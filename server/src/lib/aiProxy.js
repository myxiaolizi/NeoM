/**
 * aiProxy.js — upstream AI proxy engine (no Express dependency).
 *
 * This module owns every detail of talking to an upstream AI provider so that
 * routes/ai.js stays a thin HTTP layer:
 *
 *   · channel selection: weighted round-robin across ai_channels, biased away
 *     from channels that have been failing, with fail-count bookkeeping and
 *     automatic failover to the next key;
 *   · protocol adapters: OpenAI-compatible /chat/completions and Anthropic
 *     /v1/messages (body translation + SSE event translation);
 *   · usage normalisation: mimo returns prompt_tokens_details.cached_tokens,
 *     some gateways return prompt_cache_hit_tokens or cache_read_input_tokens,
 *     and any of those details objects may be null;
 *   · ASR/TTS, which mimo serves through chat/completions (input_audio parts
 *     and an assistant message respectively) but which other providers serve
 *     through the OpenAI audio endpoints — both paths are implemented.
 *
 * The caller (routes/ai.js) is responsible for auth, rate limiting and billing;
 * this module only performs network I/O and reports usage.
 */
import {
  q, one, num, decryptSecret, fetchJson, ApiError
} from './aiShared.js';

/* ============================== provider metadata ============================== */

/** Built-in provider catalogue, used when ai_providers has no row. */
export const PROVIDER_DOCS = {
  mimo: { name: '小米 mimo', doc: 'https://api.xiaomimimo.com', chat: 'https://api.xiaomimimo.com/v1' },
  deepseek: { name: 'DeepSeek', doc: 'https://platform.deepseek.com/api_keys', chat: 'https://api.deepseek.com/v1' },
  qwen: { name: '通义千问', doc: 'https://bailian.console.aliyun.com/', chat: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  tencent: { name: '腾讯云', doc: 'https://console.cloud.tencent.com/hunyuan/api-key', chat: 'https://api.hunyuan.cloud.tencent.com/v1' },
  zhipu: { name: '智谱 Zhipu', doc: 'https://open.bigmodel.cn/usercenter/apikeys', chat: 'https://open.bigmodel.cn/api/paas/v4' },
  volcengine: { name: '火山引擎', doc: 'https://console.volcengine.com/ark', chat: 'https://ark.cn-beijing.volces.com/api/v3' },
  qianfan: { name: '百度千帆', doc: 'https://console.bce.baidu.com/qianfan/', chat: 'https://qianfan.baidubce.com/v2' },
  'openai-compatible': { name: '自定义 [OI] 兼容', doc: '', chat: '' },
  anthropic: { name: '自定义 Anthropic 兼容', doc: '', chat: '' }
};

/**
 * Fallback model list (verified live against api.xiaomimimo.com/v1/models).
 * Only 7 models exist upstream — v2.5-pro / v2.5-flash were retired.
 */
export const FALLBACK_MODELS = [
  { id: 'mimo-v2.6-pro', label: 'MiMo v2.6 Pro', category: 'omni' },
  { id: 'mimo-v2.6-flash', label: 'MiMo v2.6 Flash', category: 'text' },
  { id: 'mimo-v2.6-pro-ultraspeed', label: 'MiMo v2.6 Pro UltraSpeed', category: 'text' },
  { id: 'mimo-v2.5-asr', label: 'MiMo v2.5 ASR', category: 'asr' },
  { id: 'mimo-v2.5-tts', label: 'MiMo v2.5 TTS', category: 'tts' },
  { id: 'mimo-v2.5-tts-voicedesign', label: 'MiMo v2.5 TTS 音色设计', category: 'tts' },
  { id: 'mimo-v2.5-tts-voiceclone', label: 'MiMo v2.5 TTS 音色克隆', category: 'voiceclone' }
];

/** Preset voices (bilingual, >= 8 as required by the contract). */
export const PRESET_VOICES = [
  { id: 'zh_female_qingxin', name: '清心', lang: 'zh-CN', desc: '标准女声，适合朗读与旁白' },
  { id: 'zh_male_wenzhong', name: '文仲', lang: 'zh-CN', desc: '沉稳男声，适合解说' },
  { id: 'zh_female_roumei', name: '柔美', lang: 'zh-CN', desc: '温柔女声，适合情感内容' },
  { id: 'zh_male_shaonian', name: '少年', lang: 'zh-CN', desc: '年轻男声，适合轻松内容' },
  { id: 'zh_female_keai', name: '可爱', lang: 'zh-CN', desc: '活泼童声，适合卡通配音' },
  { id: 'zh_male_dongbei', name: '东北', lang: 'zh-CN', desc: '东北口音，适合搞笑短视频' },
  { id: 'en_female_jane', name: 'Jane', lang: 'en-US', desc: 'Clear American female voice' },
  { id: 'en_male_jackson', name: 'Jackson', lang: 'en-US', desc: 'Warm American male voice' },
  { id: 'en_female_emma', name: 'Emma', lang: 'en-GB', desc: 'British female voice for narration' },
  { id: 'ja_female_sakura', name: 'Sakura', lang: 'ja-JP', desc: '日本語の女性音声' }
];

/* ============================== URL + usage helpers ============================== */

/** Strip a trailing endpoint/version so callers can append their own path. */
export function normalizeRoot(u) {
  return String(u || '')
    .replace(/\/+$/, '')
    .replace(/(\/v1)?\/(chat\/completions|messages|responses)$/, '');
}

/** True when the provider speaks the Anthropic protocol. */
export const isAnthropic = (provider = {}) =>
  String(provider.kind || provider.id || '').toLowerCase() === 'anthropic' ||
  /anthropic/i.test(String(provider.base_url_anthropic || ''));

/**
 * Normalise upstream usage across providers.
 * mimo/browser: prompt_tokens_details.cached_tokens
 * deepseek:     prompt_cache_hit_tokens
 * anthropic:    cache_read_input_tokens
 * Each details object may be null (observed on mimo), hence the chained null guards.
 */
export function readUsage(u = {}) {
  const src = u || {};
  const details = src.prompt_tokens_details || null;
  const cached =
    src.cached_tokens ??
    src.prompt_cache_hit_tokens ??
    src.cache_read_input_tokens ??
    (details ? details.cached_tokens : undefined) ??
    src.cache_creation_input_tokens ??
    0;
  const prompt = src.prompt_tokens ?? src.input_tokens ?? 0;
  const completion = src.completion_tokens ?? src.output_tokens ?? 0;
  const audioDetails = src.completion_tokens_details || null;
  return {
    prompt_tokens: num(prompt) || 0,
    completion_tokens: num(completion) || 0,
    cached_tokens: num(cached) || 0,
    reasoning_tokens: num(audioDetails ? audioDetails.reasoning_tokens : 0) || 0,
    audio_seconds: num(src.seconds ?? src.audio_seconds, 0) || 0,
    source: src
  };
}

/* ============================== channel pool ============================== */

/** Mark a channel healthy (reset fail counter). Never throws. */
export const markChannelOk = (id) =>
  (id ? q('UPDATE ai_channels SET fail_count=0, last_ok_at=NOW(), last_error=NULL WHERE id=?', [id]) : Promise.resolve())
    .catch(() => {});

/** Record a channel failure. Never throws. */
export const markChannelFail = (id, msg = null) =>
  (id
    ? q('UPDATE ai_channels SET fail_count=fail_count+1, last_error=? WHERE id=?', [
        msg ? String(msg).slice(0, 500) : null,
        id
      ])
    : Promise.resolve()
  ).catch(() => {});

/**
 * Pick a channel for a provider.
 *
 * Weighted random over the healthiest slice: channels are sorted by
 * (fail_count ASC, weight DESC), then drawn from the top candidates by weight
 * so one healthy key does not absorb all traffic. Failed channels are skipped
 * entirely unless nothing else is left, which is what makes failover work.
 */
export async function pickChannel(providerId, { excludeIds = [] } = {}) {
  const rows = await q(
    `SELECT * FROM ai_channels
      WHERE provider_id = ? AND status = 'active' AND enabled = 1
      ORDER BY fail_count ASC, weight DESC, id ASC`,
    [providerId]
  ).catch(() => []);
  const usable = rows.filter((r) => !excludeIds.includes(num(r.id)));
  if (!usable.length) {
    if (rows.length) return null; // all candidates were excluded
    throw ApiError.from('UPSTREAM', `没有可用的「${providerId}」渠道，请联系管理员`);
  }
  const zeroFail = usable.filter((r) => num(r.fail_count, 0) === 0);
  const candidates = (zeroFail.length ? zeroFail : usable).slice(0, 3);
  const total = candidates.reduce((s, r) => s + Math.max(1, num(r.weight, 1)), 0);
  let n = Math.random() * total;
  for (const r of candidates) {
    n -= Math.max(1, num(r.weight, 1));
    if (n <= 0) return r;
  }
  return candidates[0];
}

/** Decrypt a channel's stored key, falling back to the server env. */
export async function channelKey(ch) {
  if (ch && ch.api_key_enc) {
    try {
      const k = await decryptSecret(ch.api_key_enc);
      if (k) return k;
    } catch { /* fall through to env */ }
  }
  return process.env.MIMO_API_KEY || process.env.AI_API_KEY || '';
}

/** Resolve {apiKey, root, channel, kind} for a request, official or custom. */
export async function resolveUpstream({
  mode = 'official', providerId = 'mimo', userKey = '', userBaseUrl = '', retryExclude = []
}) {
  if (mode === 'custom') {
    const key = String(userKey || '').trim();
    if (!key) throw ApiError.from('BAD_REQUEST', '尚未配置个人 API Key', { code: 'NO_API_KEY' });
    const prov = PROVIDER_DOCS[providerId] || {};
    const root = normalizeRoot(userBaseUrl || prov.chat || '');
    if (!root) throw ApiError.from('BAD_REQUEST', '未配置上游接口地址', { code: 'NO_UPSTREAM' });
    return { apiKey: key, root, channel: null, providerId, kind: providerId };
  }
  const channel = await pickChannel(providerId, { excludeIds: retryExclude });
  if (!channel) throw ApiError.from('UPSTREAM', '所有渠道均不可用，请稍后再试');
  const apiKey = await channelKey(channel);
  if (!apiKey) throw ApiError.from('UPSTREAM', '官方渠道未配置 API Key，请联系管理员');
  const root = normalizeRoot(channel.base_url || (PROVIDER_DOCS[providerId] || {}).chat || '');
  if (!root) throw ApiError.from('UPSTREAM', '未配置上游接口地址');
  await q('UPDATE ai_channels SET last_used_at=NOW() WHERE id=?', [channel.id]).catch(() => {});
  return { apiKey, root, channel, providerId, kind: providerId };
}

/* ============================== protocol adapters ============================== */

/** OpenAI-style messages → Anthropic messages + system string. */
export function toAnthropicBody({ model, messages = [], temperature, max_tokens, stream }) {
  const systemParts = [];
  const out = [];
  for (const m of messages) {
    if (!m) continue;
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((p) => p?.text || p?.content || '').join('\n')
        : '';
    if (m.role === 'system') { systemParts.push(text); continue; }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text });
  }
  // Anthropic requires the conversation to start with a user turn.
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: systemParts.join('\n') || '…' });
  return {
    model,
    messages: out,
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(max_tokens ? { max_tokens } : { max_tokens: 4096 }),
    ...(stream ? { stream: true } : {})
  };
}

/** Anthropic response → OpenAI-ish {content, reasoning, finish_reason}. */
export function fromAnthropicResponse(json) {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const content = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const reasoning = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || '').join('');
  const stop = json?.stop_reason;
  return {
    content,
    reasoning,
    finish_reason: stop === 'max_tokens' ? 'length' : stop === 'end_turn' ? 'stop' : stop || null,
    usage: readUsage(json?.usage)
  };
}

/**
 * Parse one Anthropic SSE event into {delta?, reasoning?, finish?, usage?}.
 * Anthropic emits typed events (content_block_delta, message_delta, …).
 */
export function parseAnthropicEvent(evt) {
  const out = {};
  switch (evt?.type) {
    case 'content_block_delta': {
      const d = evt.delta || {};
      if (d.type === 'text_delta' && d.text) out.delta = d.text;
      if (d.type === 'thinking_delta' && d.thinking) out.reasoning = d.thinking;
      break;
    }
    case 'message_delta':
      if (evt.delta && evt.delta.stop_reason) {
        out.finish = evt.delta.stop_reason === 'max_tokens' ? 'length' : 'stop';
      }
      if (evt.usage) out.usage = readUsage(evt.usage);
      break;
    case 'message_start':
      if (evt.message && evt.message.usage) out.usage = readUsage(evt.message.usage);
      break;
    default:
      break;
  }
  return out;
}

/**
 * Parse one OpenAI SSE event into {delta?, reasoning?, finish?, usage?}.
 * Handles reasoning_content (mimo/deepseek) and finish_reason.
 */
export function parseOpenAIEvent(evt) {
  const choice = evt?.choices?.[0] || {};
  const d = choice.delta || choice.message || {};
  const out = {};
  const text = d.content;
  if (typeof text === 'string' && text) out.delta = text;
  const reasoning = d.reasoning_content ?? d.reasoning;
  if (typeof reasoning === 'string' && reasoning) out.reasoning = reasoning;
  if (choice.finish_reason) out.finish = choice.finish_reason;
  if (evt?.usage) out.usage = readUsage(evt.usage);
  return out;
}

/* ============================== chat ============================== */

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Non-streaming chat with automatic failover across the channel pool.
 *
 * Retries only on transport errors / retryable HTTP statuses, and only when
 * running in official mode (a custom key has nothing to fail over to).
 */
export async function chat({
  model, messages, temperature = 0.7, max_tokens,
  mode = 'official', providerId = 'mimo', userKey = '', userBaseUrl = '',
  maxAttempts = 3, timeoutMs = 120000
}) {
  const tried = [];
  let lastErr = null;
  const attempts = mode === 'official' ? Math.max(1, maxAttempts) : 1;

  for (let i = 0; i < attempts; i++) {
    let up;
    try {
      up = await resolveUpstream({ mode, providerId, userKey, userBaseUrl, retryExclude: tried });
    } catch (err) {
      throw err;
    }
    if (up.channel) tried.push(num(up.channel.id));

    const anthropic = isAnthropic({ id: up.providerId, kind: up.providerId, base_url_anthropic: up.root });
    const url = anthropic ? `${up.root}/messages` : `${up.root}/chat/completions`;
    const body = anthropic
      ? toAnthropicBody({ model, messages, temperature, max_tokens, stream: false })
      : {
          model, messages, temperature, stream: false,
          ...(max_tokens ? { max_tokens } : {})
        };
    const headers = anthropic
      ? { 'Content-Type': 'application/json', 'x-api-key': up.apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${up.apiKey}` };

    const resp = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
    const payload = resp.json;

    if (!resp.ok || !payload) {
      const detail = String(resp.text || resp.error || '').slice(0, 300);
      await markChannelFail(up.channel?.id, `HTTP ${resp.status}: ${detail}`);
      lastErr = ApiError.from(
        'UPSTREAM',
        `上游返回 ${resp.status}：${detail || '空响应'}`,
        { status: resp.status, channelId: up.channel?.id ?? null, attempt: i + 1 }
      );
      if (!RETRYABLE.has(resp.status) && resp.status !== 0) break;
      continue;
    }

    await markChannelOk(up.channel?.id);
    if (anthropic) {
      const parsed = fromAnthropicResponse(payload);
      return {
        ...parsed,
        model: payload.model || model,
        channel: up.channel,
        providerId: up.providerId,
        protocol: 'anthropic'
      };
    }
    const choice = payload?.choices?.[0] || {};
    const message = choice.message || {};
    return {
      content: typeof message.content === 'string' ? message.content : '',
      reasoning: message.reasoning_content ?? message.reasoning ?? '',
      finish_reason: choice.finish_reason || null,
      usage: readUsage(payload.usage),
      model: payload.model || model,
      channel: up.channel,
      providerId: up.providerId,
      protocol: 'openai'
    };
  }
  throw lastErr || ApiError.from('UPSTREAM', '上游调用失败');
}

/**
 * Open a streaming chat response.
 *
 * Returns {stream, channel, protocol, providerId, model, url} where `stream` is
 * a ReadableStream of already-normalised events
 * ({delta}|{reasoning}|{finish}|{usage}|{error}|{done}).
 * The caller is responsible for writing them as SSE and settling the bill.
 */
export async function chatStream({
  model, messages, temperature = 0.7, max_tokens,
  mode = 'official', providerId = 'mimo', userKey = '', userBaseUrl = '',
  timeoutMs = 180000
}) {
  const up = await resolveUpstream({ mode, providerId, userKey, userBaseUrl });
  const anthropic = isAnthropic({ id: up.providerId, kind: up.providerId, base_url_anthropic: up.root });
  const url = anthropic ? `${up.root}/messages` : `${up.root}/chat/completions`;
  const body = anthropic
    ? toAnthropicBody({ model, messages, temperature, max_tokens, stream: true })
    : { model, messages, temperature, stream: true, ...(max_tokens ? { max_tokens } : {}) };
  const headers = anthropic
    ? { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-api-key': up.apiKey, 'anthropic-version': '2023-06-01' }
    : { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${up.apiKey}` };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    await markChannelFail(up.channel?.id, err.message);
    throw ApiError.from('UPSTREAM', `无法连接上游：${err.message}`);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    clearTimeout(timer);
    await markChannelFail(up.channel?.id, `HTTP ${res.status}: ${text.slice(0, 300)}`);
    throw ApiError.from('UPSTREAM', `上游返回 ${res.status}：${text.slice(0, 300) || '空响应'}`, {
      status: res.status
    });
  }

  const parse = anthropic ? parseAnthropicEvent : parseOpenAIEvent;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            clearTimeout(timer);
            await markChannelOk(up.channel?.id);
            controller.enqueue({ done: true });
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          let emitted = false;
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith('data:')) continue;
            const raw = s.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            let evt;
            try { evt = JSON.parse(raw); } catch { continue; }
            const parsed = parse(evt);
            if (parsed.delta || parsed.reasoning || parsed.finish || parsed.usage) {
              controller.enqueue(parsed);
              emitted = true;
            }
          }
          if (emitted) return;
        }
      } catch (err) {
        clearTimeout(timer);
        await markChannelFail(up.channel?.id, err.message);
        controller.enqueue({ error: err.message || '流式读取失败' });
        controller.close();
      }
    },
    cancel() {
      clearTimeout(timer);
      try { reader.cancel(); } catch { /* noop */ }
    }
  });

  return { stream, channel: up.channel, providerId: up.providerId, protocol: anthropic ? 'anthropic' : 'openai', model, url };
}

/* ============================== audio helpers ============================== */

/**
 * Audio duration in seconds.
 * WAV is read from the RIFF header (exact); other containers fall back to a
 * conservative bitrate estimate. Upstream usage.seconds is authoritative when
 * present and overrides this.
 */
export function audioSecondsOf(buf, mime = '') {
  try {
    if (buf && buf.length >= 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
      let off = 12;
      let byteRate = 0;
      let dataLen = 0;
      while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        const size = buf.readUInt32LE(off + 4);
        if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
        if (id === 'data') { dataLen = size; break; }
        off += 8 + size + (size % 2);
      }
      if (byteRate > 0 && dataLen > 0) return Math.round((dataLen / byteRate) * 10) / 10;
    }
  } catch { /* fall through */ }
  const m = String(mime || '').toLowerCase();
  const kbps = /webm|ogg/.test(m) ? 32
    : /wav/.test(m) ? 128
    : /mp3|mpeg/.test(m) ? 96
    : /m4a|mp4|aac/.test(m) ? 96
    : 64;
  return Math.max(0.5, Math.round(((buf?.length || 0) * 8 / (kbps * 1000)) * 10) / 10);
}

/** Map a mime type / filename to the format string upstream expects. */
export function audioFormatOf(mime = '', name = '') {
  const s = `${mime} ${name}`.toLowerCase();
  if (s.includes('wav')) return 'wav';
  if (s.includes('mp3') || s.includes('mpeg')) return 'mp3';
  if (s.includes('webm')) return 'webm';
  if (s.includes('ogg')) return 'ogg';
  if (s.includes('m4a') || s.includes('mp4')) return 'm4a';
  if (s.includes('flac')) return 'flac';
  return 'wav';
}

/**
 * Transcribe audio.
 *
 * 1) OpenAI-compatible multipart POST {root}/audio/transcriptions (preferred).
 * 2) Fallback: chat/completions with an input_audio content part — this is how
 *    mimo's ASR model works (verified against api.xiaomimimo.com).
 */
export async function transcribe({ buffer, mime, filename, model, mode, providerId, userKey, userBaseUrl }) {
  const up = await resolveUpstream({ mode, providerId, userKey, userBaseUrl });
  const format = audioFormatOf(mime, filename);
  const guessed = audioSecondsOf(buffer, mime);
  let text = '';
  let seconds = guessed;
  let usage = readUsage({});
  let endpoint = 'transcriptions';

  let ok = false;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([buffer], { type: mime || 'audio/webm' }), filename || `audio.${format}`);
    fd.append('model', model);
    const res = await fetch(`${up.root}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${up.apiKey}` },
      body: fd,
      signal: AbortSignal.timeout(180000)
    });
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      text = j.text || j?.data?.text || '';
      if (j.duration) seconds = Math.round(num(j.duration) * 10) / 10;
      if (j.usage) usage = readUsage(j.usage);
      ok = true;
    }
  } catch { /* fall through to chat */ }

  if (!ok) {
    endpoint = 'chat';
    const resp = await fetchJson(`${up.root}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${up.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: buffer.toString('base64'), format } }]
        }]
      })
    }, 180000);
    if (!resp.ok) {
      const detail = String(resp.text || '').slice(0, 300) || `HTTP ${resp.status}`;
      await markChannelFail(up.channel?.id, detail);
      throw ApiError.from('UPSTREAM', `语音识别失败：${detail}`, { status: resp.status });
    }
    const j = resp.json || {};
    text = j?.choices?.[0]?.message?.content ?? '';
    usage = readUsage(j?.usage);
    if (usage.audio_seconds > 0) seconds = Math.round(usage.audio_seconds * 10) / 10;
  }

  await markChannelOk(up.channel?.id);
  return { text, seconds, usage, endpoint, channel: up.channel, providerId: up.providerId };
}

/**
 * Synthesise speech.
 *
 * 1) OpenAI-compatible {root}/audio/speech (binary or JSON body).
 * 2) Fallback: chat/completions where the text to speak is the ASSISTANT
 *    message and audio comes back base64 at choices[0].message.audio.data —
 *    this is mimo's TTS protocol (verified against api.xiaomimimo.com).
 */
export async function synthesize({ text, model, voice, style, referenceAudio, format, mode, providerId, userKey, userBaseUrl }) {
  const up = await resolveUpstream({ mode, providerId, userKey, userBaseUrl });
  let audioB64 = '';
  let mime = 'audio/wav';
  let usage = readUsage({});
  let endpoint = 'speech';

  let ok = false;
  try {
    const res = await fetch(`${up.root}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${up.apiKey}` },
      body: JSON.stringify({
        model, input: text, voice, response_format: format || 'mp3',
        ...(style ? { style } : {}),
        ...(referenceAudio ? { reference_audio: referenceAudio } : {})
      }),
      signal: AbortSignal.timeout(180000)
    });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await res.json();
        audioB64 = j.audio || j.data || j.b64_json || '';
        if (j.usage) usage = readUsage(j.usage);
        mime = j.format ? `audio/${j.format}` : 'audio/mpeg';
      } else {
        audioB64 = Buffer.from(await res.arrayBuffer()).toString('base64');
        mime = (ct.split(';')[0] || 'audio/mpeg').trim();
      }
      ok = !!audioB64;
    }
  } catch { /* fall through to chat */ }

  if (!ok) {
    endpoint = 'chat';
    const resp = await fetchJson(`${up.root}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${up.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'assistant', content: text }],
        ...(voice ? { voice } : {}),
        ...(style ? { style } : {}),
        ...(referenceAudio ? { reference_audio: referenceAudio } : {})
      })
    }, 180000);
    if (!resp.ok) {
      const detail = String(resp.text || '').slice(0, 300) || `HTTP ${resp.status}`;
      await markChannelFail(up.channel?.id, detail);
      throw ApiError.from('UPSTREAM', `语音合成失败：${detail}`, { status: resp.status });
    }
    const j = resp.json || {};
    audioB64 = j?.choices?.[0]?.message?.audio?.data || '';
    usage = readUsage(j?.usage);
    if (audioB64) {
      // mimo returns WAV; sniff the magic bytes so the mime is never wrong.
      mime = audioB64.startsWith('UklGR') ? 'audio/wav' : 'audio/mpeg';
    }
  }
  if (!audioB64) {
    await markChannelFail(up.channel?.id, '上游未返回音频数据');
    throw ApiError.from('UPSTREAM', '语音合成失败：上游未返回音频数据');
  }

  await markChannelOk(up.channel?.id);
  return { audioB64, mime, usage, endpoint, channel: up.channel, providerId: up.providerId };
}

/* ============================== model discovery ============================== */

/**
 * Fetch the upstream model list.
 * OpenAI-compatible: GET {root}/models ; Anthropic: GET {root}/models with
 * x-api-key. Returns {models, fallback} — fallback=true carries the built-in
 * list so the UI always has something to show.
 */
export async function fetchModels({ providerId = 'mimo', apiKey, baseUrl, timeoutMs = 15000 } = {}) {
  const prov = PROVIDER_DOCS[providerId] || {};
  let key = apiKey;
  let root = normalizeRoot(baseUrl || prov.chat || '');
  let channel = null;

  if (!key) {
    try {
      channel = await pickChannel(providerId);
      key = await channelKey(channel);
      if (!baseUrl && channel?.base_url) root = normalizeRoot(channel.base_url);
    } catch { /* no official channel for this provider */ }
  }
  if (!key || !root) {
    return { models: FALLBACK_MODELS, fallback: true, reason: '未提供 API Key 或接口地址，已返回内置模型列表' };
  }

  const anthropic = providerId === 'anthropic';
  const resp = await fetchJson(
    `${root}/models`,
    { headers: anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${key}` } },
    timeoutMs
  );
  if (!resp.ok) {
    await markChannelFail(channel?.id, `models HTTP ${resp.status}`);
    return {
      models: FALLBACK_MODELS,
      fallback: true,
      reason: `HTTP ${resp.status}：${String(resp.text || '').slice(0, 160)}`,
      latencyMs: resp.ms
    };
  }
  const payload = resp.json || {};
  const rows = Array.isArray(payload.data) ? payload.data
    : Array.isArray(payload.models) ? payload.models
    : Array.isArray(payload) ? payload : [];

  const models = rows.map((m) => {
    const id = m.id || m.name || String(m);
    const category = /asr|whisper|transcri/i.test(id) ? 'asr'
      : /tts|speech|voice/i.test(id) ? 'tts'
      : /reason|think|r1/i.test(id) ? 'reasoning'
      : 'text';
    return { id, label: m.display_name || m.id || id, category, ownedBy: m.owned_by || null };
  }).filter((m) => m.id);

  await markChannelOk(channel?.id);
  return {
    models: models.length ? models : FALLBACK_MODELS,
    fallback: !models.length,
    count: models.length,
    latencyMs: resp.ms,
    source: 'upstream'
  };
}

/**
 * Connectivity + latency probe.
 * Prefers GET /models (cheap, no token spend), falls back to a 1-token chat.
 */
export async function testConnection({ providerId = 'mimo', apiKey, baseUrl, timeoutMs = 15000 } = {}) {
  const prov = PROVIDER_DOCS[providerId] || {};
  let key = apiKey;
  let root = normalizeRoot(baseUrl || prov.chat || '');
  let channel = null;
  if (!key) {
    try {
      channel = await pickChannel(providerId);
      key = await channelKey(channel);
      if (!baseUrl && channel?.base_url) root = normalizeRoot(channel.base_url);
    } catch { /* ignore */ }
  }
  if (!key || !root) return { ok: false, msg: '缺少 API Key 或接口地址' };

  const anthropic = providerId === 'anthropic';
  const headers = anthropic
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${key}` };

  const modelsProbe = await fetchJson(`${root}/models`, { headers }, timeoutMs);
  if (modelsProbe.ok) {
    const payload = modelsProbe.json || {};
    const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    await markChannelOk(channel?.id);
    return { ok: true, latencyMs: modelsProbe.ms, modelCount: list.length, via: 'models' };
  }

  // /models is not universally exposed — fall back to a minimal chat.
  const started = Date.now();
  const probe = await chat({
    model: 'mimo-v2.6-flash',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    mode: apiKey ? 'custom' : 'official',
    providerId,
    userKey: apiKey || '',
    userBaseUrl: baseUrl || '',
    maxAttempts: 1,
    timeoutMs
  }).catch((e) => ({ error: e }));
  if (probe && !probe.error) {
    return { ok: true, latencyMs: Date.now() - started, via: 'chat', model: probe.model };
  }
  await markChannelFail(channel?.id, modelsProbe.status ? `models ${modelsProbe.status}` : 'probe failed');
  return {
    ok: false,
    latencyMs: Date.now() - started,
    msg: `连通性检测失败：HTTP ${modelsProbe.status}${modelsProbe.text ? ' ' + String(modelsProbe.text).slice(0, 120) : ''}`,
    via: 'models'
  };
}

/* ============================== sync models ============================== */

/**
 * Pull the upstream catalogue into ai_models (insert missing, report extra).
 * New rows are insert-only: prices default to 0 so an admin must price them.
 */
export async function syncModels({ providerId = 'mimo', channelId = null } = {}) {
  let ch = null;
  if (channelId) {
    ch = await one('SELECT * FROM ai_channels WHERE id=?', [channelId]);
  } else {
    ch = await one(
      "SELECT * FROM ai_channels WHERE provider_id=? AND status='active' ORDER BY fail_count ASC LIMIT 1",
      [providerId]
    );
  }
  if (!ch) throw ApiError.from('BAD_REQUEST', '没有可用渠道', { code: 'NO_CHANNEL' });

  const key = await channelKey(ch);
  const root = normalizeRoot(ch.base_url || (PROVIDER_DOCS[providerId] || {}).chat || '');
  const resp = await fetchJson(`${root}/models`, { headers: { Authorization: `Bearer ${key}` } }, 20000);
  if (!resp.ok) {
    await markChannelFail(ch.id, `models HTTP ${resp.status}`);
    throw ApiError.from('UPSTREAM', `拉取上游模型失败：HTTP ${resp.status} ${String(resp.text || '').slice(0, 200)}`);
  }
  const payload = resp.json || {};
  const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  const upstream = list.map((m) => m.id || m.name).filter(Boolean);

  const existing = await q('SELECT id FROM ai_models WHERE provider_id=?', [providerId]).catch(() => []);
  const existingIds = new Set((existing || []).map((r) => r.id));
  const added = [];
  for (const id of upstream) {
    if (existingIds.has(id)) continue;
    const category = /asr|whisper|transcri/i.test(id) ? 'asr'
      : /voiceclone|clone/i.test(id) ? 'voiceclone'
      : /tts|voice|speech/i.test(id) ? 'tts'
      : /pro|reason/i.test(id) ? 'omni' : 'text';
    const billing = category === 'asr' ? 'audio' : category === 'tts' ? 'free' : category === 'voiceclone' ? 'call' : 'token';
    await q(
      `INSERT INTO ai_models
        (id,provider_id,label,category,context_window,max_output,rpm,tpm,billing,
         price_cache_in,price_in,price_out,price_audio_hour,price_call,enabled,created_at)
       VALUES (?,?,?,?,1048576,131072,100,10000000,?,0,0,0,0,0,0,NOW())`,
      [id, providerId, id, category, billing]
    ).catch(() => {});
    added.push(id);
  }
  await markChannelOk(ch.id);
  const removed = [...existingIds].filter((id) => !upstream.includes(id));
  return { upstream, added, removed, total: upstream.length, channelId: num(ch.id) };
}

export default {
  PROVIDER_DOCS,
  FALLBACK_MODELS,
  PRESET_VOICES,
  normalizeRoot,
  isAnthropic,
  readUsage,
  pickChannel,
  channelKey,
  markChannelOk,
  markChannelFail,
  resolveUpstream,
  toAnthropicBody,
  fromAnthropicResponse,
  parseAnthropicEvent,
  parseOpenAIEvent,
  chat,
  chatStream,
  audioSecondsOf,
  audioFormatOf,
  transcribe,
  synthesize,
  fetchModels,
  testConnection,
  syncModels
};
