/**
 * /api/site — public portal config, docs, announcement; /api/bootstrap aggregate.
 */
import { Router } from 'express';
import { query, one, getSiteConfig, getSiteDoc } from '../lib/db.js';
import { ok, bad, asyncH, toISO, jsonParse, env } from '../lib/util.js';

export const siteRouter = Router();

/* --------------------------------- config --------------------------------- */
siteRouter.get(
  '/config',
  asyncH(async (req, res) => {
    const cfg = await getSiteConfig();
    return ok(res, cfg);
  })
);

siteRouter.get(
  '/docs',
  asyncH(async (req, res) => {
    const key = String(req.query.key || 'terms').trim();
    if (!/^[a-z0-9-]{1,32}$/i.test(key)) throw bad('文档 key 不合法', 'BAD_KEY');
    const doc = await getSiteDoc(key);
    if (!doc) throw bad('文档不存在', 'NOT_FOUND');
    return ok(res, { key: doc.k, title: doc.title, content: doc.content, updated_at: toISO(doc.updated_at) });
  })
);

siteRouter.get(
  '/announcement',
  asyncH(async (req, res) => {
    const cfg = await getSiteConfig();
    return ok(res, {
      announcement: cfg.announcement || '',
      notice: cfg.notice || '',
      updated_at: toISO(new Date())
    });
  })
);

/* -------------------------------- bootstrap -------------------------------- */
export const bootstrapRouter = Router();

bootstrapRouter.get(
  '/',
  asyncH(async (req, res) => {
    const started = Date.now();
    const [cfg, docsRows, releaseRows, pluginRows, modelRows, providerRows, notifRows] = await Promise.all([
      getSiteConfig(),
      query('SELECT k,title FROM site_docs').catch(() => [[]]),
      query("SELECT * FROM releases ORDER BY platform, published_at DESC").catch(() => [[]]),
      query("SELECT id,name,version,description,author,category,icon,builtin,manifest_json,status,downloads,rating,default_enabled,created_at AS published_at FROM plugins WHERE status='published' ORDER BY builtin DESC, sort ASC, id ASC").catch(() => [[]]),
      query('SELECT * FROM ai_models WHERE enabled=1 ORDER BY sort ASC, id ASC').catch(() => [[]]),
      query('SELECT * FROM ai_providers WHERE enabled=1 ORDER BY sort ASC').catch(() => [[]]),
      query("SELECT id,kind,title,content,created_at FROM notifications WHERE user_id IS NULL ORDER BY id DESC LIMIT 5").catch(() => [[]])
    ]);

    const byPlatform = new Map();
    for (const r of releaseRows[0]) {
      const list = byPlatform.get(r.platform) || [];
      list.push({
        id: r.id,
        platform: r.platform,
        version: r.version,
        filename: r.filename,
        size: Number(r.size || 0),
        url: r.url,
        sha256: r.sha256,
        changelog: r.changelog,
        forced: Boolean(r.forced),
        channel: r.channel,
        published_at: toISO(r.published_at),
        downloads: Number(r.downloads || 0)
      });
      byPlatform.set(r.platform, list);
    }

    return ok(res, {
      site: cfg,
      docs: (docsRows[0] || []).map((d) => ({ key: d.k, title: d.title })),
      releases: [...byPlatform.entries()].map(([platform, list]) => ({
        platform,
        latest: list.slice().sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0],
        history: list
      })),
      plugins: (pluginRows[0] || []).map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        category: p.category,
        icon: p.icon,
        builtin: Boolean(p.builtin),
        status: p.status,
        downloads: Number(p.downloads || 0),
        rating: Number(p.rating || 0),
        default_enabled: Boolean(p.default_enabled),
        published_at: toISO(p.published_at),
        manifest: jsonParse(p.manifest_json, null)
      })),
      models: (modelRows[0] || []).map((m) => ({
        id: m.id,
        provider_id: m.provider_id,
        label: m.label,
        category: m.category,
        context_window: Number(m.context_window),
        max_output: Number(m.max_output),
        rpm: Number(m.rpm),
        tpm: Number(m.tpm),
        billing: m.billing,
        price_cache_in: Number(m.price_cache_in),
        price_in: Number(m.price_in),
        price_out: Number(m.price_out),
        price_audio_hour: Number(m.price_audio_hour || 0),
        price_call: Number(m.price_call || 0),
        free_until: toISO(m.free_until),
        recommended_for: m.recommended_for,
        tag: m.tag,
        enabled: Boolean(m.enabled)
      })),
      providers: (providerRows[0] || []).map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        base_url_chat: p.base_url_chat,
        base_url_responses: p.base_url_responses,
        base_url_anthropic: p.base_url_anthropic,
        api_doc_url: p.api_doc_url,
        needs_key: Boolean(p.needs_key),
        builtin: Boolean(p.builtin),
        enabled: Boolean(p.enabled)
      })),
      notifications: (notifRows[0] || []).map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        content: n.content,
        created_at: toISO(n.created_at)
      })),
      version: cfg.client_version || '1.0.0',
      base_url: env.publicBase,
      ts: toISO(new Date()),
      took_ms: Date.now() - started
    });
  })
);

export default siteRouter;
