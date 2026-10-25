/**
 * /api/ai — thin HTTP layer over lib/aiProxy.js.
 *
 * Responsibilities kept here (and ONLY here):
 *   · auth (requireUser), per-user rate limiting, points affordability checks;
 *   · resolving the user's ai_settings (official vs custom mode);
 *   · forwarding the upstream result and settling the bill via lib/billing.js;
 *   · persisting TTS audio where the browser can fetch it.
 *
 * Every upstream protocol detail (channel pool, OpenAI vs Anthropic bodies,
 * SSE normalisation, ASR/TTS fallbacks, usage field variants) lives in
 * lib/aiProxy.js. The official API key never leaves the server: it is decrypted
 * inside the proxy and never included in a response.
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ok, fail, wrap, q, one, val, num, clientIp,
  encryptSecret, decryptSecret, maskSecret, sysGet
} from '../lib/aiShared.js';
import { requireAuth as requireUser } from '../lib/auth.js';
import { listModels, getModel, settleUsage, assertCanAfford } from '../lib/billing.js';
import { check as rateCheck, release as rateRelease, recordTokens as rateTokens, limitsFor } from '../lib/ratelimit.js';
import {
  PROVIDER_DOCS, FALLBACK_MODELS, PRESET_VOICES,
  chat as proxyChat, chatStream as proxyChatStream,
  transcribe, synthesize, fetchModels as proxyFetchModels,
  testConnection as proxyTestConnection
} from '../lib/aiProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../..');
const TTS_DIR = path.join(SERVER_ROOT, 'public', 'ai-tts');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });

/* ------------------------------------------------------- user settings -- */

/**
 * Read a user's AI configuration.
 * api_key is NEVER returned: only hasKey + a masked hint, so the UI can show
 * "已配置" without ever receiving the secret.
 */
async function userSettings(userId) {
  const row = await one('SELECT * FROM ai_settings WHERE user_id=?', [userId]).catch(() => null);
  const defaults = {
    chat: await sysGet('ai_default_scene_chat', 'mimo-v2.6-flash'),
    naming: await sysGet('ai_default_scene_naming', 'mimo-v2.6-flash'),
    asr: await sysGet('ai_default_scene_asr', 'mimo-v2.5-asr'),
    tts: await sysGet('ai_default_scene_tts', 'mimo-v2.5-tts')
  };
  if (!row) {
    return {
      mode: 'official',
      providerId: 'mimo',
      hasKey: false,
      apiKeyMasked: null,
      baseUrl: '',
      enabledModels: FALLBACK_MODELS.map((m) => m.id),
      defaults,
      ttsVoice: PRESET_VOICES[0].id,
      temperature: 0.7
    };
  }
  let defaultsParsed = {};
  try { defaultsParsed = row.defaults_json ? JSON.parse(row.defaults_json) : {}; } catch { defaultsParsed = {}; }
  let enabled = [];
  try { enabled = row.enabled_models ? JSON.parse(row.enabled_models) : []; } catch { enabled = []; }
  // Derive the display mask from the stored ciphertext length only — the
  // plaintext key is never decrypted just to render the UI.
  let masked = null;
  if (row.api_key_enc) {
    try {
      const plain = await decryptSecret(row.api_key_enc);
      masked = plain ? maskSecret(plain) : 'sk-***';
    } catch {
      masked = 'sk-***';
    }
  }
  return {
    mode: row.mode || 'official',
    providerId: row.provider_id || 'mimo',
    hasKey: !!row.api_key_enc,
    apiKeyMasked: masked,
    baseUrl: row.base_url || '',
    enabledModels: enabled.length ? enabled : FALLBACK_MODELS.map((m) => m.id),
    defaults: { ...defaults, ...defaultsParsed },
    ttsVoice: row.tts_voice || PRESET_VOICES[0].id,
    temperature: row.temperature === null || row.temperature === undefined ? 0.7 : num(row.temperature, 0.7)
  };
}

/** Resolve mode + provider + custom credentials for a request. */
async function upstreamContext(userId) {
  const settings = await userSettings(userId);
  const mode = settings.mode === 'custom' ? 'custom' : 'official';
  let userKey = '';
  let userBaseUrl = settings.baseUrl || '';
  if (mode === 'custom') {
    const row = await one('SELECT api_key_enc FROM ai_settings WHERE user_id=?', [userId]).catch(() => null);
    if (!row?.api_key_enc) {
      throw Object.assign(new Error('尚未配置个人 API Key'), { code: 'NO_API_KEY', status: 400 });
    }
    userKey = await decryptSecret(row.api_key_enc);
    if (!userKey) {
      throw Object.assign(new Error('个人 API Key 解密失败，请重新填写'), { code: 'NO_API_KEY', status: 400 });
    }
  }
  return { settings, mode, providerId: settings.providerId || 'mimo', userKey, userBaseUrl };
}

/* ----------------------------------------------------------- catalogue -- */

router.get('/providers', wrap(async (_req, res) => {
  let rows = [];
  try {
    rows = await q('SELECT * FROM ai_providers ORDER BY sort, id');
  } catch {
    rows = [];
  }
  const officialChannels = num(
    await val("SELECT COUNT(*) FROM ai_channels WHERE status='active' AND enabled=1", [], 0).catch(() => 0)
  );

  const list = rows.length
    ? rows.map((r) => {
        const meta = PROVIDER_DOCS[r.id] || {};
        return {
          id: r.id,
          name: r.name || meta.name || r.id,
          kind: r.kind || r.id,
          base_url_chat: r.base_url_chat || meta.chat || '',
          base_url_responses: r.base_url_responses || '',
          base_url_anthropic: r.base_url_anthropic || '',
          api_doc_url: r.api_doc_url || meta.doc || '',
          needs_key: r.needs_key !== 0,
          builtin: !!num(r.builtin),
          enabled: r.enabled !== 0,
          // official = the server can serve this provider without a user key.
          official: r.id === 'mimo' && officialChannels > 0
        };
      })
    : Object.entries(PROVIDER_DOCS).map(([id, m]) => ({
        id,
        name: m.name,
        kind: id,
        base_url_chat: m.chat || '',
        base_url_responses: '',
        base_url_anthropic: '',
        api_doc_url: m.doc,
        needs_key: true,
        builtin: id !== 'openai-compatible' && id !== 'anthropic',
        enabled: true,
        official: id === 'mimo' && officialChannels > 0
      }));
  ok(res, list);
}));

router.get('/models', wrap(async (_req, res) => {
  let models = [];
  try {
    models = await listModels({ enabledOnly: true });
  } catch {
    models = FALLBACK_MODELS.map((m) => ({
      ...m, billing: 'token', price_in: 0, price_out: 0, price_cache_in: 0, enabled: true
    }));
  }
  ok(res, models.map((m) => ({ ...m, free: m.billing === 'free' })));
}));

router.get('/tts/voices', wrap(async (_req, res) => ok(res, PRESET_VOICES)));

/* ----------------------------------------------------------------- chat -- */

/** Shared validation for chat entry points. */
function readChatInput(req) {
  const body = req.body || {};
  const { model: modelId, messages, temperature, max_tokens } = body;
  if (!Array.isArray(messages) || !messages.length) {
    throw Object.assign(new Error('messages 不能为空'), { code: 'BAD_REQUEST', status: 400 });
  }
  return {
    modelId,
    messages,
    temperature: temperature === undefined ? undefined : Math.min(2, Math.max(0, num(temperature, 0.7))),
    maxTokens: max_tokens === undefined ? undefined : Math.max(1, Math.trunc(num(max_tokens, 0))),
    scene: String(body.scene || 'chat').slice(0, 32)
  };
}

/** Pre-flight: resolve model, enforce affordability + rate limit. */
async function preflight(req, input, ctx) {
  const model = await getModel(input.modelId || ctx.settings.defaults[input.scene] || ctx.settings.defaults.chat).catch(() => null);
  if (!model) {
    throw Object.assign(new Error(`模型不存在：${input.modelId || '(未指定)'}`), { code: 'NOT_FOUND', status: 404 });
  }
  if (ctx.mode === 'official') await assertCanAfford(req.user, model);
  const limits = await limitsFor(req.user, { model: model.id });
  await rateCheck(req, {
    estimatedTokens: Math.ceil(JSON.stringify(input.messages).length / 3) + num(input.maxTokens, 0),
    model: model.id,
    limits
  });
  return { model, modelId: model.id };
}

router.post('/chat', requireUser, wrap(async (req, res) => {
  const t0 = Date.now();
  const input = readChatInput(req);
  const ctx = await upstreamContext(req.user.id);
  const { model, modelId } = await preflight(req, input, ctx);

  let upstream;
  try {
    upstream = await proxyChat({
      model: modelId,
      messages: input.messages,
      temperature: input.temperature ?? ctx.settings.temperature ?? 0.7,
      max_tokens: input.maxTokens,
      mode: ctx.mode,
      providerId: ctx.providerId,
      userKey: ctx.userKey,
      userBaseUrl: ctx.userBaseUrl
    });
  } finally {
    rateRelease(req);
  }

  rateTokens(req, upstream.usage.prompt_tokens + upstream.usage.completion_tokens);
  const latency = Date.now() - t0;

  const settle = await settleUsage({
    userId: req.user.id,
    model,
    scene: input.scene,
    usage: upstream.usage,
    latencyMs: latency,
    mode: ctx.mode,
    channelId: upstream.channel?.id ?? null,
    providerId: upstream.providerId || ctx.providerId,
    ip: clientIp(req)
  }).catch(() => ({ points: 0, balance_after: null }));

  ok(res, {
    content: upstream.content || '',
    reasoning: upstream.reasoning || undefined,
    finish_reason: upstream.finish_reason || null,
    model: upstream.model || modelId,
    mode: ctx.mode,
    usage: {
      model: upstream.model || modelId,
      prompt_tokens: upstream.usage.prompt_tokens,
      cached_tokens: upstream.usage.cached_tokens,
      completion_tokens: upstream.usage.completion_tokens,
      points_cost: settle?.points ?? 0,
      latency_ms: latency
    },
    points: settle?.balance_after ?? null
  });
}));

router.post('/chat/stream', requireUser, wrap(async (req, res) => {
  const t0 = Date.now();
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* client gone */ } };

  let input;
  let ctx;
  let model;
  let modelId;
  try {
    input = readChatInput(req);
    ctx = await upstreamContext(req.user.id);
    ({ model, modelId } = await preflight(req, input, ctx));
  } catch (err) {
    send({ error: err.message || '请求参数错误', code: err.code || 'BAD_REQUEST' });
    send({ done: true });
    return res.end();
  }

  let text = '';
  let reasoning = '';
  let finishReason = null;
  let usage = { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 };
  let failed = null;

  try {
    const { stream, channel } = await proxyChatStream({
      model: modelId,
      messages: input.messages,
      temperature: input.temperature ?? ctx.settings.temperature ?? 0.7,
      max_tokens: input.maxTokens,
      mode: ctx.mode,
      providerId: ctx.providerId,
      userKey: ctx.userKey,
      userBaseUrl: ctx.userBaseUrl
    });
    ctx.channel = channel;

    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.done) break;
      if (value?.error) { failed = value.error; break; }
      if (value?.delta) { text += value.delta; send({ delta: value.delta }); }
      if (value?.reasoning) { reasoning += value.reasoning; send({ reasoning: value.reasoning }); }
      if (value?.finish) finishReason = value.finish;
      if (value?.usage) usage = { ...usage, ...value.usage };
    }
  } catch (err) {
    failed = err.message || '流式请求失败';
  } finally {
    rateRelease(req);
    // Upstream may omit usage while streaming; estimate so the call is billed.
    if (!usage.completion_tokens && text) usage.completion_tokens = Math.max(1, Math.ceil(text.length / 3));
    if (!usage.prompt_tokens) usage.prompt_tokens = Math.max(1, Math.ceil(JSON.stringify(input?.messages || []).length / 3));
    rateTokens(req, usage.prompt_tokens + usage.completion_tokens);

    const latency = Date.now() - t0;
    const settle = await settleUsage({
      userId: req.user.id,
      model,
      scene: input?.scene || 'chat',
      usage,
      latencyMs: latency,
      mode: ctx.mode,
      channelId: ctx.channel?.id ?? null,
      providerId: ctx.providerId,
      ip: clientIp(req),
      // A failed stream is logged but never billed.
      status: failed ? 'error' : 'ok',
      error: failed || null
    }).catch(() => ({ points: 0, balance_after: null }));

    if (failed) send({ error: failed });
    send({
      done: true,
      ...(reasoning ? { reasoning } : {}),
      ...(finishReason ? { finish_reason: finishReason } : {}),
      usage: {
        model: modelId,
        prompt_tokens: usage.prompt_tokens,
        cached_tokens: usage.cached_tokens,
        completion_tokens: usage.completion_tokens,
        points_cost: settle?.points ?? 0,
        latency_ms: latency
      },
      points: settle?.balance_after ?? null
    });
    res.end();
  }
}));

/* ------------------------------------------------------------------ ASR -- */

router.post('/asr', requireUser, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return fail(res, '缺少音频文件', 'NO_FILE', 400);
  const t0 = Date.now();
  const ctx = await upstreamContext(req.user.id);
  const modelId = String(req.body?.model || ctx.settings.defaults.asr || 'mimo-v2.5-asr').slice(0, 64);
  const model = await getModel(modelId).catch(() => null);

  if (ctx.mode === 'official') await assertCanAfford(req.user, model || { billing: 'audio' });
  await rateCheck(req, { estimatedTokens: 0, model: modelId });

  let result;
  try {
    result = await transcribe({
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      filename: req.file.originalname,
      model: modelId,
      mode: ctx.mode,
      providerId: ctx.providerId,
      userKey: ctx.userKey,
      userBaseUrl: ctx.userBaseUrl
    });
  } finally {
    rateRelease(req);
  }
  rateTokens(req, result.usage.prompt_tokens + result.usage.completion_tokens);

  const latency = Date.now() - t0;
  const settle = await settleUsage({
    userId: req.user.id,
    model: model || modelId,
    scene: 'asr',
    usage: { ...result.usage, audio_seconds: result.seconds },
    latencyMs: latency,
    mode: ctx.mode,
    channelId: result.channel?.id ?? null,
    providerId: ctx.providerId,
    ip: clientIp(req)
  }).catch(() => ({ points: 0, balance_after: null }));

  ok(res, {
    text: result.text,
    seconds: result.seconds,
    audio_seconds: result.seconds,
    model: modelId,
    endpoint: result.endpoint,
    usage: {
      model: modelId,
      prompt_tokens: result.usage.prompt_tokens,
      cached_tokens: result.usage.cached_tokens,
      completion_tokens: result.usage.completion_tokens,
      audio_seconds: result.seconds,
      points_cost: settle?.points ?? 0,
      latency_ms: latency
    },
    points: settle?.balance_after ?? null
  });
}));

/* ------------------------------------------------------------------ TTS -- */

/**
 * Persist generated audio where the browser can fetch it.
 * OSS first (off the small server disk), then local disk served by
 * GET /tts/audio/:name. Base64 is always returned too, so a client can play
 * the audio without a second request.
 */
async function storeAudio(buf, ext = 'wav', mime = 'audio/wav') {
  const name = `tts-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  try {
    const storage = await import('../lib/storage.js');
    const key = `md/ai-tts/${name}`;
    const res = await storage.putObject(key, buf, mime, null);
    if (res && !res.local) {
      const url = res.url || (typeof storage.publicUrl === 'function' ? storage.publicUrl(key) : null);
      if (url) return { url, key, bytes: buf.length, where: 'oss' };
    }
  } catch { /* fall back to local disk */ }
  try {
    fs.mkdirSync(TTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(TTS_DIR, name), buf);
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    return { url: `${base}/api/ai/tts/audio/${name}`, key: `ai-tts/${name}`, bytes: buf.length, where: 'local' };
  } catch {
    return null;
  }
}

router.get('/tts/audio/:name', wrap(async (req, res) => {
  const name = String(req.params.name || '');
  if (!/^tts-[a-z0-9]+-[a-f0-9]+\.(wav|mp3|ogg|m4a)$/i.test(name)) {
    return fail(res, '文件名不合法', 'BAD_REQUEST', 400);
  }
  const file = path.join(TTS_DIR, name);
  if (!fs.existsSync(file)) return fail(res, '音频不存在或已过期', 'NOT_FOUND', 404);
  res.setHeader('Content-Type', name.endsWith('.mp3') ? 'audio/mpeg' : name.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(file);
}));

router.post('/tts', requireUser, wrap(async (req, res) => {
  const body = req.body || {};
  const text = String(body.text || '').trim();
  if (!text) return fail(res, 'text 不能为空', 'BAD_REQUEST', 400);

  const t0 = Date.now();
  const ctx = await upstreamContext(req.user.id);
  const modelId = String(body.model || ctx.settings.defaults.tts || 'mimo-v2.5-tts').slice(0, 64);
  const voice = String(body.voice || ctx.settings.ttsVoice || PRESET_VOICES[0].id).slice(0, 64);
  const model = await getModel(modelId).catch(() => null);

  if (ctx.mode === 'official') await assertCanAfford(req.user, model || { billing: 'free' });
  await rateCheck(req, { estimatedTokens: Math.ceil(text.length / 2), model: modelId });

  let result;
  try {
    result = await synthesize({
      // Guard the upstream: long inputs are truncated rather than billed silently.
      text: text.slice(0, 5000),
      model: modelId,
      voice,
      style: body.style ? String(body.style).slice(0, 200) : null,
      referenceAudio: body.referenceAudio || null,
      format: body.format || 'mp3',
      mode: ctx.mode,
      providerId: ctx.providerId,
      userKey: ctx.userKey,
      userBaseUrl: ctx.userBaseUrl
    });
  } finally {
    rateRelease(req);
  }
  rateTokens(req, result.usage.prompt_tokens + result.usage.completion_tokens);

  const ext = result.mime.includes('wav') ? 'wav' : result.mime.includes('ogg') ? 'ogg' : 'mp3';
  const saved = await storeAudio(Buffer.from(result.audioB64, 'base64'), ext, result.mime).catch(() => null);

  const latency = Date.now() - t0;
  const settle = await settleUsage({
    userId: req.user.id,
    model: model || modelId,
    scene: 'tts',
    usage: { ...result.usage, calls: 1 },
    latencyMs: latency,
    mode: ctx.mode,
    channelId: result.channel?.id ?? null,
    providerId: ctx.providerId,
    ip: clientIp(req)
  }).catch(() => ({ points: 0, balance_after: null }));

  ok(res, {
    url: saved?.url || `data:${result.mime};base64,${result.audioB64}`,
    dataUrl: `data:${result.mime};base64,${result.audioB64}`,
    base64: result.audioB64,
    mime: result.mime,
    voice,
    model: modelId,
    endpoint: result.endpoint,
    bytes: saved?.bytes ?? Math.round((result.audioB64.length * 3) / 4),
    usage: {
      model: modelId,
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
      points_cost: settle?.points ?? 0,
      latency_ms: latency
    },
    points: settle?.balance_after ?? null
  });
}));

/* --------------------------------------------------- dynamic model list -- */

router.post('/fetch-models', requireUser, wrap(async (req, res) => {
  const { providerId = 'mimo', apiKey, baseUrl } = req.body || {};
  const result = await proxyFetchModels({ providerId, apiKey, baseUrl });
  ok(res, result);
}));

router.post('/test', requireUser, wrap(async (req, res) => {
  const { providerId = 'mimo', apiKey, baseUrl } = req.body || {};
  const result = await proxyTestConnection({ providerId, apiKey, baseUrl });
  ok(res, result);
}));

/* ----------------------------------------------------------- settings --- */

router.get('/settings', requireUser, wrap(async (req, res) => {
  ok(res, await userSettings(req.user.id));
}));

router.post('/settings', requireUser, wrap(async (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  const mode = b.mode === 'custom' ? 'custom' : 'official';
  const providerId = String(b.providerId || 'mimo').slice(0, 48);
  const enabledModels = JSON.stringify(Array.isArray(b.enabledModels) ? b.enabledModels.slice(0, 200) : []);
  const defaults = JSON.stringify(b.defaults && typeof b.defaults === 'object' ? b.defaults : {});
  const baseUrl = b.baseUrl ? String(b.baseUrl).slice(0, 255) : '';
  const ttsVoice = b.ttsVoice ? String(b.ttsVoice).slice(0, 64) : null;
  const temperature = b.temperature === undefined || b.temperature === null
    ? null
    : Math.min(2, Math.max(0, num(b.temperature, 0.7)));

  // Only re-encrypt when a real new key was supplied (not the masked placeholder).
  let keyEnc = null;
  if (b.apiKey && !String(b.apiKey).includes('*')) {
    const k = String(b.apiKey).trim();
    if (k.length < 8) return fail(res, 'API Key 长度不足', 'BAD_REQUEST', 400);
    keyEnc = await encryptSecret(k);
  }

  // ai_settings is keyed by user_id (no surrogate id), so this must be an
  // upsert; api_key_enc is only overwritten when a new key was supplied.
  if (keyEnc) {
    await q(
      `INSERT INTO ai_settings (user_id,mode,provider_id,api_key_enc,base_url,enabled_models,defaults_json,tts_voice,temperature)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE mode=VALUES(mode), provider_id=VALUES(provider_id),
         api_key_enc=VALUES(api_key_enc), base_url=VALUES(base_url),
         enabled_models=VALUES(enabled_models), defaults_json=VALUES(defaults_json),
         tts_voice=VALUES(tts_voice), temperature=VALUES(temperature)`,
      [userId, mode, providerId, keyEnc, baseUrl, enabledModels, defaults, ttsVoice, temperature]
    );
  } else {
    await q(
      `INSERT INTO ai_settings (user_id,mode,provider_id,base_url,enabled_models,defaults_json,tts_voice,temperature)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE mode=VALUES(mode), provider_id=VALUES(provider_id),
         base_url=VALUES(base_url), enabled_models=VALUES(enabled_models),
         defaults_json=VALUES(defaults_json), tts_voice=VALUES(tts_voice),
         temperature=VALUES(temperature)`,
      [userId, mode, providerId, baseUrl, enabledModels, defaults, ttsVoice, temperature]
    );
  }

  ok(res, await userSettings(userId));
}));

export default router;
