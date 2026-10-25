/**
 * /api/auth — register, login, refresh, profile, password, sessions, bind.
 */
import { Router } from 'express';
import { query, execute, one, tx, publicUser, getSetting, setSetting, addPoints } from '../lib/db.js';
import {
  requireAuth,
  hashPassword,
  verifyPassword,
  signToken,
  signRefresh,
  verifyToken,
  createSession,
  setAuthCookie,
  clearAuthCookie,
  extractToken,
  COOKIE_NAME
} from '../lib/auth.js';
import { ok, bad, unauthorized, asyncH, ipOf, deviceOf, sha256, toISO, env, ApiError } from '../lib/util.js';

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

async function logLogin(userId, account, kind, okFlag, req, msg = null) {
  try {
    await execute(
      'INSERT INTO login_logs (user_id,account,kind,ok,ip,user_agent,device,msg) VALUES (?,?,?,?,?,?,?,?)',
      [userId, String(account || '').slice(0, 190), kind, okFlag ? 1 : 0, ipOf(req), String(req.headers['user-agent'] || '').slice(0, 500), deviceOf(req), msg]
    );
  } catch {
    /* logging must never break auth */
  }
}

async function ensureVault(userId) {
  const row = await one('SELECT id FROM vaults WHERE user_id=? LIMIT 1', [userId]);
  if (row) return row.id;
  const [r] = await execute('INSERT INTO vaults (user_id,name,kind) VALUES (?,?,?)', [userId, 'default', 'cloud']);
  return r.insertId;
}

async function issueTokens(user, req, res) {
  const token = signToken(user, null);
  const sid = await createSession(user, req, token);
  const finalToken = sid ? signToken(user, sid) : token;
  const refreshToken = signRefresh(user, sid);
  setAuthCookie(res, finalToken);
  return { token: finalToken, refreshToken, sid };
}

/* -------------------------------- register -------------------------------- */
router.post(
  '/register',
  asyncH(async (req, res) => {
    const enabled = String(await getSetting('register_enabled', '1')) !== '0';
    if (!enabled) throw bad('当前未开放注册', 'REGISTER_CLOSED');

    const { username, password, email, nickname } = req.body || {};
    if (!username || !USERNAME_RE.test(String(username))) {
      throw bad('用户名需 3-32 位，仅支持中英文、数字、下划线与短横线', 'BAD_USERNAME');
    }
    if (!password || String(password).length < 6 || String(password).length > 64) {
      throw bad('密码需 6-64 位', 'BAD_PASSWORD');
    }
    if (email && !EMAIL_RE.test(String(email))) throw bad('邮箱格式不正确', 'BAD_EMAIL');

    const name = String(username).trim();
    const dup = await one('SELECT id FROM users WHERE username=?', [name]);
    if (dup) throw bad('用户名已被占用', 'USERNAME_TAKEN');
    if (email) {
      const dupMail = await one('SELECT id FROM users WHERE email=?', [email]);
      if (dupMail) throw bad('邮箱已被注册', 'EMAIL_TAKEN');
    }

    const hash = await hashPassword(password);
    const gift = Number(await getSetting('register_gift_points', '100')) || 0;
    const settings = { theme: 'system', accent: '#2f6fed', signupGift: gift };
    const userId = await tx(async (c) => {
      const [r] = await c.query(
        `INSERT INTO users (username,email,password_hash,nickname,role,points,status,settings_json,register_ip,last_login_at)
         VALUES (?,?,?,?,'user',?,'active',?,?,NOW())`,
        [name, email || null, hash, nickname || name, gift, JSON.stringify(settings), ipOf(req)]
      );
      const id = r.insertId;
      if (gift > 0) {
        await c.query(
          `INSERT INTO point_ledger (user_id,kind,points,balance_after,note) VALUES (?,?,?,?,?)`,
          [id, 'register-gift', gift, gift, '注册赠送积分']
        );
      }
      return id;
    });

    await ensureVault(userId);
    await logLogin(userId, name, 'register', true, req, '注册成功');
    const row = await one('SELECT * FROM users WHERE id=?', [userId]);
    const user = publicUser(row);
    const tokens = await issueTokens({ id: userId, username: name, role: 'user' }, req, res);
    return ok(res, { ...tokens, user, gift }, '注册成功');
  })
);

/* --------------------------------- login ---------------------------------- */
router.post(
  '/login',
  asyncH(async (req, res) => {
    const { account, password } = req.body || {};
    if (!account || !password) throw bad('请输入账号与密码', 'BAD_INPUT');
    const acc = String(account).trim();

    const row = await one('SELECT * FROM users WHERE username=? OR email=? OR phone=? LIMIT 1', [acc, acc, acc]);
    if (!row) {
      await logLogin(null, acc, 'fail', false, req, '账号不存在');
      throw unauthorized('账号或密码错误', 'BAD_CREDENTIALS');
    }
    const good = await verifyPassword(password, row.password_hash);
    if (!good) {
      await logLogin(row.id, acc, 'fail', false, req, '密码错误');
      throw unauthorized('账号或密码错误', 'BAD_CREDENTIALS');
    }
    if (row.status === 'banned') {
      await logLogin(row.id, acc, 'fail', false, req, '账号已封禁');
      throw new ApiError(row.ban_reason || '账号已被封禁，请联系管理员', 401, 'BANNED');
    }

    await execute('UPDATE users SET last_login_at=NOW() WHERE id=?', [row.id]);
    await logLogin(row.id, acc, 'login', true, req, '登录成功');
    const fresh = await one('SELECT * FROM users WHERE id=?', [row.id]);
    const tokens = await issueTokens({ id: row.id, username: row.username, role: row.role }, req, res);
    return ok(res, { ...tokens, user: publicUser(fresh) }, '登录成功');
  })
);

/* --------------------------------- logout --------------------------------- */
router.post(
  '/logout',
  asyncH(async (req, res) => {
    const token = extractToken(req);
    if (token) {
      await execute('UPDATE user_sessions SET revoked=1 WHERE token_hash=?', [sha256(token)]);
    }
    clearAuthCookie(res);
    return ok(res, { loggedOut: true });
  })
);

/* ---------------------------------- me ------------------------------------ */
router.get(
  '/me',
  requireAuth,
  asyncH(async (req, res) => {
    const row = await one('SELECT * FROM users WHERE id=?', [req.user.id]);
    const stats = await one(
      `SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files WHERE user_id=? AND deleted=0 AND is_dir=0`,
      [req.user.id]
    );
    return ok(res, { ...publicUser(row), stats: { files: Number(stats.files || 0), bytes: Number(stats.bytes || 0) } });
  })
);

/* --------------------------------- refresh -------------------------------- */
router.post(
  '/refresh',
  asyncH(async (req, res) => {
    const provided = (req.body && (req.body.refreshToken || req.body.token)) || extractToken(req);
    if (!provided) throw unauthorized('缺少刷新令牌', 'NO_TOKEN');
    const payload = verifyToken(provided, { allowRefresh: true });
    if (!payload || !payload.uid) throw unauthorized('刷新令牌无效或已过期', 'BAD_TOKEN');
    const row = await one('SELECT * FROM users WHERE id=?', [payload.uid]);
    if (!row) throw unauthorized('账号不存在', 'NO_USER');
    if (row.status === 'banned') throw unauthorized('账号已被封禁', 'BANNED');
    if (payload.sid) {
      const s = await one('SELECT revoked FROM user_sessions WHERE id=?', [payload.sid]);
      if (s && Number(s.revoked) === 1) throw unauthorized('会话已失效', 'SESSION_REVOKED');
    }
    const token = signToken(row, payload.sid || null);
    setAuthCookie(res, token);
    await execute('UPDATE user_sessions SET last_seen_at=NOW() WHERE token_hash=?', [sha256(token)]);
    return ok(res, { token, refreshToken: signRefresh(row, payload.sid || null), user: publicUser(row) });
  })
);

/* --------------------------------- profile -------------------------------- */
router.post(
  '/profile',
  requireAuth,
  asyncH(async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (b.nickname !== undefined) {
      const nick = String(b.nickname).trim().slice(0, 64);
      if (!nick) throw bad('昵称不能为空', 'BAD_NICKNAME');
      sets.push('nickname=?');
      vals.push(nick);
    }
    if (b.avatar !== undefined) {
      sets.push('avatar=?');
      vals.push(b.avatar ? String(b.avatar).slice(0, 500) : null);
    }
    if (b.email !== undefined) {
      if (b.email && !EMAIL_RE.test(String(b.email))) throw bad('邮箱格式不正确', 'BAD_EMAIL');
      if (b.email) {
        const dup = await one('SELECT id FROM users WHERE email=? AND id<>?', [b.email, req.user.id]);
        if (dup) throw bad('邮箱已被其他账号使用', 'EMAIL_TAKEN');
      }
      sets.push('email=?');
      vals.push(b.email || null);
    }
    if (b.phone !== undefined) {
      if (b.phone && !PHONE_RE.test(String(b.phone))) throw bad('手机号格式不正确', 'BAD_PHONE');
      if (b.phone) {
        const dup = await one('SELECT id FROM users WHERE phone=? AND id<>?', [b.phone, req.user.id]);
        if (dup) throw bad('手机号已被其他账号使用', 'PHONE_TAKEN');
      }
      sets.push('phone=?');
      vals.push(b.phone || null);
    }
    if (b.settings !== undefined && typeof b.settings === 'object') {
      sets.push('settings_json=?');
      vals.push(JSON.stringify(b.settings));
    }
    if (!sets.length) return ok(res, publicUser(await one('SELECT * FROM users WHERE id=?', [req.user.id])));
    vals.push(req.user.id);
    await execute(`UPDATE users SET ${sets.join(',')} WHERE id=?`, vals);
    return ok(res, publicUser(await one('SELECT * FROM users WHERE id=?', [req.user.id])), '已保存');
  })
);

/* -------------------------------- password -------------------------------- */
router.post(
  '/password',
  requireAuth,
  asyncH(async (req, res) => {
    const { old: oldPwd, new: newPwd } = req.body || {};
    if (!newPwd || String(newPwd).length < 6) throw bad('新密码至少 6 位', 'BAD_PASSWORD');
    const row = await one('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!(await verifyPassword(oldPwd, row.password_hash))) throw bad('原密码不正确', 'BAD_OLD_PASSWORD');
    await execute('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(newPwd), req.user.id]);
    // revoke every other session
    const token = extractToken(req);
    await execute('UPDATE user_sessions SET revoked=1 WHERE user_id=? AND token_hash<>?', [req.user.id, sha256(token || '')]);
    await logLogin(req.user.id, row.username, 'password', true, req, '修改密码');
    return ok(res, { changed: true }, '密码已修改，其他设备已退出登录');
  })
);

/* -------------------------------- sessions -------------------------------- */
router.get(
  '/sessions',
  requireAuth,
  asyncH(async (req, res) => {
    const current = sha256(extractToken(req) || '');
    const [rows] = await query(
      'SELECT id,device,ip,user_agent,created_at,last_seen_at,expires_at,revoked,token_hash FROM user_sessions WHERE user_id=? ORDER BY id DESC LIMIT 50',
      [req.user.id]
    );
    return ok(res, {
      current: current,
      sessions: rows.map((r) => ({
        id: r.id,
        device: r.device,
        ip: r.ip,
        user_agent: r.user_agent,
        created_at: toISO(r.created_at),
        last_seen_at: toISO(r.last_seen_at),
        expires_at: toISO(r.expires_at),
        revoked: Boolean(r.revoked),
        current: r.token_hash === current
      }))
    });
  })
);

router.delete(
  '/sessions/:id',
  requireAuth,
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw bad('会话 id 无效', 'BAD_ID');
    await execute('UPDATE user_sessions SET revoked=1 WHERE id=? AND user_id=?', [id, req.user.id]);
    return ok(res, { revoked: true });
  })
);

/* ---------------------------------- bind ---------------------------------- */
router.post(
  '/bind',
  requireAuth,
  asyncH(async (req, res) => {
    const { email, phone, code } = req.body || {};
    if (!email && !phone) throw bad('请提供邮箱或手机号', 'BAD_INPUT');
    const target = email ? String(email) : String(phone);
    if (email && !EMAIL_RE.test(target)) throw bad('邮箱格式不正确', 'BAD_EMAIL');
    if (phone && !PHONE_RE.test(target)) throw bad('手机号格式不正确', 'BAD_PHONE');

    // optional verification code: set by an admin/notification channel as sys_settings `bind_code:<target>`
    const expected = await getSetting(`bind_code:${target}`);
    if (expected) {
      if (String(code || '') !== String(expected)) throw bad('验证码不正确', 'BAD_CODE');
      await setSetting(`bind_code:${target}`, '');
    }
    const dup = await one('SELECT id FROM users WHERE (email=? OR phone=?) AND id<>?', [target, target, req.user.id]);
    if (dup) throw bad('该邮箱或手机号已被其他账号使用', 'TAKEN');
    await execute(email ? 'UPDATE users SET email=? WHERE id=?' : 'UPDATE users SET phone=? WHERE id=?', [target, req.user.id]);
    return ok(res, publicUser(await one('SELECT * FROM users WHERE id=?', [req.user.id])), '绑定成功');
  })
);

export default router;
