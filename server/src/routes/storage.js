/**
 * /api/storage — per-user OSS/S3 settings, connectivity test, upload, signing.
 * Secrets never leave the server in plaintext.
 */
import { Router } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { query, execute, one } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { ok, bad, asyncH, encryptSecret, decryptSecret, maskKey, safePath, env, toISO, ApiError } from '../lib/util.js';
import {
  storageProbe,
  putObject,
  signUrl,
  getObject,
  userKindKey,
  userPrefixOf,
  ossConfigured,
  publicUrl,
  prefixSize
} from '../lib/storage.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

const VENDORS = ['aliyun-oss', 'tencent-cos', 'volcengine-tos', 'baidu-bos', 'jdcloud', 'ksyun', 'custom-s3', 'system'];
const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.json': 'application/json'
};

function mimeOf(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function settingsOut(row) {
  if (!row) {
    return {
      vendor: 'system',
      bucket: env.oss.bucket,
      endpoint: env.oss.endpoint,
      region: env.oss.region,
      access_key_id: null,
      access_key_secret: '',
      public_domain: env.oss.domain,
      prefix: userPrefixOf(''),
      path_style: false,
      hasSecret: false,
      test_ok: false,
      test_at: null,
      system: true
    };
  }
  return {
    vendor: row.vendor,
    bucket: row.bucket || '',
    endpoint: row.endpoint || '',
    region: row.region || '',
    access_key_id: row.access_key_id || '',
    access_key_secret: row.ak_enc ? maskKey(decryptSecret(row.ak_enc) || '') : '',
    public_domain: row.public_domain || '',
    prefix: row.prefix || '',
    path_style: Boolean(row.path_style),
    hasSecret: Boolean(row.sk_enc),
    test_ok: Boolean(row.test_ok),
    test_at: toISO(row.test_at),
    system: row.vendor === 'system'
  };
}


/* -------------------------------------------------------------------------- */
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
  return crypto.createHmac('sha256', env.jwtSecret).update(`raw:${key}:${expires}`).digest('base64url');
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
    if (/\.apk$/i.test(key)) {
      res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
    }
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.send(obj.content);
  })
);

/* ----------------- authenticated storage endpoints ------------------------ */
router.use(requireAuth);

/* -------------------------------- settings -------------------------------- */
router.get(
  '/settings',
  asyncH(async (req, res) => {
    const row = await one('SELECT * FROM storage_configs WHERE user_id=?', [req.user.id]);
    const out = settingsOut(row);
    out.system_default = {
      vendor: 'aliyun-oss',
      bucket: env.oss.bucket,
      endpoint: env.oss.endpoint,
      region: env.oss.region,
      public_domain: env.oss.domain
    };
    out.used = await prefixSize(userPrefixOf(req.user.username)).catch(() => 0);
    out.prefix_base = userPrefixOf(req.user.username);
    return ok(res, out);
  })
);

router.post(
  '/settings',
  asyncH(async (req, res) => {
    const b = req.body || {};
    const vendor = String(b.vendor || 'aliyun-oss');
    if (!VENDORS.includes(vendor)) throw bad(`不支持的存储厂商：${vendor}`, 'BAD_VENDOR');

    if (vendor === 'system') {
      await execute(
        `INSERT INTO storage_configs (user_id,vendor,test_ok) VALUES (?, 'system', 1)
         ON DUPLICATE KEY UPDATE vendor='system', bucket=NULL, endpoint=NULL, region=NULL, ak_enc=NULL, sk_enc=NULL,
           access_key_id=NULL, public_domain=NULL, prefix=NULL`,
        [req.user.id]
      );
      return ok(res, settingsOut(await one('SELECT * FROM storage_configs WHERE user_id=?', [req.user.id])), '已切换为系统存储');
    }

    const bucket = String(b.bucket || '').trim();
    const endpoint = String(b.endpoint || '').trim().replace(/^https?:\/\//, '');
    if (!bucket || !endpoint) throw bad('bucket 与 endpoint 必填', 'BAD_INPUT');

    const existing = await one('SELECT * FROM storage_configs WHERE user_id=?', [req.user.id]);
    const newAk = b.access_key_id !== undefined ? String(b.access_key_id || '') : '';
    const newSk = b.access_key_secret !== undefined ? String(b.access_key_secret || '') : '';
    // keep old secrets when the client sends the masked placeholder or omits them
    const akPlain = newAk && !newAk.includes('*') ? newAk : existing ? decryptSecret(existing.ak_enc) || existing.access_key_id || '' : '';
    const skPlain = newSk && !newSk.includes('*') ? newSk : existing ? decryptSecret(existing.sk_enc) || '' : '';
    if (!akPlain || !skPlain) throw bad('access_key_id 与 access_key_secret 必填', 'NEED_KEYS');

    await execute(
      `INSERT INTO storage_configs (user_id,vendor,bucket,endpoint,region,ak_enc,sk_enc,access_key_id,public_domain,prefix,path_style)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE vendor=VALUES(vendor),bucket=VALUES(bucket),endpoint=VALUES(endpoint),region=VALUES(region),
         ak_enc=VALUES(ak_enc),sk_enc=VALUES(sk_enc),access_key_id=VALUES(access_key_id),public_domain=VALUES(public_domain),
         prefix=VALUES(prefix),path_style=VALUES(path_style)`,
      [
        req.user.id,
        vendor,
        bucket,
        endpoint,
        String(b.region || '').slice(0, 64) || null,
        encryptSecret(akPlain),
        encryptSecret(skPlain),
        maskKey(akPlain),
        b.public_domain ? String(b.public_domain).replace(/\/$/, '').slice(0, 255) : null,
        b.prefix ? String(b.prefix).replace(/^\/|\/$/g, '').slice(0, 255) : null,
        b.path_style ? 1 : 0
      ]
    );
    // verify the saved config once so test_ok reflects reality
    const probe = await storageProbe({
      ak: akPlain,
      sk: skPlain,
      bucket,
      endpoint,
      region: b.region || '',
      publicDomain: b.public_domain || '',
      prefix: b.prefix || ''
    });
    await execute('UPDATE storage_configs SET test_ok=?, test_at=NOW() WHERE user_id=?', [probe.ok ? 1 : 0, req.user.id]);
    return ok(res, { ...settingsOut(await one('SELECT * FROM storage_configs WHERE user_id=?', [req.user.id])), probe }, probe.ok ? '已保存并连通' : '已保存，但连通测试失败');
  })
);

/* ---------------------------------- test ---------------------------------- */
router.post(
  '/test',
  asyncH(async (req, res) => {
    const b = req.body || {};
    let cfg;
    if (b.bucket && b.endpoint) {
      const existing = await one('SELECT * FROM storage_configs WHERE user_id=?', [req.user.id]);
      const ak = b.access_key_id && !String(b.access_key_id).includes('*') ? b.access_key_id : existing ? decryptSecret(existing.ak_enc) || '' : env.oss.ak;
      const sk = b.access_key_secret && !String(b.access_key_secret).includes('*') ? b.access_key_secret : existing ? decryptSecret(existing.sk_enc) || '' : env.oss.sk;
      cfg = { ak, sk, bucket: b.bucket, endpoint: b.endpoint, region: b.region || '', publicDomain: b.public_domain || '', prefix: b.prefix || '' };
    } else {
      const existing = await one('SELECT * FROM storage_configs WHERE user_id=?', [req.user.id]);
      if (existing && existing.vendor !== 'system') {
        cfg = {
          ak: decryptSecret(existing.ak_enc),
          sk: decryptSecret(existing.sk_enc),
          bucket: existing.bucket,
          endpoint: existing.endpoint,
          region: existing.region,
          publicDomain: existing.public_domain,
          prefix: existing.prefix
        };
      } else {
        cfg = { ak: env.oss.ak, sk: env.oss.sk, bucket: env.oss.bucket, endpoint: env.oss.endpoint, region: env.oss.region, prefix: env.oss.prefixAdmin };
      }
    }
    const probe = await storageProbe(cfg);
    return ok(res, probe, probe.msg);
  })
);

/* --------------------------------- upload --------------------------------- */
router.post(
  '/upload',
  upload.single('file'),
  asyncH(async (req, res) => {
    if (!req.file) throw bad('未收到文件', 'NO_FILE');
    const kind = String((req.body && req.body.kind) || 'ot');
    if (!['tupian', 'bk', 'ot'].includes(kind)) throw bad('kind 只能是 tupian|bk|ot', 'BAD_KIND');
    const original = String(req.file.originalname || 'file');
    const base = path.basename(original.replace(/\\/g, '/')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
    const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const name = `${stamp}-${base || 'file'}`;
    const key = userKindKey(req.user.username, kind, name);
    const put = await putObject(key, req.file.buffer, mimeOf(base), req.user);
    let url = await signUrl(key, req.user, 7 * 24 * 3600).catch(() => publicUrl(key));
    // apk is refused on the raw endpoint and the custom domain breaks
    // signatures, so hand back our own proxied URL for those cases
    if (/\.apk$/i.test(key) || !url.includes(String(process.env.OSS_BUCKET || '\u0000'))) {
      const e = Math.floor(Date.now() / 1000) + RAW_TTL;
      url = `${env.publicBase}/api/storage/raw/${key.split('/').map(encodeURIComponent).join('/')}?t=${rawTokenFor(key, e)}&e=${e}`;
    }
    return ok(res, { url, key, size: req.file.size, name: base, kind, etag: put.etag || null }, '上传成功');
  })
);

/* ---------------------------------- sign ---------------------------------- */
router.post(
  '/sign',
  asyncH(async (req, res) => {
    const key = String((req.body || {}).key || '');
    if (!key) throw bad('缺少 key', 'BAD_INPUT');
    const prefix = `${userPrefixOf(req.user.username)}/`;
    if (!key.startsWith(prefix) && !key.startsWith(`${env.oss.prefixAdmin}/`)) {
      throw new ApiError('无权访问该对象', 403, 'FORBIDDEN_KEY');
    }
    const expires = Math.min(7 * 24 * 3600, Math.max(60, Number((req.body || {}).expires) || 3600));
    const url = await signUrl(key, req.user, expires);
    // proxy fallback that never depends on OSS-side signature verification
    const e = Math.floor(Date.now() / 1000) + RAW_TTL;
    const proxy = `/api/storage/raw/${key.split('/').map(encodeURIComponent).join('/')}?t=${rawTokenFor(key, e)}&e=${e}`;
    return ok(res, { url, proxy, key, expires });
  })
);

/* ------------------------- local fallback (dev only) ---------------------- */
router.get(
  '/local/:key(*)',
  asyncH(async (req, res) => {
    if (ossConfigured()) throw new ApiError('本地存储未启用', 404, 'LOCAL_DISABLED');
    const key = safePath(String(req.params.key || ''));
    const obj = await getObject(key, req.user);
    if (!obj) throw new ApiError('对象不存在', 404, 'NOT_FOUND');
    res.setHeader('Content-Type', mimeOf(key));
    return res.send(obj.content);
  })
);

export default router;
