/**
 * /api/publish — publish a document as a standalone HTML page (/p/:id).
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, execute, one } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { ok, bad, notFound, asyncH, safePath, toISO, randId, env, ApiError, baseOf } from '../lib/util.js';
import { readDoc } from '../lib/files.js';
import { renderMarkdown, sharePage, passwordPromptPage, notFoundPage, escapeHtml } from '../lib/export.js';

const router = Router();

function publishUrl(id) {
  return `${env.publicBase}/p/${id}`;
}

function pageOut(row) {
  return {
    id: row.id,
    doc_id: row.path,
    doc_name: row.doc_name,
    path: row.path,
    url: publishUrl(row.id),
    encrypted: Boolean(row.encrypted),
    has_password: Boolean(row.password),
    views: Number(row.views || 0),
    status: row.status,
    created_at: toISO(row.created_at)
  };
}

async function ownerOf(userId) {
  const row = await one('SELECT id,username,nickname FROM users WHERE id=?', [userId]);
  return row ? { id: row.id, username: row.username, nickname: row.nickname, storage_quota_mb: 0 } : null;
}

router.post(
  '/create',
  requireAuth,
  asyncH(async (req, res) => {
    const { path: docPath, encrypted = false, password } = req.body || {};
    const path = safePath(docPath);
    const doc = await readDoc(req.user, path).catch(() => null);
    if (!doc) throw notFound('文档不存在');
    if (encrypted && !password) throw bad('加密发布需要设置访问密码', 'NEED_PASSWORD');
    const id = randId(12);
    await execute(
      `INSERT INTO publish_pages (id,user_id,path,doc_name,encrypted,password,status)
       VALUES (?,?,?,?,?,?,'active')`,
      [id, req.user.id, path, doc.name, encrypted ? 1 : 0, password ? await bcrypt.hash(String(password), 10) : null]
    );
    const row = await one('SELECT * FROM publish_pages WHERE id=?', [id]);
    return ok(res, pageOut(row), '发布成功');
  })
);

router.get(
  '/list',
  requireAuth,
  asyncH(async (req, res) => {
    const [rows] = await query('SELECT * FROM publish_pages WHERE user_id=? ORDER BY id DESC LIMIT 500', [req.user.id]);
    return ok(res, rows.map(pageOut));
  })
);

router.post(
  '/revoke',
  requireAuth,
  asyncH(async (req, res) => {
    const { id } = req.body || {};
    if (!id) throw bad('缺少 id', 'BAD_INPUT');
    await execute("UPDATE publish_pages SET status='blocked' WHERE id=? AND user_id=?", [String(id).slice(0, 32), req.user.id]);
    return ok(res, { id, status: 'blocked' }, '发布页已下线');
  })
);

/* --------------------------- server rendered page -------------------------- */
export async function renderPublishPage(req, res) {
  const id = String(req.params.id || '').slice(0, 32);
  try {
    const row = await one('SELECT * FROM publish_pages WHERE id=?', [id]);
    if (!row || row.status === 'blocked') return res.status(404).send(notFoundPage('发布页不存在或已下线'));
    const pwd = req.query.pwd || req.headers['x-share-password'];
    if (row.password) {
      let passOk = false;
      if (pwd) {
        try {
          passOk = await bcrypt.compare(String(pwd), row.password);
        } catch {
          passOk = false;
        }
      }
      if (!passOk) {
        return res.status(401).send(
          passwordPromptPage({ title: row.doc_name || 'NeoM 发布页', action: `/p/${id}`, wrong: Boolean(pwd) })
        );
      }
    }
    const owner = await ownerOf(row.user_id);
    const doc = owner ? await readDoc(owner, row.path).catch(() => null) : null;
    if (!doc) return res.status(404).send(notFoundPage('文档已被删除'));
    await execute('UPDATE publish_pages SET views=views+1 WHERE id=?', [id]);

    const html = sharePage({
      docName: row.doc_name || baseOf(row.path),
      bodyHtml: renderMarkdown(doc.content),
      mode: 'read',
      comments: [],
      commentsOpen: false,
      shareId: id,
      extraMeta: `<span>发布页 · ${Number(row.views || 0) + 1} 次浏览</span>
        <span>${row.encrypted ? '加密访问' : '公开访问'}</span>`
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch {
    return res.status(500).send(notFoundPage('页面渲染失败'));
  }
}

export { publishUrl, escapeHtml, ApiError };
export default router;
