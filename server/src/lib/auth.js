/**
 * Auth: bcrypt password hashing, JWT issue/verify, express middlewares.
 * Exports (stable contract): requireAuth, requireAdmin, authOptional,
 * signToken, verifyToken, hashPassword, verifyPassword, createSession.
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, query, one } from './db.js';
import { env, unauthorized, forbidden, sha256, deviceOf, ipOf, toISO } from './util.js';

const BCRYPT_ROUNDS = 10;
const COOKIE_NAME = 'neom.token';

export const hashPassword = (plain) => bcrypt.hash(String(plain), BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => (hash ? bcrypt.compare(String(plain), hash) : Promise.resolve(false));

/** access token: {uid, username, role, sid} */
export function signToken(user, sid = null) {
  return jwt.sign({ uid: user.id, username: user.username, role: user.role, sid }, env.jwtSecret, {
    expiresIn: env.jwtExpires
  });
}

/** refresh token: distinct purpose claim so it cannot be used as an access token */
export function signRefresh(user, sid = null) {
  return jwt.sign({ uid: user.id, sid, typ: 'refresh' }, env.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token, { allowRefresh = false } = {}) {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (!allowRefresh && payload.typ === 'refresh') return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.cookies && req.cookies[COOKIE_NAME]) return decodeURIComponent(req.cookies[COOKIE_NAME]);
  // support ?token= for SSE / download links only
  if (req.query && typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return null;
}

/** Simple cookie parser (no extra dependency). */
export function cookieParser(req, _res, next) {
  const header = req.headers.cookie;
  req.cookies = {};
  if (header) {
    for (const part of String(header).split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k) req.cookies[k] = v;
    }
  }
  next();
}

export function setAuthCookie(res, token) {
  const maxAge = 7 * 24 * 3600;
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
  );
}

export function clearAuthCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

/** Persist a session row; returns its id. */
export async function createSession(user, req, token) {
  try {
    const [r] = await pool.query(
      `INSERT INTO user_sessions (user_id,device,ip,user_agent,token_hash,expires_at)
       VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [user.id, deviceOf(req), ipOf(req), String(req.headers['user-agent'] || '').slice(0, 500), sha256(token)]
    );
    return r.insertId;
  } catch {
    return null;
  }
}

/** Resolve the caller: valid JWT + active user + non revoked session. */
async function loadUser(req, { required }) {
  const token = extractToken(req);
  if (!token) {
    if (required) throw unauthorized('请先登录', 'NO_TOKEN');
    return null;
  }
  const payload = verifyToken(token);
  if (!payload || !payload.uid) {
    if (required) throw unauthorized('登录状态已失效，请重新登录', 'BAD_TOKEN');
    return null;
  }
  const user = await one('SELECT * FROM users WHERE id=?', [payload.uid]);
  if (!user) {
    if (required) throw unauthorized('账号不存在', 'NO_USER');
    return null;
  }
  if (user.status === 'banned') {
    throw unauthorized(user.ban_reason || '账号已被封禁', 'BANNED');
  }
  // session revocation check (only when we recorded the session)
  if (payload.sid) {
    const s = await one('SELECT revoked, expires_at FROM user_sessions WHERE id=?', [payload.sid]);
    if (s && (Number(s.revoked) === 1 || (s.expires_at && new Date(s.expires_at) < new Date()))) {
      if (required) throw unauthorized('会话已失效，请重新登录', 'SESSION_REVOKED');
      return null;
    }
  }
  req.userRow = user;
  req.user = {
    id: user.id,
    username: user.username,
    nickname: user.nickname || user.username,
    email: user.email || null,
    phone: user.phone || null,
    avatar: user.avatar || null,
    role: user.role,
    points: Number(user.points || 0),
    status: user.status,
    storage_quota_mb: Number(user.storage_quota_mb || 0),
    rpm_limit: Number(user.rpm_limit || 0),
    tpm_limit: Number(user.tpm_limit || 0),
    created_at: toISO(user.created_at),
    last_login_at: toISO(user.last_login_at),
    sid: payload.sid || null
  };
  return req.user;
}

export const requireAuth = (req, res, next) => {
  loadUser(req, { required: true }).then(() => next()).catch(next);
};

export const authOptional = (req, res, next) => {
  loadUser(req, { required: false })
    .then(() => next())
    .catch(() => {
      req.user = null;
      next();
    });
};

export const requireAdmin = (req, res, next) => {
  loadUser(req, { required: true })
    .then(() => {
      if (req.user.role !== 'admin' && req.user.role !== 'developer') {
        return next(forbidden('需要管理员权限', 'ADMIN_ONLY'));
      }
      next();
    })
    .catch(next);
};

/** strict admin (no developer role) */
export const requireAdminStrict = (req, res, next) => {
  loadUser(req, { required: true })
    .then(() => {
      if (req.user.role !== 'admin') return next(forbidden('需要管理员权限', 'ADMIN_ONLY'));
      next();
    })
    .catch(next);
};

export { COOKIE_NAME };
export default { requireAuth, requireAdmin, authOptional, signToken, verifyToken, hashPassword, verifyPassword };
