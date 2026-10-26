#!/usr/bin/env node
/**
 * Applies the raw-proxy patch to src/routes/storage.js idempotently.
 * Run: node scripts/patch-storage-raw.mjs  (from server/ or repo root)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'src', 'routes', 'storage.js');
let src = fs.readFileSync(target, 'utf8');

if (src.includes("'/raw/:key(*)'")) {
  console.log('[patch] raw route already present, nothing to do');
  process.exit(0);
}

/* 1. crypto import */
src = src.replace(
  "import { Router } from 'express';\nimport path from 'node:path';",
  "import { Router } from 'express';\nimport path from 'node:path';\nimport crypto from 'node:crypto';"
);

/* 2a. insert the raw-proxy route before the settings section (first authed route),
 *     with the router-level requireAuth guard right after it */
const rawBlock = `/* -------------------------------------------------------------------------- */
/*  Proxied object download  GET /api/storage/raw/:key?t=<hmac>&e=<expires>   */
/*  Fallback channel when direct OSS access is impossible (the custom domain  */
/*  is a relay that breaks OSS signatures; the raw endpoint refuses .apk).    */
/*  HMAC token authorizes the exact key until expiry; no login needed so      */
/*  <img>/<a> tags and 302 redirects can use it. Declared BEFORE the          */
/*  router-level requireAuth guard that follows this block.                   */
/* -------------------------------------------------------------------------- */
const RAW_TTL = 7 * 24 * 3600;

/** HMAC token that authorizes GET /api/storage/raw/:key until expires. */
function rawTokenFor(key, expires) {
  return crypto.createHmac('sha256', env.jwtSecret).update(\`raw:\${key}:\${expires}\`).digest('base64url');
}
export { rawTokenFor };

router.get(
  '/raw/:key(*)',
  asyncH(async (req, res) => {
    const key = safePath(String(req.params.key || ''));
    const expires = Math.max(60, Number(req.query.e) || 0);
    if (!expires || expires < Math.floor(Date.now() / 1000)) {
      throw new ApiError('链接已过期', 403, 'LINK_EXPIRED');
    }
    const expect = rawTokenFor(key, expires);
    const got = String(req.query.t || '');
    let okSig = false;
    try {
      okSig = expect.length === got.length &&
        crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(got));
    } catch { okSig = false; }
    if (!okSig) throw new ApiError('签名无效', 403, 'BAD_SIGNATURE');

    const storage = await import('../lib/storage.js');
    const obj = await storage.getObject(key, null);
    if (!obj) throw new ApiError('对象不存在', 404, 'NOT_FOUND');

    if (obj.local) {
      res.setHeader('Content-Type', obj.contentType || mimeOf(key));
      return res.send(obj.content);
    }
    res.setHeader('Content-Type', obj.contentType || mimeOf(key));
    if (/\\.apk$/i.test(key)) {
      res.setHeader('Content-Disposition', \`attachment; filename="\${key.split('/').pop()}"\`);
    }
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.send(obj.content);
  })
);

`;

/* 2b. remove the early router.use(requireAuth) and re-add it after the raw block */
src = src.replace('router.use(requireAuth);\n\n/* -------------------------------- settings', '\n/* -------------------------------- settings');

const settingsMarker = '/* -------------------------------- settings -------------------------------- */';
if (!src.includes(settingsMarker)) throw new Error('settings marker not found');
src = src.replace(settingsMarker, rawBlock + '/* ----------------- authenticated storage endpoints ------------------------ */\nrouter.use(requireAuth);\n\n' + settingsMarker);

/* 3. /sign returns proxy url too */
src = src.replace(
  `    const url = await signUrl(key, req.user, expires);
    return ok(res, { url, key, expires });`,
  `    const url = await signUrl(key, req.user, expires);
    // proxy fallback that never depends on OSS-side signature verification
    const e = Math.floor(Date.now() / 1000) + RAW_TTL;
    const proxy = \`/api/storage/raw/\${key.split('/').map(encodeURIComponent).join('/')}?t=\${rawTokenFor(key, e)}&e=\${e}\`;
    return ok(res, { url, proxy, key, expires });`
);

/* 5. /upload returns proxy url when direct OSS would break (apk or relay domain) */
src = src.replace(
  `    const url = await signUrl(key, req.user, 7 * 24 * 3600).catch(() => publicUrl(key));
    return ok(res, { url, key, size: req.file.size, name: base, kind, etag: put.etag || null }, '上传成功');`,
  `    let url = await signUrl(key, req.user, 7 * 24 * 3600).catch(() => publicUrl(key));
    // apk is refused on the raw endpoint and the custom domain breaks
    // signatures, so hand back our own proxied URL for those cases
    if (/\\.apk$/i.test(key) || !url.includes(String(process.env.OSS_BUCKET || '\\u0000'))) {
      const e = Math.floor(Date.now() / 1000) + RAW_TTL;
      url = \`\${env.publicBase}/api/storage/raw/\${key.split('/').map(encodeURIComponent).join('/')}?t=\${rawTokenFor(key, e)}&e=\${e}\`;
    }
    return ok(res, { url, key, size: req.file.size, name: base, kind, etag: put.etag || null }, '上传成功');`
);

fs.writeFileSync(target, src, 'utf8');
console.log('[patch] storage.js patched:', src.length, 'bytes');
