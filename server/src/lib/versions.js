/**
 * Version history + recycle-bin snapshots.
 * Keeps at most N versions per document (default 200) and de-duplicates
 * identical content saved within a short window (default 10 minutes).
 */
import { query, execute, one, tx, getSettingNum } from './db.js';
import { etagOf, toISO, jsonParse, num } from './util.js';

const DEFAULTS = { maxVersions: 200, dedupeMinutes: 10 };

async function limits() {
  const [maxVersions, dedupeMinutes] = await Promise.all([
    getSettingNum('max_versions_per_file', DEFAULTS.maxVersions),
    getSettingNum('version_dedupe_minutes', DEFAULTS.dedupeMinutes)
  ]);
  return { maxVersions: maxVersions || DEFAULTS.maxVersions, dedupeMinutes: dedupeMinutes || DEFAULTS.dedupeMinutes };
}

/**
 * Append a version row for (user, path). Returns the inserted id or null when skipped.
 * @param {object} opts {userId, path, content, reason, device}
 */
export async function addVersion({ userId, path, content, reason = 'save', device = null }) {
  const body = String(content ?? '');
  const size = Buffer.byteLength(body);
  const { maxVersions, dedupeMinutes } = await limits();

  // de-dupe: same user+path with identical content inside the window
  const recent = await one(
    `SELECT id, size FROM file_versions
      WHERE user_id=? AND path=? AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
      ORDER BY id DESC LIMIT 1`,
    [userId, path, dedupeMinutes]
  );
  if (recent) {
    const prev = await one('SELECT content FROM file_versions WHERE id=?', [recent.id]);
    if (prev && etagOf(prev.content) === etagOf(body)) return null;
  }

  const next = await one('SELECT COALESCE(MAX(version),0)+1 AS v FROM file_versions WHERE user_id=? AND path=?', [
    userId,
    path
  ]);
  const version = Number(next?.v || 1);
  const [r] = await execute(
    'INSERT INTO file_versions (user_id,path,version,content,size,reason,device) VALUES (?,?,?,?,?,?,?)',
    [userId, path, version, body, size, reason, device]
  );

  // trim oldest beyond cap
  const row = await one('SELECT COUNT(*) AS c FROM file_versions WHERE user_id=? AND path=?', [userId, path]);
  const count = Number(row?.c || 0);
  if (count > maxVersions) {
    const extra = count - maxVersions;
    await execute(
      `DELETE FROM file_versions WHERE user_id=? AND path=? ORDER BY id ASC LIMIT ${Number(extra)}`,
      [userId, path]
    );
  }
  return r.insertId;
}

export function versionMeta(row) {
  return {
    id: row.id,
    doc_id: row.path,
    path: row.path,
    version: Number(row.version),
    size: Number(row.size),
    created_at: toISO(row.created_at),
    reason: row.reason,
    device: row.device || undefined
  };
}

export async function listVersions(userId, path, limit = 50) {
  const [rows] = await query(
    `SELECT id,path,version,size,reason,device,created_at FROM file_versions
      WHERE user_id=? AND path=? ORDER BY id DESC LIMIT ?`,
    [userId, path, Math.min(500, Math.max(1, Number(limit) || 50))]
  );
  return rows.map(versionMeta);
}

export async function readVersion(userId, id) {
  const row = await one('SELECT * FROM file_versions WHERE id=? AND user_id=?', [id, userId]);
  if (!row) return null;
  return { ...versionMeta(row), content: row.content };
}

/** Latest version number for a path (0 when none). */
export async function latestVersionNo(userId, path) {
  const row = await one('SELECT COALESCE(MAX(version),0) AS v FROM file_versions WHERE user_id=? AND path=?', [
    userId,
    path
  ]);
  return Number(row?.v || 0);
}

export async function versionCount(userId, path) {
  const row = await one('SELECT COUNT(*) AS c FROM file_versions WHERE user_id=? AND path=?', [userId, path]);
  return Number(row?.c || 0);
}

/* ------------------------------- snapshots -------------------------------- */
/** Store a recycle-bin snapshot (single file or a whole directory). */
export async function addSnapshot({ userId, path, name, kind = 'file', size = 0, etag = null, payload = null, ossKey = null, reason = 'delete' }) {
  const keepDays = await getSettingNum('recycle_keep_days', 30);
  const [r] = await execute(
    `INSERT INTO file_snapshots (user_id,path,name,kind,size,etag,payload,oss_key,reason,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [userId, path, name, kind, Number(size) || 0, etag, payload ? JSON.stringify(payload) : null, ossKey, reason, keepDays || 30]
  );
  // trim oldest recycle entries beyond cap
  const maxItems = await getSettingNum('recycle_max_items', 500);
  const row = await one('SELECT COUNT(*) AS c FROM file_snapshots WHERE user_id=? AND restored=0', [userId]);
  const count = Number(row?.c || 0);
  if (count > (maxItems || 500)) {
    await execute(
      `DELETE FROM file_snapshots WHERE user_id=? AND restored=0 ORDER BY id ASC LIMIT ${Number(count - maxItems)}`,
      [userId]
    );
  }
  return r.insertId;
}

export function snapshotMeta(row) {
  const payload = jsonParse(row.payload, null);
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    kind: row.kind,
    size: Number(row.size),
    etag: row.etag || null,
    reason: row.reason,
    restored: Boolean(row.restored),
    created_at: toISO(row.created_at),
    expires_at: toISO(row.expires_at),
    items: Array.isArray(payload?.files) ? payload.files.length : payload?.content ? 1 : 0
  };
}

export async function listSnapshots(userId, limit = 100) {
  const [rows] = await query(
    `SELECT id,user_id,path,name,kind,size,etag,reason,restored,created_at,expires_at,payload
       FROM file_snapshots WHERE user_id=? ORDER BY id DESC LIMIT ?`,
    [userId, Math.min(500, Math.max(1, Number(limit) || 100))]
  );
  return rows.map((r) => ({ ...snapshotMeta(r), _payload: jsonParse(r.payload, null) }));
}

export async function readSnapshot(userId, id) {
  const row = await one('SELECT * FROM file_snapshots WHERE id=? AND user_id=?', [id, userId]);
  if (!row) return null;
  return { ...snapshotMeta(row), payload: jsonParse(row.payload, null) };
}

export async function markSnapshotRestored(userId, id) {
  await execute('UPDATE file_snapshots SET restored=1 WHERE id=? AND user_id=?', [id, userId]);
}

export async function purgeExpiredSnapshots() {
  const [r] = await execute('DELETE FROM file_snapshots WHERE expires_at IS NOT NULL AND expires_at < NOW()');
  return r.affectedRows || 0;
}

export { num, tx };
