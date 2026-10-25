/**
 * /api/plugins — installed list, store, install/uninstall/toggle, upload (zip),
 * update, and the builtin manifest registry used by the frontend.
 */
import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import unzipper from 'unzipper';
import multer from 'multer';
import { query, execute, one } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { ok, bad, notFound, asyncH, jsonParse, toISO, SERVER_ROOT, ApiError, env } from '../lib/util.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

export const PLUGIN_ROOT = path.join(SERVER_ROOT, 'data', 'plugins');
const MANIFEST_REQUIRED = ['id', 'name', 'version', 'description', 'author', 'category'];
const CATEGORIES = ['core', 'visualization', 'productivity', 'media', 'data', 'ai', 'publish'];
const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const VERSION_RE = /^\d+\.\d+\.\d+([.-][\w.]+)?$/;

function manifestOf(row) {
  return jsonParse(row.manifest_json, null);
}

function pluginOut(row) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    author: row.author,
    category: row.category,
    icon: row.icon,
    builtin: Boolean(row.builtin),
    status: row.status,
    downloads: Number(row.downloads || 0),
    rating: Number(row.rating || 0),
    default_enabled: Boolean(row.default_enabled),
    published_at: toISO(row.published_at || row.created_at),
    changelog: row.changelog || null,
    manifest: manifestOf(row)
  };
}

/** Validate + normalize an uploaded manifest. */
export function validateManifest(m) {
  if (!m || typeof m !== 'object') throw bad('manifest.json 格式不正确', 'BAD_MANIFEST');
  for (const k of MANIFEST_REQUIRED) {
    if (!m[k] || typeof m[k] !== 'string' || !String(m[k]).trim()) throw bad(`manifest 缺少必填字段 ${k}`, 'BAD_MANIFEST');
  }
  if (!ID_RE.test(m.id)) throw bad('manifest.id 只能是小写字母、数字与短横线（2-48 位）', 'BAD_PLUGIN_ID');
  if (!VERSION_RE.test(m.version)) throw bad('manifest.version 需为 x.y.z 形式', 'BAD_VERSION');
  if (m.category && !CATEGORIES.includes(m.category)) throw bad(`manifest.category 必须是 ${CATEGORIES.join('/')}`, 'BAD_CATEGORY');
  if (m.entry && (String(m.entry).includes('..') || path.isAbsolute(String(m.entry)))) throw bad('manifest.entry 不允许目录穿越', 'BAD_ENTRY');
  const contributions = m.contributes && typeof m.contributes === 'object' ? m.contributes : {};
  if (contributions.commands && !Array.isArray(contributions.commands)) throw bad('contributes.commands 必须是数组', 'BAD_MANIFEST');
  return {
    ...m,
    minAppVersion: m.minAppVersion || '1.0.0',
    icon: m.icon || 'plugin',
    builtin: Boolean(m.builtin),
    permissions: Array.isArray(m.permissions) ? m.permissions : [],
    defaultEnabled: Boolean(m.defaultEnabled),
    contributes: {
      ribbon: Boolean(contributions.ribbon),
      leftPanel: Boolean(contributions.leftPanel),
      rightPanel: Boolean(contributions.rightPanel),
      statusItem: Boolean(contributions.statusItem),
      commands: (contributions.commands || []).map((c) => ({
        id: String(c.id || `plugin.${m.id}.cmd`),
        name: String(c.name || c.id || 'command'),
        hotkey: c.hotkey || undefined
      }))
    }
  };
}

/** Safe zip extraction: reject traversal, absolute paths, and oversized totals. */
async function extractZip(buffer, destDir) {
  const dir = await unzipper.Open.buffer(buffer);
  let total = 0;
  const written = [];
  for (const entry of dir.files) {
    const rawName = String(entry.path || '').replace(/\\/g, '/');
    if (!rawName || rawName.endsWith('/')) continue;
    if (rawName.includes('..') || rawName.startsWith('/') || /^[A-Za-z]:/.test(rawName)) {
      throw bad(`zip 中存在非法路径：${rawName}`, 'ZIP_TRAVERSAL');
    }
    total += Number(entry.uncompressedSize || 0);
    if (total > 20 * 1024 * 1024) throw bad('zip 解压后体积超过 20MB', 'ZIP_TOO_LARGE');
    const target = path.resolve(destDir, rawName);
    if (!target.startsWith(path.resolve(destDir))) throw bad('zip 路径越界', 'ZIP_TRAVERSAL');
    const buf = await entry.buffer();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buf);
    written.push(rawName);
  }
  return written;
}

/** Find manifest.json at the zip root or one level deep. */
async function readManifest(dir) {
  const candidates = [path.join(dir, 'manifest.json')];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) if (e.isDirectory()) candidates.push(path.join(dir, e.name, 'manifest.json'));
  for (const c of candidates) {
    try {
      const raw = await fs.readFile(c, 'utf8');
      return { manifest: JSON.parse(raw), file: c, baseDir: path.dirname(c) };
    } catch {
      /* try next */
    }
  }
  return null;
}

/* --------------------------------- public --------------------------------- */
router.get(
  '/store',
  asyncH(async (req, res) => {
    const category = String(req.query.category || '').trim();
    const q = String(req.query.q || '').trim();
    const where = ["status='published'"];
    const params = [];
    if (category && category !== 'all') {
      where.push('(category=? OR category=(SELECT category FROM plugins p2 WHERE p2.id=?))');
      params.push(category, category);
    }
    if (q) {
      where.push('(name LIKE ? OR description LIKE ? OR id LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const [rows] = await query(
      `SELECT * FROM plugins WHERE ${where.join(' AND ')} ORDER BY builtin DESC, downloads DESC, sort ASC, id ASC LIMIT 500`,
      params
    );
    return ok(res, { total: rows.length, plugins: rows.map(pluginOut) });
  })
);

router.get(
  '/manifest',
  asyncH(async (req, res) => {
    const [rows] = await query("SELECT * FROM plugins WHERE builtin=1 ORDER BY sort ASC, id ASC");
    const manifests = rows.map((r) => manifestOf(r)).filter(Boolean);
    return ok(res, { total: manifests.length, manifests });
  })
);

/* -------------------------------- protected ------------------------------- */
router.use(requireAuth);

router.get(
  '/installed',
  asyncH(async (req, res) => {
    const [rows] = await query(
      `SELECT up.id AS up_id, up.version AS up_version, up.enabled, up.source, up.installed_at,
              p.*
         FROM user_plugins up JOIN plugins p ON p.id = up.plugin_id
        WHERE up.user_id=? ORDER BY p.sort ASC, p.id ASC`,
      [req.user.id]
    );
    const list = rows.map((r) => {
      const latest = r.version;
      return {
        id: r.id,
        version: r.up_version || r.version,
        enabled: Boolean(r.enabled),
        source: r.source,
        installed_at: toISO(r.installed_at),
        manifest: manifestOf(r),
        update_available: r.up_version && r.up_version !== latest ? latest : undefined
      };
    });
    return ok(res, list);
  })
);

router.post(
  '/install',
  asyncH(async (req, res) => {
    const { id, version } = req.body || {};
    if (!id) throw bad('缺少插件 id', 'BAD_INPUT');
    const plugin = await one('SELECT * FROM plugins WHERE id=?', [String(id)]);
    if (!plugin) throw notFound('插件不存在');
    if (plugin.status !== 'published') throw bad('该插件当前不可安装', 'NOT_AVAILABLE');
    const ver = String(version || plugin.version);
    await execute(
      `INSERT INTO user_plugins (user_id,plugin_id,version,enabled,source) VALUES (?,?,?,1,?)
       ON DUPLICATE KEY UPDATE version=VALUES(version), enabled=1, source=VALUES(source)`,
      [req.user.id, plugin.id, ver, plugin.builtin ? 'builtin' : 'store']
    );
    await execute('UPDATE plugins SET downloads=downloads+1 WHERE id=?', [plugin.id]);
    return ok(res, { id: plugin.id, version: ver, enabled: true }, '安装成功');
  })
);

router.post(
  '/uninstall',
  asyncH(async (req, res) => {
    const { id } = req.body || {};
    if (!id) throw bad('缺少插件 id', 'BAD_INPUT');
    const plugin = await one('SELECT * FROM plugins WHERE id=?', [String(id)]);
    if (plugin && plugin.builtin && Boolean(plugin.default_enabled)) {
      // builtin plugins that ship enabled can only be disabled, not removed
      await execute('UPDATE user_plugins SET enabled=0 WHERE user_id=? AND plugin_id=?', [req.user.id, plugin.id]);
      return ok(res, { id: plugin.id, uninstalled: false, enabled: false }, '内置插件已禁用（不可卸载）');
    }
    await execute('DELETE FROM user_plugins WHERE user_id=? AND plugin_id=?', [req.user.id, String(id)]);
    return ok(res, { id, uninstalled: true }, '已卸载');
  })
);

router.post(
  '/toggle',
  asyncH(async (req, res) => {
    const { id, enabled } = req.body || {};
    if (!id) throw bad('缺少插件 id', 'BAD_INPUT');
    const plugin = await one('SELECT * FROM plugins WHERE id=?', [String(id)]);
    if (!plugin) throw notFound('插件不存在');
    const value = enabled === undefined ? 1 : enabled ? 1 : 0;
    await execute(
      `INSERT INTO user_plugins (user_id,plugin_id,version,enabled,source) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`,
      [req.user.id, plugin.id, plugin.version, value, plugin.builtin ? 'builtin' : 'store']
    );
    return ok(res, { id: plugin.id, enabled: Boolean(value) }, Boolean(value) ? '已启用' : '已禁用');
  })
);

router.post(
  '/update',
  asyncH(async (req, res) => {
    const { id } = req.body || {};
    if (!id) throw bad('缺少插件 id', 'BAD_INPUT');
    const plugin = await one('SELECT * FROM plugins WHERE id=?', [String(id)]);
    if (!plugin) throw notFound('插件不存在');
    const latest = await one('SELECT version,changelog FROM plugin_versions WHERE plugin_id=? ORDER BY id DESC LIMIT 1', [plugin.id]);
    const target = latest?.version || plugin.version;
    await execute(
      `INSERT INTO user_plugins (user_id,plugin_id,version,enabled,source) VALUES (?,?,?,1,?)
       ON DUPLICATE KEY UPDATE version=VALUES(version)`,
      [req.user.id, plugin.id, target, plugin.builtin ? 'builtin' : 'store']
    );
    if (!plugin.builtin) await execute('UPDATE plugins SET version=? WHERE id=?', [target, plugin.id]);
    return ok(res, { id: plugin.id, version: target, changelog: latest?.changelog || null }, '已更新到最新版本');
  })
);

/* ---------------------------------- upload -------------------------------- */
router.post(
  '/upload',
  upload.single('file'),
  asyncH(async (req, res) => {
    if (!req.file) throw bad('未收到插件包（zip）', 'NO_FILE');
    if (req.file.size > 5 * 1024 * 1024) throw bad('插件包不能超过 5MB', 'ZIP_TOO_LARGE');
    const name = String(req.file.originalname || 'plugin.zip');
    if (!/\.zip$/i.test(name)) throw bad('只接受 .zip 插件包', 'BAD_FILE');
    const buf = req.file.buffer;
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw bad('文件不是有效的 zip', 'BAD_ZIP');

    const tmp = path.join(PLUGIN_ROOT, '.tmp', `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(tmp, { recursive: true });
    try {
      const files = await extractZip(buf, tmp);
      const found = await readManifest(tmp);
      if (!found) throw bad('插件包内缺少 manifest.json', 'NO_MANIFEST');
      const manifest = validateManifest(found.manifest);
      // keep only the manifest-bearing folder
      const finalDir = path.join(PLUGIN_ROOT, manifest.id);
      await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(path.dirname(finalDir), { recursive: true });
      if (found.baseDir === tmp) {
        await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
        await fs.cp(tmp, finalDir, { recursive: true });
      } else {
        await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
        await fs.cp(found.baseDir, finalDir, { recursive: true });
      }

      await execute(
        `INSERT INTO plugins (id,name,version,description,author,category,icon,builtin,manifest_json,status,default_enabled)
         VALUES (?,?,?,?,?,?,?,0,?, 'pending', ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name),version=VALUES(version),description=VALUES(description),
           author=VALUES(author),category=VALUES(category),icon=VALUES(icon),manifest_json=VALUES(manifest_json)`,
        [
          manifest.id,
          manifest.name,
          manifest.version,
          manifest.description,
          manifest.author,
          manifest.category,
          manifest.icon,
          JSON.stringify(manifest),
          manifest.defaultEnabled ? 1 : 0
        ]
      );
      await execute(
        `INSERT INTO plugin_versions (plugin_id,version,changelog,status) VALUES (?,?,?, 'pending')
         ON DUPLICATE KEY UPDATE changelog=VALUES(changelog)`,
        [manifest.id, manifest.version, `上传自 ${name}`]
      );
      await execute(
        `INSERT INTO user_plugins (user_id,plugin_id,version,enabled,source) VALUES (?,?,?,0,'uploaded')
         ON DUPLICATE KEY UPDATE version=VALUES(version), source='uploaded'`,
        [req.user.id, manifest.id, manifest.version]
      );
      return ok(res, { id: manifest.id, manifest, files: files.length, dir: `data/plugins/${manifest.id}`, status: 'pending' }, '上传成功，等待管理员审核');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  })
);

export default router;
