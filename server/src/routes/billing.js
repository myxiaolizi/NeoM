/**
 * /api/billing — points balance, ledger, recharge packages, redeem codes,
 * orders and daily sign-in.
 */
import { Router } from 'express'
import { ok, fail, wrap, requireUser, round2 } from '../lib/aiShared.js'
import {
  balanceInfo, ledgerList, getUserPoints, getPackages, getPackagesAll,
  createOrder, listOrders, shapeOrder, redeem, signin, signedInToday,
  getPointPerCny, getSigninPoints, billingConfig, refundOrder
} from '../lib/billing.js'
import { q, one } from '../lib/aiShared.js'

const router = Router()

router.get('/balance', requireUser, wrap(async (req, res) => {
  const info = await balanceInfo(req.user.id)
  const signed = await signedInToday(req.user.id).catch(() => false)
  const cfg = await billingConfig().catch(() => ({}))
  ok(res, { ...info, signinToday: !!signed, ...cfg })
}))

router.get('/ledger', requireUser, wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const data = await ledgerList(req.user.id, { page, size, kind: req.query.kind || null })
  ok(res, data)
}))

router.get('/packages', wrap(async (_req, res) => {
  const list = await getPackages().catch(() => [])
  ok(res, list)
}))

router.post('/recharge', requireUser, wrap(async (req, res) => {
  const { packageId, channel = 'mock' } = req.body || {}
  if (!packageId) return fail(res, '请选择充值套餐', 'BAD_REQUEST')
  const order = await createOrder({ userId: req.user.id, packageId, channel })
  // No real payment gateway is wired yet: the order is created and can be
  // fulfilled by an admin (or a payment callback) later.
  const row = await one("SELECT v FROM sys_settings WHERE k='pay_enabled'").catch(() => null)
  const payEnabled = String(row?.v ?? '0') === '1'
  ok(res, {
    orderId: order.orderId,
    id: order.orderId,
    amount: order.amount,
    points: order.points,
    channel,
    status: 'pending',
    payUrl: payEnabled ? order.payUrl || null : null,
    mock: !payEnabled,
    hint: payEnabled ? null : '未配置支付通道，订单已创建，请联系管理员确认到账'
  })
}))

router.get('/orders', requireUser, wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  ok(res, await listOrders(req.user.id, { page, size }))
}))

router.post('/redeem', requireUser, wrap(async (req, res) => {
  const code = String(req.body?.code || '').trim()
  if (!code) return fail(res, '请输入兑换码', 'BAD_REQUEST')
  const r = await redeem(req.user.id, code)
  ok(res, r)
}))

router.post('/signin', requireUser, wrap(async (req, res) => {
  const r = await signin(req.user.id)
  ok(res, r)
}))

export default router
