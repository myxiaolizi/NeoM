/**
 * Module 4 — 商业化计费、模型定价与支付财务管理
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  BarChart, DataTable, Drawer, Field, KV, Note, PageHeader, Section,
  StatCard, Tabs, Tag, Toolbar, callApi, cx, downloadCsv, fmtDateTime,
  fmtInt, fmtMoney, fmtNum, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList, seq } from '../data'
import { useAdmin } from '../AdminApp'

/* ------------------------------------------------------------------ types */
export interface PriceRow {
  id: string
  label: string
  category: string
  billing: 'token' | 'audio' | 'call' | 'free'
  priceCacheIn: number
  priceIn: number
  priceOut: number
  priceAudioHour: number
  priceCall: number
  freeUntil: string | null
  enabled: boolean
}

export interface OrderRow {
  id: number
  order_no: string
  username: string
  amount: number
  points: number
  channel: string
  status: string
  created_at: string
  paid_at: string | null
}

export interface RedeemRow {
  id: number
  code: string
  points: number
  batch: string | null
  status: string
  used_by: number | null
  used_at: string | null
  created_at: string
}

export interface PackageRow {
  id: string | number
  name: string
  price: number
  points: number
  bonus: number
}

export interface AiLogRow {
  id: number
  username?: string
  model: string
  scene: string
  prompt_tokens: number
  cached_tokens: number
  completion_tokens: number
  audio_seconds?: number
  points_cost: number
  latency_ms: number
  status: string
  created_at: string
}

/* -------------------------------------------------------------- demo data */
const DEMO_PRICES: PriceRow[] = [
  { id: 'mimo-v2.6-pro', label: 'MiMo v2.6 Pro', category: 'omni', billing: 'token', priceCacheIn: 0.025, priceIn: 3, priceOut: 6, priceAudioHour: 0, priceCall: 0, freeUntil: null, enabled: true },
  { id: 'mimo-v2.6-flash', label: 'MiMo v2.6 Flash', category: 'text', billing: 'token', priceCacheIn: 0.02, priceIn: 1, priceOut: 2, priceAudioHour: 0, priceCall: 0, freeUntil: null, enabled: true },
  { id: 'mimo-v2.6-pro-ultraspeed', label: 'MiMo v2.6 Pro UltraSpeed', category: 'text', billing: 'token', priceCacheIn: 0.025, priceIn: 3, priceOut: 6, priceAudioHour: 0, priceCall: 0, freeUntil: null, enabled: true },
  { id: 'mimo-v2.5-asr', label: 'MiMo v2.5 ASR', category: 'asr', billing: 'audio', priceCacheIn: 0, priceIn: 0, priceOut: 0, priceAudioHour: 0.5, priceCall: 0, freeUntil: null, enabled: true },
  { id: 'mimo-v2.5-tts', label: 'MiMo v2.5 TTS', category: 'tts', billing: 'free', priceCacheIn: 0, priceIn: 0, priceOut: 0, priceAudioHour: 0, priceCall: 0, freeUntil: null, enabled: true },
  { id: 'mimo-v2.5-tts-voicedesign', label: 'MiMo v2.5 TTS 音色设计', category: 'tts', billing: 'free', priceCacheIn: 0, priceIn: 0, priceOut: 0, priceAudioHour: 0, priceCall: 0, freeUntil: null, enabled: true },
  { id: 'mimo-v2.5-tts-voiceclone', label: 'MiMo v2.5 TTS 音色克隆', category: 'voiceclone', billing: 'call', priceCacheIn: 0, priceIn: 0, priceOut: 0, priceAudioHour: 0, priceCall: 0.2, freeUntil: null, enabled: true }
]

const DEMO_PACKAGES: PackageRow[] = [
  { id: 'p1', name: '入门包', price: 10, points: 1000, bonus: 0 },
  { id: 'p2', name: '标准包', price: 50, points: 5000, bonus: 200 },
  { id: 'p3', name: '专业包', price: 100, points: 10000, bonus: 1000 },
  { id: 'p4', name: '团队包', price: 500, points: 50000, bonus: 10000 }
]

const DEMO_ORDERS: OrderRow[] = seq(24, (i) => ({
  id: 1000 + i,
  order_no: `NM${202610000 + i}`,
  username: ['alice', 'bob', 'carol', 'dave'][i % 4],
  amount: [10, 50, 100, 500][i % 4],
  points: [1000, 5200, 11000, 60000][i % 4],
  channel: ['wechat', 'alipay', 'mock'][i % 3],
  status: i % 7 === 0 ? 'refunded' : 'paid',
  created_at: new Date(Date.now() - i * 3600_000 * 9).toISOString(),
  paid_at: new Date(Date.now() - i * 3600_000 * 9 + 60_000).toISOString()
}))

const DEMO_REDEEM: RedeemRow[] = seq(30, (i) => ({
  id: 2000 + i,
  code: `NM-${(0xabcdef + i * 7919).toString(36).toUpperCase().slice(0, 4)}-${(i * 13337).toString(36).toUpperCase().slice(0, 4)}`,
  points: [100, 500, 1000][i % 3],
  batch: `B2026${String((i % 3) + 1).padStart(2, '0')}`,
  status: i % 5 === 0 ? 'used' : i % 11 === 0 ? 'void' : 'unused',
  used_by: i % 5 === 0 ? 100 + i : null,
  used_at: i % 5 === 0 ? new Date(Date.now() - i * 7200_000).toISOString() : null,
  created_at: new Date(Date.now() - i * 86400_000).toISOString()
}))

const DEMO_LOGS: AiLogRow[] = seq(40, (i) => ({
  id: 3000 + i,
  username: ['admin', 'alice', 'bob'][i % 3],
  model: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.5-asr'][i % 3],
  scene: ['chat', 'naming', 'asr'][i % 3],
  prompt_tokens: 300 + ((i * 173) % 4200),
  cached_tokens: i % 4 === 0 ? 0 : Math.round((300 + ((i * 173) % 4200)) * 0.35),
  completion_tokens: 80 + ((i * 97) % 900),
  audio_seconds: i % 3 === 2 ? 60 + ((i * 31) % 600) : 0,
  points_cost: Number((0.01 + (i % 50) * 0.017).toFixed(2)),
  latency_ms: 320 + ((i * 211) % 3800),
  status: i % 19 === 0 ? 'error' : 'ok',
  created_at: new Date(Date.now() - i * 1800_000).toISOString()
}))

/* ------------------------------------------------------------------ module */
const Billing: React.FC = () => {
  const confirm = useConfirm()
  const [tab, setTab] = useState<'pricing' | 'points' | 'orders' | 'redeem' | 'logs'>('pricing')

  /* ---- pricing ---- */
  const modelsApi = useApiData<PriceRow[]>(
    async () => {
      const raw = await api.get('/api/admin/models')
      const list = asList<any>(raw)
      if (!list.length) throw new Error('empty')
      return list.map((m) => ({
        id: m.id,
        label: m.label || m.id,
        category: m.category || 'text',
        billing: m.billing || 'token',
        priceCacheIn: Number(m.priceCacheIn ?? 0),
        priceIn: Number(m.priceIn ?? 0),
        priceOut: Number(m.priceOut ?? 0),
        priceAudioHour: Number(m.priceAudioHour ?? 0),
        priceCall: Number(m.priceCall ?? 0),
        freeUntil: m.freeUntil ?? null,
        enabled: m.enabled !== false
      }))
    },
    DEMO_PRICES,
    []
  )

  const [draft, setDraft] = useState<Record<string, Partial<PriceRow>>>({})
  const rows = useMemo(
    () => modelsApi.data.map((r) => ({ ...r, ...(draft[r.id] || {}) })),
    [modelsApi.data, draft]
  )
  const dirty = Object.keys(draft).length

  const patch = (id: string, key: keyof PriceRow, val: unknown) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), [key]: val } }))

  const savePricing = async () => {
    const items = rows.map((r) => ({
      id: r.id, billing: r.billing,
      priceCacheIn: r.priceCacheIn, priceIn: r.priceIn, priceOut: r.priceOut,
      priceAudioHour: r.priceAudioHour, priceCall: r.priceCall, freeUntil: r.freeUntil
    }))
    const r = await callApi(
      () => api.post('/api/admin/pricing', { items }),
      `已保存 ${items.length} 个模型的定价`,
      '保存定价失败'
    )
    if (r.ok) setDraft({})
  }

  const priceColumns: Column<PriceRow>[] = [
    {
      key: 'id', title: '模型', width: 220,
      render: (r) => (
        <div>
          <div className="mono" style={{ fontWeight: 600 }}>{r.id}</div>
          <div className="dim tiny">{r.label}</div>
        </div>
      )
    },
    {
      key: 'category', title: '分类', width: 96,
      render: (r) => <Tag tone={r.category === 'asr' ? 'purple' : r.category === 'tts' ? 'ok' : 'accent'}>{r.category}</Tag>
    },
    {
      key: 'billing', title: '计费方式', width: 148,
      render: (r) => (
        <select className="input" style={{ height: 26, fontSize: 12 }} value={r.billing}
          onChange={(e) => patch(r.id, 'billing', e.target.value)}>
          <option value="token">按百万 Tokens</option>
          <option value="audio">按音频时长</option>
          <option value="call">按次</option>
          <option value="free">限时免费</option>
        </select>
      )
    },
    {
      key: 'priceCacheIn', title: '输入(命中缓存) ¥/1M', width: 150, align: 'right',
      render: (r) => r.billing !== 'token' ? <span className="dim">—</span> : (
        <input className="input num" style={{ height: 26, fontSize: 12, textAlign: 'right' }}
          value={r.priceCacheIn} onChange={(e) => patch(r.id, 'priceCacheIn', Number(e.target.value))} />
      )
    },
    {
      key: 'priceIn', title: '输入(未命中) ¥/1M', width: 140, align: 'right',
      render: (r) => r.billing !== 'token' ? <span className="dim">—</span> : (
        <input className="input num" style={{ height: 26, fontSize: 12, textAlign: 'right' }}
          value={r.priceIn} onChange={(e) => patch(r.id, 'priceIn', Number(e.target.value))} />
      )
    },
    {
      key: 'priceOut', title: '输出 ¥/1M', width: 110, align: 'right',
      render: (r) => r.billing !== 'token' ? <span className="dim">—</span> : (
        <input className="input num" style={{ height: 26, fontSize: 12, textAlign: 'right' }}
          value={r.priceOut} onChange={(e) => patch(r.id, 'priceOut', Number(e.target.value))} />
      )
    },
    {
      key: 'priceAudioHour', title: '音频 ¥/小时', width: 110, align: 'right',
      render: (r) => r.billing !== 'audio' ? <span className="dim">—</span> : (
        <input className="input num" style={{ height: 26, fontSize: 12, textAlign: 'right' }}
          value={r.priceAudioHour} onChange={(e) => patch(r.id, 'priceAudioHour', Number(e.target.value))} />
      )
    },
    {
      key: 'priceCall', title: '按次 ¥/次', width: 100, align: 'right',
      render: (r) => r.billing !== 'call' ? <span className="dim">—</span> : (
        <input className="input num" style={{ height: 26, fontSize: 12, textAlign: 'right' }}
          value={r.priceCall} onChange={(e) => patch(r.id, 'priceCall', Number(e.target.value))} />
      )
    },
    {
      key: 'enabled', title: '状态', width: 90,
      render: (r) => (r.billing === 'free' ? <Tag tone="ok" dot>限时免费</Tag> : <Tag tone="accent" dot>计费中</Tag>)
    }
  ]

  /* ---- packages ---- */
  const [packages, setPackages] = useState<PackageRow[]>(DEMO_PACKAGES)
  const pointsApi = useApiData<{ perCny: number; signin: number; gift: number }>(
    async () => {
      const cfg = await api.get('/api/admin/site')
      const sys = (cfg as any)?.sys || {}
      try {
        const list = asList<PackageRow>(await api.get('/api/billing/packages'))
        if (list.length) setPackages(list)
      } catch { /* keep demo packages */ }
      return {
        perCny: Number(sys.point_per_cny ?? 100),
        signin: Number(sys.signin_points ?? 100),
        gift: Number(sys.register_gift_points ?? 100)
      }
    },
    { perCny: 100, signin: 100, gift: 100 },
    []
  )

  /* ---- orders ---- */
  const ordersApi = useApiData<OrderRow[]>(
    async () => {
      const list = asList<any>(await api.get('/api/admin/orders?size=100'))
      if (!list.length) throw new Error('empty')
      return list.map((o) => ({
        id: o.id, order_no: o.order_no, username: o.username || '—',
        amount: Number(o.amount ?? 0), points: Number(o.points ?? 0),
        channel: o.channel || 'mock', status: o.status || 'pending',
        created_at: o.created_at, paid_at: o.paid_at
      }))
    },
    DEMO_ORDERS,
    []
  )

  /* ---- redeem ---- */
  const redeemApi = useApiData<RedeemRow[]>(
    async () => {
      const list = asList<any>(await api.get('/api/admin/redeem?size=200'))
      if (!list.length) throw new Error('empty')
      return list.map((r) => ({
        id: r.id, code: r.code, points: Number(r.points ?? 0), batch: r.batch,
        status: r.status || 'unused', used_by: r.used_by, used_at: r.used_at, created_at: r.created_at
      }))
    },
    DEMO_REDEEM,
    []
  )

  const [genForm, setGenForm] = useState({ count: 50, points: 500, batch: '' })
  const generate = async () => {
    const r = await callApi(
      () => api.post('/api/admin/redeem', genForm),
      `已生成 ${genForm.count} 个卡密`,
      '生成卡密失败'
    )
    if (r.ok) redeemApi.reload()
  }

  /* ---- ai logs ---- */
  const logsApi = useApiData<AiLogRow[]>(
    async () => {
      const list = asList<any>(await api.get('/api/admin/ai-logs?size=100'))
      if (!list.length) throw new Error('empty')
      return list.map((l) => ({
        id: l.id, username: l.username, model: l.model, scene: l.scene || 'chat',
        prompt_tokens: Number(l.prompt_tokens ?? 0),
        cached_tokens: Number(l.cached_tokens ?? 0),
        completion_tokens: Number(l.completion_tokens ?? 0),
        audio_seconds: Number(l.audio_seconds ?? 0),
        points_cost: Number(l.points_cost ?? 0),
        latency_ms: Number(l.latency_ms ?? 0),
        status: l.status || 'ok',
        created_at: l.created_at
      }))
    },
    DEMO_LOGS,
    []
  )

  const totalPoints = useMemo(() => ordersApi.data.reduce((s, o) => (o.status === 'paid' ? s + o.points : s), 0), [ordersApi.data])
  const totalAmount = useMemo(() => ordersApi.data.reduce((s, o) => (o.status === 'paid' ? s + o.amount : s), 0), [ordersApi.data])
  const logTokens = useMemo(() => logsApi.data.reduce((s, l) => s + l.prompt_tokens + l.completion_tokens, 0), [logsApi.data])

  return (
    <>
      <PageHeader
        icon="credit-card"
        title="商业化计费与财务"
        desc="模型定价（缓存/未命中/输出分离）、积分兑换、充值套餐、支付通道、卡密与 AI 审计"
        demo={modelsApi.demo}
        reload={() => { modelsApi.reload(); ordersApi.reload(); redeemApi.reload(); logsApi.reload() }}
        loading={modelsApi.loading}
      />

      <div className="adm-stat-grid">
        <StatCard label="累计充值金额" value={fmtMoney(totalAmount)} unit="元" icon="coins" />
        <StatCard label="累计发放积分" value={fmtInt(totalPoints)} icon="credit-card" />
        <StatCard label="AI 消耗 Tokens（样本）" value={fmtInt(logTokens)} icon="cpu" />
        <StatCard label="卡密未使用" value={fmtInt(redeemApi.data.filter((r) => r.status === 'unused').length)} icon="key" />
      </div>

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { id: 'pricing', label: '模型定价' },
          { id: 'points', label: '积分与套餐' },
          { id: 'orders', label: '充值订单' },
          { id: 'redeem', label: '卡密管理' },
          { id: 'logs', label: 'AI 审计日志' }
        ]}
      />

      {tab === 'pricing' && (
        <Section
          title="精细化模型定价"
          sub="按百万 Tokens 差异化定价，缓存命中与未命中分别计价"
          icon="sliders"
          flush
          actions={
            <>
              {dirty > 0 && <Tag tone="warn">未保存 {dirty} 项</Tag>}
              <button className="btn btn-primary btn-sm" onClick={savePricing} disabled={!dirty}>
                <Icon name="save" size={13} /> 保存全部
              </button>
            </>
          }
        >
          <DataTable
            columns={priceColumns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={modelsApi.loading}
            hideSearch
            noPager
            dense
          />
          <div style={{ padding: 12 }}>
            <Note tone="info">
              当前兑换比例：<b>1 元 = {pointsApi.data.perCny} 积分</b>；注册赠送 <b>{pointsApi.data.gift}</b> 积分；
              每日签到 <b>{pointsApi.data.signin}</b> 积分。计费公式：缓存输入 × 命中单价 + (输入−缓存) × 未命中单价 + 输出 × 输出单价。
            </Note>
          </div>
        </Section>
      )}

      {tab === 'points' && (
        <>
          <Section title="充值套餐" icon="coins" sub="档位与赠送比例" actions={
            <button className="btn btn-sm" onClick={() => setPackages([...packages, { id: 'p' + Date.now(), name: '新套餐', price: 0, points: 0, bonus: 0 }])}>
              <Icon name="plus" size={13} /> 新增档位
            </button>
          }>
            <div className="adm-pkg-grid">
              {packages.map((p, i) => (
                <div className="adm-pkg" key={p.id}>
                  <input className="input" value={p.name}
                    onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <label className="tiny dim">售价（元）</label>
                  <input className="input num" type="number" value={p.price}
                    onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} />
                  <label className="tiny dim">积分</label>
                  <input className="input num" type="number" value={p.points}
                    onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} />
                  <label className="tiny dim">赠送积分</label>
                  <input className="input num" type="number" value={p.bonus}
                    onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, bonus: Number(e.target.value) } : x)))} />
                  <button className="btn btn-ghost btn-sm" onClick={() => setPackages(packages.filter((_, j) => j !== i))}>
                    <Icon name="trash" size={12} /> 删除
                  </button>
                </div>
              ))}
            </div>
          </Section>

          <Section title="支付通道" icon="credit-card">
            <div className="adm-grid-2">
              {[
                { id: 'wechat', name: '微信支付', icon: 'credit-card' },
                { id: 'alipay', name: '支付宝', icon: 'credit-card' },
                { id: 'epay', name: '易支付', icon: 'globe' },
                { id: 'stripe', name: 'Stripe', icon: 'globe' }
              ].map((c) => (
                <div className="adm-channel-card" key={c.id}>
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                    <Icon name={c.icon} size={15} />
                    <b>{c.name}</b>
                    <Tag tone="default">未启用</Tag>
                  </div>
                  <div className="dim tiny">AppID / MchID / 密钥 / 回调地址配置位于站点设置，启用后生效。</div>
                </div>
              ))}
            </div>
            <Note tone="warn" style={{ marginTop: 12 }}>
              当前未接入真实支付通道：用户下单后订单状态为「待支付」，需管理员在「充值订单」中手动确认到账（或对接支付回调）。
            </Note>
          </Section>
        </>
      )}

      {tab === 'orders' && (
        <Section title="充值订单" icon="credit-card" flush actions={
          <button className="btn btn-ghost btn-sm" onClick={() =>
            downloadCsv('orders.csv', [['订单号', '用户', '金额', '积分', '通道', '状态', '创建时间'],
              ...ordersApi.data.map((o) => [o.order_no, o.username, o.amount, o.points, o.channel, o.status, o.created_at])])}>
            <Icon name="download" size={13} /> 导出
          </button>
        }>
          <DataTable
            columns={[
              { key: 'order_no', title: '订单号', render: (o) => <span className="mono tiny">{o.order_no}</span> },
              { key: 'username', title: '用户' },
              { key: 'amount', title: '金额', align: 'right', render: (o) => fmtMoney(o.amount) },
              { key: 'points', title: '积分', align: 'right', render: (o) => fmtInt(o.points) },
              { key: 'channel', title: '通道', render: (o) => <Tag tone="default">{o.channel}</Tag> },
              {
                key: 'status', title: '状态',
                render: (o) => <Tag tone={o.status === 'paid' ? 'ok' : o.status === 'refunded' ? 'danger' : 'warn'} dot>{o.status}</Tag>
              },
              { key: 'created_at', title: '创建时间', render: (o) => <span className="tiny dim">{fmtDateTime(o.created_at)}</span> }
            ] as Column<OrderRow>[]}
            rows={ordersApi.data}
            rowKey={(o) => String(o.id)}
            loading={ordersApi.loading}
          />
        </Section>
      )}

      {tab === 'redeem' && (
        <>
          <Section title="批量生成卡密" icon="key">
            <div className="adm-grid-3">
              <Field label="生成数量">
                <input className="input num" type="number" value={genForm.count}
                  onChange={(e) => setGenForm({ ...genForm, count: Number(e.target.value) })} />
              </Field>
              <Field label="每张积分">
                <input className="input num" type="number" value={genForm.points}
                  onChange={(e) => setGenForm({ ...genForm, points: Number(e.target.value) })} />
              </Field>
              <Field label="批次备注">
                <input className="input" value={genForm.batch} placeholder="如 B202610"
                  onChange={(e) => setGenForm({ ...genForm, batch: e.target.value })} />
              </Field>
            </div>
            <button className="btn btn-primary" onClick={generate}>
              <Icon name="plus" size={14} /> 生成卡密
            </button>
          </Section>

          <Section title="卡密列表" icon="key" flush actions={
            <button className="btn btn-ghost btn-sm" onClick={() =>
              downloadCsv('redeem-codes.csv', [['卡密', '积分', '批次', '状态', '使用人', '使用时间'],
                ...redeemApi.data.map((r) => [r.code, r.points, r.batch || '', r.status, r.used_by || '', r.used_at || ''])])}>
              <Icon name="download" size={13} /> 导出 CSV
            </button>
          }>
            <DataTable
              columns={[
                { key: 'code', title: '卡密', render: (r) => <span className="mono">{r.code}</span> },
                { key: 'points', title: '积分', align: 'right', render: (r) => fmtInt(r.points) },
                { key: 'batch', title: '批次', render: (r) => <span className="dim tiny">{r.batch || '—'}</span> },
                {
                  key: 'status', title: '状态',
                  render: (r) => <Tag tone={r.status === 'unused' ? 'ok' : r.status === 'used' ? 'default' : 'danger'} dot>{r.status}</Tag>
                },
                { key: 'used_by', title: '使用人', render: (r) => r.used_by ? `#${r.used_by}` : <span className="dim">—</span> },
                { key: 'used_at', title: '使用时间', render: (r) => <span className="tiny dim">{r.used_at ? fmtDateTime(r.used_at) : '—'}</span> }
              ] as Column<RedeemRow>[]}
              rows={redeemApi.data}
              rowKey={(r) => String(r.id)}
              loading={redeemApi.loading}
            />
          </Section>
        </>
      )}

      {tab === 'logs' && (
        <Section title="AI 调用审计日志" icon="chart" sub="每笔请求的模型、Token、缓存命中与扣费" flush>
          <DataTable
            columns={[
              { key: 'created_at', title: '时间', width: 150, render: (l) => <span className="tiny dim">{fmtDateTime(l.created_at)}</span> },
              { key: 'username', title: '用户', width: 90, render: (l) => l.username || '—' },
              { key: 'model', title: '模型', width: 200, render: (l) => <span className="mono tiny">{l.model}</span> },
              { key: 'scene', title: '场景', width: 80, render: (l) => <Tag tone="default">{l.scene}</Tag> },
              { key: 'prompt_tokens', title: '输入', align: 'right', width: 90, render: (l) => fmtInt(l.prompt_tokens) },
              { key: 'cached_tokens', title: '缓存命中', align: 'right', width: 96, render: (l) => fmtInt(l.cached_tokens) },
              { key: 'completion_tokens', title: '输出', align: 'right', width: 90, render: (l) => fmtInt(l.completion_tokens) },
              { key: 'points_cost', title: '扣费', align: 'right', width: 80, render: (l) => fmtNum(l.points_cost) },
              { key: 'latency_ms', title: '耗时', align: 'right', width: 84, render: (l) => `${l.latency_ms}ms` },
              {
                key: 'status', title: '状态', width: 76,
                render: (l) => <Tag tone={l.status === 'ok' ? 'ok' : 'danger'} dot>{l.status}</Tag>
              }
            ] as Column<AiLogRow>[]}
            rows={logsApi.data}
            rowKey={(l) => String(l.id)}
            loading={logsApi.loading}
          />
        </Section>
      )}

      {confirm.node}
    </>
  )
}

export default Billing
