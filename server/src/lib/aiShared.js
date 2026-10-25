/**
 * aiShared.js — shared infrastructure for the AI / billing / admin modules.
 *
 * Owned by server-ai-admin. Keeps three concerns in one place so that the AI,
 * billing and admin routes never depend on the exact export names chosen by
 * server-core:
 *
 *   1. a resilient bridge to the shared MySQL pool (lib/db.js) with a direct
 *      mysql2 fallback, so this module is testable stand-alone;
 *   2. a resilient bridge to lib/auth.js plus a self-contained JWT fallback so
 *      requireUser / requireAdmin always work even before auth.js lands;
 *   3. crypto helpers (aes-256-gcm) for upstream API keys, ::: they are stored
 *      encrypted in the DB and only ever returned masked.
 *
 * Response envelope is uniform: {status:true,data} / {status:false,msg,code}.
 */
import crypto from 'node:crypto';

/* ============================== envelope ============================== */

export function ok(res, data = null, extra = {}) {
  if (res.headersSent) return res;
  return res.json({ status: true, data, ...extra });
}

export function fail(res, msg, code = null, statusCode = 200, extra = {}) {
  if (res.headersSent) return res;
  const body = { status: false, msg };
  if (code) body.code = code;
  return res.status(statusCode).json({ ...body, ...extra });
}

export const ERR = {
  UNAUTHORIZED: { code: 'UNAUTHORIZED', msg: '请先登录', http: 401 },
  FORBIDDEN: { code: 'FORBIDDEN', msg: '无权访问', http: 403 },
  BAD_REQUEST: { code: 'BAD_REQUEST', msg: '参数错误', http: 400 },
  NOT_FOUND: { code: 'NOT_FOUND', msg: '目标不存在', http: 404 },
  INSUFFICIENT_POINTS: { code: 'INSUFFICIENT_POINTS', msg: '积分不足，请先充值', http: 402 },
  RATE_LIMITED: { code: 'RATE_LIMITED', msg: '请求过于频繁，请稍后再试', http: 429 },
  DISABLED: { code: 'DISABLED', msg: '该功能已被禁用', http: 403 },
  UPSTREAM: { code: 'UPSTREAM_ERROR', msg: '上游服务异常', http: 502 }
};

/** Throw this from services to abort a request with a contract response. */
export class ApiError extends Error {
  constructor(code, msg, http = 400, data) {
    super(msg || code);
    this.name = 'ApiError';
    this.code = code;
    // `msg` is what the envelope prints; keep it in sync with .message so both
    // `err.msg` (our funnel) and `err.message` (logs) read sensibly.
    this.msg = msg || code;
    this.http = http;
    this.data = data;
  }
  static from(key, msg, data) {
    const d = ERR[key] || ERR.BAD_REQUEST;
    return new ApiError(d.code, msg || d.msg, d.http, data);
  }
}

/** Express error funnel: keep every response on the same envelope. */
export function sendError(res, err) {
  const e = err instanceof ApiError ? err : null;
  if (e) return fail(res, e.msg, e.code, e.http, e.data !== undefined ? { data: e.data } : {});
  const code = err && err.code;
  if (code === 'ER_NO_SUCH_TABLE') {
    return fail(res, '数据表尚未就绪（等待 001_schema.sql 初始化）', 'SCHEMA_MISSING', 503);
  }
  // Handlers in this module sometimes raise plain Errors carrying status/code
  // (e.g. upstream 502s). Honour them instead of flattening every failure to 500.
  const status = Number(err && err.status) || 0;
  if (status >= 400 && status < 600) {
    return fail(res, (err && err.message) || '请求失败', code || 'ERROR', status);
  }
  return fail(res, (err && err.message) || '服务器内部错误', code || 'INTERNAL', 500);
}

/** Wrap async handlers so thrown errors land on sendError. */
export function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err instanceof ApiError) return sendError(res, err);
      if (!res.headersSent) sendError(res, err);
      else {
        try { res.end(); } catch { /* noop */ }
      }
    });
  };
}

/* ============================== numbers ============================== */

export const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
export const int = (v, d = 0) => Math.trunc(num(v, d));
export const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v)));

/**
 * Page/size/offset from the query string.
 *
 * `size` and `limit` are deliberately aliases: routes destructure either name,
 * and an undefined value here would reach SQL as `LIMIT NULL` (silently
 * returning zero rows). Always hand back both.
 */
export function pagination(req, defSize = 20, maxSize = 200) {
  const q = (req && req.query) || {};
  const page = Math.max(1, int(q.page, 1));
  const size = clamp(int(q.pageSize || q.size || q.limit, defSize), 1, maxSize);
  return { page, size, limit: size, pageSize: size, offset: (page - 1) * size };
}

/* ============================== DB bridge ============================== */

const modCache = new Map();

/** Import a sibling module, tolerating "not created yet". */
export async function loadOptional(spec) {
  if (modCache.has(spec)) return modCache.get(spec);
  let m = null;
  try {
    m = await import(spec);
  } catch {
    m = null;
  }
  modCache.set(spec, m);
  return m;
}

export function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) {
    if (typeof mod[n] === 'function') return mod[n];
  }
  const d = mod.default;
  if (d) {
    for (const n of names) {
      if (typeof d[n] === 'function') return d[n].bind(d);
    }
    if (typeof d === 'function') return d;
  }
  return null;
}

let poolPromise = null;

export function dbEnv() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'NeoM',
    password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'neom'
  };
}

/** Resolve the shared mysql2 pool (server-core lib/db.js) or build our own. */
export async function getPool() {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    for (const spec of ['./db.js', '../db/index.js', '../db/pool.js']) {
      const m = await loadOptional(spec);
      if (!m) continue;
      const d = m.default;
      let cand = m.pool || d?.pool || d?.db || m.db;
      if (!cand) {
        const getter = pickFn(m, ['getPool', 'pool']);
        if (getter) {
          try {
            cand = await getter();
          } catch {
            cand = null;
          }
        }
      }
      if (typeof cand === 'function') {
        try {
          cand = await cand();
        } catch {
          cand = null;
        }
      }
      if (cand && typeof cand.query === 'function') return cand;
    }
    const mysql = await import('mysql2/promise');
    const impl = mysql.default || mysql;
    const pool = impl.createPool({
      ...dbEnv(),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'local',
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: false,
      namedPlaceholders: false
    });
    return pool;
  })();
  return poolPromise;
}

/** Run a parameterised query against the shared pool. */
export async function q(sql, params = []) {
  const pool = await getPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function one(sql, params = []) {
  const row = await q1(sql, params);
  return row || null;
}

export const val = async (sql, params = [], d = 0) => {
  const row = await q1(sql, params);
  if (!row) return d;
  const first = Object.values(row)[0];
  return first === null || first === undefined ? d : first;
};

/** Transaction helper; fn receives a connection-bound query helper. */
export async function withTx(fn) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  const cq = async (sql, params = []) => {
    const [r] = await conn.query(sql, params);
    return r;
  };
  const c1 = async (sql, params = []) => {
    const r = await cq(sql, params);
    return Array.isArray(r) ? r[0] : r;
  };
  try {
    await conn.beginTransaction();
    const out = await fn({ conn, q: cq, q1: c1 });
    await conn.commit();
    return out;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* noop */
    }
    throw err;
  } finally {
    try {
      conn.release();
    } catch {
      /* noop */
    }
  }
}

/** Query that degrades to `empty` when the table does not exist yet. */
export async function safeQ(sql, params = [], empty = []) {
  try {
    return await q(sql, params);
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR')) return empty;
    throw err;
  }
}

export async function safeVal(sql, params = [], d = 0) {
  try {
    return await val(sql, params, d);
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR')) return d;
    throw err;
  }
}

export async function tableExists(name) {
  try {
    const r = await q(
      'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      [name]
    );
    return num(r && r[0] && r[0].c) > 0;
  } catch {
    return false;
  }
}

export async function columnExists(table, column) {
  try {
    const r = await q(
      'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
      [table, column]
    );
    return num(r && r[0] && r[0].c) > 0;
  } catch {
    return false;
  }
}

/* ============================== auth bridge ============================== */

export function jwtSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.NEOM_JWT_SECRET ||
    process.env.NEOM_SECRET ||
    'neom-dev-secret'
  );
}

export function extractToken(req) {
  const h = req.headers && req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
  if (req.query && typeof req.query.token === 'string' && req.query.token) return req.query.token;
  const cookie = (req.headers && req.headers.cookie) || '';
  const m = /(?:^|;\s*)(?:neom\.token|token)=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

/** Verify a JWT through lib/auth.js when available, else jsonwebtoken. */
export async function verifyToken(token) {
  const m = await loadOptional('./auth.js');
  const verify = pickFn(m, ['verifyToken', 'verify', 'decodeToken', 'parseToken', 'readToken']);
  if (verify) {
    try {
      const payload = await verify(token);
      if (payload && typeof payload === 'object') return payload;
    } catch {
      /* fall through to local verification */
    }
  }
  try {
    const jwtMod = await import('jsonwebtoken');
    const jwt = jwtMod.default || jwtMod;
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}

/** Sign a JWT (admin login) — prefers lib/auth.js's own signer. */
export async function signToken(payload, opts = {}) {
  const m = await loadOptional('./auth.js');
  const sign = pickFn(m, ['signToken', 'issueToken', 'createToken', 'sign', 'makeToken']);
  if (sign) {
    try {
      const t = await sign(payload, opts);
      if (typeof t === 'string') return t;
    } catch {
      /* fall back */
    }
  }
  const jwtMod = await import('jsonwebtoken');
  const jwt = jwtMod.default || jwtMod;
  return jwt.sign(payload, jwtSecret(), { expiresIn: opts.expiresIn || process.env.JWT_EXPIRES || '30d' });
}

export async function verifyPassword(plain, hash) {
  const m = await loadOptional('./auth.js');
  const verify = pickFn(m, ['verifyPassword', 'comparePassword', 'checkPassword']);
  if (verify) {
    try {
      const r = await verify(plain, hash);
      if (typeof r === 'boolean') return r;
      if (r && typeof r === 'object') return !!(r.ok || r.valid || r.match);
    } catch {
      /* fall through */
    }
  }
  try {
    const bcryptMod = await import('bcryptjs');
    const bcrypt = bcryptMod.default || bcryptMod;
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function normalizeUser(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const u = payload.user || payload;
  const id = u.id ?? u.userId ?? u.uid ?? u.sub ?? null;
  if (id === null || id === undefined) return null;
  return {
    id: typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id,
    username: u.username || u.name || '',
    nickname: u.nickname || u.username || '',
    role: u.role || 'user',
    status: u.status || 'active',
    raw: u
  };
}

const USER_COLS = ['id', 'username', 'nickname', 'avatar', 'email', 'role', 'points', 'status', 'storage_quota_mb', 'rpm_limit', 'tpm_limit', 'created_at', 'last_login_at'];
const NUM_COLS = new Set(['id', 'points', 'storage_quota_mb', 'rpm_limit', 'tpm_limit']);

/** Load the authoritative user row (fresh points / status). */
export async function loadUser(id) {
  if (id === null || id === undefined || id === '') return null;
  let cols = USER_COLS;
  try {
    const r = await q(
      'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      ['users']
    );
    const have = new Set((Array.isArray(r) ? r : []).map((x) => String(x.c).toLowerCase()));
    const picked = USER_COLS.filter((c) => have.has(c));
    if (picked.length) cols = picked;
  } catch {
    /* keep defaults */
  }
  const row = await one(`SELECT ${cols.join(', ')} FROM users WHERE id = ? LIMIT 1`, [id]);
  if (!row) return null;
  for (const k of Object.keys(row)) if (NUM_COLS.has(k)) row[k] = num(row[k]);
  return row;
}

/** Try lib/auth.js middleware first; otherwise verify locally. */
async function trySharedMiddleware(names) {
  const m = await loadOptional('./auth.js');
  const fn = pickFn(m, names);
  if (!fn) return null;
  return (req, res, next) => {
    try {
      fn(req, res, (err) => {
        if (err) return next(err);
        if (!req.user) {
          // shared middleware may put payload elsewhere
          req.user = req.user || req.auth || req.session?.user || null;
        }
        next();
      });
    } catch (err) {
      next(err);
    }
  };
}

async function resolveUser(req) {
  if (req._neomUser) return req._neomUser;
  let payloadUser = req.user ? normalizeUser(req.user) : null;
  if (!payloadUser) {
    const token = extractToken(req);
    if (!token) return null;
    const payload = await verifyToken(token);
    payloadUser = normalizeUser(payload);
  }
  if (!payloadUser || payloadUser.id === null) return null;
  let row = null;
  try {
    row = await loadUser(payloadUser.id);
  } catch {
    row = null;
  }
  const merged = {
    ...(row || {}),
    ...payloadUser,
    ...(row || {})
  };
  if (!merged.username && payloadUser.username) merged.username = payloadUser.username;
  req._neomUser = merged;
  req.user = merged;
  return merged;
}

/** Auth middleware: populates req.user with a fresh DB row. */
export const requireUser = wrap(async (req, res, next) => {
  if (!req.user || !(req.user.id ?? req.user.userId)) {
    const shared = await trySharedMiddleware(['requireAuth', 'authRequired', 'requireLogin']);
    if (shared) {
      await new Promise((resolve, reject) => {
        shared(req, res, (err) => (err ? reject(err) : resolve()));
      });
    }
  }
  const user = await resolveUser(req);
  if (!user) return fail(res, ERR.UNAUTHORIZED.msg, ERR.UNAUTHORIZED.code, 401);
  if (String(user.status) === 'banned' || String(user.status) === 'disabled') {
    return fail(res, '账号已被封禁，请联系管理员', 'ACCOUNT_BANNED', 403);
  }
  next();
});

/** Admin middleware: requireUser + role check. */
export const requireAdmin = wrap(async (req, res, next) => {
  const shared = await trySharedMiddleware(['requireAdmin', 'adminOnly', 'requireAdministrator']);
  if (shared && !req.user) {
    let blocked = false;
    await new Promise((resolve, reject) => {
      shared(req, res, (err) => {
        if (err) return reject(err);
        if (res.headersSent) {
          blocked = true;
          return resolve();
        }
        resolve();
      });
    });
    if (blocked) return undefined;
  }
  const user = await resolveUser(req);
  if (!user) return fail(res, ERR.UNAUTHORIZED.msg, ERR.UNAUTHORIZED.code, 401);
  if (user.role !== 'admin') return fail(res, ERR.FORBIDDEN.msg, ERR.FORBIDDEN.code, 403);
  next();
});

/**
 * Insert an admin audit row. Schema (001_schema.sql):
 *   admin_audit(admin_id, action, target, detail JSON, ip, created_at)
 * Accepts an optional explicit actor for non-request contexts.
 */
export async function audit(req, action, entityType = null, entityId = null, meta = null, actor = null) {
  const user = actor || (req && (req._neomUser || req.user)) || {};
  const target = [entityType, entityId === null || entityId === undefined ? null : entityId]
    .filter((x) => x !== null && x !== undefined && x !== '')
    .join(':');
  try {
    await q(
      'INSERT INTO admin_audit (admin_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,NOW())',
      [
        user.id ?? null,
        String(action).slice(0, 64),
        String(target).slice(0, 190),
        meta ? JSON.stringify(meta).slice(0, 60000) : null,
        req ? clientIp(req) : ''
      ]
    );
  } catch {
    /* audit must never break the request */
  }
}

export function clientIp(req) {
  const xff = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  const ip = String(xff).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}

/* ============================== crypto ============================== */

function keyBytes() {
  const secret = process.env.AI_KEY_SECRET || process.env.NEOM_AI_SECRET || jwtSecret();
  return crypto.createHash('sha256').update(`neom:ai-key:v1:${secret}`).digest();
}

/**
 * Secret storage. server-core owns lib/util.js (AES-256-GCM, format
 * "v1:<b64iv>:<b64tag>:<b64ct>") and 002_seed already encrypts the seeded
 * mimo channel key with it, so we MUST decrypt through that module whenever it
 * exists. The local implementation ("enc:v1:…", base64url) is the fallback for
 * stand-alone testing and for keys we ourselves encrypted before util.js
 * landed. Both formats are detected on read.
 */
let secretBridge = null;

async function secretFns() {
  if (secretBridge !== null) return secretBridge;
  const util = await loadOptional('./util.js');
  secretBridge = {
    encrypt: pickFn(util, ['encryptSecret', 'encrypt', 'encryptKey']),
    decrypt: pickFn(util, ['decryptSecret', 'decrypt', 'decryptKey']),
    mask: pickFn(util, ['maskKey', 'maskSecret'])
  };
  return secretBridge;
}

/** Synchronous local aes-256-gcm encrypt → "enc:v1:<iv>:<tag>:<ct>". */
export function encryptSecretLocal(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['enc', 'v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

export function decryptSecretLocal(payload) {
  if (!payload) return '';
  const s = String(payload);
  if (!s.startsWith('enc:v1:')) return s; // plaintext (custom user key / legacy)
  const parts = s.split(':');
  if (parts.length !== 5) return '';
  try {
    const iv = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const ct = Buffer.from(parts[4], 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Encrypt via server-core's util.js when present, else locally. */
export async function encryptSecret(plain) {
  if (!plain) return '';
  const f = await secretFns();
  if (f.encrypt) {
    try {
      const out = f.encrypt(String(plain));
      if (out) return String(out);
    } catch {
      /* fall back */
    }
  }
  return encryptSecretLocal(plain);
}

/**
 * Decrypt anything we might find in api_key_enc: server-core's "v1:…",
 * our own "enc:v1:…", or a bare plaintext key.
 */
export async function decryptSecret(payload) {
  if (!payload) return '';
  const s = String(payload).trim();
  if (!s) return '';
  if (s.startsWith('enc:v1:')) return decryptSecretLocal(s);
  const f = await secretFns();
  if (f.decrypt && /^v1:/.test(s)) {
    try {
      const out = f.decrypt(s);
      if (out) return String(out);
    } catch {
      /* fall back below */
    }
  }
  if (f.decrypt) {
    try {
      const out = f.decrypt(s);
      if (out && /^[\x20-\x7e]+$/.test(String(out))) return String(out);
    } catch {
      /* noop */
    }
  }
  // bare plaintext key (e.g. hand-inserted during bootstrap)
  return s;
}

/** sk-abcdef… → sk-***cdef */
export function maskSecret(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 8) return `${s.slice(0, 2)}***${s.slice(-2)}`;
  const prefix = /^sk-/i.test(s) ? 'sk-' : s.slice(0, Math.min(3, Math.floor(s.length / 4)));
  return `${prefix}***${s.slice(-4)}`;
}

export const hasSecret = (payload) => !!payload && String(payload).length > 0;

/* ============================== sys_settings ============================== */

let sysColsPromise = null;

/** sys_settings may be (k,v) or (skey,value): detect once. */
export async function sysCols() {
  if (sysColsPromise) return sysColsPromise;
  sysColsPromise = (async () => {
    try {
      const r = await q(
        'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
        ['sys_settings']
      );
      const have = new Set((Array.isArray(r) ? r : []).map((x) => String(x.c).toLowerCase()));
      if (!have.size) return null;
      const keyCol = ['k', 'skey', 'setting_key', 'key'].find((c) => have.has(c));
      const valCol = ['v', 'value', 'svalue', 'value_json', 'val'].find((c) => have.has(c));
      if (!keyCol || !valCol) return null;
      return { table: 'sys_settings', keyCol, valCol };
    } catch {
      return null;
    }
  })();
  return sysColsPromise;
}

export async function sysGet(key, def = null) {
  const cols = await sysCols();
  if (!cols) return def;
  try {
    const row = await one(
      `SELECT \`${cols.valCol}\` AS v FROM \`${cols.table}\` WHERE \`${cols.keyCol}\` = ? LIMIT 1`,
      [key]
    );
    if (!row || row.v === null || row.v === undefined || row.v === '') return def;
    let v = row.v;
    if (typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(v)) v = v.toString('utf8');
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try {
          return JSON.parse(t);
        } catch {
          return v;
        }
      }
      if (t === 'true') return true;
      if (t === 'false') return false;
      if (t !== '' && !Number.isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
      return v;
    }
    return v;
  } catch {
    return def;
  }
}

export async function sysSet(key, value) {
  const cols = await sysCols();
  if (!cols) return false;
  const raw = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  await q(
    `INSERT INTO \`${cols.table}\` (\`${cols.keyCol}\`, \`${cols.valCol}\`) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE \`${cols.valCol}\` = VALUES(\`${cols.valCol}\`)`,
    [key, raw]
  );
  return true;
}

export async function sysGetMany(keys) {
  const out = {};
  for (const k of keys) out[k] = await sysGet(k);
  return out;
}

/* ============================== misc helpers ============================== */

export function iso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** fetch with timeout; returns {ok, status, text, json, ms} */
export async function fetchJson(url, init = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, text, json, ms: Date.now() - started, headers: res.headers };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    return {
      ok: false,
      status: aborted ? 504 : 0,
      text: '',
      json: null,
      ms: Date.now() - started,
      error: aborted ? `请求超时(${timeoutMs}ms)` : (err && err.message) || String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonMaybe(v, def = null) {
  if (v === null || v === undefined || v === '') return def;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return def;
  }
}

export function toSqlDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const rid = (prefix = '') => `${prefix}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
