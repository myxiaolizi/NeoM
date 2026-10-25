/**
 * DB facade + domain helpers shared by every route.
 * Exports both the raw pool/query (pool.js) and small business helpers.
 */
import { pool, query, execute, tx, one, ping } from '../db/pool.js';
import { toISO, nowSql, jsonParse, num } from './util.js';

export { pool, query, execute, tx, one, ping };
export { getPool, closePool } from '../db/pool.js';
export default pool;

/* ------------------------------- settings -------------------------------- */
export async function getSetting(k, def = null) {
  const row = await one('SELECT v FROM sys_settings WHERE k=?', [k]);
  if (!row) return def;
  return row.v;
}

export async function getSettingNum(k, def = 0) {
  const v = await getSetting(k);
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export async function getSettings(keys = null) {
  const [rows] = keys
    ? await query('SELECT k,v FROM sys_settings WHERE k IN (?)', [keys])
    : await query('SELECT k,v FROM sys_settings');
  const out = {};
  for (const r of rows) out[r.k] = r.v;
  return out;
}

export async function setSetting(k, v) {
  await execute(
    'INSERT INTO sys_settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)',
    [k, v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v)]
  );
}

/* ------------------------------ site config ------------------------------- */
const PUBLIC_SITE_KEYS = [
  'site_name', 'site_title', 'site_desc', 'banner_title', 'banner_sub', 'banner_image', 'banner_cta',
  'features', 'footer', 'icp', 'copyright', 'contact', 'agreement', 'announcement', 'notice',
  'register_enabled', 'default_theme', 'download_title', 'oss_domain', 'client_version', 'mobile_base'
];

export async function getSiteConfig() {
  const [rows] = await query('SELECT k,v FROM site_config');
  const raw = {};
  for (const r of rows) raw[r.k] = r.v;
  const out = {};
  for (const k of PUBLIC_SITE_KEYS) {
    if (raw[k] === undefined) continue;
    out[k] = jsonParse(raw[k], raw[k]);
  }
  // explicitly never leak secrets: only whitelisted keys are returned
  return out;
}

export async function getSiteConfigRaw() {
  const [rows] = await query('SELECT k,v FROM site_config');
  const out = {};
  for (const r of rows) out[r.k] = jsonParse(r.v, r.v);
  return out;
}

export async function setSiteConfig(k, v) {
  await execute(
    'INSERT INTO site_config (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)',
    [k, v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v)]
  );
}

export async function getSiteDoc(key) {
  return one('SELECT k,title,content,updated_at FROM site_docs WHERE k=?', [key]);
}

/* --------------------------------- users ---------------------------------- */
export function publicUser(row) {
  if (!row) return null;
  const settings = jsonParse(row.settings_json, {}) || {};
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    phone: row.phone || null,
    nickname: row.nickname || row.username,
    avatar: row.avatar || null,
    role: row.role,
    points: num(row.points, 0),
    status: row.status,
    storage_quota_mb: num(row.storage_quota_mb, 5120),
    rpm_limit: num(row.rpm_limit, 60),
    tpm_limit: num(row.tpm_limit, 200000),
    created_at: toISO(row.created_at),
    last_login_at: toISO(row.last_login_at),
    settings: settings
  };
}

export async function getUserById(id) {
  return one('SELECT * FROM users WHERE id=?', [id]);
}

export async function ensureVault(userId, name = 'default') {
  const row = await one('SELECT id FROM vaults WHERE user_id=? AND name=?', [userId, name]);
  if (row) return row.id;
  const [r] = await execute('INSERT INTO vaults (user_id,name,kind) VALUES (?,?,?)', [userId, name, 'cloud']);
  return r.insertId;
}

/**
 * Atomically change a user's points and append a ledger row.
 * delta < 0 = spend. Returns the new balance.
 */
export async function addPoints(userId, delta, meta = {}) {
  return tx(async (c) => {
    const [rows] = await c.query('SELECT points FROM users WHERE id=? FOR UPDATE', [userId]);
    if (!rows.length) throw new Error('user not found');
    const before = Number(rows[0].points || 0);
    const after = Number((before + Number(delta)).toFixed(4));
    await c.query('UPDATE users SET points=? WHERE id=?', [after, userId]);
    await c.query(
      `INSERT INTO point_ledger
       (user_id,kind,points,balance_after,model,prompt_tokens,cached_tokens,completion_tokens,audio_seconds,note,ref_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId,
        meta.kind || (delta < 0 ? 'ai' : 'admin-adjust'),
        Number(delta).toFixed(4),
        after,
        meta.model || null,
        num(meta.prompt_tokens, 0),
        num(meta.cached_tokens, 0),
        num(meta.completion_tokens, 0),
        num(meta.audio_seconds, 0),
        meta.note || null,
        meta.ref_id || null
      ]
    );
    return after;
  });
}

export async function createNotification(userId, title, content, kind = 'system') {
  await execute('INSERT INTO notifications (user_id,kind,title,content) VALUES (?,?,?,?)', [userId, kind, title, content]);
}

/* ------------------------------ rate limiting ----------------------------- */
/**
 * Fixed-window rate limit. scope+key+window bucket row in rate_limits.
 * Returns {allowed, hits, limit, retryAfter}.
 */
export async function hitRate(scope, key, limit, windowSeconds) {
  const bucketMs = windowSeconds * 1000;
  const bucket = new Date(Math.floor(Date.now() / bucketMs) * bucketMs);
  const bucketSql = nowSql(bucket);
  try {
    await execute(
      `INSERT INTO rate_limits (scope,\`key\`,hits,window_at) VALUES (?,?,1,?)
       ON DUPLICATE KEY UPDATE hits=hits+1`,
      [scope, String(key).slice(0, 190), bucketSql]
    );
    const row = await one('SELECT hits, blocked FROM rate_limits WHERE scope=? AND `key`=? AND window_at=?', [
      scope,
      String(key).slice(0, 190),
      bucketSql
    ]);
    const hits = row ? Number(row.hits) : 1;
    return { allowed: hits <= limit, hits, limit, retryAfter: Math.ceil((bucket.getTime() + bucketMs - Date.now()) / 1000) };
  } catch {
    return { allowed: true, hits: 0, limit }; // fail-open, never break the route
  }
}

/* --------------------------------- misc ----------------------------------- */
export async function tableCount(table) {
  const row = await one(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return row ? Number(row.c) : 0;
}

export async function pingDb() {
  try {
    return await ping();
  } catch {
    return false;
  }
}

