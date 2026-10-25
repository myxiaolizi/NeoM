/**
 * Cloud vault file service.
 *
 * Storage model: content lives in OSS/S3 under <prefix>/<path>; the `files`
 * table is only an index (path/size/etag/mtime/order). Nothing is written to
 * the server disk. `file_versions` keeps history, `file_snapshots` the bin.
 */
import { query, execute, one, getSettingNum } from './db.js';
import { addVersion, addSnapshot } from './versions.js';
import {
  putObject,
  getText,
  deleteObject,
  copyObject,
  listObjects,
  userDocKey,
  userPrefixOf,
  resolveUserKey
} from './storage.js';
import { ApiError, bad, notFound, etagOf, toISO, safePath, parentOf, baseOf, extOf, jsonParse } from './util.js';

export const EXT_MAP = { md: 'md', mdx: 'mdx', canvas: 'canvas', txt: 'txt', html: 'html' };
const MD_EXT = /\.(md|mdx|markdown|txt)$/i;
const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/* --------------------------------- mapping -------------------------------- */
export function tagsOf(content) {
  const set = new Set();
  const re = /(^|\s)#([\p{L}\p{N}_/-]{1,40})/gu;
  let m;
  while ((m = re.exec(String(content || '')))) set.add(m[2]);
  if (set.size > 30) return [...set].slice(0, 30);
  return [...set];
}

export function nodeOf(row, content = null) {
  const path = row.path;
  const ext = extOf(path);
  return {
    id: path,
    vault_id: String(row.vault_id || 'cloud'),
    name: row.name || baseOf(path),
    path,
    is_dir: Boolean(row.is_dir),
    parent: row.parent ?? parentOf(path),
    size: Number(row.size || 0),
    mtime: toISO(row.mtime),
    ctime: toISO(row.ctime),
    order: Number(row.order || 0),
    tags: content ? tagsOf(content) : row.tags ? String(row.tags).split(',').filter(Boolean) : [],
    starred: Boolean(row.starred),
    ext: EXT_MAP[ext] || 'other'
  };
}

/* -------------------------------- read/list ------------------------------- */
export async function rowOf(userId, path) {
  return one('SELECT * FROM files WHERE user_id=? AND path=? AND deleted=0', [userId, path]);
}

export async function listRows(userId, { includeDeleted = false } = {}) {
  const [rows] = await query(
    `SELECT * FROM files WHERE user_id=? ${includeDeleted ? '' : 'AND deleted=0'} ORDER BY is_dir DESC, \`order\` ASC, name ASC`,
    [userId]
  );
  return rows;
}

export async function listTree(user) {
  const rows = await listRows(user.id);
  return rows.map((r) => nodeOf(r));
}

/** Read a document: index row + object content. */
export async function readDoc(user, rawPath) {
  const path = safePath(rawPath);
  const row = await rowOf(user.id, path);
  // A soft-deleted path keeps its OSS object (so the recycle bin can restore
  // it) but must not be readable through the normal read path.
  if (!row) {
    const trashed = await one('SELECT id FROM files WHERE user_id=? AND path=? AND deleted=1', [user.id, path]);
    if (trashed) throw notFound('文件已删除，可在回收站恢复', 'IN_RECYCLE_BIN');
  }
  const { key } = await resolveUserKey(user, path);
  const content = (await getText(key, user)) ?? (row ? '' : null);
  if (content === null && !row) throw notFound('文件不存在', 'NOT_FOUND');
  const body = content ?? '';
  const etag = etagOf(body);
  return {
    path,
    name: row?.name || baseOf(path),
    content: body,
    etag,
    mtime: toISO(row?.mtime) || toISO(new Date()),
    version: await nextVersionNo(user.id, path),
    size: Buffer.byteLength(body),
    tags: tagsOf(body)
  };
}

async function nextVersionNo(userId, path) {
  const r = await one('SELECT COALESCE(MAX(version),0)+1 AS v FROM file_versions WHERE user_id=? AND path=?', [userId, path]);
  return Number(r?.v || 1);
}

/* --------------------------------- naming --------------------------------- */
const pad = (n) => String(n).padStart(2, '0');

export function titleFromContent(content) {
  const text = String(content || '');
  const h1 = text.match(/^\s*#\s+(.+?)\s*$/m);
  let title = h1 ? h1[1] : '';
  if (!title) {
    title = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_`>#~[\]()!|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20);
  }
  title = String(title).replace(ILLEGAL_NAME, ' ').replace(/\s+/g, ' ').trim();
  return title || '未命名';
}

/** Render the naming template: YY年MM月DD日HHMM-【{title}】 */
export function templateName(title, tpl = 'YY年MM月DD日HHMM-【{title}】', d = new Date()) {
  const safeTitle = String(title || '未命名').replace(ILLEGAL_NAME, ' ').trim() || '未命名';
  const yyyy = String(d.getFullYear());
  const mins = pad(d.getMinutes());
  const name = String(tpl || 'YY年MM月DD日HHMM-【{title}】')
    // composite tokens first: HHMM / HHmm mean hours+minutes, so the trailing
    // MM must not be consumed by the month placeholder
    .replace(/HH(?:MM|mm)/g, () => `${pad(d.getHours())}${mins}`)
    .replace(/YYYY/g, () => yyyy)
    .replace(/YY/g, () => yyyy.slice(2))
    .replace(/MM/g, () => pad(d.getMonth() + 1))
    .replace(/mm/g, () => mins)
    .replace(/DD/g, () => pad(d.getDate()))
    .replace(/HH/g, () => pad(d.getHours()))
    .replace(/SS/g, () => pad(d.getSeconds()))
    .replace(/\{title\}/g, () => safeTitle)
    .replace(/\{name\}/g, () => safeTitle);
  return name.replace(ILLEGAL_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || safeTitle;
}

/** Best-effort AI naming: uses aiProxy.nameDocument when available, else heuristics. */
async function aiTitle(user, content) {
  try {
    const mod = await import('./aiProxy.js');
    if (typeof mod.nameDocument === 'function') {
      const t = await mod.nameDocument(user, content);
      if (t && String(t).trim()) return String(t).trim().slice(0, 60);
    }
  } catch {
    /* aiProxy not ready — fall through to heuristic */
  }
  return titleFromContent(content);
}

function stampName(d = new Date()) {
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/* ---------------------------------- write --------------------------------- */
async function quotaUsed(userId) {
  const row = await one('SELECT COALESCE(SUM(size),0) AS s FROM files WHERE user_id=? AND deleted=0 AND is_dir=0', [userId]);
  return Number(row?.s || 0);
}

/**
 * Write/create a document.
 * @returns {{path,name,etag,version,mtime,renamed}}
 * @throws ApiError 409 CONFLICT with remote content when baseEtag mismatches
 */
export async function writeDoc(user, { path: rawPath, content, baseEtag = undefined, naming = 'keep', device = null, reason = 'save' }) {
  let path = safePath(rawPath);
  const body = String(content ?? '');
  const row = await rowOf(user.id, path);

  // conflict detection
  if (baseEtag !== undefined && baseEtag !== null && baseEtag !== '') {
    const currentKey = (await resolveUserKey(user, path)).key;
    const current = await getText(currentKey, user);
    const currentEtag = current === null ? null : etagOf(current);
    if (currentEtag && currentEtag !== baseEtag) {
      throw new ApiError('云端内容已被修改，请先解决冲突', 409, 'CONFLICT', {
        remote: {
          content: current ?? '',
          etag: currentEtag,
          mtime: toISO(row?.mtime) || toISO(new Date()),
          device: row?.device || null
        }
      });
    }
  }

  // quota guard (only when growing)
  const quotaMb = Number(user.storage_quota_mb || 0);
  if (quotaMb > 0) {
    const used = await quotaUsed(user.id);
    const prevSize = Number(row?.size || 0);
    const delta = Buffer.byteLength(body) - prevSize;
    if (delta > 0 && used + delta > quotaMb * 1024 * 1024) {
      throw new ApiError('云空间不足，请清理回收站或升级配额', 413, 'QUOTA_EXCEEDED', { used, quotaMb });
    }
  }

  // version of previous content
  const oldKey = (await resolveUserKey(user, path)).key;
  const oldText = row ? await getText(oldKey, user) : null;
  if (row && oldText !== null && etagOf(oldText) !== etagOf(body)) {
    await addVersion({ userId: user.id, path, content: oldText, reason, device });
  }

  // auto naming
  let renamed = false;
  if (naming && naming !== 'keep') {
    const title = naming === 'ai' ? await aiTitle(user, body) : titleFromContent(body);
    const tpl = await getUserNamingTemplate(user);
    const newBase = naming === 'ai' ? title : templateName(title, tpl);
    const dir = parentOf(path);
    let candidate = `${dir ? `${dir}/` : ''}${newBase}.md`;
    if (candidate !== path) {
      // avoid clobbering an unrelated document
      const exists = await one('SELECT id FROM files WHERE user_id=? AND path=? AND deleted=0', [user.id, candidate]);
      if (!exists) {
        await moveDoc(user, path, candidate, { silentMissing: true });
        path = candidate;
        renamed = true;
      }
    }
  }

  const { key } = await resolveUserKey(user, path);
  await putObject(key, body, 'text/markdown; charset=utf-8', user);
  const etag = etagOf(body);
  const size = Buffer.byteLength(body);
  const now = new Date();
  const parent = parentOf(path);
  const vaultId = await ensureVaultId(user);
  await execute(
    `INSERT INTO files (user_id,vault_id,path,name,parent,is_dir,size,etag,mtime,ctime,oss_key,tags)
     VALUES (?,?,?,?,?,0,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE size=VALUES(size),etag=VALUES(etag),mtime=VALUES(mtime),deleted=0,deleted_at=NULL,
       is_dir=0,parent=VALUES(parent),name=VALUES(name),oss_key=VALUES(oss_key),tags=VALUES(tags)`,
    [user.id, vaultId, path, baseOf(path), parent, size, etag, now, now, key, tagsOf(body).join(',')]
  );
  const version = await nextVersionNo(user.id, path);
  return { path, name: baseOf(path), etag, version, mtime: toISO(now), renamed, size };
}

async function getUserNamingTemplate(user) {
  const row = await one('SELECT settings_json FROM users WHERE id=?', [user.id]);
  const settings = jsonParse(row?.settings_json, {}) || {};
  return settings.namingTemplate || 'YY年MM月DD日HHMM-【{title}】';
}

async function ensureVaultId(user) {
  const row = await one('SELECT id FROM vaults WHERE user_id=? ORDER BY id LIMIT 1', [user.id]);
  if (row) return row.id;
  const [r] = await execute('INSERT INTO vaults (user_id,name,kind) VALUES (?,?,?)', [user.id, 'default', 'cloud']);
  return r.insertId;
}

/* -------------------------------- structure ------------------------------- */
export async function createDoc(user, { dir = '', name = '', content = '' } = {}) {
  const parent = dir ? safePath(dir) : '';
  const filename = name
    ? `${String(name).replace(ILLEGAL_NAME, ' ').trim() || stampName()}${MD_EXT.test(name) ? '' : '.md'}`
    : `${stampName()}.md`;
  const path = parent ? `${parent}/${filename}` : filename;
  const res = await writeDoc(user, { path, content: content || `# ${baseOf(path).replace(/\.md$/i, '')}\n\n`, reason: 'save' });
  return res;
}

export async function mkdir(user, rawPath) {
  const path = safePath(rawPath);
  const vaultId = await ensureVaultId(user);
  const now = new Date();
  await execute(
    `INSERT INTO files (user_id,vault_id,path,name,parent,is_dir,size,mtime,ctime)
     VALUES (?,?,?,?,?,1,0,?,?)
     ON DUPLICATE KEY UPDATE deleted=0,deleted_at=NULL,is_dir=1`,
    [user.id, vaultId, path, baseOf(path), parentOf(path), now, now]
  );
  // make sure ancestor dirs exist as rows (so the tree can be built)
  const segs = path.split('/');
  for (let i = 1; i < segs.length; i++) {
    const p = segs.slice(0, i).join('/');
    await execute(
      `INSERT IGNORE INTO files (user_id,vault_id,path,name,parent,is_dir,size,mtime,ctime) VALUES (?,?,?,?,?,1,0,?,?)`,
      [user.id, vaultId, p, baseOf(p), parentOf(p), now, now]
    );
  }
  return { path, name: baseOf(path), is_dir: true };
}

async function moveRow(user, from, to, isDir) {
  await execute('UPDATE files SET path=?, name=?, parent=? WHERE user_id=? AND path=?', [to, baseOf(to), parentOf(to), user.id, from]);
  if (isDir) {
    // rewrite descendant paths first, then recompute their parent/name
    await execute('UPDATE files SET path=CONCAT(?, SUBSTRING(path, ?)) WHERE user_id=? AND path LIKE ?', [
      `${to}/`,
      from.length + 1,
      user.id,
      `${from}/%`
    ]);
    const [rows] = await query('SELECT id,path FROM files WHERE user_id=? AND path LIKE ?', [user.id, `${to}/%`]);
    for (const r of rows) {
      await execute('UPDATE files SET parent=?, name=? WHERE id=?', [parentOf(r.path), baseOf(r.path), r.id]);
    }
  }
}

export async function moveDoc(user, fromRaw, toRaw, { silentMissing = false } = {}) {
  const from = safePath(fromRaw);
  const to = safePath(toRaw);
  if (from === to) return { from, to, moved: false };
  if (to.startsWith(`${from}/`)) throw bad('不能移动到自身的子目录', 'BAD_TARGET');
  const row = await rowOf(user.id, from);
  if (!row) {
    if (silentMissing) return { from, to, moved: false };
    throw notFound('源文件不存在', 'NOT_FOUND');
  }
  const target = await rowOf(user.id, to);
  if (target) throw bad('目标已存在', 'EXISTS');

  if (!row.is_dir) {
    const fromKey = (await resolveUserKey(user, from)).key;
    const toKey = (await resolveUserKey(user, to)).key;
    const okCopy = await copyObject(fromKey, toKey, user);
    if (okCopy) await deleteObject(fromKey, user);
    await execute('UPDATE files SET path=?,name=?,parent=?,oss_key=? WHERE id=?', [to, baseOf(to), parentOf(to), toKey, row.id]);
    // history follows the document so the frontend keeps one continuous timeline
    await execute('UPDATE file_versions SET path=? WHERE user_id=? AND path=?', [to, user.id, from]);
    await execute('UPDATE file_snapshots SET path=? WHERE user_id=? AND path=? AND restored=0', [to, user.id, from]).catch(() => {});
  } else {
    // move every descendant object
    const [rows] = await query('SELECT path FROM files WHERE user_id=? AND path LIKE ? AND is_dir=0', [user.id, `${from}/%`]);
    for (const r of rows) {
      const fk = (await resolveUserKey(user, r.path)).key;
      const nk = (await resolveUserKey(user, `${to}${r.path.slice(from.length)}`)).key;
      if (await copyObject(fk, nk, user)) await deleteObject(fk, user);
    }
    await execute('UPDATE file_versions SET path=CONCAT(?, SUBSTRING(path, ?)) WHERE user_id=? AND path LIKE ?', [
      `${to}/`,
      from.length + 1,
      user.id,
      `${from}/%`
    ]);
    await moveRow(user, from, to, true);
  }
  // keep the parent dir rows in sync
  await execute('INSERT IGNORE INTO files (user_id,vault_id,path,name,parent,is_dir,size,mtime,ctime) VALUES (?,?,?,?,?,1,0,NOW(),NOW())', [
    user.id,
    row.vault_id || (await ensureVaultId(user)),
    parentOf(to),
    baseOf(parentOf(to)),
    parentOf(parentOf(to))
  ]);
  return { from, to, moved: true };
}

export const renameDoc = (user, from, to) => moveDoc(user, from, to);

export async function copyDoc(user, fromRaw, toRaw) {
  const from = safePath(fromRaw);
  const row = await rowOf(user.id, from);
  if (!row) throw notFound('源文件不存在');
  let to = toRaw ? safePath(toRaw) : defaultCopyName(from);
  if (row.is_dir) {
    const [rows] = await query('SELECT * FROM files WHERE user_id=? AND path LIKE ? AND is_dir=0', [user.id, `${from}/%`]);
    for (const r of rows) {
      const fk = (await resolveUserKey(user, r.path)).key;
      const np = `${to}${r.path.slice(from.length)}`;
      const nk = (await resolveUserKey(user, np)).key;
      if (await copyObject(fk, nk, user)) {
        await execute(
          `INSERT INTO files (user_id,vault_id,path,name,parent,is_dir,size,etag,mtime,ctime,oss_key)
           VALUES (?,?,?,?,?,0,?,?,NOW(),NOW(),?) ON DUPLICATE KEY UPDATE deleted=0,deleted_at=NULL,size=VALUES(size),etag=VALUES(etag)`,
          [user.id, row.vault_id, np, baseOf(np), parentOf(np), r.size, r.etag, nk]
        );
      }
    }
    await mkdir(user, to);
    return { from, to, copied: rows.length };
  }
  // single file: dedupe name
  let guard = 0;
  while ((await rowOf(user.id, to)) && guard++ < 50) to = defaultCopyName(to);
  const fk = (await resolveUserKey(user, from)).key;
  const nk = (await resolveUserKey(user, to)).key;
  if (!(await copyObject(fk, nk, user))) throw bad('复制失败：源对象不可读', 'COPY_FAILED');
  await execute(
    `INSERT INTO files (user_id,vault_id,path,name,parent,is_dir,size,etag,mtime,ctime,oss_key)
     VALUES (?,?,?,?,?,0,?,?,NOW(),NOW(),?) ON DUPLICATE KEY UPDATE deleted=0,deleted_at=NULL,size=VALUES(size),etag=VALUES(etag)`,
    [user.id, row.vault_id, to, baseOf(to), parentOf(to), row.size, row.etag, nk]
  );
  return { from, to, copied: 1 };
}

function defaultCopyName(path) {
  const dir = parentOf(path);
  const name = baseOf(path);
  const m = name.match(/^(.*?)(\.[^.]+)?$/);
  const stem = m[1];
  const ext = m[2] || '';
  return `${dir ? `${dir}/` : ''}${stem} 副本${ext}`;
}

/** Soft delete + recycle-bin snapshot (OSS objects are kept for restore). */
export async function removeDoc(user, rawPath) {
  const path = safePath(rawPath);
  const row = await rowOf(user.id, path);
  if (!row) throw notFound('文件不存在');
  const rows = row.is_dir
    ? (await query('SELECT * FROM files WHERE user_id=? AND (path=? OR path LIKE ?) AND deleted=0', [user.id, path, `${path}/%`]))[0]
    : [row];
  const totalSize = rows.reduce((a, r) => a + Number(r.size || 0), 0);
  await addSnapshot({
    userId: user.id,
    path,
    name: row.name,
    kind: row.is_dir ? 'dir' : 'file',
    size: totalSize,
    etag: row.etag,
    reason: 'delete',
    payload: {
      dir: Boolean(row.is_dir),
      files: rows.map((r) => ({
        path: r.path,
        name: r.name,
        parent: r.parent,
        is_dir: Boolean(r.is_dir),
        size: Number(r.size || 0),
        etag: r.etag,
        order: Number(r.order || 0),
        oss_key: r.oss_key
      }))
    }
  });
  const now = new Date();
  for (const r of rows) {
    await execute('UPDATE files SET deleted=1, deleted_at=? WHERE id=?', [now, r.id]);
  }
  return { path, deleted: rows.length, kind: row.is_dir ? 'dir' : 'file' };
}

export async function restoreSnapshot(user, id) {
  const { readSnapshot, markSnapshotRestored } = await import('./versions.js');
  const snap = await readSnapshot(user.id, id);
  if (!snap || !snap.payload) throw notFound('快照不存在');
  const now = new Date();
  let restored = 0;
  for (const f of snap.payload.files || []) {
    if (f.is_dir) {
      await mkdir(user, f.path);
      restored++;
      continue;
    }
    await execute(
      `INSERT INTO files (user_id,vault_id,path,name,parent,is_dir,size,etag,mtime,ctime,oss_key,deleted)
       VALUES (?,?,?,?,?,0,?,?,?,?,?,0)
       ON DUPLICATE KEY UPDATE deleted=0,deleted_at=NULL,size=VALUES(size),etag=VALUES(etag),oss_key=VALUES(oss_key)`,
      [user.id, await ensureVaultId(user), f.path, f.name || baseOf(f.path), parentOf(f.path), f.size || 0, f.etag, now, now, f.oss_key]
    );
    restored++;
  }
  await markSnapshotRestored(user.id, id);
  return { path: snap.path, restored };
}

/** Hard delete from the recycle bin (removes OSS objects too). */
export async function purgeSnapshot(user, id) {
  const { readSnapshot } = await import('./versions.js');
  const snap = await readSnapshot(user.id, id);
  if (!snap) throw notFound('快照不存在');
  for (const f of snap.payload?.files || []) {
    if (f.is_dir) continue;
    const key = (f.oss_key || (await resolveUserKey(user, f.path)).key);
    await deleteObject(key, user);
  }
  await execute('DELETE FROM file_snapshots WHERE id=? AND user_id=?', [id, user.id]);
  return { purged: true };
}

/* ---------------------------------- sort ---------------------------------- */
export async function applySort(user, orders = []) {
  let n = 0;
  for (const o of orders) {
    if (!o || o.path === undefined) continue;
    const path = safePath(o.path);
    await execute('UPDATE files SET `order`=? WHERE user_id=? AND path=?', [Number(o.order) || 0, user.id, path]);
    n++;
  }
  return { updated: n };
}

export async function recentDocs(user, limit = 20) {
  const [rows] = await query(
    'SELECT * FROM files WHERE user_id=? AND deleted=0 AND is_dir=0 ORDER BY mtime DESC LIMIT ?',
    [user.id, Math.min(100, Math.max(1, Number(limit) || 20))]
  );
  return rows.map((r) => nodeOf(r));
}

/* --------------------------------- search --------------------------------- */
export async function search(user, { q: keyword = '', scope = 'all', limit = 200 } = {}) {
  const kw = String(keyword || '').trim();
  if (!kw) return { hits: [], total: 0 };
  const maxHits = Math.min(200, Math.max(1, Number(limit) || 200));
  const rows = (await listRows(user.id)).filter((r) => !r.is_dir);
  const hits = [];
  let total = 0;
  const lower = kw.toLowerCase();
  const tagKey = kw.replace(/^#/, '');

  for (const row of rows) {
    if (hits.length >= maxHits) break;
    const nameHit = scope === 'name' || scope === 'all' ? String(row.name || '').toLowerCase().includes(lower) : false;
    let matches = [];
    let tags = String(row.tags || '').split(',').filter(Boolean);

    if (scope === 'content' || scope === 'tag' || scope === 'all') {
      if (Number(row.size || 0) > 3 * 1024 * 1024) continue;
      const content = await getText((await resolveUserKey(user, row.path)).key, user);
      if (content !== null) {
        tags = tagsOf(content);
        if (scope === 'tag' || scope === 'all') {
          const tagHit = tags.some((t) => t.toLowerCase().includes(tagKey.toLowerCase()));
          if (tagHit && !nameHit) matches.push({ line: 0, text: tags.map((t) => `#${t}`).join(' ') });
          if (tagHit) total++;
        }
        if (scope === 'content' || scope === 'all') {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && matches.length < 5; i++) {
            if (lines[i].toLowerCase().includes(lower)) {
              matches.push({ line: i + 1, text: lines[i].slice(0, 300) });
            }
          }
        }
      }
    }
    if (nameHit && !matches.some((m) => m.line === 0)) matches.unshift({ line: 0, text: row.path });
    if (nameHit) total++;
    if (nameHit || matches.length) {
      hits.push({ path: row.path, name: row.name || baseOf(row.path), matches, tags, mtime: toISO(row.mtime) });
    }
  }
  return { hits, total: hits.length, scope, q: kw };
}

/* ----------------------------------- sync --------------------------------- */
/** Two-way sync between the OSS prefix and the files index. */
export async function syncVault(user) {
  const prefix = userPrefixOf(user.username);
  const objects = await listObjects(prefix, user);
  const rows = await listRows(user.id);
  const byPath = new Map(rows.map((r) => [r.path, r]));
  const added = [];
  const updated = [];
  const vaultId = await ensureVaultId(user);

  for (const obj of objects) {
    const rel = obj.key.slice(prefix.length + 1);
    if (!rel || rel.endsWith('/')) continue;
    if (/^(tupian|bk|ot)\//.test(rel)) continue; // attachment dirs are not vault docs
    const row = byPath.get(rel);
    if (!row) {
      const text = await getText(obj.key, user);
      const etag = text === null ? null : etagOf(text);
      await execute(
        `INSERT INTO files (user_id,vault_id,path,name,parent,is_dir,size,etag,mtime,ctime,oss_key,tags)
         VALUES (?,?,?,?,?,0,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE deleted=0,deleted_at=NULL,size=VALUES(size),etag=VALUES(etag)`,
        [user.id, vaultId, rel, baseOf(rel), parentOf(rel), Number(obj.size || 0), etag, obj.mtime || new Date(), new Date(), obj.key, text ? tagsOf(text).join(',') : null]
      );
      added.push(rel);
      byPath.delete(rel);
    } else {
      byPath.delete(rel);
      const size = Number(obj.size || 0);
      if (size !== Number(row.size || 0)) {
        const text = await getText(obj.key, user);
        await execute('UPDATE files SET size=?, etag=?, oss_key=?, tags=? WHERE id=?', [
          size,
          text === null ? row.etag : etagOf(text),
          obj.key,
          text ? tagsOf(text).join(',') : row.tags,
          row.id
        ]);
        updated.push(rel);
      }
    }
  }
  const missing = [...byPath.values()].filter((r) => !r.is_dir).map((r) => r.path);
  for (const row of byPath.values()) {
    if (row.is_dir) continue;
    await execute('UPDATE files SET deleted=1, deleted_at=NOW() WHERE id=?', [row.id]);
  }
  return { added, updated, missing, objects: objects.length };
}

/* -------------------------------- conflicts ------------------------------- */
export async function conflictInfo(user, rawPath) {
  const path = safePath(rawPath);
  const row = await rowOf(user.id, path);
  const remoteText = await getText((await resolveUserKey(user, path)).key, user);
  return {
    local: row ? { etag: row.etag, size: Number(row.size), mtime: toISO(row.mtime) } : null,
    remote: remoteText === null ? null : { content: remoteText, etag: etagOf(remoteText), mtime: toISO(row?.mtime) || null, device: null }
  };
}

/* ---------------------------------- stats --------------------------------- */
export async function vaultStats(user) {
  const row = await one(
    `SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files WHERE user_id=? AND deleted=0 AND is_dir=0`,
    [user.id]
  );
  const bin = await one('SELECT COUNT(*) AS items FROM file_snapshots WHERE user_id=? AND restored=0', [user.id]);
  const versions = await one('SELECT COUNT(*) AS items FROM file_versions WHERE user_id=?', [user.id]);
  return {
    files: Number(row?.files || 0),
    bytes: Number(row?.bytes || 0),
    quotaMb: Number(user.storage_quota_mb || 0),
    recycleItems: Number(bin?.items || 0),
    versions: Number(versions?.items || 0),
    prefix: userPrefixOf(user.username)
  };
}

export { getSettingNum };
