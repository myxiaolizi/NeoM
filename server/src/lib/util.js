/**
 * Shared helpers: env loading, response envelope, errors, crypto, path safety.
 * No DB / no express-router dependencies so it can be imported anywhere.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

/* --------------------------------- errors --------------------------------- */
export class ApiError extends Error {
  constructor(msg, status = 400, code = 'BAD_REQUEST', data = undefined) {
    super(msg);
    this.status = status;
    this.code = code;
    this.data = data;
    // The shared error middleware only forwards the message when err.expose is
    // set; every ApiError is an intentional, user-facing 4xx (or explicit 5xx).
    this.expose = true;
  }
}
export const bad = (msg, code = 'BAD_REQUEST', data) => new ApiError(msg, 400, code, data);
export const unauthorized = (msg = '请先登录', code = 'UNAUTHORIZED') => new ApiError(msg, 401, code);
export const forbidden = (msg = '没有权限', code = 'FORBIDDEN') => new ApiError(msg, 403, code);
export const notFound = (msg = '资源不存在', code = 'NOT_FOUND') => new ApiError(msg, 404, code);

/* -------------------------------- envelope -------------------------------- */
export function ok(res, data = null, msg = undefined) {
  const body = { status: true, data };
  if (msg) body.msg = msg;
  return res.json(body);
}
export function fail(res, msg = '操作失败', code = 'BAD_REQUEST', status = 400, data = undefined) {
  const body = { status: false, msg, code };
  if (data !== undefined) body.data = data;
  return res.status(status).json(body);
}
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------------------------------- misc ---------------------------------- */
export const nowISO = () => new Date().toISOString();
export const toISO = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export const nowSql = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
export const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const etagOf = (content) => md5(typeof content === 'string' ? content : String(content ?? ''));
export const randId = (n = 10) => crypto.randomBytes(32).toString('base64url').replace(/[-_]/g, '').slice(0, n);
export const randCode = (n = 16) =>
  Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('');

export function ipOf(req) {
  const raw =
    (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
    (req.headers['x-real-ip'] || '').toString() ||
    req.ip ||
    req.socket?.remoteAddress ||
    '';
  return raw.replace(/^::ffff:/, '').slice(0, 64);
}
export function deviceOf(req) {
  const ua = (req.headers['user-agent'] || '').toString();
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ios/i.test(ua)) return 'iOS';
  if (/macintosh|mac os x/i.test(ua)) return 'macOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/linux/i.test(ua)) return 'Linux';
  return ua ? 'Unknown' : 'API';
}

/* ------------------------------ path safety ------------------------------- */
/** Normalize a user supplied vault path. Rejects traversal / absolute / NUL. */
export function safePath(input, { allowEmpty = false } = {}) {
  if (input === undefined || input === null) {
    if (allowEmpty) return '';
    throw bad('path 不能为空', 'BAD_PATH');
  }
  let p = String(input).trim();
  if (/[\u0000-\u001f]/.test(p)) throw bad('path 含非法字符', 'BAD_PATH');
  p = p.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw bad('path 不允许绝对路径', 'BAD_PATH');
  const segs = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw bad('path 不允许目录穿越', 'BAD_PATH');
    if (seg.length > 255) throw bad('path 片段过长', 'BAD_PATH');
    segs.push(seg);
  }
  const out = segs.join('/');
  if (!out && !allowEmpty) throw bad('path 不能为空', 'BAD_PATH');
  if (out.length > 1000) throw bad('path 过长', 'BAD_PATH');
  return out;
}
export const parentOf = (p) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
export const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
export const extOf = (p) => {
  const b = baseOf(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
};
export const joinPath = (...parts) => parts.filter((x) => x !== '' && x !== undefined && x !== null).join('/');

/* ------------------------------- encryption ------------------------------- */
/** AES-256-GCM with SECRETS_KEY material. Format: v1:<b64 iv>:<b64 tag>:<b64 ct> */
function secretsKey() {
  const raw = process.env.SECRETS_KEY || 'neom-dev-insecure-secrets-key-change-me';
  return crypto.createHash('sha256').update(raw).digest();
}
export function encryptSecret(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretsKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
export function decryptSecret(blob) {
  if (!blob) return null;
  const parts = String(blob).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // legacy plain value (e.g. seeded by hand)
    return String(blob);
  }
  try {
    const [, ivb, tagb, ctb] = parts;
    const d = crypto.createDecipheriv('aes-256-gcm', secretsKey(), Buffer.from(ivb, 'base64'));
    d.setAuthTag(Buffer.from(tagb, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ctb, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
export function maskKey(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}

/* --------------------------------- config --------------------------------- */
export const env = {
  port: Number(process.env.PORT || 3300),
  host: process.env.HOST || '0.0.0.0',
  publicBase: (process.env.PUBLIC_BASE_URL || 'https://m.zhengl.vip').replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'neom-dev-jwt-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  oss: {
    bucket: process.env.OSS_BUCKET || 'zhengle',
    endpoint: process.env.OSS_ENDPOINT || 'oss-cn-guangzhou.aliyuncs.com',
    region: process.env.OSS_REGION || 'oss-cn-guangzhou',
    domain: (process.env.OSS_DOMAIN || '').replace(/\/$/, ''),
    ak: process.env.OSS_AK || '',
    sk: process.env.OSS_SK || '',
    prefixAdmin: (process.env.OSS_PREFIX_ADMIN || 'md/mdadmin').replace(/\/$/, ''),
    prefixUser: (process.env.OSS_PREFIX_USER || 'md/user').replace(/\/$/, '')
  },
  mimo: {
    apiKey: process.env.MIMO_API_KEY || '',
    baseUrl: process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1'
  }
};

/* ------------------------------ small utils ------------------------------- */
export function paginate(query, defLimit = 20, maxLimit = 200) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || (query.page_size ? parseInt(query.page_size, 10) : defLimit)));
  return { page, limit, offset: (page - 1) * limit };
}
export const jsonParse = (v, fallback = null) => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
export const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
export const bool = (v, def = false) => (v === undefined || v === null || v === '' ? def : v === true || v === 1 || v === '1' || v === 'true');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};
