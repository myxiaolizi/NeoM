/**
 * billing — 积分与账单
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API, type PointLedgerItem } from '@/lib/contracts'
import { useStore } from '@/store'
import { Dialog } from '@/components/Overlays'
import { fmtDate, fmtNum, fmtPoints, pick, safeArr } from '@/features/marketing/portalKit'
import { EmptyBox, ErrorBox, Loading, Section } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

interface Package {
  id: string
  name: string
  price: number
  points: number
  bonus: number
  tag?: string
}

const KIND_META: Record<string, { label: string; icon: string }> = {
  ai: { label: 'AI 调用', icon: 'sparkles' },
  recharge: { label: '充值', icon: 'credit-card' },
  refund: { label: '退款', icon: 'undo' },
  'admin-adjust': { label: '管理调整', icon: 'sliders' },
  signin: { label: '每日签到', icon: 'calendar' },
  'register-gift': { label: '注册赠送', icon: 'star' },
  redeem: { label: '兑换码', icon: 'key' }
}

const normalizeLedger = (raw: any): PointLedgerItem => ({
  id: Number(pick(raw, ['id'], 0)),
  kind: (pick(raw, ['kind', 'type'], 'ai') as PointLedgerItem['kind']) || 'ai',
  points: Number(pick(raw, ['points', 'delta', 'amount'], 0)),
  balance_after: Number(pick(raw, ['balance_after', 'balance', 'balanceAfter'], 0)),
  model: pick(raw, ['model'], ''),
  prompt_tokens: Number(pick(raw, ['prompt_tokens'], 0)),
  cached_tokens: Number(pick(raw, ['cached_tokens'], 0)),
  completion_tokens: Number(pick(raw, ['completion_tokens'], 0)),
  audio_seconds: Number(pick(raw, ['audio_seconds'], 0)),
  note: pick(raw, ['note', 'remark', 'memo'], ''),
  created_at: String(pick(raw, ['created_at', 'createdAt'], ''))
})

const PAGE_SIZE = 20

const BillingPanel: React.FC<PanelProps> = ({ user, refreshUser }) => {
  const toast = useStore((s) => s.toast)

  const [points, setPoints] = useState<number>(Number(user?.points || 0))
  const [signinToday, setSigninToday] = useState(false)
  const [packages, setPackages] = useState<Package[]>([])
  const [pkgLoading, setPkgLoading] = useState(true)
  const [pkgErr, setPkgErr] = useState('')
  const [signing, setSigning] = useState(false)

  const [page, setPage] = useState(1)
  const [ledger, setLedger] = useState<PointLedgerItem[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [ledgerErr, setLedgerErr] = useState('')
  const [hasMore, setHasMore] = useState(false)

  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  const [payOrder, setPayOrder] = useState<{ orderId: string; payUrl?: string; pkg: Package } | null>(null)
  const [paying, setPaying] = useState<string | null>(null)

  const loadBalance = useCallback(() => {
    api
      .get<any>(API.pointsBalance)
      .then((raw) => {
        setPoints(Number(pick(raw, ['points', 'balance'], user?.points || 0)))
        setSigninToday(!!pick(raw, ['signinToday', 'signedToday', 'signed'], false))
      })
      .catch(() => {
        /* keep the cached value */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.points])

  const loadPackages = () => {
    setPkgLoading(true)
    setPkgErr('')
    api
      .get<any>(API.pointsPackages)
      .then((raw) => {
        const list = safeArr<any>(raw).map((p) => ({
          id: String(pick(p, ['id', 'package_id'], '')),
          name: String(pick(p, ['name', 'label', 'title'], '充值包')),
          price: Number(pick(p, ['price', 'amount'], 0)),
          points: Number(pick(p, ['points'], 0)),
          bonus: Number(pick(p, ['bonus'], 0)),
          tag: pick(p, ['tag'], '')
        }))
        setPackages(list.filter((p) => p.id))
      })
      .catch((e: any) => setPkgErr(e?.message || '充值套餐加载失败'))
      .finally(() => setPkgLoading(false))
  }

  const loadLedger = (nextPage = page) => {
    setLedgerLoading(true)
    setLedgerErr('')
    api
      .get<any>(API.pointsLedger + `?page=${nextPage}&limit=${PAGE_SIZE}`)
      .then((raw) => {
        const list = safeArr<any>(raw).map(normalizeLedger)
        setLedger(list)
        setHasMore(list.length >= PAGE_SIZE)
      })
      .catch((e: any) => setLedgerErr(e?.message || '账单明细加载失败'))
      .finally(() => setLedgerLoading(false))
  }

  useEffect(() => {
    loadBalance()
    loadPackages()
    loadLedger(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signin = async () => {
    setSigning(true)
    try {
      const raw = await api.post<any>(API.pointsSignin, {})
      const gained = Number(pick(raw, ['points', 'gained', 'amount'], 0))
      setSigninToday(true)
      setPoints((p) => p + gained)
      toast({ kind: 'ok', text: gained > 0 ? `签到成功，获得 ${fmtPoints(gained)} 积分` : '签到成功' })
      loadLedger(1)
      setPage(1)
      refreshUser()
    } catch (e: any) {
      const msg = String(e?.message || '签到失败')
      if (/已签到|already/i.test(msg)) setSigninToday(true)
      toast({ kind: /已签到|already/i.test(msg) ? 'info' : 'error', text: msg })
    } finally {
      setSigning(false)
    }
  }

  const redeem = async () => {
    const c = code.trim()
    if (!c) {
      toast({ kind: 'warn', text: '请输入兑换码' })
      return
    }
    setRedeeming(true)
    try {
      const raw = await api.post<any>(API.pointsRedeem, { code: c })
      const gained = Number(pick(raw, ['points', 'amount'], 0))
      setPoints((p) => p + gained)
      setCode('')
      toast({ kind: 'ok', text: `兑换成功，获得 ${fmtPoints(gained)} 积分` })
      loadLedger(1)
      setPage(1)
      refreshUser()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '兑换失败：兑换码无效、已使用或已过期' })
    } finally {
      setRedeeming(false)
    }
  }

  const recharge = async (pkg: Package) => {
    setPaying(pkg.id)
    try {
      const raw = await api.post<any>(API.pointsRecharge, { packageId: pkg.id, package_id: pkg.id, channel: 'manual' })
      const orderId = String(pick(raw, ['orderId', 'order_id', 'id'], '') || '')
      const payUrl = pick(raw, ['payUrl', 'pay_url'], '') as string | undefined
      setPayOrder({ orderId, payUrl, pkg })
      if (payUrl) window.open(payUrl, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '创建订单失败，请稍后重试' })
    } finally {
      setPaying(null)
    }
  }

  const totalPts = (p: Package) => p.points + p.bonus

  return (
    <>
      {/* ---------------------------------------------------- balance */}
      <div className="ac-balance-card">
        <div>
          <div className="tiny" style={{ opacity: 0.86, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 700 }}>
            当前积分余额
          </div>
          <div className="ac-balance-num">{fmtPoints(points)}</div>
          <div className="ac-balance-lbl">1 积分 ≈ ¥0.01 的 AI 调用额度 · 官方通道按模型价格扣减</div>
        </div>
        <div className="ac-balance-actions">
          <button className="p-btn solid" onClick={signin} disabled={signing || signinToday}>
            {signing ? <span className="spinner" /> : <Icon name="calendar" size={15} />}
            {signinToday ? '今日已签到' : '每日签到'}
          </button>
          <button className="p-btn" onClick={loadBalance}>
            <Icon name="refresh" size={15} /> 刷新余额
          </button>
        </div>
      </div>

      {/* --------------------------------------------------- packages */}
      <Section
        icon="credit-card"
        title="充值套餐"
        desc="充值后积分立即到账，长期有效。当前站点未接入在线支付时，将生成待支付订单并提供收款码。"
        actions={
          <button className="btn btn-sm" onClick={loadPackages} disabled={pkgLoading}>
            {pkgLoading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
          </button>
        }
      >
        {pkgLoading ? (
          <Loading text="正在加载充值套餐…" />
        ) : pkgErr ? (
          <ErrorBox message={pkgErr} onRetry={loadPackages} />
        ) : packages.length === 0 ? (
          <EmptyBox
            icon="credit-card"
            title="暂无可购买的充值套餐"
            desc="管理员在后台配置套餐后会显示在这里；你也可以直接使用兑换码充值。"
          />
        ) : (
          <div className="ac-packages">
            {packages.map((p) => (
              <div className="ac-package" key={p.id}>
                {p.tag && <span className="badge tag">{p.tag}</span>}
                <div className="p">
                  {fmtPoints(totalPts(p))}
                  <small> 积分</small>
                </div>
                <div className="pts">
                  ¥{p.price} · {fmtPoints(p.points)} 积分
                </div>
                {p.bonus > 0 && <div className="bonus">额外赠送 {fmtPoints(p.bonus)} 积分</div>}
                <button
                  className="btn btn-primary btn-sm btn-block"
                  onClick={() => recharge(p)}
                  disabled={paying === p.id}
                  style={{ marginTop: 4 }}
                >
                  {paying === p.id ? <span className="spinner" /> : <Icon name="coins" size={13} />} 立即充值
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 18, gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input mono"
            style={{ maxWidth: 260 }}
            placeholder="输入兑换码，如 NEOM-XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') redeem()
            }}
          />
          <button className="btn" onClick={redeem} disabled={redeeming || !code.trim()}>
            {redeeming ? <span className="spinner" /> : <Icon name="key" size={13} />} 兑换积分
          </button>
          <span className="tiny dim">兑换码不区分大小写，单次仅可使用一次</span>
        </div>
      </Section>

      {/* ----------------------------------------------------- ledger */}
      <Section
        icon="chart"
        title="账单明细"
        desc="包含 AI 调用消耗（Token / 音频）、充值、签到与管理调整，正负分色显示。"
        actions={
          <button
            className="btn btn-sm"
            onClick={() => loadLedger(page)}
            disabled={ledgerLoading}
          >
            {ledgerLoading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
          </button>
        }
      >
        {ledgerLoading ? (
          <Loading text="正在加载账单…" />
        ) : ledgerErr ? (
          <ErrorBox message={ledgerErr} onRetry={() => loadLedger(page)} />
        ) : ledger.length === 0 ? (
          <EmptyBox
            icon="chart"
            title="还没有账单记录"
            desc="使用 AI 或充值后，这里会逐条记录积分变动与余额。"
          />
        ) : (
          <>
            <div className="ac-ledger">
              {ledger.map((row) => {
                const meta = KIND_META[row.kind] || { label: row.kind, icon: 'coins' }
                const positive = row.points >= 0
                const detail: string[] = []
                if (row.model) detail.push(row.model)
                if (row.prompt_tokens || row.completion_tokens) {
                  detail.push(
                    `输入 ${fmtNum(row.prompt_tokens)}${row.cached_tokens ? ` (缓存 ${fmtNum(row.cached_tokens)})` : ''} · 输出 ${fmtNum(row.completion_tokens)} tokens`
                  )
                }
                if (row.audio_seconds) detail.push(`音频 ${Math.round(row.audio_seconds)}s`)
                if (row.note) detail.push(String(row.note))
                return (
                  <div className="ac-ledger-row" key={row.id}>
                    <div className="when">{fmtDate(row.created_at, true)}</div>
                    <div className="what">
                      <b>
                        <Icon name={meta.icon} size={11} /> {meta.label}
                      </b>
                      {detail.length > 0 && <div className="sub">{detail.join(' · ')}</div>}
                    </div>
                    <div className={'amt ' + (positive ? 'pos' : 'neg')}>
                      {positive ? '+' : ''}
                      {fmtPoints(row.points)}
                    </div>
                    <div className="bal">余额 {fmtPoints(row.balance_after)}</div>
                  </div>
                )
              })}
            </div>

            <div className="ac-pager">
              <span className="tiny dim">第 {page} 页</span>
              <button
                className="btn btn-sm"
                disabled={page <= 1 || ledgerLoading}
                onClick={() => {
                  const next = page - 1
                  setPage(next)
                  loadLedger(next)
                }}
              >
                <Icon name="chevron-left" size={12} /> 上一页
              </button>
              <button
                className="btn btn-sm"
                disabled={!hasMore || ledgerLoading}
                onClick={() => {
                  const next = page + 1
                  setPage(next)
                  loadLedger(next)
                }}
              >
                下一页 <Icon name="chevron-right" size={12} />
              </button>
            </div>
          </>
        )}
      </Section>

      {/* ----------------------------------------------------- pay dialog */}
      {payOrder && (
        <Dialog
          title="订单已创建"
          icon="credit-card"
          onClose={() => {
            setPayOrder(null)
            loadBalance()
          }}
          width={420}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setPayOrder(null)
                  loadBalance()
                  loadLedger(1)
                  setPage(1)
                }}
              >
                关闭
              </button>
              {payOrder.payUrl && (
                <a className="btn btn-primary" href={payOrder.payUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" size={13} /> 前往支付
                </a>
              )}
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            <div className="ac-kv">
              <span className="k">订单号</span>
              <span className="v mono">{payOrder.orderId || '（后端未返回）'}</span>
            </div>
            <div className="ac-kv">
              <span className="k">套餐</span>
              <span className="v">
                {payOrder.pkg.name} · {fmtPoints(totalPts(payOrder.pkg))} 积分
              </span>
            </div>
            <div className="ac-kv">
              <span className="k">应付金额</span>
              <span className="v">
                <b>¥{payOrder.pkg.price}</b>
              </span>
            </div>

            <div className="center" style={{ flexDirection: 'column', gap: 8, padding: '14px 0' }}>
              <div
                className="qr-box"
                style={{ width: 140, height: 140, display: 'grid', placeItems: 'center', gap: 6 }}
                title="收款二维码占位"
              >
                <div className="grid">
                  {Array.from({ length: 25 }).map((_, i) => (
                    <i key={i} />
                  ))}
                </div>
                <span style={{ fontSize: 10 }}>收款二维码占位</span>
              </div>
              <span className="tiny dim" style={{ textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
                {payOrder.payUrl
                  ? '已在新标签打开支付页面，完成支付后积分自动到账。'
                  : '当前站点尚未接入在线支付通道。请联系管理员并提供上方订单号完成支付，管理员确认后积分将手动入账。'}
              </span>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}

export default BillingPanel
