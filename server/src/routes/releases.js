/**
 * /api/releases — install packages per platform + update check.
 */
import { Router } from 'express';
import { query, execute, one } from '../lib/db.js';
import { ok, bad, asyncH, toISO } from '../lib/util.js';

const router = Router();
const PLATFORM_ORDER = ['win-x64', 'win-green', 'mac-arm64', 'mac-x64', 'android', 'ios', 'linux-x64'];

function assetOut(row) {
  return {
    id: row.id,
    platform: row.platform,
    version: row.version,
    filename: row.filename,
    size: Number(row.size || 0),
    url: row.url,
    oss_key: row.oss_key || null,
    sha256: row.sha256 || null,
    changelog: row.changelog || '',
    forced: Boolean(row.forced),
    channel: row.channel,
    published_at: toISO(row.published_at),
    downloads: Number(row.downloads || 0)
  };
}

/** Semver-ish compare: returns >0 when a > b. */
function cmpVersion(a, b) {
  const pa = String(a || '0')
    .split(/[.\-+]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0')
    .split(/[.\-+]/)
    .map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

router.get(
  '/',
  asyncH(async (req, res) => {
    const channel = String(req.query.channel || '').trim();
    const [rows] = await query(
      `SELECT * FROM releases ${channel ? 'WHERE channel=?' : ''} ORDER BY published_at DESC, id DESC`,
      channel ? [channel] : []
    );
    const byPlatform = new Map();
    for (const row of rows) {
      const list = byPlatform.get(row.platform) || [];
      list.push(assetOut(row));
      byPlatform.set(row.platform, list);
    }
    const platforms = [...byPlatform.keys()]
      .sort((a, b) => {
        const ia = PLATFORM_ORDER.indexOf(a);
        const ib = PLATFORM_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map((platform) => {
        const history = byPlatform.get(platform).sort((a, b) => cmpVersion(b.version, a.version));
        return { platform, latest: history[0], history };
      });
    return ok(res, {
      platforms,
      all: rows.map(assetOut),
      latest_version: platforms.map((p) => p.latest?.version).sort(cmpVersion).pop() || null
    });
  })
);

router.get(
  '/check',
  asyncH(async (req, res) => {
    const platform = String(req.query.platform || '').trim();
    const current = String(req.query.version || '0.0.0').trim();
    const channel = String(req.query.channel || 'stable').trim();
    if (!platform) throw bad('缺少 platform', 'BAD_INPUT');
    const row = await one(
      'SELECT * FROM releases WHERE platform=? AND channel=? ORDER BY published_at DESC, id DESC LIMIT 1',
      [platform, channel]
    );
    if (!row) {
      return ok(res, { hasUpdate: false, forced: false, latest: null, current, platform, msg: '暂无该平台的发布记录' });
    }
    const latest = assetOut(row);
    const hasUpdate = cmpVersion(latest.version, current) > 0;
    return ok(res, {
      hasUpdate,
      forced: hasUpdate && latest.forced,
      current,
      platform,
      channel,
      latest,
      url: latest.url,
      changelog: latest.changelog
    });
  })
);

router.get(
  '/:id/download',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const row = await one('SELECT * FROM releases WHERE id=?', [id]);
    if (!row) throw bad('安装包不存在', 'NOT_FOUND');
    if (!row.url && !row.oss_key) throw bad('该平台安装包尚未发布', 'NOT_PUBLISHED');

    await execute('UPDATE releases SET downloads=downloads+1 WHERE id=?', [id]);

    /**
     * The bucket is PRIVATE. Direct OSS redirects are unreliable here:
     *  - the custom domain is a relay that breaks OSS signatures (403), and
     *  - the raw endpoint rejects .apk delivery (Aliyun ApkDownloadForbidden,
     *    even with a signed response-content-disposition override).
     * So .apk always streams through the server-proxied /api/storage/raw
     * route; other objects use the signed raw-endpoint URL.
     */
    if (row.oss_key) {
      if (/\.apk$/i.test(row.oss_key)) {
        const { rawProxyUrl } = await import('../lib/storage.js');
        return res.redirect(302, rawProxyUrl(row.oss_key, 3600));
      }
      try {
        const { signUrl } = await import('../lib/storage.js');
        const signed = await signUrl(row.oss_key, null, 3600);
        if (signed) return res.redirect(302, signed);
      } catch { /* fall through to proxy */ }
      const { rawProxyUrl } = await import('../lib/storage.js');
      return res.redirect(302, rawProxyUrl(row.oss_key, 3600));
    }
    if (!row.url) throw bad('该平台安装包尚未发布', 'NOT_PUBLISHED');
    return res.redirect(302, row.url);
  })
);

/** Download by platform (convenience: /api/releases/latest/win-x64/download). */
router.get(
  '/latest/:platform/download',
  asyncH(async (req, res) => {
    const platform = String(req.params.platform || '');
    const row = await one(
      "SELECT * FROM releases WHERE platform=? AND channel='stable' ORDER BY published_at DESC LIMIT 1",
      [platform]
    );
    if (!row) throw bad('该平台安装包尚未发布', 'NOT_FOUND');
    return res.redirect(302, `/api/releases/${row.id}/download`);
  })
);

export default router;
