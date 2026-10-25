/**
 * /api/versions — history list/read/restore/snapshot/diff.
 */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { ok, bad, notFound, asyncH, safePath } from '../lib/util.js';
import { listVersions, readVersion, addVersion, versionCount } from '../lib/versions.js';
import { lineDiff, unifiedDiff } from '../lib/diff.js';
import { writeDoc, rowOf, readDoc } from '../lib/files.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/list',
  asyncH(async (req, res) => {
    const path = safePath(req.query.path);
    const list = await listVersions(req.user.id, path, req.query.limit || 50);
    return ok(res, { path, total: list.length, all: await versionCount(req.user.id, path), versions: list });
  })
);

router.get(
  '/read',
  asyncH(async (req, res) => {
    const id = Number(req.query.id);
    if (!id) throw bad('缺少版本 id', 'BAD_INPUT');
    const v = await readVersion(req.user.id, id);
    if (!v) throw notFound('版本不存在');
    return ok(res, v);
  })
);

router.post(
  '/restore',
  asyncH(async (req, res) => {
    const { id, path: targetPath } = req.body || {};
    if (!id) throw bad('缺少版本 id', 'BAD_INPUT');
    const v = await readVersion(req.user.id, Number(id));
    if (!v) throw notFound('版本不存在');
    const path = targetPath ? safePath(targetPath) : v.path;
    // keep the current content as a version before overwriting
    const current = await rowOf(req.user.id, path);
    if (current) {
      const cur = await readDoc(req.user, path);
      await addVersion({ userId: req.user.id, path, content: cur.content, reason: 'restore', device: 'restore' });
    }
    const out = await writeDoc(req.user, { path, content: v.content || '', naming: 'keep', reason: 'restore', baseEtag: undefined });
    return ok(res, { ...out, restoredFrom: v.version }, `已恢复到第 ${v.version} 版`);
  })
);

router.post(
  '/snapshot',
  asyncH(async (req, res) => {
    const { path, content, reason } = req.body || {};
    const p = safePath(path);
    const id = await addVersion({
      userId: req.user.id,
      path: p,
      content: content ?? '',
      reason: ['save', 'auto', 'restore', 'snapshot', 'import'].includes(reason) ? reason : 'snapshot',
      device: req.headers['x-device'] || 'snapshot'
    });
    return ok(res, { id, path: p, skipped: id === null }, id ? '快照已保存' : '内容与最近一版相同，已跳过');
  })
);

router.get(
  '/diff',
  asyncH(async (req, res) => {
    const aId = Number(req.query.a);
    const bId = Number(req.query.b);
    let left;
    let right;
    let leftLabel;
    let rightLabel;

    if (aId && bId) {
      const va = await readVersion(req.user.id, aId);
      const vb = await readVersion(req.user.id, bId);
      if (!va || !vb) throw notFound('版本不存在');
      left = va.content || '';
      right = vb.content || '';
      leftLabel = `v${va.version}`;
      rightLabel = `v${vb.version}`;
    } else {
      // fall back to (current remote) vs (selected version)
      const path = safePath(req.query.path);
      const vid = aId || bId;
      if (!vid) throw bad('请提供 a 与 b（版本 id）', 'BAD_INPUT');
      const v = await readVersion(req.user.id, vid);
      if (!v) throw notFound('版本不存在');
      const cur = await readDoc(req.user, path);
      if (aId) {
        left = v.content || '';
        right = cur.content;
      } else {
        left = cur.content;
        right = v.content || '';
      }
      leftLabel = aId ? `v${v.version}` : 'current';
      rightLabel = bId ? `v${v.version}` : 'current';
    }

    const { unified, added, removed } = unifiedDiff(left, right, { leftLabel, rightLabel });
    return ok(res, { left, right, unified, added, removed, ops: lineDiff(left, right).slice(0, 4000) });
  })
);

export default router;
