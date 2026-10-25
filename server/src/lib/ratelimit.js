/**
 * ratelimit.js — per-user sliding-window RPM/TPM limiter.
 *
 * The window is process-local (a single Node process serves port 3300) and is
 * backed by an LRU-ish sweep so memory stays bounded. Counters are advisory:
 * the authoritative per-user limits live on users.rpm_limit / users.tpm_limit
 * and fall back to sys_settings, then to the contract defaults (60 rpm /
 * 200000 tpm).
 *
 * Errors surface as ApiError(429, 'RATE_LIMITED'), which the route layer turns
 * into {status:false,code:'RATE_LIMITED'}.
 */
import { num, int, ApiError, sysGet, sysSet, tableExists, q } from './aiShared.js';

const WINDOW_MS = 60_000;
const MAX_ENTRIES = 20_000;

const hits = new Map(); // userId -> { r: number[] (ms), t: Array<{ms:number, tk:number}> }

export const DEFAULT_RPM = 60;
export const DEFAULT_TPM = 200_000;

let cfgCache = { at: 0, rpm: DEFAULT_RPM, tpm: DEFAULT_TPM };
const CFG_TTL = 60_000;

/** Global defaults from sys_settings (cached 60s). */
export async function defaultLimits() {
  if (Date.now() - cfgCache.at < CFG_TTL) return cfgCache;
  const [rpm, tpm] = await Promise.all([
    sysGet('default_rpm_limit', null),
    sysGet('default_tpm_limit', null)
  ]);
  cfgCache = {
    at: Date.now(),
    rpm: int(rpm, DEFAULT_RPM) > 0 ? int(rpm, DEFAULT_RPM) : DEFAULT_RPM,
    tpm: int(tpm, DEFAULT_TPM) > 0 ? int(tpm, DEFAULT_TPM) : DEFAULT_TPM
  };
  return cfgCache;
}

export function invalidateLimits() {
  cfgCache = { at: 0, rpm: DEFAULT_RPM, tpm: DEFAULT_TPM };
}

/** Per-model rpm override from ai_models (cached 60s per id). */
const modelLimits = new Map();
export async function modelLimit(modelId) {
  if (!modelId) return { rpm: 0, tpm: 0 };
  const c = modelLimits.get(modelId);
  if (c && Date.now() - c.at < CFG_TTL) return c.v;
  let v = { rpm: 0, tpm: 0 };
  try {
    const rows = await q('SELECT rpm, tpm FROM ai_models WHERE id = ? LIMIT 1', [modelId]);
    if (rows && rows[0]) v = { rpm: int(rows[0].rpm, 0), tpm: int(rows[0].tpm, 0) };
  } catch {
    /* table not ready */
  }
  modelLimits.set(modelId, { at: Date.now(), v });
  return v;
}

function bucket(userId) {
  let b = hits.get(userId);
  if (!b) {
    b = { r: [], t: [] };
    hits.set(userId, b);
    if (hits.size > MAX_ENTRIES) sweep();
  }
  return b;
}

function prune(b, now) {
  const cut = now - WINDOW_MS;
  if (b.r.length && b.r[0] < cut) b.r = b.r.filter((x) => x >= cut);
  if (b.t.length && b.t[0].ms < cut) b.t = b.t.filter((x) => x.ms >= cut);
}

function sweep() {
  const now = Date.now();
  for (const [uid, b] of hits) {
    prune(b, now);
    if (!b.r.length && !b.t.length) hits.delete(uid);
  }
}

let sweepTimer = null;
export function startSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, 120_000);
  if (sweepTimer.unref) sweepTimer.unref();
}

/** Effective limits for a user, honouring per-user overrides. */
export async function limitsFor(user, { model, rpm, tpm } = {}) {
  const g = await defaultLimits();
  const m = model ? await modelLimit(model) : { rpm: 0, tpm: 0 };
  const pick = (a, b, c, d) => {
    for (const v of [a, b, c, d]) if (int(v, 0) > 0) return int(v, 0);
    return d;
  };
  return {
    rpm: pick(rpm, user && user.rpm_limit, m.rpm, g.rpm),
    tpm: pick(tpm, user && user.tpm_limit, m.tpm, g.tpm)
  };
}

export function snapshot(userId) {
  const b = hits.get(userId);
  if (!b) return { rpmUsed: 0, tpmUsed: 0 };
  prune(b, Date.now());
  return { rpmUsed: b.r.length, tpmUsed: b.t.reduce((s, x) => s + num(x.tk), 0) };
}

/**
 * Reserve one request against the sliding window.
 * Throws ApiError 429 when either dimension is exceeded.
 */
export async function check(req, { estimatedTokens = 0, model = null, limits = null } = {}) {
  const user = req._neomUser || req.user || {};
  const uid = user.id ?? 'anon';
  const lim = limits || (await limitsFor(user, { model }));
  const now = Date.now();
  const b = bucket(uid);
  prune(b, now);

  if (lim.rpm > 0 && b.r.length >= lim.rpm) {
    const oldest = b.r[0] || now;
    const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    throw new ApiError(
      'RATE_LIMITED',
      `触发限流：每分钟最多 ${lim.rpm} 次请求，请 ${retryAfter} 秒后重试`,
      429,
      { retryAfter, limit: 'rpm', rpm: lim.rpm }
    );
  }
  const usedTpm = b.t.reduce((s, x) => s + num(x.tk), 0);
  if (lim.tpm > 0 && estimatedTokens > 0 && usedTpm + estimatedTokens > lim.tpm) {
    throw new ApiError(
      'RATE_LIMITED',
      `触发限流：每分钟最多 ${lim.tpm} Token，请稍后重试`,
      429,
      { retryAfter: 60, limit: 'tpm', tpm: lim.tpm, used: usedTpm }
    );
  }

  b.r.push(now);
  if (estimatedTokens > 0) b.t.push({ ms: now, tk: estimatedTokens });
  else b.r.length && b.t.push({ ms: now, tk: 0 });

  return { ...lim, rpmUsed: b.r.length, tpmUsed: usedTpm + estimatedTokens };
}

/** Release the request slot when the upstream call fails before billing. */
export function release(req) {
  const user = req._neomUser || req.user || {};
  const b = hits.get(user.id ?? 'anon');
  if (!b) return;
  b.r.pop();
  const last = b.t[b.t.length - 1];
  if (last && last.tk === 0) b.t.pop();
}

/** Account real tokens after the upstream response (for TPM accuracy). */
export function recordTokens(req, tokens) {
  const user = req._neomUser || req.user || {};
  const b = bucket(user.id ?? 'anon');
  const now = Date.now();
  prune(b, now);
  if (num(tokens) > 0) b.t.push({ ms: now, tk: num(tokens) });
}

/** Rough token estimate used for pre-flight TPM checks (CJK aware). */
export function estimateTokens(messages = [], maxOut = 0) {
  let chars = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    const c = m && m.content;
    if (typeof c === 'string') chars += c.length;
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (!part) continue;
        if (typeof part.text === 'string') chars += part.text.length;
        else if (typeof part.content === 'string') chars += part.content.length;
      }
    }
  }
  // CJK ≈ 1.5 chars/token, latin ≈ 4 chars/token — use a conservative 2.2
  const prompt = Math.ceil(chars / 2.2) + 8;
  return prompt + Math.max(0, int(maxOut, 0));
}

/**
 * Limiter configuration for the admin security page.
 *
 * Config lives in sys_settings (default_rpm_limit / default_tpm_limit plus the
 * per-scope overrides `rl:<scope>`), because the rate_limits TABLE in
 * 001_schema.sql is a hit counter (scope, key, hits, window_at, blocked) used
 * for persisted abuse tracking, not a config store. Both are exposed here.
 */
export async function getRateLimitConfig() {
  const g = await defaultLimits();
  const scopes = ['share:comment', 'auth:login', 'auth:register', 'ai:chat', 'files:write'];
  const out = { rpm: g.rpm, tpm: g.tpm, scopes: {} };
  for (const s of scopes) {
    const v = await sysGet(`rl:${s}`, null);
    const n = int(v, 0);
    out.scopes[s] = n > 0 ? n : null;
  }
  return out;
}

/** Persist limiter config into sys_settings; invalidates the cache. */
export async function saveRateLimit({ scope = 'global', key = null, rpm, tpm, burst, enabled = 1 }) {
  if (scope === 'global') {
    if (rpm !== undefined && rpm !== null) await sysSet('default_rpm_limit', int(rpm, DEFAULT_RPM));
    if (tpm !== undefined && tpm !== null) await sysSet('default_tpm_limit', int(tpm, DEFAULT_TPM));
  } else {
    const scopeKey = `rl:${key || scope}`;
    if (rpm === null || rpm === undefined || int(rpm, 0) <= 0) await sysSet(scopeKey, '');
    else await sysSet(scopeKey, int(rpm, 0));
  }
  invalidateLimits();
  return getRateLimitConfig();
}

/** Recent persisted hit counters (rate_limits table), newest first. */
export async function listRateLimitHits({ scope = null, limit = 100 } = {}) {
  if (!(await tableExists('rate_limits'))) return [];
  try {
    const where = scope ? 'WHERE scope = ?' : '';
    const params = scope ? [scope] : [];
    const rows = await q(
      `SELECT id, scope, \`key\`, hits, window_at, blocked, updated_at
         FROM rate_limits ${where} ORDER BY updated_at DESC LIMIT ?`,
      [...params, int(limit, 100)]
    );
    return rows || [];
  } catch {
    return [];
  }
}

/** Bump a persisted hit counter (call from public endpoints under abuse). */
export async function bumpRateHit(scope, key, { blocked = false } = {}) {
  if (!(await tableExists('rate_limits'))) return 0;
  const win = new Date();
  win.setSeconds(0, 0);
  try {
    await q(
      `INSERT INTO rate_limits (scope, \`key\`, hits, window_at, blocked)
       VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE hits = hits + 1, blocked = GREATEST(blocked, VALUES(blocked))`,
      [scope, String(key).slice(0, 190), win, blocked ? 1 : 0]
    );
    const r = await q('SELECT hits FROM rate_limits WHERE scope = ? AND `key` = ? AND window_at = ? LIMIT 1', [
      scope,
      String(key).slice(0, 190),
      win
    ]);
    return r && r[0] ? num(r[0].hits) : 0;
  } catch {
    return 0;
  }
}

export const _internal = { hits, sweep };
