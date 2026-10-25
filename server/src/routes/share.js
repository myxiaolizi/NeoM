/**
 * /api/share — owner endpoints + public (no-login) read/comment endpoints,
 * plus the server-rendered /s/:id page.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, execute, one, getSettingNum, hitRate } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { ok, bad, notFound, asyncH, safePath, toISO, randId, ipOf, env, ApiError, baseOf } from '../lib/util.js';
import { readDoc } from '../lib/files.js';
import { renderMarkdown, sharePage, passwordPromptPage, notFoundPage, escapeHtml } from '../lib/export.js';

const router = Router();

/* ---------------------------- sensitive filtering ------------------------- */
let wordCache = { at: 0, list: [] };
async function sensitiveWords() {
  if (Date.now() - wordCache.at < 60_000) return wordCache.list;
  try {
    const [rows] = await query('SELECT word,action FROM sensitive_words');
    wordCache = { at: Date.now(), list: rows };
  } catch {
    wordCache = { at: Date.now(), list: [] };
  }
  return wordCache.list;
}

export async function filterContent(text) {
  const body = String(text || '');
  const words = await sensitiveWords();
  let out = body;
  let blocked = null;
  for (const w of words) {
    if (!w.word) continue;
    if (body.toLowerCase().includes(String(w.word).toLowerCase())) {
      if (w.action === 'replace') out = out.split(w.word).join('*'.repeat(String(w.word).length));
      else blocked = w.word;
    }
  }
  return { blocked, text: out };
}

/* -------------------------------- helpers -------------------------------- */
async function shareRow(id) {
  if (!id) return null;
  return one('SELECT * FROM share_links WHERE id=?', [id.slice(0, 32)]);
}

function isExpired(row) {
  return Boolean(row.expires_at && new Date(row.expires_at).getTime() < Date.now());
}

async function ownerOf(userId) {
  const row = await one('SELECT id,username,nickname FROM users WHERE id=?', [userId]);
  if (!row) return null;
  return { id: row.id, username: row.username, nickname: row.nickname, storage_quota_mb: 0 };
}

function shareUrl(id) {
  return `${env.publicBase}/s/${id}`;
}

function shareLinkOut(row, uid) {
  const expired = isExpired(row) || row.status === 'expired';
  return {
    id: row.id,
    doc_id: row.path,
    doc_name: row.doc_name,
    mode: row.mode,
    expires_at: toISO(row.expires_at),
    password: row.password ? '******' : null,
    has_password: Boolean(row.password),
    url: shareUrl(row.id),
    path: row.path,
    views: Number(row.views || 0),
    comments: Number(uid ?? 0),
    created_at: toISO(row.created_at),
    status: expired ? 'expired' : row.status
  };
}

async function commentCount(id) {
  const row = await one("SELECT COUNT(*) AS c FROM share_comments WHERE share_id=? AND status='visible'", [id]);
  return Number(row?.c || 0);
}

export async function commentsOf(id) {
  const [rows] = await query(
    "SELECT id,author,content,anchor,created_at FROM share_comments WHERE share_id=? AND status='visible' ORDER BY id ASC LIMIT 500",
    [id]
  );
  return rows.map((r) => ({
    id: r.id,
    author: r.author,
    content: r.content,
    anchor: r.anchor,
    created_at: toISO(r.created_at)
  }));
}

async function verifySharePassword(row, provided) {
  if (!row.password) return true;
  if (!provided) return false;
  try {
    return await bcrypt.compare(String(provided), row.password);
  } catch {
    return false;
  }
}

/* --------------------------------- owner ---------------------------------- */
router.post(
  '/create',
  requireAuth,
  asyncH(async (req, res) => {
    const { path: docPath, mode = 'read', expiresAt, password } = req.body || {};
    const path = safePath(docPath);
    const doc = await readDoc(req.user, path).catch(() => null);
    if (!doc) throw notFound('文档不存在');
    if (!['read', 'comment', 'edit'].includes(mode)) throw bad('mode 只能是 read|comment|edit', 'BAD_MODE');
    const id = randId(12);
    await execute(
      `INSERT INTO share_links (id,user_id,path,doc_name,mode,password,expires_at,status)
       VALUES (?,?,?,?,?,?,?, 'active')`,
      [
        id,
        req.user.id,
        path,
        doc.name,
        mode,
        password ? await bcrypt.hash(String(password), 10) : null,
        expiresAt ? new Date(expiresAt) : null
      ]
    );
    const row = await shareRow(id);
    return ok(res, shareLinkOut(row, 0), '分享链接已创建');
  })
);

router.get(
  '/list',
  requireAuth,
  asyncH(async (req, res) => {
    const [rows] = await query('SELECT * FROM share_links WHERE user_id=? ORDER BY id DESC LIMIT 500', [req.user.id]);
    const counts = await query(
      "SELECT share_id, COUNT(*) AS c FROM share_comments WHERE status='visible' GROUP BY share_id"
    );
    const map = new Map(counts[0].map((r) => [r.share_id, Number(r.c)]));
    return ok(res, rows.map((r) => shareLinkOut(r, map.get(r.id) || 0)));
  })
);

router.post(
  '/revoke',
  requireAuth,
  asyncH(async (req, res) => {
    const { id } = req.body || {};
    if (!id) throw bad('缺少 id', 'BAD_INPUT');
    await execute("UPDATE share_links SET status='blocked' WHERE id=? AND user_id=?", [String(id).slice(0, 32), req.user.id]);
    return ok(res, { id, status: 'blocked' }, '分享已撤销');
  })
);

/* -------------------------------- public ---------------------------------- */
router.get(
  '/get',
  asyncH(async (req, res) => {
    const id = String(req.query.id || '').slice(0, 32);
    const row = await shareRow(id);
    if (!row) throw notFound('分享不存在或已被撤销');
    if (row.status === 'blocked') throw new ApiError('分享已被作者撤销', 403, 'SHARE_BLOCKED');
    if (isExpired(row)) {
      await execute("UPDATE share_links SET status='expired' WHERE id=?", [id]);
      throw new ApiError('分享链接已过期', 410, 'SHARE_EXPIRED');
    }
    const provided = req.query.pwd || req.body?.pwd || req.headers['x-share-password'];
    if (!(await verifySharePassword(row, provided))) {
      throw new ApiError('该分享需要访问密码', 401, 'PASSWORD_REQUIRED');
    }
    const owner = await ownerOf(row.user_id);
    if (!owner) throw notFound('分享者不存在');
    const doc = await readDoc(owner, row.path).catch(() => null);
    await execute('UPDATE share_links SET views=views+1 WHERE id=?', [id]);
    const comments = row.mode === 'read' ? [] : await commentsOf(id);
    return ok(res, {
      doc: { name: row.doc_name || baseOf(row.path), content: doc ? doc.content : '', etag: doc?.etag || null },
      mode: row.mode,
      expiresAt: toISO(row.expires_at),
      comments,
      canComment: row.mode === 'comment' || row.mode === 'edit',
      author: owner.nickname || owner.username,
      createdAt: toISO(row.created_at)
    });
  })
);

router.post(
  '/comment',
  asyncH(async (req, res) => {
    const { id, content, anchor, author } = req.body || {};
    const shareId = String(id || '').slice(0, 32);
    const row = await shareRow(shareId);
    if (!row) throw notFound('分享不存在');
    if (row.status === 'blocked') throw new ApiError('分享已被作者撤销', 403, 'SHARE_BLOCKED');
    if (isExpired(row)) throw new ApiError('分享链接已过期', 410, 'SHARE_EXPIRED');
    if (row.mode === 'read') throw new ApiError('该分享未开启评论', 403, 'COMMENT_CLOSED');

    const body = String(content || '').trim();
    if (!body || body.length > 1000) throw bad('评论内容需 1-1000 字', 'BAD_COMMENT');

    // per-IP rate limit
    const limit = await getSettingNum('share_comment_limit', 10);
    const windowSec = await getSettingNum('share_comment_window', 600);
    const rl = await hitRate('share:comment', ipOf(req), limit, windowSec);
    if (!rl.allowed) throw new ApiError(`评论过于频繁，请 ${rl.retryAfter} 秒后再试`, 429, 'RATE_LIMITED');

    const filtered = await filterContent(body);
    if (filtered.blocked) throw new ApiError('评论包含敏感词，已被拦截', 400, 'SENSITIVE');

    const name = String(author || '').trim().slice(0, 32) || '匿名';
    const [r] = await execute(
      'INSERT INTO share_comments (share_id,author,content,anchor,ip,status) VALUES (?,?,?,?,?,?)',
      [shareId, name, filtered.text, anchor ? String(anchor).slice(0, 255) : null, ipOf(req), 'visible']
    );
    return ok(res, { id: r.insertId, author: name, content: filtered.text, anchor: anchor || null, created_at: toISO(new Date()) }, '评论已发布');
  })
);

/* --------------------------- server rendered page -------------------------- */
export async function renderSharePage(req, res) {
  const id = String(req.params.id || '').slice(0, 32);
  try {
    const row = await shareRow(id);
    if (!row || row.status === 'blocked' || isExpired(row)) return res.status(404).send(notFoundPage('分享链接不存在或已失效'));
    const pwd = req.query.pwd || req.headers['x-share-password'];
    if (!(await verifySharePassword(row, pwd))) {
      return res.status(401).send(
        passwordPromptPage({ title: row.doc_name || 'NeoM 分享', action: `/s/${id}`, wrong: Boolean(pwd) })
      );
    }
    const owner = await ownerOf(row.user_id);
    const doc = owner ? await readDoc(owner, row.path).catch(() => null) : null;
    if (!doc) return res.status(404).send(notFoundPage('文档已被删除'));
    await execute('UPDATE share_links SET views=views+1 WHERE id=?', [id]);
    const comments = row.mode === 'read' ? [] : await commentsOf(id);

    const html = sharePage({
      docName: row.doc_name || baseOf(row.path),
      bodyHtml: renderMarkdown(doc.content),
      mode: row.mode,
      comments,
      commentsOpen: row.mode === 'comment' || row.mode === 'edit',
      shareId: id,
      extraMeta: `<span>${row.mode === 'edit' ? '协作编辑' : '只读'} · ${Number(row.views || 0) + 1} 次浏览</span>
        <span>${row.expires_at ? `有效期至 ${escapeHtml(String(row.expires_at).slice(0, 10))}` : '长期有效'}</span>`
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send(notFoundPage('页面渲染失败'));
  }
}

export default router;
