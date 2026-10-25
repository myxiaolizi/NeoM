/**
 * /api/admin — enterprise admin console API (10 modules).
 * Every route requires role=admin; all mutations are written to admin_audit.
 */
import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import {
  ok, fail, wrap, q, q1, one, val, withTx, audit, round2, clientIp,
  encryptSecret, decryptSecret, maskSecret, sysGet, sysSet, sysGetMany,
  fetchJson, startOfToday, daysAgo, num, int, pagination
} from '../lib/aiShared.js'
import { hashPassword, signToken, requireAdmin } from '../lib/auth.js'
import { verifyPassword, normalizeUser } from '../lib/aiShared.js'
import {
  getModel, shapeModel, billingConfig, getPointPerCny, getSigninPoints,
  listModels, getPackagesAll, setPackages, listOrders,
  fulfillOrder, refundOrder, generateCodes, shapeOrder, adjustPoints,
  validateBillingConfig
} from '../lib/billing.js'
import { limitsFor, getRateLimitConfig, saveRateLimit, listRateLimitHits } from '../lib/ratelimit.js'
import * as adminStats from '../lib/adminStats.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '../..')

const router = Router()
const execFileAsync = promisify(execFile)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } })
const gzipBuffer = (buf) =>
  new Promise((resolve, reject) =>
    zlib.gzip(buf, { level: 9 }, (err, out) => (err ? reject(err) : resolve(out)))
  )

/* ------------------------------------------------------------------ login */
router.post('/login', wrap(async (req, res) => {
  // Accept both shapes: {account,password} (auth contract) and
  // {username,password} (common admin-console form).
  const body = req.body || {}
  const account = body.account || body.username || body.email
  const password = body.password
  if (!account || !password) return fail(res, '请输入账号和密码', 'BAD_REQUEST')
  const row = await one('SELECT * FROM users WHERE username=? OR email=? LIMIT 1', [account, account])
  if (!row) return fail(res, '账号或密码错误', 'BAD_CREDENTIALS')
  if (row.status === 'banned') return fail(res, '该账号已被封禁', 'BANNED')
  if (row.role !== 'admin' && row.role !== 'developer') {
    return fail(res, '该账号没有管理后台权限', 'FORBIDDEN')
  }
  const good = await verifyPassword(password, row.password_hash)
  if (!good) return fail(res, '账号或密码错误', 'BAD_CREDENTIALS')
  // auth.js#signToken expects the user row (it reads .id / .username / .role).
  const token = signToken(row, null)
  await q('UPDATE users SET last_login_at=NOW() WHERE id=?', [row.id])
  await audit(req, 'admin.login', 'user', row.id, null, row.id).catch(() => {})
  ok(res, { token, user: normalizeUser(row) })
}))

/* -------------------------------------------------------------- dashboard */
/* Aggregation lives in lib/adminStats.js so the dashboard, /stats and any
 * future reporting surface share one implementation (and one cache shape). */
router.get('/dashboard', requireAdmin, wrap(async (_req, res) => {
  ok(res, await adminStats.dashboard())
}))

/* ------------------------------------------------------------------ users */
router.get('/users', requireAdmin, wrap(async (req, res) => {
  const { page = 1, keyword = '', role = '', status = '', minPoints = '', maxPoints = '' } = req.query
  const { limit, offset } = pagination(req, 20, 100)
  const where = []
  const params = []
  if (keyword) {
    where.push('(username LIKE ? OR nickname LIKE ? OR email LIKE ? OR phone LIKE ?)')
    const k = `%${keyword}%`
    params.push(k, k, k, k)
  }
  if (role) { where.push('role=?'); params.push(role) }
  if (status) { where.push('status=?'); params.push(status) }
  if (minPoints !== '') { where.push('points>=?'); params.push(num(minPoints)) }
  if (maxPoints !== '') { where.push('points<=?'); params.push(num(maxPoints)) }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = await val(`SELECT COUNT(*) FROM users ${w}`, params, 0).catch(() => 0)
  const rows = await q(
    `SELECT id,username,email,phone,nickname,avatar,role,points,status,storage_quota_mb,rpm_limit,tpm_limit,created_at,last_login_at
       FROM users ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).catch(() => [])
  ok(res, { total: int(total), page: int(page), size: limit, list: rows })
}))

router.post('/users', requireAdmin, wrap(async (req, res) => {
  const { username, password, email = null, nickname = null, role = 'user', points = 0 } = req.body || {}
  if (!username || !password) return fail(res, '用户名和密码必填', 'BAD_REQUEST')
  const exists = await one('SELECT id FROM users WHERE username=?', [username]).catch(() => null)
  if (exists) return fail(res, '用户名已存在', 'DUPLICATE')
  const hash = await hashPassword(password)
  const [r] = await q(
    `INSERT INTO users (username,password_hash,email,nickname,role,points,status,created_at)
     VALUES (?,?,?,?,?,?,'active',NOW())`,
    [username, hash, email, nickname || username, role, num(points)]
  )
  await audit(req, 'admin.user.create', 'user', r.insertId, { username, role })
  ok(res, { id: r.insertId })
}))

router.put('/users/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const { nickname, email, phone, role, status, storage_quota_mb, rpm_limit, tpm_limit } = req.body || {}
  const sets = []
  const params = []
  if (nickname !== undefined) { sets.push('nickname=?'); params.push(nickname) }
  if (email !== undefined) { sets.push('email=?'); params.push(email) }
  if (phone !== undefined) { sets.push('phone=?'); params.push(phone) }
  if (role !== undefined) { sets.push('role=?'); params.push(role) }
  if (status !== undefined) { sets.push('status=?'); params.push(status) }
  if (storage_quota_mb !== undefined) { sets.push('storage_quota_mb=?'); params.push(int(storage_quota_mb)) }
  if (rpm_limit !== undefined) { sets.push('rpm_limit=?'); params.push(int(rpm_limit)) }
  if (tpm_limit !== undefined) { sets.push('tpm_limit=?'); params.push(int(tpm_limit)) }
  if (!sets.length) return fail(res, '没有要更新的字段', 'BAD_REQUEST')
  params.push(id)
  await q(`UPDATE users SET ${sets.join(',')} WHERE id=?`, params)
  await audit(req, 'admin.user.update', 'user', id, req.body)
  ok(res, { id })
}))

router.post('/users/:id/ban', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  if (id === req.user.id) return fail(res, '不能封禁自己', 'BAD_REQUEST')
  const ban = String(req.body?.ban ?? '1') !== '0'
  const reason = ban ? String(req.body?.reason || '').slice(0, 255) || null : null
  const r = await q('UPDATE users SET status=?, ban_reason=? WHERE id=?', [ban ? 'banned' : 'active', reason, id])
  if (!r.affectedRows) return fail(res, '用户不存在', 'NOT_FOUND')
  if (ban) await q('UPDATE user_sessions SET revoked=1 WHERE user_id=?', [id]).catch(() => {})
  await audit(req, ban ? 'admin.user.ban' : 'admin.user.unban', 'user', id, { ban, reason })
  ok(res, { id, banned: ban, status: ban ? 'banned' : 'active', reason })
}))

/** Delete a user (FK cascades remove sessions/vaults/files/ledger rows). */
router.delete('/users/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  if (id === req.user.id) return fail(res, '不能删除自己', 'BAD_REQUEST')
  const row = await one('SELECT id,username,role FROM users WHERE id=?', [id])
  if (!row) return fail(res, '用户不存在', 'NOT_FOUND')
  if (row.role === 'admin') {
    const admins = int(await val("SELECT COUNT(*) FROM users WHERE role='admin'", [], 0))
    if (admins <= 1) return fail(res, '不能删除唯一的超级管理员', 'LAST_ADMIN')
  }
  // Collect object keys first: storage rows cascade but OSS objects do not.
  const files = await q('SELECT oss_key FROM files WHERE user_id=? AND oss_key IS NOT NULL', [id]).catch(() => [])
  await q('DELETE FROM users WHERE id=?', [id])
  let purged = 0
  try {
    const storage = await import('../lib/storage.js')
    for (const f of files) {
      try { await storage.deleteObject(f.oss_key); purged++ } catch { /* keep going */ }
    }
  } catch { /* storage unavailable: DB row is gone, objects remain */ }
  await audit(req, 'admin.user.delete', 'user', id, { username: row.username, objectsPurged: purged })
  ok(res, { id, deleted: true, objectsPurged: purged, objectsFound: files.length })
}))

router.post('/users/:id/reset-password', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const pwd = String(req.body?.password || '').trim() || `NeoM@${Math.random().toString(36).slice(2, 8)}`
  if (pwd.length < 6) return fail(res, '密码至少 6 位', 'BAD_REQUEST')
  await q('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(pwd), id])
  await q('UPDATE user_sessions SET revoked=1 WHERE user_id=?', [id]).catch(() => {})
  await audit(req, 'admin.user.reset-password', 'user', id)
  ok(res, { id, password: pwd })
}))

router.get('/users/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const user = await one(
    `SELECT id,username,email,phone,nickname,avatar,role,points,status,storage_quota_mb,rpm_limit,tpm_limit,created_at,last_login_at
       FROM users WHERE id=?`, [id]
  )
  if (!user) return fail(res, '用户不存在', 'NOT_FOUND')
  const [shares, aiLogs, ledger, versions, sessions, orders] = await Promise.all([
    q('SELECT id,path,doc_name,mode,views,status,created_at FROM share_links WHERE user_id=? ORDER BY id DESC LIMIT 30', [id]).catch(() => []),
    q('SELECT id,model,scene,prompt_tokens,cached_tokens,completion_tokens,points_cost,latency_ms,created_at FROM ai_usage_logs WHERE user_id=? ORDER BY id DESC LIMIT 30', [id]).catch(() => []),
    q('SELECT id,kind,points,balance_after,note,created_at FROM point_ledger WHERE user_id=? ORDER BY id DESC LIMIT 30', [id]).catch(() => []),
    q('SELECT id,path,version,size,reason,created_at FROM file_versions WHERE user_id=? ORDER BY id DESC LIMIT 30', [id]).catch(() => []),
    q('SELECT id,device,ip,created_at,revoked,expires_at FROM user_sessions WHERE user_id=? ORDER BY id DESC LIMIT 20', [id]).catch(() => []),
    q('SELECT id,order_no,amount,points,status,created_at FROM recharge_orders WHERE user_id=? ORDER BY id DESC LIMIT 20', [id]).catch(() => [])
  ])
  ok(res, { user, shares, aiLogs, ledger, versions, sessions, orders })
}))

/* ----------------------------------------------------------------- points */
router.post('/points', requireAdmin, wrap(async (req, res) => {
  const { userId, delta, reason } = req.body || {}
  if (!userId || !delta) return fail(res, 'userId 与 delta 必填', 'BAD_REQUEST')
  if (!reason || String(reason).trim().length < 2) return fail(res, '必须填写变更原因（审计要求）', 'REASON_REQUIRED')
  const r = await adjustPoints({
    userId: int(userId), delta: num(delta), kind: 'admin-adjust',
    note: String(reason).trim(), actorId: req.user.id
  })
  await audit(req, 'admin.points.adjust', 'user', userId, { delta: num(delta), reason })
  ok(res, {
    userId: int(userId),
    delta: r.delta,
    before: round2(r.before),
    after: round2(r.after),
    balance: round2(r.after),
    balance_after: round2(r.after)
  })
}))

/* --------------------------------------------------------------- channels */
router.get('/channels', requireAdmin, wrap(async (_req, res) => {
  const rows = await q('SELECT * FROM ai_channels ORDER BY id').catch(() => [])
  ok(res, rows.map((r) => ({
    id: r.id, providerId: r.provider_id, name: r.name, baseUrl: r.base_url,
    weight: r.weight, status: r.status, failCount: r.fail_count,
    lastOkAt: r.last_ok_at, lastFailAt: r.last_fail_at,
    hasKey: !!r.api_key_enc,
    apiKeyMasked: r.api_key_enc ? maskSecret(`sk-${'x'.repeat(32)}`) : null
  })))
}))

router.post('/channels', requireAdmin, wrap(async (req, res) => {
  const { providerId = 'mimo', name, baseUrl, weight = 10, status = 'active', apiKey } = req.body || {}
  if (!name || !baseUrl) return fail(res, 'name 与 baseUrl 必填', 'BAD_REQUEST')
  const enc = apiKey && !String(apiKey).includes('*') ? await encryptSecret(String(apiKey).trim()) : null
  const [r] = await q(
    `INSERT INTO ai_channels (provider_id,name,base_url,weight,status,api_key_enc,fail_count,created_at)
     VALUES (?,?,?,?,?,?,0,NOW())`,
    [providerId, name, baseUrl, int(weight), status, enc]
  )
  await audit(req, 'admin.channel.create', 'ai_channel', r.insertId, { providerId, name })
  ok(res, { id: r.insertId })
}))

router.put('/channels/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const { name, baseUrl, weight, status, apiKey } = req.body || {}
  const sets = []
  const params = []
  if (name !== undefined) { sets.push('name=?'); params.push(name) }
  if (baseUrl !== undefined) { sets.push('base_url=?'); params.push(baseUrl) }
  if (weight !== undefined) { sets.push('weight=?'); params.push(int(weight)) }
  if (status !== undefined) { sets.push('status=?'); params.push(status) }
  if (apiKey && !String(apiKey).includes('*')) {
    sets.push('api_key_enc=?')
    params.push(await encryptSecret(String(apiKey).trim()))
  }
  if (!sets.length) return fail(res, '没有要更新的字段', 'BAD_REQUEST')
  params.push(id)
  await q(`UPDATE ai_channels SET ${sets.join(',')} WHERE id=?`, params)
  await audit(req, 'admin.channel.update', 'ai_channel', id, req.body)
  ok(res, { id })
}))

router.delete('/channels/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  await q('DELETE FROM ai_channels WHERE id=?', [id])
  await audit(req, 'admin.channel.delete', 'ai_channel', id)
  ok(res, { id })
}))

router.post('/channels/:id/test', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const ch = await one('SELECT * FROM ai_channels WHERE id=?', [id])
  if (!ch) return fail(res, '渠道不存在', 'NOT_FOUND')
  let key = process.env.MIMO_API_KEY
  if (ch.api_key_enc) {
    try { key = await decryptSecret(ch.api_key_enc) } catch { /* keep env key */ }
  }
  if (!key) return ok(res, { ok: false, msg: '未配置 Key' })
  const t0 = Date.now()
  try {
    const root = String(ch.base_url || '').replace(/\/+$/, '')
    const r = await fetch(`${root}/models`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000)
    })
    const latencyMs = Date.now() - t0
    const j = await r.json().catch(() => ({}))
    const count = Array.isArray(j?.data) ? j.data.length : 0
    await q('UPDATE ai_channels SET fail_count=0, last_ok_at=NOW() WHERE id=?', [id]).catch(() => {})
    ok(res, { ok: r.ok, latencyMs, modelCount: count, msg: r.ok ? `连通正常，${count} 个模型` : `HTTP ${r.status}` })
  } catch (e) {
    await q('UPDATE ai_channels SET fail_count=fail_count+1, last_error=? WHERE id=?', [String(e.message).slice(0, 500), id]).catch(() => {})
    ok(res, { ok: false, msg: e.message, latencyMs: Date.now() - t0 })
  }
}))

/** Pull the upstream model catalogue into ai_models (insert new, report missing). */
router.post('/channels/sync-models', requireAdmin, wrap(async (req, res) => {
  const providerId = req.body?.providerId || 'mimo'
  const ch = await one(
    "SELECT * FROM ai_channels WHERE provider_id=? AND status='active' ORDER BY fail_count ASC LIMIT 1",
    [providerId]
  )
  if (!ch) return fail(res, '没有可用渠道', 'NO_CHANNEL')
  let key = process.env.MIMO_API_KEY
  if (ch.api_key_enc) {
    try { key = await decryptSecret(ch.api_key_enc) } catch { /* keep env key */ }
  }
  let upstream = []
  try {
    const root = String(ch.base_url || '').replace(/\/+$/, '')
    // fetchJson returns {ok,status,text,json,ms}: unwrap .json for the payload.
    const resp = await fetchJson(`${root}/models`, { headers: { Authorization: `Bearer ${key}` } }, 20000)
    if (!resp.ok) {
      return fail(res, `拉取上游模型失败：HTTP ${resp.status} ${String(resp.text || '').slice(0, 200)}`, 'UPSTREAM_ERROR')
    }
    const payload = resp.json || {}
    const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []
    upstream = list.map((m) => m.id || m.name).filter(Boolean)
  } catch (e) {
    return fail(res, `拉取上游模型失败：${e.message}`, 'UPSTREAM_ERROR')
  }
  const existing = await q('SELECT id FROM ai_models WHERE provider_id=?', [providerId]).catch(() => [])
  const existingIds = new Set(existing.map((r) => r.id))
  const added = []
  for (const id of upstream) {
    if (existingIds.has(id)) continue
    const category = /asr|whisper|transcri/i.test(id) ? 'asr'
      : /tts|voice/i.test(id) ? 'tts'
      : /pro|reason/i.test(id) ? 'omni' : 'text'
    await q(
      `INSERT INTO ai_models (id,provider_id,label,category,context_window,max_output,rpm,tpm,billing,
         price_cache_in,price_in,price_out,price_audio_hour,price_call,enabled,created_at)
       VALUES (?,?,?,?,1048576,131072,100,10000000,'token',0,0,0,0,0,0,NOW())`,
      [id, providerId, id, category]
    ).catch(() => {})
    added.push(id)
  }
  const removed = [...existingIds].filter((id) => !upstream.includes(id))
  await audit(req, 'admin.channel.sync-models', 'ai_provider', providerId, { added, removed })
  ok(res, { upstream, added, removed, total: upstream.length })
}))

/* ----------------------------------------------------------------- models */
const shapeAdminModel = (r) => ({
  id: r.id,
  providerId: r.provider_id,
  label: r.label,
  category: r.category,
  contextWindow: int(r.context_window),
  maxOutput: int(r.max_output),
  rpm: int(r.rpm),
  tpm: int(r.tpm),
  billing: r.billing,
  priceCacheIn: num(r.price_cache_in),
  priceIn: num(r.price_in),
  priceOut: num(r.price_out),
  priceAudioHour: num(r.price_audio_hour),
  priceCall: num(r.price_call),
  freeUntil: r.free_until,
  recommendedFor: r.recommended_for,
  tag: r.tag,
  enabled: !!int(r.enabled),
  sort: int(r.sort),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

router.get('/models', requireAdmin, wrap(async (_req, res) => {
  const rows = await q('SELECT * FROM ai_models ORDER BY sort, id').catch(() => [])
  ok(res, rows.map(shapeAdminModel))
}))

/** Create a model row (admin). */
router.post('/models', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {}
  const id = String(b.id || '').trim()
  const providerId = String(b.providerId || b.provider_id || '').trim()
  if (!id || !providerId) return fail(res, 'id 与 providerId 必填', 'BAD_REQUEST')
  if (!/^[A-Za-z0-9._:-]{2,64}$/.test(id)) return fail(res, 'id 只能包含字母数字 . _ : -', 'BAD_REQUEST')
  const exists = await one('SELECT id FROM ai_models WHERE id=?', [id])
  if (exists) return fail(res, `模型 ${id} 已存在`, 'ALREADY_EXISTS')
  const category = ['text', 'omni', 'reasoning', 'asr', 'tts', 'voiceclone'].includes(b.category) ? b.category : 'text'
  const billing = ['token', 'audio', 'call', 'free'].includes(b.billing) ? b.billing : 'token'
  await q(
    `INSERT INTO ai_models
      (id,provider_id,label,category,context_window,max_output,rpm,tpm,billing,
       price_cache_in,price_in,price_out,price_audio_hour,price_call,free_until,
       recommended_for,tag,enabled,sort,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
    [
      id, providerId, String(b.label || id), category,
      int(b.contextWindow, 8192), int(b.maxOutput, 4096), int(b.rpm, 100), int(b.tpm, 10000000),
      billing, num(b.priceCacheIn), num(b.priceIn), num(b.priceOut),
      num(b.priceAudioHour), num(b.priceCall), b.freeUntil || null,
      b.recommendedFor || null, b.tag || null, b.enabled === false ? 0 : 1, int(b.sort, 0)
    ]
  )
  await audit(req, 'admin.model.create', 'ai_model', id, { providerId, category, billing })
  ok(res, shapeAdminModel(await one('SELECT * FROM ai_models WHERE id=?', [id])))
}))

router.delete('/models/:id', requireAdmin, wrap(async (req, res) => {
  const id = String(req.params.id)
  const used = int(await val('SELECT COUNT(*) FROM ai_usage_logs WHERE model=?', [id], 0))
  if (used > 0 && String(req.query.force || '') !== '1') {
    // Historical usage exists: prefer disabling so past bills stay readable.
    return fail(res, `该模型已有 ${used} 条调用记录，建议下架而非删除（传 ?force=1 可强制删除）`, 'MODEL_IN_USE', 409, { calls: used })
  }
  const r = await q('DELETE FROM ai_models WHERE id=?', [id])
  if (!r.affectedRows) return fail(res, '模型不存在', 'NOT_FOUND', 404)
  await audit(req, 'admin.model.delete', 'ai_model', id, { calls: used })
  ok(res, { id, deleted: true })
}))

router.put('/models/:id', requireAdmin, wrap(async (req, res) => {
  const id = String(req.params.id)
  const b = req.body || {}
  const map = {
    label: 'label', category: 'category', contextWindow: 'context_window', maxOutput: 'max_output',
    rpm: 'rpm', tpm: 'tpm', billing: 'billing', priceCacheIn: 'price_cache_in',
    priceIn: 'price_in', priceOut: 'price_out', priceAudioHour: 'price_audio_hour',
    priceCall: 'price_call', freeUntil: 'free_until', recommendedFor: 'recommended_for',
    tag: 'tag', enabled: 'enabled', sort: 'sort', providerId: 'provider_id'
  }
  const current = await one('SELECT * FROM ai_models WHERE id=?', [id])
  if (!current) return fail(res, '模型不存在', 'NOT_FOUND', 404)

  const sets = []
  const params = []
  const next = { ...current }
  for (const [k, col] of Object.entries(map)) {
    if (b[k] === undefined) continue
    sets.push(`${col}=?`)
    params.push(col === 'enabled' ? (b[k] ? 1 : 0) : b[k])
    if (col in next) next[col] = b[k]
  }
  if (!sets.length) return fail(res, '没有要更新的字段', 'BAD_REQUEST')

  // Refuse a contradictory billing/price combination (see validateBillingConfig).
  const conflict = validateBillingConfig(next)
  if (conflict) return fail(res, conflict, 'PRICING_CONFLICT', 400, { id })

  params.push(id)
  const r = await q(`UPDATE ai_models SET ${sets.join(',')} WHERE id=?`, params)
  if (!r.affectedRows) return fail(res, '模型不存在', 'NOT_FOUND', 404)
  await audit(req, 'admin.model.update', 'ai_model', id, b)
  ok(res, { id, model: shapeAdminModel(await one('SELECT * FROM ai_models WHERE id=?', [id])) })
}))

/** Batch pricing update. */
router.post('/pricing', requireAdmin, wrap(async (req, res) => {
  // Accept {items|updates|models:[...]} and both snake_case (contract AiModel)
  // and camelCase spellings, so the admin UI cannot silently no-op.
  const body = req.body || {}
  const list = [body.items, body.updates, body.models].find((x) => Array.isArray(x) && x.length) || []
  if (!list.length) return fail(res, 'items 不能为空', 'BAD_REQUEST')
  const pick = (it, ...names) => {
    for (const n of names) if (it[n] !== undefined && it[n] !== null) return it[n]
    return undefined
  }
  const colNames = [
    ['price_cache_in', ['price_cache_in', 'priceCacheIn', 'cacheIn']],
    ['price_in', ['price_in', 'priceIn', 'input']],
    ['price_out', ['price_out', 'priceOut', 'output']],
    ['price_audio_hour', ['price_audio_hour', 'priceAudioHour', 'audioHour']],
    ['price_call', ['price_call', 'priceCall', 'call']]
  ]

  // Two-pass: compute the post-update row in memory and validate it BEFORE
  // writing anything. A contradictory row (e.g. billing=free with a live
  // price) would otherwise silently bill 0 forever — that regression hit the
  // ASR model once.
  const planned = []
  const problems = []
  for (const it of list) {
    if (!it || !it.id) continue
    const current = await one('SELECT * FROM ai_models WHERE id=?', [String(it.id)])
    if (!current) { problems.push({ id: it.id, error: '模型不存在' }); continue }
    const next = { ...current }
    const billing = pick(it, 'billing')
    if (billing !== undefined) next.billing = String(billing)
    for (const [col, names] of colNames) {
      const v = pick(it, ...names)
      if (v !== undefined) next[col] = num(v)
    }
    const err = validateBillingConfig(next)
    if (err) { problems.push({ id: it.id, error: err }); continue }
    planned.push({ it, next })
  }
  if (problems.length) {
    return fail(res, '计费配置存在矛盾，已全部取消（未写入任何更改）', 'PRICING_CONFLICT', 400, {
      problems
    })
  }

  let updated = 0
  const touched = []
  await withTx(async (tx) => {
    for (const { it, next } of planned) {
      const sets = []
      const params = []
      if (pick(it, 'billing') !== undefined) { sets.push('billing=?'); params.push(next.billing) }
      for (const [col, names] of colNames) {
        if (pick(it, ...names) !== undefined) { sets.push(`${col}=?`); params.push(num(next[col])) }
      }
      const freeUntil = pick(it, 'free_until', 'freeUntil')
      if (freeUntil !== undefined) { sets.push('free_until=?'); params.push(freeUntil || null) }
      const enabled = pick(it, 'enabled')
      if (enabled !== undefined) { sets.push('enabled=?'); params.push(enabled ? 1 : 0) }
      if (!sets.length) continue
      await tx.q(`UPDATE ai_models SET ${sets.join(',')} WHERE id=?`, [...params, String(it.id)])
      updated++
      touched.push(String(it.id))
    }
  })
  await audit(req, 'admin.pricing.update', 'ai_model', null, { count: updated, ids: touched })
  ok(res, { updated, ids: touched })
}))

/* ----------------------------------------------------------------- orders */
router.get('/orders', requireAdmin, wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req, 20, 100)
  const kw = String(req.query.keyword || '').trim()
  const status = String(req.query.status || '').trim()
  const conds = []
  const params = []
  // recharge_orders has no order_no column: its id IS the order number.
  if (kw) {
    conds.push('(o.id LIKE ? OR u.username LIKE ?)')
    params.push(`%${kw}%`, `%${kw}%`)
  }
  if (status) {
    conds.push('o.status = ?')
    params.push(status)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const total = await val(
    `SELECT COUNT(*) FROM recharge_orders o LEFT JOIN users u ON u.id=o.user_id ${where}`, params, 0
  ).catch(() => 0)
  const rows = await q(
    `SELECT o.*, u.username, u.nickname FROM recharge_orders o LEFT JOIN users u ON u.id=o.user_id
     ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]
  ).catch(() => [])
  ok(res, {
    total: int(total),
    page: int(page),
    pageSize: limit,
    list: rows.map((r) => ({
      id: r.id,
      orderId: r.id,
      userId: r.user_id,
      username: r.username,
      nickname: r.nickname,
      packageId: r.package_id,
      amount: num(r.amount),
      points: round2(r.points),
      bonus: round2(r.bonus),
      channel: r.channel,
      status: r.status,
      payUrl: r.pay_url || null,
      tradeNo: r.trade_no || null,
      paidAt: r.paid_at,
      createdAt: r.created_at
    }))
  })
}))

router.post('/orders/:id/fulfill', requireAdmin, wrap(async (req, res) => {
  // recharge_orders.id is VARCHAR(40) (e.g. NMMVNKQUMK886) — never coerce it.
  const orderId = String(req.params.id)
  const r = await fulfillOrder(orderId, {
    tradeNo: req.body?.tradeNo || null, actorId: req.user.id
  })
  await audit(req, 'admin.order.fulfill', 'order', orderId, { points: r.points })
  ok(res, r)
}))

router.post('/orders/:id/refund', requireAdmin, wrap(async (req, res) => {
  const orderId = String(req.params.id)
  const r = await refundOrder(orderId, {
    reason: req.body?.reason || null, actorId: req.user.id
  })
  await audit(req, 'admin.order.refund', 'order', orderId, { reason: req.body?.reason, deducted: r.deducted })
  ok(res, r)
}))

/* ----------------------------------------------------------- redeem codes */
router.get('/redeem', requireAdmin, wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req, 30, 200)
  const total = await val('SELECT COUNT(*) FROM redeem_codes', [], 0).catch(() => 0)
  const used = await val("SELECT COUNT(*) FROM redeem_codes WHERE status='used'", [], 0).catch(() => 0)
  const rows = await q('SELECT * FROM redeem_codes ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]).catch(() => [])
  ok(res, { total: int(total), used: int(used), page: int(page), list: rows })
}))

router.post('/redeem', requireAdmin, wrap(async (req, res) => {
  const { count = 10, points = 100, batch = null } = req.body || {}
  const r = await generateCodes({
    count: Math.min(1000, Math.max(1, int(count))),
    points: num(points), batch, createdBy: req.user.id
  })
  await audit(req, 'admin.redeem.generate', 'redeem_code', null, { count, points, batch })
  ok(res, r)
}))

router.post('/redeem/:id/void', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const r = await q("UPDATE redeem_codes SET status='void' WHERE id=? AND status='unused'", [id]).catch(() => ({ affectedRows: 0 }))
  if (!r.affectedRows) return fail(res, '卡密不存在或已被使用', 'BAD_REQUEST')
  await audit(req, 'admin.redeem.void', 'redeem_code', id)
  ok(res, { id, status: 'void' })
}))

/** Export redeem codes as CSV (respects the same filters as GET /redeem). */
router.get('/redeem/export', requireAdmin, wrap(async (req, res) => {
  const batch = String(req.query.batch || '').trim()
  const status = String(req.query.status || '').trim()
  const conds = []
  const params = []
  if (batch) { conds.push('batch=?'); params.push(batch) }
  if (status) { conds.push('status=?'); params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const rows = await q(
    `SELECT code, points, batch, status, used_by, used_at, created_at
       FROM redeem_codes ${where} ORDER BY id DESC LIMIT 50000`,
    params
  )
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = ['卡密,积分,批次,状态,使用者ID,使用时间,创建时间']
  for (const r of rows) {
    lines.push([r.code, round2(r.points), r.batch || '', r.status, r.used_by || '', r.used_at || '', r.created_at].map(esc).join(','))
  }
  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="neom-redeem-${stamp}.csv"`)
  // BOM keeps Excel from mangling the Chinese header row.
  res.send('\uFEFF' + lines.join('\r\n'))
}))

/* ---------------------------------------------------------------- plugins */
router.get('/plugins', requireAdmin, wrap(async (req, res) => {
  const status = req.query.status || null
  const kw = String(req.query.keyword || '').trim()
  const conds = []
  const params = []
  if (status) { conds.push('status=?'); params.push(status) }
  if (kw) { conds.push('(id LIKE ? OR name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const rows = await q(
    `SELECT * FROM plugins ${where} ORDER BY builtin DESC, id`, params
  ).catch(() => [])
  const total = await val(`SELECT COUNT(*) FROM plugins ${where}`, params, 0).catch(() => 0)
  const stats = await q(
    'SELECT plugin_id, COUNT(*) AS installs, SUM(enabled) AS enabled FROM user_plugins GROUP BY plugin_id'
  ).catch(() => [])
  const map = Object.fromEntries(stats.map((s) => [s.plugin_id, s]))
  const list = rows.map((r) => ({
    id: r.id, name: r.name, version: r.version, description: r.description,
    author: r.author, category: r.category, icon: r.icon, builtin: !!r.builtin,
    status: r.status, downloads: int(r.downloads), rating: num(r.rating),
    defaultEnabled: !!r.default_enabled,
    installs: int(map[r.id]?.installs || 0), enabledCount: int(map[r.id]?.enabled || 0),
    createdAt: r.created_at
  }))
  // 启用率 = 已启用安装数 / 总安装数（全站插件概览，前端 dashboard 直接可用）
  const installSum = list.reduce((s, p) => s + p.installs, 0)
  const enabledSum = list.reduce((s, p) => s + p.enabledCount, 0)
  ok(res, {
    total: int(total),
    list,
    summary: {
      plugins: int(total),
      installs: installSum,
      enabled: enabledSum,
      enableRate: installSum ? Number(((enabledSum / installSum) * 100).toFixed(2)) : 0,
      downloads: list.reduce((s, p) => s + p.downloads, 0)
    }
  })
}))

router.put('/plugins/:id', requireAdmin, wrap(async (req, res) => {
  const id = String(req.params.id)
  const b = req.body || {}
  const { status, defaultEnabled, category, sort } = b
  const sets = []
  const params = []
  if (status !== undefined) {
    if (!['published', 'pending', 'rejected', 'offline'].includes(status)) {
      return fail(res, 'status 只能是 published|pending|rejected|offline', 'BAD_REQUEST')
    }
    sets.push('status=?'); params.push(status)
  }
  if (defaultEnabled !== undefined) { sets.push('default_enabled=?'); params.push(defaultEnabled ? 1 : 0) }
  if (category !== undefined) { sets.push('category=?'); params.push(category) }
  if (sort !== undefined) { sets.push('sort=?'); params.push(int(sort, 0)) }
  if (!sets.length) return fail(res, '没有要更新的字段', 'BAD_REQUEST')
  params.push(id)
  const r = await q(`UPDATE plugins SET ${sets.join(',')} WHERE id=?`, params)
  if (!r.affectedRows) return fail(res, '插件不存在', 'NOT_FOUND')
  await audit(req, 'admin.plugin.update', 'plugin', id, b)
  ok(res, { id, status, defaultEnabled })
}))

/** 审核通过 / 驳回 / 上架 / 下架 —— 语义化快捷动作。 */
for (const [action, nextStatus, label] of [
  ['approve', 'published', 'admin.plugin.approve'],
  ['reject', 'rejected', 'admin.plugin.reject'],
  ['publish', 'published', 'admin.plugin.publish'],
  ['offline', 'offline', 'admin.plugin.offline']
]) {
  router.post(`/plugins/:id/${action}`, requireAdmin, wrap(async (req, res) => {
    const id = String(req.params.id)
    const row = await one('SELECT id, name, version FROM plugins WHERE id=?', [id])
    if (!row) return fail(res, '插件不存在', 'NOT_FOUND')
    await q('UPDATE plugins SET status=? WHERE id=?', [nextStatus, id])
    // Keep the version row in sync so the store listing matches.
    await q('UPDATE plugin_versions SET status=? WHERE plugin_id=? AND version=?', [nextStatus, id, row.version]).catch(() => {})
    const reason = String(req.body?.reason || '').slice(0, 500) || null
    await audit(req, label, 'plugin', id, { version: row.version, reason })
    ok(res, { id, status: nextStatus, reason })
  }))
}

/** 插件版本列表 + 回滚到指定版本。 */
router.get('/plugins/:id/versions', requireAdmin, wrap(async (req, res) => {
  const id = String(req.params.id)
  const rows = await q(
    'SELECT * FROM plugin_versions WHERE plugin_id=? ORDER BY created_at DESC, id DESC',
    [id]
  ).catch(() => [])
  ok(res, { pluginId: id, total: rows.length, list: rows })
}))

router.post('/plugins/:id/rollback', requireAdmin, wrap(async (req, res) => {
  const id = String(req.params.id)
  const version = String(req.body?.version || '').trim()
  if (!version) return fail(res, 'version 必填', 'BAD_REQUEST')
  const v = await one('SELECT * FROM plugin_versions WHERE plugin_id=? AND version=?', [id, version])
  if (!v) return fail(res, '该版本不存在', 'NOT_FOUND')
  const cur = await one('SELECT name, version FROM plugins WHERE id=?', [id])
  if (!cur) return fail(res, '插件不存在', 'NOT_FOUND')
  await q(
    `UPDATE plugins SET version=?, changelog=?, package_key=COALESCE(?, package_key), status='published' WHERE id=?`,
    [version, v.changelog || null, v.package_key || null, id]
  ).catch(async () => {
    // plugins has no changelog column in some revisions — fall back.
    await q('UPDATE plugins SET version=?, package_key=COALESCE(?, package_key), status=? WHERE id=?', [
      version, v.package_key || null, 'published', id
    ])
  })
  await audit(req, 'admin.plugin.rollback', 'plugin', id, { from: cur.version, to: version })
  ok(res, { id, version, previous: cur.version })
}))

/** 允许未签名插件上传开关（写入 sys_settings）。 */
router.get('/plugins/settings', requireAdmin, wrap(async (_req, res) => {
  const allowUnsigned = await sysGet('plugin_allow_unsigned', 0)
  const uploadMaxMb = await sysGet('plugin_upload_max_mb', 20)
  ok(res, { allowUnsigned: !!num(allowUnsigned), uploadMaxMb: num(uploadMaxMb, 20) })
}))

router.post('/plugins/settings', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {}
  if (b.allowUnsigned !== undefined) await sysSet('plugin_allow_unsigned', b.allowUnsigned ? '1' : '0')
  if (b.uploadMaxMb !== undefined) await sysSet('plugin_upload_max_mb', String(Math.min(200, Math.max(1, int(b.uploadMaxMb, 20)))))
  await audit(req, 'admin.plugin.settings', 'sys_setting', null, b)
  ok(res, {
    allowUnsigned: !!num(await sysGet('plugin_allow_unsigned', 0)),
    uploadMaxMb: num(await sysGet('plugin_upload_max_mb', 20), 20)
  })
}))

/* ----------------------------------------------------------------- shares */
router.get('/shares', requireAdmin, wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req, 20, 100)
  const userRows = await q(
    `SELECT s.*, u.username FROM share_links s LEFT JOIN users u ON u.id=s.user_id
     ORDER BY s.id DESC LIMIT ? OFFSET ?`, [limit, offset]
  ).catch(() => [])
  const pubRows = await q(
    `SELECT p.*, u.username FROM publish_pages p LEFT JOIN users u ON u.id=p.user_id
     ORDER BY p.id DESC LIMIT ? OFFSET ?`, [limit, offset]
  ).catch(() => [])
  const [totalShares, totalPublish] = await Promise.all([
    val('SELECT COUNT(*) FROM share_links', [], 0).catch(() => 0),
    val('SELECT COUNT(*) FROM publish_pages', [], 0).catch(() => 0)
  ])
  const base = (process.env.PUBLIC_BASE_URL || 'https://m.zhengl.vip').replace(/\/$/, '')
  ok(res, {
    total: int(totalShares), totalPublish: int(totalPublish), page: int(page),
    shares: userRows.map((r) => ({ ...r, url: `${base}/s/${r.id}` })),
    publishes: pubRows.map((r) => ({ ...r, url: `${base}/p/${r.id}` }))
  })
}))

router.post('/shares/:id/block', requireAdmin, wrap(async (req, res) => {
  // share_links.id / publish_pages.id are VARCHAR(32) share tokens — keep string.
  const id = String(req.params.id)
  const blocked = String(req.body?.blocked ?? '1') !== '0'
  const table = req.body?.kind === 'publish' ? 'publish_pages' : 'share_links'
  const r = await q(`UPDATE ${table} SET status=? WHERE id=?`, [blocked ? 'blocked' : 'active', id])
  if (!r.affectedRows) return fail(res, '分享不存在', 'NOT_FOUND')
  await audit(req, blocked ? 'admin.share.block' : 'admin.share.unblock', table, id)
  ok(res, { id, blocked })
}))

router.delete('/shares/:id', requireAdmin, wrap(async (req, res) => {
  const id = String(req.params.id)
  const table = req.query.kind === 'publish' ? 'publish_pages' : 'share_links'
  const r = await q(`DELETE FROM ${table} WHERE id=?`, [id])
  if (!r.affectedRows) return fail(res, '分享不存在', 'NOT_FOUND')
  await audit(req, 'admin.share.delete', table, id)
  ok(res, { id })
}))

router.get('/comments', requireAdmin, wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req, 30, 200)
  const kw = String(req.query.keyword || '').trim()
  const where = kw ? 'WHERE c.content LIKE ? OR c.author LIKE ?' : ''
  const params = kw ? [`%${kw}%`, `%${kw}%`] : []
  const rows = await q(
    `SELECT c.*, s.doc_name FROM share_comments c LEFT JOIN share_links s ON s.id=c.share_id
     ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]
  ).catch(() => [])
  const total = await val(`SELECT COUNT(*) FROM share_comments c ${where}`, params, 0).catch(() => 0)
  const words = await q('SELECT word FROM sensitive_words').catch(() => [])
  const list = rows.map((r) => ({
    ...r,
    flagged: words.some((w) => String(r.content || '').includes(w.word))
  }))
  ok(res, { total: int(total), page: int(page), pageSize: limit, list })
}))

router.delete('/comments/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  await q('DELETE FROM share_comments WHERE id=?', [id])
  await audit(req, 'admin.comment.delete', 'share_comment', id)
  ok(res, { id })
}))

/* --------------------------------------------------------------- releases */
router.get('/releases', requireAdmin, wrap(async (_req, res) => {
  const rows = await q('SELECT * FROM releases ORDER BY platform, published_at DESC').catch(() => [])
  const list = rows.map((r) => ({
    id: int(r.id),
    platform: r.platform,
    version: r.version,
    filename: r.filename,
    size: int(r.size),
    url: r.url,
    ossKey: r.oss_key || null,
    sha256: r.sha256 || null,
    changelog: r.changelog || '',
    forced: !!int(r.forced),
    channel: r.channel,
    downloads: int(r.downloads),
    publishedAt: r.published_at
  }))
  ok(res, { total: list.length, list })
}))

router.post('/releases', requireAdmin, wrap(async (req, res) => {
  const {
    platform, version, filename, size = 0, url, ossKey = null,
    changelog = null, forced = false, channel = 'stable'
  } = req.body || {}
  if (!platform || !version || !filename) return fail(res, 'platform / version / filename 必填', 'BAD_REQUEST')
  const finalUrl = url || `https://mdadmin.zhengl.vip/${ossKey || `md/mdadmin/${filename}`}`
  const [r] = await q(
    `INSERT INTO releases (platform,version,filename,size,url,oss_key,changelog,forced,channel,published_at,downloads)
     VALUES (?,?,?,?,?,?,?,?,?,NOW(),0)`,
    [platform, version, filename, int(size), finalUrl, ossKey, changelog, forced ? 1 : 0, channel]
  )
  await audit(req, 'admin.release.create', 'release', r.insertId, { platform, version })
  ok(res, { id: r.insertId, url: finalUrl })
}))

router.put('/releases/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const { version, url, size, changelog, forced, channel } = req.body || {}
  const sets = []
  const params = []
  if (version !== undefined) { sets.push('version=?'); params.push(version) }
  if (url !== undefined) { sets.push('url=?'); params.push(url) }
  if (size !== undefined) { sets.push('size=?'); params.push(int(size)) }
  if (changelog !== undefined) { sets.push('changelog=?'); params.push(changelog) }
  if (forced !== undefined) { sets.push('forced=?'); params.push(forced ? 1 : 0) }
  if (channel !== undefined) { sets.push('channel=?'); params.push(channel) }
  if (!sets.length) return fail(res, '没有要更新的字段', 'BAD_REQUEST')
  params.push(id)
  await q(`UPDATE releases SET ${sets.join(',')} WHERE id=?`, params)
  await audit(req, 'admin.release.update', 'release', id, req.body)
  ok(res, { id })
}))

router.delete('/releases/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  await q('DELETE FROM releases WHERE id=?', [id])
  await audit(req, 'admin.release.delete', 'release', id)
  ok(res, { id })
}))

/** Upload an installer straight to the public OSS bucket (md/mdadmin). */
router.post('/releases/upload', requireAdmin, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return fail(res, '缺少文件', 'NO_FILE')
  const platform = req.body?.platform || 'win-x64'
  const version = req.body?.version || '1.0.0'
  const filename = req.file.originalname
  const key = `md/mdadmin/${filename}`
  let url
  try {
    const storage = await import('../lib/storage.js')
    await storage.putObject(key, req.file.buffer, req.file.mimetype || 'application/octet-stream')
    url = storage.publicUrl(key)
  } catch (e) {
    return fail(res, `上传 OSS 失败：${e.message}`, 'OSS_ERROR')
  }
  const [r] = await q(
    `INSERT INTO releases (platform,version,filename,size,url,oss_key,changelog,forced,channel,published_at,downloads)
     VALUES (?,?,?,?,?,?,?,?,?,NOW(),0)`,
    [platform, version, filename, req.file.size, url, key,
      req.body?.changelog || null, String(req.body?.forced) === '1' ? 1 : 0, req.body?.channel || 'stable']
  )
  await audit(req, 'admin.release.upload', 'release', r.insertId, { platform, version, filename })
  ok(res, { id: r.insertId, url, ossKey: key, size: req.file.size })
}))

/* -------------------------------------------------------------------- OSS */
router.get('/oss', requireAdmin, wrap(async (req, res) => {
  const prefix = String(req.query.prefix || 'md/')
  try {
    const storage = await import('../lib/storage.js')
    const listing = await storage.listObjects(prefix, null, { max: 1000 })
    const files = []
    const dirs = new Map()
    for (const obj of listing || []) {
      const key = obj.name || obj.key
      if (!key || key === prefix) continue
      const rel = key.slice(prefix.length)
      if (!rel) continue
      const slash = rel.indexOf('/')
      if (slash > 0) {
        const dir = rel.slice(0, slash)
        const agg = dirs.get(dir) || { dir, count: 0, size: 0 }
        agg.count++
        agg.size += Number(obj.size || 0)
        dirs.set(dir, agg)
      } else if (!key.endsWith('/')) {
        files.push({
          key, name: rel, size: Number(obj.size || 0),
          mtime: obj.lastModified || null, url: storage.publicUrl(key)
        })
      }
    }
    const users = await q("SELECT username FROM users WHERE role!='admin' LIMIT 500").catch(() => [])
    const usage = []
    for (const u of users.slice(0, 60)) {
      const size = await storage
        .prefixSize(`${process.env.OSS_PREFIX_USER || 'md/user'}/${u.username}`)
        .catch(() => 0)
      if (size > 0) usage.push({ username: u.username, size })
    }
    usage.sort((a, b) => b.size - a.size)
    const health = await storage.storageHealth().catch(() => null)
    ok(res, {
      prefix,
      files: files.slice(0, 500),
      dirs: [...dirs.values()].sort((a, b) => a.dir.localeCompare(b.dir)),
      usage: usage.slice(0, 20),
      stats: health,
      truncated: (listing || []).length >= 1000
    })
  } catch (e) {
    ok(res, { prefix, files: [], dirs: [], usage: [], stats: null, error: e.message })
  }
}))

/**
 * 清理孤立对象。
 *
 * An object is orphaned when no DB row references it. The authoritative
 * reference set is files.oss_key (content/index rows) — comparing OSS basenames
 * against files.path (as an earlier revision did) flags every live object,
 * because document bodies live in OSS and only their keys are in the DB.
 */
router.post('/oss/cleanup', requireAdmin, wrap(async (req, res) => {
  const dryRun = String(req.body?.dryRun ?? '1') !== '0'
  const prefix = String(req.body?.prefix || 'md/user/')
  const storage = await import('../lib/storage.js')
  const listing = await storage.listObjects(prefix, null, { max: 5000 })

  const objects = (listing || [])
    .map((o) => ({ key: o.name || o.key, size: num(o.size, 0) }))
    .filter((o) => o.key && !o.key.endsWith('/'))

  // Every key the DB knows about: file content objects, snapshots, backups, releases.
  const [fileKeys, snapshotKeys, backupKeys, releaseKeys, pluginKeys] = await Promise.all([
    q('SELECT oss_key FROM files WHERE oss_key IS NOT NULL').catch(() => []),
    q('SELECT oss_key FROM file_snapshots WHERE oss_key IS NOT NULL').catch(() => []),
    q('SELECT oss_key FROM backups WHERE oss_key IS NOT NULL').catch(() => []),
    q('SELECT oss_key FROM releases WHERE oss_key IS NOT NULL').catch(() => []),
    q('SELECT package_key FROM plugins WHERE package_key IS NOT NULL').catch(() => [])
  ])
  const known = new Set()
  for (const r of fileKeys) known.add(String(r.oss_key))
  for (const r of snapshotKeys) known.add(String(r.oss_key))
  for (const r of backupKeys) known.add(String(r.oss_key))
  for (const r of releaseKeys) known.add(String(r.oss_key))
  for (const r of pluginKeys) known.add(String(r.package_key))

  const orphans = objects.filter((o) => !known.has(o.key))
  const orphanBytes = orphans.reduce((s, o) => s + o.size, 0)

  let removed = 0
  let freed = 0
  if (!dryRun) {
    for (const o of orphans.slice(0, 500)) {
      try {
        await storage.deleteObject(o.key)
        removed++
        freed += o.size
      } catch { /* keep going: report what actually succeeded */ }
    }
  }
  await audit(req, dryRun ? 'admin.oss.cleanup.scan' : 'admin.oss.cleanup.run', 'oss', null, {
    prefix, scanned: objects.length, orphans: orphans.length, removed, dryRun
  })
  ok(res, {
    dryRun,
    prefix,
    scanned: objects.length,
    referenced: known.size,
    orphans: orphans.length,
    orphanBytes,
    removed,
    freedBytes: freed,
    sample: orphans.slice(0, 100).map((o) => ({ key: o.key, size: o.size })),
    note: dryRun ? '试运行：未删除任何文件，传 {dryRun:false} 才会真正删除' : null
  })
}))

/* ------------------------------------------------------------------- site */
router.get('/site', requireAdmin, wrap(async (_req, res) => {
  const cfg = await q('SELECT k,v FROM site_config').catch(() => [])
  const map = {}
  for (const r of cfg) {
    try { map[r.k] = JSON.parse(r.v) } catch { map[r.k] = r.v }
  }
  const docs = await q('SELECT k,title,content,updated_at FROM site_docs').catch(() => [])
  const sys = await sysGetMany([
    'register_enabled', 'register_gift_points', 'signin_points', 'point_per_cny', 'pay_enabled',
    'default_naming_mode', 'default_theme', 'announcement', 'smtp_host', 'smtp_port', 'smtp_user',
    'sms_provider', 'upload_max_mb'
  ])
  ok(res, { site: map, docs, sys })
}))

router.post('/site', requireAdmin, wrap(async (req, res) => {
  const { site = {}, docs = [], sys = {} } = req.body || {}
  for (const [k, v] of Object.entries(site)) {
    await q(
      'INSERT INTO site_config (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)',
      [k, typeof v === 'string' ? v : JSON.stringify(v)]
    )
  }
  for (const d of docs) {
    if (!d.k) continue
    await q(
      `INSERT INTO site_docs (k,title,content,updated_at) VALUES (?,?,?,NOW())
       ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), updated_at=NOW()`,
      [d.k, d.title || d.k, d.content || '']
    )
  }
  for (const [k, v] of Object.entries(sys)) await sysSet(k, v)
  // Secrets accepted separately and stored encrypted only.
  if (req.body?.smtpPassword) await sysSet('smtp_password_enc', await encryptSecret(String(req.body.smtpPassword)))
  if (req.body?.smsKey) await sysSet('sms_key_enc', await encryptSecret(String(req.body.smsKey)))
  await audit(req, 'admin.site.update', 'site_config', null, {
    keys: Object.keys(site), sys: Object.keys(sys)
  })
  ok(res, { updated: true })
}))

/* --------------------------------------------------------------- security */
/* admin_audit schema (001_schema.sql): admin_id, action, target, detail, ip. */
const AUDIT_JOIN = 'SELECT a.*, u.username FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id'

router.get('/security', requireAdmin, wrap(async (_req, res) => {
  const [audits, logins, words, limits, logStats] = await Promise.all([
    q(`${AUDIT_JOIN} ORDER BY a.id DESC LIMIT 100`).catch(() => []),
    q('SELECT * FROM login_logs ORDER BY id DESC LIMIT 100').catch(() => []),
    q('SELECT * FROM sensitive_words ORDER BY id DESC LIMIT 300').catch(() => []),
    getRateLimitConfig().catch(() => ({})),
    Promise.all([
      val('SELECT COUNT(*) FROM login_logs WHERE ok=0 AND created_at>=CURDATE()', [], 0).catch(() => 0),
      val('SELECT COUNT(*) FROM login_logs WHERE created_at>=CURDATE()', [], 0).catch(() => 0),
      val('SELECT COUNT(DISTINCT ip) FROM login_logs WHERE ok=0 AND created_at>=DATE_SUB(NOW(), INTERVAL 7 DAY)', [], 0).catch(() => 0)
    ])
  ])
  const [failToday, loginToday, badIps] = logStats
  ok(res, {
    audits,
    logins,
    sensitiveWords: words,
    rateLimits: limits,
    loginSummary: {
      today: int(loginToday),
      failedToday: int(failToday),
      failedIp7d: int(badIps),
      successRate: int(loginToday) ? round2(((int(loginToday) - int(failToday)) / int(loginToday)) * 100) : 100
    }
  })
}))

router.post('/security/words', requireAdmin, wrap(async (req, res) => {
  const words = Array.isArray(req.body?.words)
    ? req.body.words
    : String(req.body?.text || '').split(/[\s,，、]+/).filter(Boolean)
  const action = req.body?.action === 'replace' ? 'replace' : 'block'
  let added = 0
  for (const w of words.slice(0, 500)) {
    const word = String(w).trim().slice(0, 96)
    if (!word) continue
    const r = await q('INSERT IGNORE INTO sensitive_words (word,action) VALUES (?,?)', [word, action]).catch(() => null)
    if (r && r.affectedRows) added++
  }
  await audit(req, 'admin.security.words', 'sensitive_word', null, { added, action })
  ok(res, { added, action, total: words.length })
}))

router.delete('/security/words/:id', requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id)
  const r = await q('DELETE FROM sensitive_words WHERE id=?', [id])
  if (!r.affectedRows) return fail(res, '敏感词不存在', 'NOT_FOUND')
  await audit(req, 'admin.security.word.delete', 'sensitive_word', id)
  ok(res, { id, deleted: true })
}))

router.post('/security/ratelimit', requireAdmin, wrap(async (req, res) => {
  const r = await saveRateLimit(req.body || {})
  await audit(req, 'admin.security.ratelimit', 'rate_limit', null, req.body)
  ok(res, r)
}))

router.get('/security/ratelimit/hits', requireAdmin, wrap(async (req, res) => {
  const scope = String(req.query.scope || '').trim() || null
  ok(res, { list: await listRateLimitHits({ scope, limit: 200 }) })
}))

/* ------------------------------------------------------------------ audit */
router.get('/audit', requireAdmin, wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req, 50, 200)
  const action = String(req.query.action || '').trim()
  const adminId = int(req.query.adminId, 0)
  const conds = []
  const params = []
  if (action) { conds.push('a.action LIKE ?'); params.push(`%${action}%`) }
  if (adminId) { conds.push('a.admin_id = ?'); params.push(adminId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const total = await val(`SELECT COUNT(*) FROM admin_audit a ${where}`, params, 0).catch(() => 0)
  const rows = await q(
    `${AUDIT_JOIN} ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]
  ).catch(() => [])
  ok(res, { total: int(total), page: int(page), pageSize: limit, list: rows })
}))

/* --------------------------------------------------------------- ai logs */
/** 全站 AI 审计：耗时 / 模型 / Token / 缓存命中 / 扣费。 */
router.get('/ai-logs', requireAdmin, wrap(async (req, res) => {
  const { limit, offset, page } = pagination(req, 50, 200)
  const conds = []
  const params = []
  const model = String(req.query.model || '').trim()
  const userId = int(req.query.userId, 0)
  const status = String(req.query.status || '').trim()
  const scene = String(req.query.scene || '').trim()
  const from = String(req.query.from || '').trim()
  const to = String(req.query.to || '').trim()
  if (model) { conds.push('l.model = ?'); params.push(model) }
  if (userId) { conds.push('l.user_id = ?'); params.push(userId) }
  if (status) { conds.push('l.status = ?'); params.push(status) }
  if (scene) { conds.push('l.scene = ?'); params.push(scene) }
  if (from) { conds.push('l.created_at >= ?'); params.push(from) }
  if (to) { conds.push('l.created_at <= ?'); params.push(to) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const [total, aggRows, rows] = await Promise.all([
    val(`SELECT COUNT(*) FROM ai_usage_logs l ${where}`, params, 0).catch(() => 0),
    q(
      `SELECT COALESCE(SUM(l.prompt_tokens),0) AS prompt_tokens,
              COALESCE(SUM(l.cached_tokens),0) AS cached_tokens,
              COALESCE(SUM(l.completion_tokens),0) AS completion_tokens,
              COALESCE(SUM(l.points_cost),0) AS points,
              COALESCE(AVG(l.latency_ms),0) AS avg_latency,
              COALESCE(SUM(l.status<>'ok'),0) AS errors
         FROM ai_usage_logs l ${where}`,
      params
    ).catch(() => []),
    q(
      `SELECT l.*, u.username FROM ai_usage_logs l LEFT JOIN users u ON u.id = l.user_id
        ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ).catch(() => [])
  ])
  // Aggregate queries always return exactly one row; guard anyway.
  const agg = (Array.isArray(aggRows) && aggRows[0]) || {}

  const prompt = int(agg.prompt_tokens, 0)
  ok(res, {
    total: int(total),
    page: int(page),
    pageSize: limit,
    summary: {
      promptTokens: prompt,
      cachedTokens: int(agg.cached_tokens, 0),
      completionTokens: int(agg.completion_tokens, 0),
      points: round2(agg.points),
      avgLatency: Math.round(num(agg.avg_latency, 0)),
      errors: int(agg.errors, 0),
      // 缓存命中率 = 命中缓存的 prompt token / prompt token 总量
      cacheHitRate: prompt ? round2((int(agg.cached_tokens, 0) / prompt) * 100) : 0
    },
    list: rows.map((r) => ({
      id: int(r.id),
      userId: int(r.user_id),
      username: r.username || null,
      model: r.model,
      providerId: r.provider_id,
      channelId: r.channel_id === null ? null : int(r.channel_id),
      scene: r.scene,
      mode: r.mode,
      promptTokens: int(r.prompt_tokens),
      cachedTokens: int(r.cached_tokens),
      completionTokens: int(r.completion_tokens),
      audioSeconds: num(r.audio_seconds),
      pointsCost: round2(r.points_cost),
      cnyCost: num(r.cny_cost),
      latencyMs: int(r.latency_ms),
      status: r.status,
      error: r.error || null,
      ip: r.ip || null,
      createdAt: r.created_at
    }))
  })
}))

/* ------------------------------------------------------------------ stats */
router.get('/stats', requireAdmin, wrap(async (_req, res) => {
  ok(res, await adminStats.summary())
}))

/* ----------------------------------------------------------------- backup */
/* ----------------------------------------------------------------- backup */

/**
 * Cross-platform MySQL dump.
 *
 * Preferred: `mysqldump --single-transaction` when the binary exists (the
 * production Linux path). Fallback: a pure-JS dump via mysql2 (SHOW CREATE
 * TABLE + batched INSERTs) so the feature also works on hosts without MySQL
 * client tools (e.g. the Windows dev box).
 */
async function hasMysqldump() {
  try {
    await execFileAsync('mysqldump', ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
  const s = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u0000/g, '\\0')
    .replace(/\u001a/g, '\\Z')
  return `'${s}'`
}

/** Dump every base table: CREATE TABLE (from SHOW CREATE) + batched INSERTs. */
async function jsDump() {
  const tables = await q(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = ? ORDER BY table_name',
    ['BASE TABLE']
  )
  const chunks = [
    `-- NeoM backup ${new Date().toISOString()} (js-dump fallback)`,
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";',
    ''
  ]
  for (const row of tables) {
    const name = row.t
    const safe = String(name).replace(/`/g, '``')
    const create = await one(`SHOW CREATE TABLE \`${safe}\``)
    const ddl = create && (create['Create Table'] || create['Create View'])
    chunks.push(`-- ---------------------------- ${name}`, `DROP TABLE IF EXISTS \`${safe}\`;`)
    if (ddl) chunks.push(`${ddl};`)
    const cols = await q(
      'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position',
      [name]
    )
    const colList = cols.map((c) => `\`${String(c.c).replace(/`/g, '``')}\``).join(',')
    const total = int(await val(`SELECT COUNT(*) FROM \`${safe}\``, [], 0))
    const BATCH = 500
    for (let offset = 0; offset < total; offset += BATCH) {
      const rows = await q(`SELECT * FROM \`${safe}\` LIMIT ${BATCH} OFFSET ${offset}`)
      if (!rows.length) break
      const values = rows.map((r) => `(${cols.map((c) => sqlLiteral(r[c.c])).join(',')})`)
      chunks.push(`INSERT INTO \`${safe}\` (${colList}) VALUES\n${values.join(',\n')};`)
    }
    chunks.push('')
  }
  chunks.push('SET FOREIGN_KEY_CHECKS = 1;', '-- end of backup')
  return Buffer.from(chunks.join('\n'), 'utf8')
}

router.post('/backup', requireAdmin, wrap(async (req, res) => {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const tmpDir = path.join(SERVER_ROOT, 'data', 'backups')
  fs.mkdirSync(tmpDir, { recursive: true })
  const baseName = `neom-${stamp}.sql`
  const tmp = path.join(tmpDir, baseName)
  const envDb = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'NeoM',
    pass: process.env.DB_PASS || process.env.DB_PASSWORD || '',
    db: process.env.DB_NAME || 'neom'
  }

  let buf = null
  let method = 'js'
  if (await hasMysqldump()) {
    try {
      // MYSQL_PWD keeps the password off the process command line.
      const { stdout } = await execFileAsync(
        'mysqldump',
        ['--single-transaction', '--quick', '--default-character-set=utf8mb4',
          '-h', envDb.host, '-u', envDb.user, envDb.db],
        { timeout: 600000, maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, MYSQL_PWD: envDb.pass } }
      )
      buf = Buffer.from(stdout)
      fs.writeFileSync(tmp, buf)
      method = 'mysqldump'
    } catch {
      buf = null
    }
  }
  if (!buf) {
    buf = await jsDump()
    fs.writeFileSync(tmp, buf)
    method = 'js'
  }

  const gz = await gzipBuffer(buf)
  const filename = `${baseName}.gz`
  let ossKey = `md/mdadmin/bk/${filename}`
  let url = null
  try {
    const storage = await import('../lib/storage.js')
    await storage.putObject(ossKey, gz, 'application/gzip', null)
    url = storage.publicUrl(ossKey)
  } catch {
    ossKey = null
    url = null // keep the local copy under data/backups
  }
  try { fs.unlinkSync(tmp) } catch { /* ignore */ }

  const ins = await q(
    'INSERT INTO backups (user_id, scope, name, oss_key, size, status, msg, created_at) VALUES (?,?,?,?,?,?,?,NOW())',
    [req.user.id, 'mysql', filename, ossKey, gz.length, 'done', method]
  ).catch(() => ({ insertId: null }))

  await audit(req, 'admin.backup.create', 'backup', ins.insertId, {
    filename, size: gz.length, method, oss: !!ossKey
  })
  ok(res, {
    id: ins.insertId === undefined ? null : ins.insertId,
    filename,
    size: gz.length,
    rawSize: buf.length,
    url,
    ossKey,
    method,
    note: ossKey ? null : 'OSS 未配置，备份文件已保留在服务器本地 data/backups 目录'
  })
}))

router.get('/backup', requireAdmin, wrap(async (_req, res) => {
  const rows = await q(
    `SELECT b.*, u.username FROM backups b LEFT JOIN users u ON u.id = b.user_id
      ORDER BY b.id DESC LIMIT 50`
  ).catch(() => [])
  let publicUrl = null
  try {
    const storage = await import('../lib/storage.js')
    publicUrl = (key) => storage.publicUrl(key)
  } catch { /* storage unavailable */ }
  ok(res, {
    total: rows.length,
    list: rows.map((r) => ({
      id: int(r.id),
      userId: r.user_id === null ? null : int(r.user_id),
      username: r.username || null,
      scope: r.scope,
      name: r.name,
      ossKey: r.oss_key || null,
      size: int(r.size),
      status: r.status,
      msg: r.msg || null,
      url: r.oss_key && publicUrl ? publicUrl(r.oss_key) : null,
      createdAt: r.created_at
    }))
  })
}))
/* Errors bubble to src/index.js's error middleware; every handler above is
 * wrapped by `wrap()` which renders the {status:false,msg,code} envelope. */

export default router