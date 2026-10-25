/**
 * Object storage abstraction (Aliyun OSS via ali-oss) + optional local-disk dev fallback.
 *
 * Rules:
 *  - a user's content ALWAYS lives in object storage, never on the small server disk
 *    (local fallback is only used when OSS credentials are not configured at all).
 *  - object key = <prefix>/<relative path>, e.g. md/user/alice/tupian/pic.png
 *  - DB stores only metadata/index rows.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import OSS from 'ali-oss';
import { one } from './db.js';
import { env, SERVER_ROOT, ApiError, bad, decryptSecret, safePath } from './util.js';

const LOCAL_ROOT = path.join(SERVER_ROOT, 'data', 'objects');
export const USER_KINDS = ['tupian', 'bk', 'ot'];
const KIND_DIR = { tupian: 'tupian', bk: 'bk', ot: 'ot' };

export const ossConfigured = () => Boolean(env.oss.bucket && env.oss.ak && env.oss.sk);
export const userPrefixOf = (username) => `${env.oss.prefixUser}/${username}`;

/* ------------------------------- client cache ----------------------------- */
const cache = new Map();
function makeClient(cfg) {
  const opts = {
    accessKeyId: cfg.ak,
    accessKeySecret: cfg.sk,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
    region: cfg.region || env.oss.region,
    secure: true,
    timeout: 30000
  };
  if (cfg.cname && cfg.publicDomain) {
    opts.cname = true;
    opts.endpoint = cfg.publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  return new OSS(opts);
}

/** Public (system) OSS client. Pass cname:true to sign over the custom domain. */
export function publicClient(cname = false) {
  const key = `public:${cname ? 'cname' : 'raw'}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      makeClient({
        ak: env.oss.ak,
        sk: env.oss.sk,
        bucket: env.oss.bucket,
        endpoint: env.oss.endpoint,
        region: env.oss.region,
        cname,
        publicDomain: env.oss.domain
      })
    );
  }
  return cache.get(key);
}

/** Personal storage config row (decrypted) or null. */
export async function getUserStorageConfig(userId) {
  const row = await one('SELECT * FROM storage_configs WHERE user_id=?', [userId]);
  if (!row) return null;
  const ak = decryptSecret(row.ak_enc) || row.access_key_id || '';
  const sk = decryptSecret(row.sk_enc) || '';
  if (!row.bucket || !row.endpoint || !ak || !sk) return null;
  return {
    vendor: row.vendor,
    bucket: row.bucket,
    endpoint: row.endpoint,
    region: row.region,
    ak,
    sk,
    publicDomain: row.public_domain,
    prefix: (row.prefix || '').replace(/^\/|\/$/g, ''),
    pathStyle: Boolean(row.path_style),
    testOk: Boolean(row.test_ok)
  };
}

async function clientFor(user, { cname = false } = {}) {
  const personal = user ? await getUserStorageConfig(user.id) : null;
  if (personal && personal.vendor !== 'system') {
    const key = `user:${user.id}:${cname ? 'c' : 'r'}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        makeClient({
          ak: personal.ak,
          sk: personal.sk,
          bucket: personal.bucket,
          endpoint: personal.endpoint,
          region: personal.region,
          cname,
          publicDomain: personal.publicDomain
        })
      );
    }
    return { client: cache.get(key), bucket: personal.bucket, prefix: personal.prefix || '', personal };
  }
  return { client: publicClient(cname), bucket: env.oss.bucket, prefix: '', personal: null };
}

/* -------------------------------- local mode ------------------------------ */
function localPath(key) {
  const p = path.resolve(LOCAL_ROOT, key);
  if (!p.startsWith(LOCAL_ROOT)) throw bad('非法对象路径', 'BAD_KEY');
  return p;
}
async function localPut(key, body) {
  const p = localPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
}
async function localGet(key) {
  try {
    return await fs.readFile(localPath(key));
  } catch {
    return null;
  }
}
async function localDelete(key) {
  try {
    await fs.unlink(localPath(key));
    return true;
  } catch {
    return false;
  }
}
async function localList(prefix) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const st = await fs.stat(full);
        const rel = full.slice(LOCAL_ROOT.length + 1).replace(/\\/g, '/');
        if (rel.startsWith(prefix)) out.push({ key: rel, size: st.size, mtime: st.mtime, etag: null });
      }
    }
  }
  await walk(LOCAL_ROOT);
  return out;
}

/* --------------------------------- generic -------------------------------- */
/** Put an object. Accepts the pre-computed full key. */
export async function putObject(key, body, contentType = 'text/markdown; charset=utf-8', user = null) {
  if (!ossConfigured() && (!user || !(await getUserStorageConfig(user.id)))) {
    await localPut(key, body);
    return { key, size: Buffer.byteLength(body), local: true };
  }
  const { client } = await clientFor(user);
  const res = await client.put(key, Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'), {
    headers: { 'Content-Type': contentType },
    mime: contentType
  });
  return { key, size: Buffer.byteLength(body), etag: res?.res?.headers?.etag, url: res?.url };
}

export async function getObject(key, user = null) {
  if (!ossConfigured() && (!user || !(await getUserStorageConfig(user.id)))) {
    const buf = await localGet(key);
    return buf === null ? null : { content: buf, size: buf.length, mtime: null };
  }
  const { client } = await clientFor(user);
  try {
    const res = await client.get(key);
    const content = Buffer.isBuffer(res.content) ? res.content : Buffer.from(res.content || '');
    return { content, size: content.length, mtime: res.res?.headers?.['last-modified'] || null, etag: res.res?.headers?.etag };
  } catch (err) {
    if (err.code === 'NoSuchKey' || err.status === 404) return null;
    throw err;
  }
}

export async function getText(key, user = null) {
  const obj = await getObject(key, user);
  return obj ? obj.content.toString('utf8') : null;
}

export async function headObject(key, user = null) {
  if (!ossConfigured() && (!user || !(await getUserStorageConfig(user.id)))) {
    try {
      const st = await fs.stat(localPath(key));
      return { size: st.size, mtime: st.mtime };
    } catch {
      return null;
    }
  }
  const { client } = await clientFor(user);
  try {
    const r = await client.head(key);
    return { size: Number(r.res?.headers?.['content-length'] || 0), mtime: r.res?.headers?.['last-modified'] || null };
  } catch {
    return null;
  }
}

export async function deleteObject(key, user = null) {
  if (!ossConfigured() && (!user || !(await getUserStorageConfig(user.id)))) return localDelete(key);
  const { client } = await clientFor(user);
  try {
    await client.delete(key);
    return true;
  } catch {
    return false;
  }
}

export async function copyObject(fromKey, toKey, user = null) {
  const obj = await getObject(fromKey, user);
  if (!obj) return false;
  await putObject(toKey, obj.content, 'text/markdown; charset=utf-8', user);
  return true;
}

/** List all objects under a prefix -> [{key,size,mtime}] */
export async function listObjects(prefix, user = null, { max = 5000 } = {}) {
  if (!ossConfigured() && (!user || !(await getUserStorageConfig(user.id)))) {
    const all = await localList(prefix);
    return all.slice(0, max);
  }
  const { client } = await clientFor(user);
  const out = [];
  let marker = null;
  while (out.length < max) {
    const res = await client.list({ prefix, marker, 'max-keys': Math.min(1000, max - out.length) }, {});
    for (const o of res.objects || []) {
      out.push({ key: o.name, size: Number(o.size || 0), mtime: o.lastModified, etag: o.etag });
    }
    if (!res.isTruncated) break;
    marker = res.nextMarker;
  }
  return out;
}

/** Signed GET url (private read). Falls back to a direct URL when unsigned content is public. */
export async function signUrl(key, user = null, expires = 3600) {
  if (!ossConfigured() && (!user || !(await getUserStorageConfig(user.id)))) {
    return `${env.publicBase}/api/storage/local/${encodeURIComponent(key)}`;
  }
  const resolved = await clientFor(user);
  const useCname = !resolved.personal && Boolean(env.oss.domain);
  const client = useCname ? publicClient(true) : resolved.client;
  const url = client.signatureUrl(key, { expires, method: 'GET' });
  return url.replace(/^http:\/\//, 'https://');
}

/** Plain (unsigned) url for a key using the configured public domain. */
export function publicUrl(key) {
  if (env.oss.domain) return `${env.oss.domain}/${key}`;
  return `https://${env.oss.bucket}.${env.oss.endpoint}/${key}`;
}

/** Total bytes stored under a prefix. */
export async function prefixSize(prefix, user = null) {
  const list = await listObjects(prefix, user);
  return list.reduce((a, o) => a + Number(o.size || 0), 0);
}

/* ------------------------------ per user paths ---------------------------- */
export function userKindKey(username, kind, relPath = '') {
  const dir = KIND_DIR[kind];
  if (!dir) throw bad('kind 只能是 tupian|bk|ot', 'BAD_KIND');
  const rel = relPath ? safePath(relPath) : '';
  return `${userPrefixOf(username)}/${dir}${rel ? `/${rel}` : ''}`;
}

/** Key for a document inside the user's vault. */
export function userDocKey(username, vaultPath) {
  return `${userPrefixOf(username)}/${safePath(vaultPath)}`;
}

/** Resolve key for arbitrary (possibly personal-storage) user content. */
export async function resolveUserKey(user, vaultPath) {
  const cfg = await getUserStorageConfig(user.id);
  const rel = safePath(vaultPath);
  if (cfg && cfg.vendor !== 'system') {
    return { key: cfg.prefix ? `${cfg.prefix}/${rel}` : rel, personal: cfg };
  }
  return { key: `${userPrefixOf(user.username)}/${rel}`, personal: null };
}

/* ------------------------------- connectivity ----------------------------- */
/**
 * Real connectivity probe: put -> get -> delete a tiny object.
 * Returns {ok,msg,latencyMs,bucket}.
 */
export async function storageProbe(cfg) {
  const t0 = Date.now();
  const useLocal = !cfg || (!cfg.ak && !ossConfigured());
  const key = `md/_probe/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const payload = `neom-probe-${Date.now()}`;
  if (useLocal) {
    await localPut(key, payload);
    const got = await localGet(key);
    await localDelete(key);
    return { ok: got?.toString() === payload, msg: got ? '本地回退存储可用（未配置 OSS）' : '本地存储写入失败', latencyMs: Date.now() - t0, mode: 'local' };
  }
  let client;
  try {
    client = makeClient({
      ak: cfg.ak || env.oss.ak,
      sk: cfg.sk || env.oss.sk,
      bucket: cfg.bucket || env.oss.bucket,
      endpoint: cfg.endpoint || env.oss.endpoint,
      region: cfg.region || env.oss.region,
      cname: Boolean(cfg.cname && cfg.publicDomain),
      publicDomain: cfg.publicDomain
    });
  } catch (e) {
    return { ok: false, msg: `客户端初始化失败: ${e.message}`, latencyMs: Date.now() - t0 };
  }
  const probeKey = cfg.prefix ? `${String(cfg.prefix).replace(/^\/|\/$/g, '')}/${key}` : key;
  try {
    await client.put(probeKey, Buffer.from(payload));
    const got = await client.get(probeKey);
    const text = Buffer.isBuffer(got.content) ? got.content.toString() : String(got.content || '');
    await client.delete(probeKey);
    const okk = text === payload;
    return {
      ok: okk,
      msg: okk ? 'OSS 连通正常（put/get/delete 通过）' : 'OSS 读取内容与写入不一致',
      latencyMs: Date.now() - t0,
      bucket: cfg.bucket || env.oss.bucket,
      mode: 'oss'
    };
  } catch (e) {
    try {
      await client.delete(probeKey);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      msg: `OSS 访问失败: ${e.code || e.name || ''} ${e.message || ''}`.slice(0, 300),
      latencyMs: Date.now() - t0,
      bucket: cfg.bucket || env.oss.bucket
    };
  }
}

/** Ensure the public bucket is reachable (used by health/bootstrap). */
export async function storageHealth() {
  if (!ossConfigured()) return { ok: false, mode: 'local', msg: '未配置 OSS，使用本地回退存储' };
  try {
    const c = publicClient();
    await c.list({ 'max-keys': 1 }, {});
    return { ok: true, mode: 'oss', bucket: env.oss.bucket };
  } catch (e) {
    return { ok: false, mode: 'oss', msg: String(e.code || e.message || e).slice(0, 200) };
  }
}

export { ApiError };
