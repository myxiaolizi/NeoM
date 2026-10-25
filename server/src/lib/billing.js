/**
 * billing.js — points / pricing / ledger core.
 *
 * Everything that touches money lives here so the AI proxy, the billing routes
 * and the admin console cannot drift apart:
 *
 *   ¥ (CNY) price → points  :  points = ceil(cny * point_per_cny * 100) / 100
 *   token  billing :  cached/1e6*price_cache_in + (prompt-cached)/1e6*price_in
 *                     + completion/1e6*price_out
 *   audio  billing :  audio_seconds/3600 * price_audio_hour
 *   call   billing :  price_call
 *   free           :  0            (also when free_until is in the future)
 *
 * A charge is one transaction: row-locked balance update + point_ledger row +
 * ai_usage_logs row. Streaming settles after the stream drains (the SSE handler
 * calls settleUsage once, at the end).
 */
import {
  q, q1, one, val, num, int, round2, withTx, ApiError, ERR,
  sysGet, sysSet, parseJsonMaybe, rid, iso
} from './aiShared.js';

export const DEFAULT_POINT_PER_CNY = 100;
export const MIN_POINTS_CHARGE = 0.01;

export const LEDGER_KIND = {
  AI: 'ai',
  RECHARGE: 'recharge',
  REFUND: 'refund',
  ADMIN: 'admin-adjust',
  SIGNIN: 'signin',
  REGISTER_GIFT: 'register-gift',
  REDEEM: 'redeem',
  INVITE: 'invite-gift'
};

/* ============================== config ============================== */

export async function getPointPerCny() {
  const v = num(await sysGet('point_per_cny', DEFAULT_POINT_PER_CNY), DEFAULT_POINT_PER_CNY);
  return v > 0 ? v : DEFAULT_POINT_PER_CNY;
}

export async function getSigninPoints() {
  const v = num(await sysGet('signin_points', 100), 100);
  return v > 0 ? v : 0;
}

export async function billingConfig() {
  const [ppc, signin, gift, payEnabled] = await Promise.all([
    getPointPerCny(),
    getSigninPoints(),
    sysGet('register_gift_points', 100),
    sysGet('pay_enabled', 0)
  ]);
  return {
    point_per_cny: ppc,
    signin_points: num(signin),
    register_gift_points: num(gift),
    pay_enabled: !!num(payEnabled),
    min_charge: MIN_POINTS_CHARGE
  };
}

/* ============================== pricing ============================== */

const DEFAULT_MODELS_FALLBACK = [];

export async function getModel(id) {
  if (!id) return null;
  const row = await one('SELECT * FROM ai_models WHERE id = ? LIMIT 1', [String(id)]);
  return row || null;
}

export async function getModelOrThrow(id) {
  const m = await getModel(id);
  if (!m) throw ApiError.from('BAD_REQUEST', `模型不存在：${id}`, { model: id });
  if (num(m.enabled, 1) === 0) throw ApiError.from('BAD_REQUEST', `模型已下架：${id}`, { model: id });
  return m;
}

export async function listModels({ enabledOnly = true, providerId = null } = {}) {
  const where = [];
  const params = [];
  if (enabledOnly) where.push('enabled = 1');
  if (providerId) {
    where.push('provider_id = ?');
    params.push(providerId);
  }
  const sql = `SELECT * FROM ai_models ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort ASC, id ASC`;
  const rows = await q(sql, params);
  return (rows || []).map(shapeModel);
}

export function shapeModel(r) {
  return {
    id: String(r.id),
    provider_id: r.provider_id || '',
    label: r.label || r.id,
    category: r.category || 'text',
    context_window: int(r.context_window, 0),
    max_output: int(r.max_output, 0),
    rpm: int(r.rpm, 0),
    tpm: int(r.tpm, 0),
    billing: r.billing || 'token',
    price_cache_in: num(r.price_cache_in, 0),
    price_in: num(r.price_in, 0),
    price_out: num(r.price_out, 0),
    price_audio_hour: num(r.price_audio_hour, 0),
    price_call: num(r.price_call, 0),
    free_until: iso(r.free_until),
    recommended_for: r.recommended_for || '',
    tag: r.tag || '',
    enabled: !!num(r.enabled, 1)
  };
}

const isFreeNow = (model) => {
  if (!model) return true;
  if (String(model.billing) === 'free') return true;
  const fu = model.free_until;
  if (!fu) return false;
  const t = new Date(fu).getTime();
  return Number.isFinite(t) && t > Date.now();
};

/**
 * Validate that a model's billing mode and its price columns agree.
 *
 * A `billing='free'` row that still carries a price is contradictory: it would
 * silently bill 0 forever (this actually happened once when an admin pricing
 * batch set billing=free on the ASR model, whose price_audio_hour was 0.5).
 * Returns an error string, or null when consistent.
 */
export function validateBillingConfig(model) {
  if (!model) return '模型不存在';
  const billing = String(model.billing || 'token');
  const prices = {
    token: ['price_cache_in', 'price_in', 'price_out'],
    audio: ['price_audio_hour'],
    call: ['price_call'],
    free: ['price_cache_in', 'price_in', 'price_out', 'price_audio_hour', 'price_call']
  }[billing];
  if (!prices) return `未知计费模式：${billing}`;
  if (billing === 'free') {
    const nonzero = prices.filter((c) => num(model[c], 0) > 0);
    if (nonzero.length) {
      return `计费模式为 free 但 ${nonzero.join('/')} 不为 0，将被永久按 0 计费；请改为对应计费模式或清零价格`;
    }
    return null;
  }
  // A priced mode with every price at 0 is almost certainly a mistake.
  const total = prices.reduce((s, c) => s + num(model[c], 0), 0);
  if (total <= 0) return `计费模式为 ${billing} 但价格全为 0，调用将不会产生费用`;
  return null;
}

/**
 * Cost in CNY for one call. `usage` accepts the union of upstream field names:
 * {prompt_tokens|input_tokens, cached_tokens|prompt_cache_hit_tokens|
 *  prompt_tokens_details.cached_tokens|cache_read_input_tokens,
 *  completion_tokens|output_tokens, audio_seconds, calls}
 */
export function calcCny(model, usage = {}) {
  if (!model) return 0;
  if (isFreeNow(model)) return 0;
  const billing = String(model.billing || 'token');
  if (billing === 'free') return 0;

  if (billing === 'call') {
    const calls = int(usage.calls, 1) || 1;
    return num(model.price_call, 0) * calls;
  }
  if (billing === 'audio') {
    const secs = num(usage.audio_seconds, 0);
    if (secs <= 0) return 0;
    return (secs / 3600) * num(model.price_audio_hour, 0);
  }

  const prompt = Math.max(0, num(usage.prompt_tokens, 0));
  const cachedRaw = num(
    usage.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens ?? 0,
    0
  );
  const cached = Math.min(Math.max(0, cachedRaw), prompt);
  const completion = Math.max(0, num(usage.completion_tokens, 0));
  const fresh = Math.max(0, prompt - cached);

  const cny =
    (cached / 1e6) * num(model.price_cache_in, 0) +
    (fresh / 1e6) * num(model.price_in, 0) +
    (completion / 1e6) * num(model.price_out, 0);
  return cny;
}

/** CNY → points, 2 decimals, minimum 0.01 for any non-free call. */
export function cnyToPoints(cny, pointPerCny = DEFAULT_POINT_PER_CNY) {
  const c = num(cny, 0);
  if (c <= 0) return 0;
  const ppc = num(pointPerCny, DEFAULT_POINT_PER_CNY) || DEFAULT_POINT_PER_CNY;
  const raw = Math.ceil(c * ppc * 100 - 1e-9) / 100;
  return Math.max(MIN_POINTS_CHARGE, round2(raw));
}

/** Full quote: {cny, points, free, billing}. */
export async function quote(model, usage) {
  const ppc = await getPointPerCny();
  const free = isFreeNow(model);
  const cny = free ? 0 : calcCny(model, usage);
  return {
    cny: round2(cny * 1e6) / 1e6,
    points: free ? 0 : cnyToPoints(cny, ppc),
    free,
    billing: (model && model.billing) || 'token'
  };
}

/* ============================== balance ============================== */

export async function getUserPoints(userId) {
  const p = await val('SELECT points FROM users WHERE id = ? LIMIT 1', [userId], 0);
  return num(p);
}

/** Pre-flight affordability check (no lock). Throws 402 INSUFFICIENT_POINTS. */
export async function assertCanAfford(user, model) {
  if (!user || user.id === null || user.id === undefined) return { points: 0, need: 0 };
  const points = await getUserPoints(user.id);
  if (isFreeNow(model)) return { points, need: 0 };

  let need = MIN_POINTS_CHARGE;
  const billing = String((model && model.billing) || 'token');
  if (billing === 'call') need = Math.max(MIN_POINTS_CHARGE, num(model.price_call, 0));
  else if (billing === 'audio') {
    // one minute of audio as the floor
    need = Math.max(MIN_POINTS_CHARGE, round2(((await getPointPerCny()) * num(model.price_audio_hour, 0)) / 60));
  }
  if (points + 1e-9 < need) {
    throw new ApiError(
      'INSUFFICIENT_POINTS',
      `积分不足：本次预估需要 ${need} 积分，当前余额 ${round2(points)} 积分`,
      402,
      { points: round2(points), need }
    );
  }
  return { points, need };
}

/* ============================== ledger ============================== */

export async function ledgerList(userId, { page = 1, size = 20, kind = null } = {}) {
  const offset = (Math.max(1, page) - 1) * size;
  const where = ['user_id = ?'];
  const params = [userId];
  if (kind) {
    where.push('kind = ?');
    params.push(kind);
  }
  const rows = await q(
    `SELECT id, kind, points, balance_after, model, prompt_tokens, cached_tokens,
            completion_tokens, audio_seconds, note, ref_id, created_at
       FROM point_ledger WHERE ${where.join(' AND ')}
      ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, int(size, 20), offset]
  );
  const total = await val(`SELECT COUNT(*) FROM point_ledger WHERE ${where.join(' AND ')}`, params, 0);
  return {
    items: (rows || []).map((r) => ({
      id: num(r.id),
      kind: r.kind,
      points: round2(r.points),
      balance_after: round2(r.balance_after),
      model: r.model || undefined,
      prompt_tokens: r.prompt_tokens === null ? undefined : num(r.prompt_tokens),
      cached_tokens: r.cached_tokens === null ? undefined : num(r.cached_tokens),
      completion_tokens: r.completion_tokens === null ? undefined : num(r.completion_tokens),
      audio_seconds: r.audio_seconds === null ? undefined : num(r.audio_seconds),
      note: r.note || undefined,
      ref_id: r.ref_id || undefined,
      created_at: iso(r.created_at)
    })),
    total: num(total),
    page,
    pageSize: size
  };
}

/** Internal: append a ledger row inside an existing transaction. */
async function writeLedger(tx, {
  userId, kind, points, balanceAfter, model = null, promptTokens = null,
  cachedTokens = null, completionTokens = null, audioSeconds = null, note = null, refId = null
}) {
  // point_ledger.token/audio columns are NOT NULL DEFAULT 0 (001_schema.sql), so
  // absent values must be coerced to 0 rather than sent as NULL.
  await tx.q(
    `INSERT INTO point_ledger
      (user_id, kind, points, balance_after, model, prompt_tokens, cached_tokens,
       completion_tokens, audio_seconds, note, ref_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
    [
      userId, kind, round2(points), round2(balanceAfter), model || null,
      int(promptTokens, 0),
      int(cachedTokens, 0),
      int(completionTokens, 0),
      round2(audioSeconds || 0),
      note ? String(note).slice(0, 500) : null,
      refId ? String(refId).slice(0, 64) : null
    ]
  );
}

/**
 * Adjust a user's balance by `delta` (negative = spend) inside a transaction.
 * Returns {balanceAfter, ledgerId}.
 */
export async function adjustPoints({
  userId, delta, kind, note = null, refId = null, model = null,
  promptTokens = null, cachedTokens = null, completionTokens = null,
  audioSeconds = null, allowNegative = false, ledger = true
}) {
  const d = round2(delta);
  return withTx(async (tx) => {
    const row = await tx.q1('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!row) throw ApiError.from('NOT_FOUND', '用户不存在');
    const before = num(row.points);
    const after = round2(before + d);
    if (after < 0 && !allowNegative) {
      throw new ApiError('INSUFFICIENT_POINTS', '积分不足', 402, { points: before, need: Math.abs(d) });
    }
    await tx.q('UPDATE users SET points = ? WHERE id = ?', [after, userId]);
    if (ledger && d !== 0) {
      await writeLedger(tx, {
        userId, kind, points: d, balanceAfter: after, model,
        promptTokens, cachedTokens, completionTokens, audioSeconds, note, refId
      });
    }
    return { before, after, delta: d };
  });
}

/* ============================== AI settlement ============================== */

/**
 * Settle one AI call: deduct points (official mode), write point_ledger and
 * ai_usage_logs atomically. Safe to call with mode='custom' (logs only).
 *
 * usage: {prompt_tokens, cached_tokens, completion_tokens, audio_seconds, calls}
 */
export async function settleUsage({
  userId, model, usage = {}, scene = 'chat', mode = 'official',
  channelId = null, providerId = null, latencyMs = 0, status = 'ok', error = null,
  ip = null, refId = null, note = null, requestId = null
}) {
  // `model` may arrive as a full ai_models row (preferred) or just its id —
  // callers in routes/ai.js pass the resolved id. Always price against a row,
  // otherwise every charge silently rounds to 0.
  let modelRow = model && typeof model === 'object' ? model : null;
  const modelId = String((modelRow && modelRow.id) || (typeof model === 'string' ? model : '') || usage.model || '').slice(0, 64);
  if (!modelRow && modelId) modelRow = await getModel(modelId).catch(() => null);

  const promptTokens = Math.max(0, int(usage.prompt_tokens ?? usage.input_tokens, 0));
  const cachedTokens = Math.min(
    promptTokens,
    Math.max(0, int(usage.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens, 0))
  );
  const completionTokens = Math.max(0, int(usage.completion_tokens ?? usage.output_tokens, 0));
  const audioSeconds = Math.max(0, num(usage.audio_seconds, 0));

  const official = mode === 'official';
  const ppc = official ? await getPointPerCny() : 0;
  const free = official ? isFreeNow(modelRow) : true;
  const cny = free ? 0 : calcCny(modelRow, { ...usage, prompt_tokens: promptTokens, cached_tokens: cachedTokens, completion_tokens: completionTokens, audio_seconds: audioSeconds });
  let points = free ? 0 : cnyToPoints(cny, ppc);

  // failed calls are never billed
  if (status !== 'ok') {
    points = 0;
    // still log tokens (0) for observability
    await logUsage({
      userId, modelId, providerId, channelId, scene, mode,
      promptTokens: 0, cachedTokens: 0, completionTokens: 0, audioSeconds,
      pointsCost: 0, cnyCost: 0, latencyMs, status, error, ip, requestId
    });
    return { points: 0, cny: 0, balance_after: await getUserPoints(userId), billed: false };
  }

  if (!official) {
    await logUsage({
      userId, modelId, providerId, channelId, scene, mode,
      promptTokens, cachedTokens, completionTokens, audioSeconds,
      pointsCost: 0, cnyCost: 0, latencyMs, status, error, ip, requestId
    });
    return { points: 0, cny: 0, balance_after: await getUserPoints(userId), billed: false };
  }

  const out = await withTx(async (tx) => {
    const row = await tx.q1('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!row) throw ApiError.from('NOT_FOUND', '用户不存在');
    const before = num(row.points);
    let charged = round2(points);
    if (charged > 0 && before + 1e-9 < charged) {
      throw new ApiError('INSUFFICIENT_POINTS', '积分不足，本次调用未结算', 402, {
        points: round2(before), need: charged
      });
    }
    const after = round2(before - charged);
    if (charged > 0) await tx.q('UPDATE users SET points = ? WHERE id = ?', [after, userId]);
    if (charged > 0 || free) {
      await writeLedger(tx, {
        userId, kind: LEDGER_KIND.AI, points: -charged, balanceAfter: after, model: modelId,
        promptTokens, cachedTokens, completionTokens, audioSeconds, note, refId
      });
    }
    await tx.q(
      `INSERT INTO ai_usage_logs
        (user_id, channel_id, provider_id, model, scene, mode, prompt_tokens, cached_tokens,
         completion_tokens, audio_seconds, points_cost, cny_cost, latency_ms, status, error, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        userId, channelId, providerId, modelId, scene, mode,
        promptTokens, cachedTokens, completionTokens, round2(audioSeconds),
        charged, Number(cny.toFixed(8)), int(latencyMs, 0),
        String(status).slice(0, 16), error ? String(error).slice(0, 500) : null, ip
      ]
    );
    return { before, after, charged };
  });

  return {
    points: out.charged,
    cny: Number(cny.toFixed(8)),
    balance_after: out.after,
    billed: out.charged > 0,
    free
  };
}

async function logUsage({
  userId, modelId, providerId, channelId, scene, mode, promptTokens,
  cachedTokens, completionTokens, audioSeconds, pointsCost, cnyCost,
  latencyMs, status, error, ip, requestId
}) {
  try {
    await q(
      `INSERT INTO ai_usage_logs
        (user_id, channel_id, provider_id, model, scene, mode, prompt_tokens, cached_tokens,
         completion_tokens, audio_seconds, points_cost, cny_cost, latency_ms, status, error, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        userId, channelId, providerId, modelId, scene, mode,
        int(promptTokens, 0), int(cachedTokens, 0), int(completionTokens, 0),
        round2(audioSeconds), round2(pointsCost), cnyCost, int(latencyMs, 0),
        String(status).slice(0, 16), error ? String(error).slice(0, 500) : null, ip
      ]
    );
  } catch {
    /* usage logging must not break the request */
  }
}

/* ============================== recharge packages ==============================
 * Authoritative source is the recharge_packages table (seeded by 002_seed).
 * sys_settings.recharge_packages is honoured as an operator override so the
 * admin console can rewrite the catalogue without a migration.
 */
export const DEFAULT_PACKAGES = [
  { id: 'pkg-1000', name: '入门包', price: 10, points: 1000, bonus: 0 },
  { id: 'pkg-5200', name: '进阶包', price: 50, points: 5000, bonus: 200 },
  { id: 'pkg-11000', name: '专业包', price: 100, points: 10000, bonus: 1000 },
  { id: 'pkg-60000', name: '创作包', price: 500, points: 50000, bonus: 10000 }
];

export function shapePackage(r, i = 0) {
  return {
    id: String(r.id || `pkg-${i + 1}`),
    name: String(r.name || `套餐${i + 1}`),
    price: num(r.price, 0),
    points: num(r.points, 0),
    bonus: num(r.bonus, 0),
    tag: r.tag || '',
    enabled: r.enabled === undefined ? true : !!num(r.enabled, 1),
    sort: int(r.sort, i)
  };
}

/** All packages (including disabled) — used by the admin console. */
export async function getPackagesAll() {
  const override = parseJsonMaybe(await sysGet('recharge_packages', null), null);
  if (Array.isArray(override) && override.length) {
    return override.map(shapePackage).sort((a, b) => a.sort - b.sort);
  }
  try {
    const rows = await q('SELECT id, name, price, points, bonus, tag, enabled, sort FROM recharge_packages ORDER BY sort ASC, price ASC');
    if (rows && rows.length) return rows.map(shapePackage);
  } catch {
    /* table not ready — fall through */
  }
  return DEFAULT_PACKAGES.map((p, i) => ({ ...p, tag: '', enabled: true, sort: i }));
}

/** Purchasable packages only (user-facing). */
export async function getPackages() {
  const all = await getPackagesAll();
  return all.filter((p) => p.enabled);
}

/** Replace the catalogue (admin). Writes sys_settings override + optional table sync. */
export async function setPackages(list) {
  const clean = (Array.isArray(list) ? list : []).map(shapePackage);
  await sysSet('recharge_packages', JSON.stringify(clean));
  return clean;
}

/* ============================== orders ============================== */

export async function createOrder({ userId, packageId, channel = 'mock' }) {
  const pkgs = await getPackages();
  const pkg = pkgs.find((p) => p.id === packageId);
  if (!pkg) throw ApiError.from('BAD_REQUEST', '套餐不存在');
  const points = num(pkg.points) + num(pkg.bonus);
  const orderId = `NM${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  const payEnabled = !!num(await sysGet('pay_enabled', 0));
  const mock = !payEnabled || channel === 'mock';
  const payUrl = mock ? null : buildPayUrl(orderId, num(pkg.price), channel);

  await q(
    `INSERT INTO recharge_orders
      (id, user_id, package_id, amount, points, bonus, channel, pay_url, status, created_at)
     VALUES (?,?,?,?,?,?,?,?, 'pending', NOW())`,
    [orderId, userId, pkg.id, num(pkg.price), num(pkg.points), num(pkg.bonus), channel, payUrl]
  );

  return { orderId, payUrl, mock, amount: num(pkg.price), points };
}

function buildPayUrl(orderId, amount, channel) {
  const base = process.env.PAY_RETURN_BASE || 'https://m.zhengl.vip';
  // No real gateway credentials are configured yet; the admin confirms manually.
  return `${base}/account/billing?order=${encodeURIComponent(orderId)}&amount=${amount}&channel=${encodeURIComponent(channel)}`;
}

/** Admin/user side: mark an order paid and credit points. Idempotent. */
export async function fulfillOrder(orderId, { tradeNo = null, actorId = null } = {}) {
  return withTx(async (tx) => {
    const order = await tx.q1('SELECT * FROM recharge_orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order) throw ApiError.from('NOT_FOUND', '订单不存在');
    if (order.status === 'paid') {
      return { already: true, orderId, points: num(order.points), balance_after: await getUserPoints(order.user_id) };
    }
    if (order.status !== 'pending') throw ApiError.from('BAD_REQUEST', `订单状态为 ${order.status}，无法确认支付`);

    const total = round2(num(order.points) + num(order.bonus));
    const row = await tx.q1('SELECT points FROM users WHERE id = ? FOR UPDATE', [order.user_id]);
    if (!row) throw ApiError.from('NOT_FOUND', '用户不存在');
    const after = round2(num(row.points) + total);
    await tx.q('UPDATE users SET points = ? WHERE id = ?', [after, order.user_id]);
    await tx.q(
      "UPDATE recharge_orders SET status = 'paid', paid_at = NOW(), trade_no = COALESCE(?, trade_no) WHERE id = ?",
      [tradeNo, orderId]
    );
    await writeLedger(tx, {
      userId: order.user_id,
      kind: LEDGER_KIND.RECHARGE,
      points: total,
      balanceAfter: after,
      note: `充值 ¥${num(order.amount)}${num(order.bonus) ? `（含赠送 ${num(order.bonus)}）` : ''}`,
      refId: orderId
    });
    return { already: false, orderId, points: total, balance_after: after };
  });
}

/** Refund: deduct the credited points again (allowing negative owed) + flag order. */
export async function refundOrder(orderId, { reason = null, actorId = null } = {}) {
  return withTx(async (tx) => {
    const order = await tx.q1('SELECT * FROM recharge_orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order) throw ApiError.from('NOT_FOUND', '订单不存在');
    if (order.status === 'refunded') {
      return { already: true, orderId, deducted: 0, balance_after: await getUserPoints(order.user_id) };
    }
    if (order.status !== 'paid') throw ApiError.from('BAD_REQUEST', '只有已支付的订单可以退款');
    const total = round2(num(order.points) + num(order.bonus));
    const row = await tx.q1('SELECT points FROM users WHERE id = ? FOR UPDATE', [order.user_id]);
    const before = num(row.points);
    const deduct = Math.min(before, total);
    const after = round2(before - deduct);
    await tx.q('UPDATE users SET points = ? WHERE id = ?', [after, order.user_id]);
    await tx.q("UPDATE recharge_orders SET status = 'refunded' WHERE id = ?", [orderId]);
    await writeLedger(tx, {
      userId: order.user_id,
      kind: LEDGER_KIND.REFUND,
      points: -deduct,
      balanceAfter: after,
      note: reason ? `订单退款：${reason}` : '订单退款',
      refId: orderId
    });
    return { already: false, orderId, deducted: deduct, balance_after: after, uncollected: round2(total - deduct) };
  });
}

export async function listOrders(userId, { page = 1, size = 20 } = {}) {
  const offset = (Math.max(1, page) - 1) * size;
  const rows = await q(
    `SELECT id, package_id, amount, points, bonus, channel, status, pay_url, paid_at, created_at
       FROM recharge_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, int(size, 20), offset]
  );
  const total = await val('SELECT COUNT(*) FROM recharge_orders WHERE user_id = ?', [userId], 0);
  return { items: (rows || []).map(shapeOrder), total: num(total), page, pageSize: size };
}

export function shapeOrder(r) {
  return {
    id: r.id,
    packageId: r.package_id,
    amount: num(r.amount),
    points: round2(r.points),
    bonus: round2(r.bonus),
    channel: r.channel,
    status: r.status,
    payUrl: r.pay_url || null,
    paidAt: iso(r.paid_at),
    createdAt: iso(r.created_at)
  };
}

/* ============================== redeem codes ============================== */

export async function redeem(userId, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) throw ApiError.from('BAD_REQUEST', '请输入卡密');
  return withTx(async (tx) => {
    const row = await tx.q1('SELECT * FROM redeem_codes WHERE code = ? FOR UPDATE', [c]);
    if (!row) throw ApiError.from('BAD_REQUEST', '卡密无效');
    if (row.status === 'used') throw ApiError.from('BAD_REQUEST', '该卡密已被使用');
    if (row.status === 'void') throw ApiError.from('BAD_REQUEST', '该卡密已作废');
    const points = round2(row.points);
    const u = await tx.q1('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!u) throw ApiError.from('NOT_FOUND', '用户不存在');
    const after = round2(num(u.points) + points);
    await tx.q('UPDATE users SET points = ? WHERE id = ?', [after, userId]);
    await tx.q(
      "UPDATE redeem_codes SET status = 'used', used_by = ?, used_at = NOW() WHERE id = ?",
      [userId, row.id]
    );
    await writeLedger(tx, {
      userId, kind: LEDGER_KIND.REDEEM, points, balanceAfter: after,
      note: `卡密兑换 ${c}`, refId: c
    });
    return { points, balance_after: after, code: c };
  });
}

/** Generate N codes (admin). */
export async function generateCodes({ count = 10, points = 100, batch = null, createdBy = null, prefix = 'NM' }) {
  const n = Math.min(Math.max(1, int(count, 10)), 5000);
  const pts = round2(points);
  const tag = batch || `B${Date.now().toString(36).toUpperCase()}`;
  const made = [];
  // collision-safe generation: retry the whole batch if a code already exists
  for (let attempt = 0; attempt < 5; attempt++) {
    made.length = 0;
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      let code;
      do {
        code = `${prefix}${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
      } while (seen.has(code));
      seen.add(code);
      made.push(code);
    }
    const placeholders = made.map(() => '(?,?,?,?,?,NOW())').join(',');
    const params = [];
    for (const code of made) params.push(code, pts, tag, createdBy, 'unused');
    try {
      await q(
        `INSERT INTO redeem_codes (code, points, batch, created_by, status, created_at) VALUES ${placeholders}`,
        params
      );
      return { batch: tag, count: made.length, points: pts, codes: made };
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY' && attempt < 4) continue;
      throw err;
    }
  }
  throw ApiError.from('INTERNAL', '卡密生成失败，请重试');
}

function randomChunk(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/* ============================== sign-in ============================== */

export async function signin(userId) {
  const reward = await getSigninPoints();
  const today = await one(
    `SELECT id, points FROM point_ledger
      WHERE user_id = ? AND kind = ? AND DATE(created_at) = CURDATE() ORDER BY id DESC LIMIT 1`,
    [userId, LEDGER_KIND.SIGNIN]
  );
  if (today) {
    const points = await getUserPoints(userId);
    return { already: true, points: 0, balance: points, note: '今天已经签到过了' };
  }
  const out = await withTx(async (tx) => {
    const u = await tx.q1('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!u) throw ApiError.from('NOT_FOUND', '用户不存在');
    const after = round2(num(u.points) + reward);
    await tx.q('UPDATE users SET points = ? WHERE id = ?', [after, userId]);
    if (reward > 0) {
      await writeLedger(tx, {
        userId, kind: LEDGER_KIND.SIGNIN, points: reward, balanceAfter: after, note: '每日签到'
      });
    }
    return { after, reward };
  });
  return { already: false, points: out.reward, balance: out.after, note: '签到成功' };
}

export async function signedInToday(userId) {
  const row = await one(
    `SELECT id FROM point_ledger WHERE user_id = ? AND kind = ? AND DATE(created_at) = CURDATE() LIMIT 1`,
    [userId, LEDGER_KIND.SIGNIN]
  );
  return !!row;
}

/* ============================== misc ============================== */

export async function balanceInfo(userId) {
  const [points, signinToday] = await Promise.all([getUserPoints(userId), signedInToday(userId)]);
  const cfg = await billingConfig();
  return {
    points: round2(points),
    cny: round2(points / cfg.point_per_cny),
    point_per_cny: cfg.point_per_cny,
    signinToday,
    signin_points: cfg.signin_points
  };
}

export const _internal = { isFreeNow, writeLedger };
