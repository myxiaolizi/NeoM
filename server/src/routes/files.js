/**
 * /api/files — cloud vault endpoints (content in OSS, index in MySQL).
 */
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../lib/auth.js';
import { ok, bad, notFound, asyncH, safePath, parentOf, baseOf } from '../lib/util.js';
import * as files from '../lib/files.js';
import { listSnapshots, readSnapshot, purgeExpiredSnapshots } from '../lib/versions.js';
import { exportDocx, exportHtml, exportPdf } from '../lib/export.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 20 } });

router.use(requireAuth);

/* --------------------------------- listing -------------------------------- */
router.get(
  '/tree',
  asyncH(async (req, res) => {
    const nodes = await files.listTree(req.user);
    return ok(res, nodes);
  })
);

router.get(
  '/list',
  asyncH(async (req, res) => {
    const nodes = await files.listTree(req.user);
    return ok(res, nodes);
  })
);

router.get(
  '/read',
  asyncH(async (req, res) => {
    const doc = await files.readDoc(req.user, req.query.path);
    return ok(res, doc);
  })
);

/* ---------------------------------- write --------------------------------- */
router.post(
  '/write',
  asyncH(async (req, res) => {
    const { path, content, baseEtag, naming, device } = req.body || {};
    if (path === undefined) throw bad('缺少 path', 'BAD_INPUT');
    try {
      const out = await files.writeDoc(req.user, {
        path,
        content,
        baseEtag,
        naming: naming || 'keep',
        device: device || req.headers['x-device'] || null,
        reason: 'save'
      });
      return ok(res, out, out.renamed ? '已保存并按命名规则重命名' : '已保存');
    } catch (e) {
      // 409 must carry data.remote for the frontend conflict dialog; the shared
      // error middleware only forwards status/msg/code, so answer it here.
      if (e && e.code === 'CONFLICT') {
        return res.status(409).json({ status: false, msg: e.message, code: 'CONFLICT', data: e.data });
      }
      throw e;
    }
  })
);

router.post(
  '/create',
  asyncH(async (req, res) => {
    const { dir, name, content } = req.body || {};
    const out = await files.createDoc(req.user, { dir, name, content });
    return ok(res, out);
  })
);

router.post(
  '/mkdir',
  asyncH(async (req, res) => {
    const out = await files.mkdir(req.user, (req.body || {}).path);
    return ok(res, out, '目录已创建');
  })
);

router.post(
  '/rename',
  asyncH(async (req, res) => {
    const { from, to } = req.body || {};
    if (!to) throw bad('缺少目标路径 to', 'BAD_INPUT');
    const out = await files.renameDoc(req.user, from, to);
    return ok(res, out, '已重命名');
  })
);

router.post(
  '/move',
  asyncH(async (req, res) => {
    const { from, to } = req.body || {};
    if (!to) throw bad('缺少目标路径 to', 'BAD_INPUT');
    const out = await files.moveDoc(req.user, from, to);
    return ok(res, out, '已移动');
  })
);

router.post(
  '/copy',
  asyncH(async (req, res) => {
    const { from, to } = req.body || {};
    const out = await files.copyDoc(req.user, from, to);
    return ok(res, out, '已复制');
  })
);

router.post(
  '/delete',
  asyncH(async (req, res) => {
    const { path, id } = req.body || {};
    if (id !== undefined && path === undefined) {
      // restore-by-id helper (/files/restore) is separate; here id purges from bin
      const out = await files.purgeSnapshot(req.user, id);
      return ok(res, out, '已彻底删除');
    }
    const out = await files.removeDoc(req.user, path);
    return ok(res, out, '已移入回收站');
  })
);

/* -------------------------------- recycle bin ------------------------------ */
router.get(
  '/recycle',
  asyncH(async (req, res) => {
    await purgeExpiredSnapshots().catch(() => {});
    const items = await listSnapshots(req.user.id, req.query.limit || 100);
    return ok(res, items.map(({ _payload, ...rest }) => rest));
  })
);

router.get(
  '/recycle/read',
  asyncH(async (req, res) => {
    const snap = await readSnapshot(req.user.id, Number(req.query.id));
    if (!snap) throw notFound('快照不存在');
    return ok(res, snap);
  })
);

router.post(
  '/restore',
  asyncH(async (req, res) => {
    const { id } = req.body || {};
    if (!id) throw bad('缺少快照 id', 'BAD_INPUT');
    const out = await files.restoreSnapshot(req.user, Number(id));
    return ok(res, out, '已恢复到原位置');
  })
);

/* --------------------------------- search --------------------------------- */
router.get(
  '/search',
  asyncH(async (req, res) => {
    const out = await files.search(req.user, {
      q: req.query.q || req.query.keyword || '',
      scope: req.query.scope || 'all',
      limit: req.query.limit || 200
    });
    return ok(res, out);
  })
);

router.get(
  '/recent',
  asyncH(async (req, res) => {
    const nodes = await files.recentDocs(req.user, req.query.limit || 20);
    return ok(res, nodes);
  })
);

/* ---------------------------------- sort ---------------------------------- */
router.post(
  '/sort',
  asyncH(async (req, res) => {
    const orders = (req.body || {}).orders;
    if (!Array.isArray(orders)) throw bad('orders 必须是数组', 'BAD_INPUT');
    const out = await files.applySort(req.user, orders);
    return ok(res, out);
  })
);

/* ---------------------------------- sync ---------------------------------- */
router.post(
  '/sync',
  asyncH(async (req, res) => {
    const out = await files.syncVault(req.user);
    return ok(res, out, `同步完成：新增 ${out.added.length}、更新 ${out.updated.length}、缺失 ${out.missing.length}`);
  })
);

router.get(
  '/conflict',
  asyncH(async (req, res) => {
    const out = await files.conflictInfo(req.user, req.query.path);
    return ok(res, out);
  })
);

router.get(
  '/stats',
  asyncH(async (req, res) => {
    const out = await files.vaultStats(req.user);
    return ok(res, out);
  })
);

/* --------------------------------- export --------------------------------- */
router.post(
  '/export',
  asyncH(async (req, res) => {
    const { path: docPath, format = 'md' } = req.body || {};
    if (!docPath) throw bad('缺少 path', 'BAD_INPUT');
    const doc = await files.readDoc(req.user, docPath);
    const title = baseOf(doc.path).replace(/\.(md|mdx|txt)$/i, '');
    const fmt = String(format).toLowerCase();

    if (fmt === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition(`${title}.md`));
      return res.send(doc.content);
    }
    if (fmt === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition(`${title}.html`));
      return res.send(exportHtml(title, doc.content));
    }
    if (fmt === 'docx') {
      const buf = await exportDocx(title, doc.content);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', contentDisposition(`${title}.docx`));
      return res.send(buf);
    }
    if (fmt === 'pdf') {
      // no headless engine: hand back printable HTML + explicit fallback flag
      return ok(res, exportPdf(title, doc.content), '服务端未启用 PDF 引擎，请使用打印功能导出 PDF');
    }
    throw bad('不支持的导出格式，可选 md|html|docx|pdf', 'BAD_FORMAT');
  })
);

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/* --------------------------------- import --------------------------------- */
router.post(
  '/import',
  upload.array('files', 20),
  asyncH(async (req, res) => {
    const list = req.files || (req.file ? [req.file] : []);
    if (!list.length) throw bad('未收到文件', 'NO_FILE');
    const dir = (req.body || {}).dir ? safePath(req.body.dir) : '';
    const saved = [];
    for (const f of list) {
      const original = String(f.originalname || 'import.md').replace(/\\/g, '/');
      const base = baseOf(original).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
      const name = /\.(md|mdx|txt|markdown)$/i.test(base) ? base : `${base}.md`;
      const target = dir ? `${dir}/${name}` : name;
      const content = f.buffer.toString('utf8');
      const out = await files.writeDoc(req.user, { path: target, content, reason: 'import' });
      saved.push(out);
    }
    return ok(res, { imported: saved }, `已导入 ${saved.length} 个文件`);
  })
);

export default router;
