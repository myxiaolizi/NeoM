/**
 * Module 1 — 数据驾驶舱 (dashboard)
 * 8 KPI cards, AI token breakdown by model, storage, server health, 14-day trends.
 */
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  BarList, DataTable, DemoBadge, DonutChart, KV, LineChart, PageHeader, Progress, Section, StatCard,
  Tag, fmtBytes, fmtInt, fmtMoney, fmtPct, fmtTimeAgo, cx, type Column
} from '../components'
import { lastDays, rndInt, series, seq } from '../data'
import { useAdmin } from '../AdminApp'

/* ------------------------------------------------------------------ types */
interface ModelUsage {
  model: string
  label: string
  category: string
  requests: number
  tokens_in: number
  tokens_cached: number
  tokens_out: number
  hit_rate: number
  points: number
}
interface DashData {
  stats: {
    today_register: number; total_users: number; dau: number; mau: number
    total_docs: number; total_shares: number
    today_recharge: number; total_recharge: number
  }
  deltas: Record<string, number>
  ai: { today_tokens: number; total_tokens: number; today_points: number; total_points: number; by_model: ModelUsage[] }
  storage: { total_bytes: number; quota_bytes: number; trend: number[]; top_users: { username: string; bytes: number; images: number; backups: number }[] }
  health: { cpu: number; mem: number; disk: number; load: [number, number, number]; uptime_hours: number; os?: string }
  trends: { dates: string[]; register: number[]; active: number[]; recharge: number[]; tokens: number[] }
}

/* ------------------------------------------------------------- demo data */
const DAYS = 14
const demoModelRows = (): ModelUsage[] => {
  const rows: [string, string, string, number, number, number, number][] = [
    ['mimo-v2.6-pro', 'MiMo V2.6 Pro', 'text', 4820, 12_400_000, 8_930_000, 3_120_000],
    ['mimo-v2.6-flash', 'MiMo V2.6 Flash', 'text', 18_640, 31_800_000, 22_100_000, 8_460_000],
    ['mimo-v2.6-pro-ultraspeed', 'MiMo V2.6 Pro UltraSpeed', 'reasoning', 1260, 4_920_000, 3_180_000, 1_640_000],
    ['mimo-omni-1', 'MiMo Omni 1', 'omni', 860, 2_140_000, 1_360_000, 780_000],
    ['mimo-asr-1', 'MiMo ASR 1', 'asr', 320, 0, 0, 0],
    ['mimo-tts-1', 'MiMo TTS 1', 'tts', 640, 0, 0, 0],
    ['mimo-tts-voicedesign', 'MiMo TTS VoiceDesign', 'tts', 92, 0, 0, 0],
    ['mimo-tts-voiceclone', 'MiMo TTS VoiceClone', 'tts', 48, 0, 0, 0]
  ]
  const price: Record<string, [number, number, number]> = {
    pro: [3, 0.025, 6],
    flash: [1, 0.02, 2],
    ultraspeed: [3, 0.025, 6],
    omni: [1.5, 0.02, 3],
    asr: [0, 0, 0],
    tts: [0, 0, 0]
  }
  return rows.map(([model, label, category, requests, ti, tc, to]) => {
    const key = model.includes('ultraspeed') ? 'ultraspeed' : model.includes('flash') ? 'flash' : model.includes('omni') ? 'omni' : model.includes('asr') ? 'asr' : model.includes('tts') ? 'tts' : 'pro'
    const [pIn, pCache, pOut] = price[key]
    const points = Math.round(((tc * pCache + (ti - tc) * pIn + to * pOut) / 1_000_000) * 100) / 100
    return {
      model, label, category, requests, tokens_in: ti, tokens_cached: tc, tokens_out: to,
      hit_rate: ti > 0 ? (tc / ti) * 100 : 0,
      points
    }
  })
}

const DEMO: DashData = (() => {
  const dates = lastDays(DAYS)
  const register = series(DAYS, 34, 46, 3)
  const active = series(DAYS, 420, 260, 11)
  const recharge = series(DAYS, 320, 780, 21)
  const tokens = series(DAYS, 4_200_000, 3_600_000, 31)
  return {
    stats: {
      today_register: register[DAYS - 1],
      total_users: 12_486,
      dau: active[DAYS - 1],
      mau: 8_742,
      total_docs: 386_412,
      total_shares: 24_186,
      today_recharge: recharge[DAYS - 1],
      total_recharge: 486_920
    },
    deltas: { today_register: 12.4, total_users: 3.1, dau: 6.8, mau: 2.4, total_docs: 4.2, total_shares: -1.6, today_recharge: 18.2, total_recharge: 5.7 },
    ai: {
      today_tokens: 7_640_000,
      total_tokens: 486_200_000,
      today_points: 1864.42,
      total_points: 128_460.8,
      by_model: demoModelRows()
    },
    storage: {
      total_bytes: 486_243_301_376,
      quota_bytes: 1_099_511_627_776,
      trend: series(DAYS, 380, 110, 41).map((v) => v * 1_073_741_824),
      top_users: [
        { username: 'zhengl', bytes: 48_318_382_080, images: 12_840, backups: 86 },
        { username: 'lixiaoming', bytes: 36_507_297_792, images: 9_120, backups: 64 },
        { username: 'wangfang', bytes: 29_982_638_080, images: 7_460, backups: 52 },
        { username: 'chenyu', bytes: 21_474_836_480, images: 5_880, backups: 41 },
        { username: 'zhaolei', bytes: 18_253_611_008, images: 4_210, backups: 33 },
        { username: 'sunqi', bytes: 15_032_385_536, images: 3_640, backups: 28 },
        { username: 'zhoujie', bytes: 11_811_160_064, images: 2_980, backups: 21 },
        { username: 'wuhao', bytes: 9_663_676_416, images: 2_140, backups: 17 },
        { username: 'xuting', bytes: 7_516_192_768, images: 1_760, backups: 12 },
        { username: 'hanmei', bytes: 5_368_709_120, images: 1_240, backups: 9 }
      ]
    },
    health: {
      cpu: 34, mem: 62, disk: 78,
      load: [1.24, 1.06, 0.92],
      uptime_hours: 1284,
      os: 'Ubuntu 22.04 LTS · 8 vCPU / 16 GB'
    },
    trends: { dates, register, active, recharge, tokens }
  }
})()

/* --------------------------------------------------------------- module */
type TrendKey = 'register' | 'active' | 'recharge' | 'tokens'

export default function Dashboard() {
  const navigate = useNavigate()
  const { demo: sessionDemo, bootstrap } = useAdmin()
  const [data, setData] = useState<DashData>(DEMO)
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [trend, setTrend] = useState<TrendKey>('register')
  const [tick, setTick] = useState(0)

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const raw: any = await api.get<any>('/api/admin/dashboard')
        if (!alive) return
        // The API speaks camelCase (`usersTotal`), this view uses snake_case
        // (`total_users`). Normalise instead of blind-spreading DEMO, otherwise
        // every real number would be shadowed by the demo baseline.
        const s = raw?.stats || {}
        const t = raw?.trend || {}
        const modelRows = Array.isArray(raw?.models) ? raw.models : []

        const merged: DashData = {
          ...DEMO,
          stats: {
            ...DEMO.stats,
            today_register: s.usersToday ?? DEMO.stats.today_register,
            total_users: s.usersTotal ?? DEMO.stats.total_users,
            dau: s.dau ?? DEMO.stats.dau,
            mau: s.mau ?? DEMO.stats.mau,
            total_docs: s.docsTotal ?? DEMO.stats.total_docs,
            total_shares: (s.sharesTotal ?? 0) + (s.publishTotal ?? 0) || DEMO.stats.total_shares,
            today_recharge: s.rechargeToday ?? DEMO.stats.today_recharge,
            total_recharge: s.rechargeTotal ?? DEMO.stats.total_recharge
          },
          // Deltas need historical comparison the API does not return yet.
          deltas: { ...DEMO.deltas },
          ai: {
            ...DEMO.ai,
            today_tokens: s.aiTokensToday ?? DEMO.ai.today_tokens,
            total_tokens: s.aiTokensTotal ?? DEMO.ai.total_tokens,
            by_model: modelRows.length
              ? modelRows.map((m: any) => ({
                  model: m.model || '—',
                  label: m.model || '—',
                  category: /asr/i.test(m.model) ? 'asr' : /tts/i.test(m.model) ? 'tts' : /pro|omni/i.test(m.model) ? 'omni' : 'text',
                  requests: Number(m.calls || 0),
                  tokens_in: Number(m.promptTokens || 0),
                  tokens_cached: Number(m.cachedTokens || 0),
                  tokens_out: Number(m.completionTokens || 0),
                  points: Number(m.points || 0)
                }))
              : DEMO.ai.by_model
          },
          storage: {
            ...DEMO.storage,
            total_bytes: s.ossBytes ?? DEMO.storage.total_bytes
          },
          health: {
            ...DEMO.health,
            ...(raw?.health || {})
          },
          trends: {
            ...DEMO.trends,
            dates: Array.isArray(t.dates) && t.dates.length ? t.dates : DEMO.trends.dates,
            register: Array.isArray(t.signups) && t.signups.length ? t.signups : DEMO.trends.register,
            active: Array.isArray(t.active) && t.active.length ? t.active : DEMO.trends.active,
            recharge: Array.isArray(t.recharge) && t.recharge.length ? t.recharge : DEMO.trends.recharge,
            tokens: Array.isArray(t.tokens) && t.tokens.length ? t.tokens : DEMO.trends.tokens
          }
        }
        setData(merged)
        setDemo(false)
        setErr(null)
      } catch (e) {
        if (!alive) return
        setData(DEMO)
        setDemo(true)
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [tick])

  const reload = () => setTick((t) => t + 1)

  const cacheHit = useMemo(() => {
    const ti = data.ai.by_model.reduce((a, b) => a + b.tokens_in, 0)
    const tc = data.ai.by_model.reduce((a, b) => a + b.tokens_cached, 0)
    return ti > 0 ? (tc / ti) * 100 : 0
  }, [data.ai.by_model])

  const catSegments = useMemo(() => {
    const map = new Map<string, number>()
    data.ai.by_model.forEach((m) => map.set(m.category, (map.get(m.category) || 0) + m.tokens_in + m.tokens_out))
    const palette: Record<string, string> = {
      text: 'var(--accent)', reasoning: '#6f5bf0', omni: '#0e7490', asr: 'var(--warn)', tts: 'var(--ok)', voiceclone: '#b44df0'
    }
    const names: Record<string, string> = { text: '文本生成', reasoning: '深度思考', omni: '全模态', asr: 'ASR', tts: 'TTS', voiceclone: '音色克隆' }
    return Array.from(map.entries())
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: names[k] || k, value: v, color: palette[k] || 'var(--text-3)' }))
  }, [data.ai.by_model])

  const trendSeries = useMemo(() => {
    const t = data.trends
    const map: Record<TrendKey, { name: string; color: string; data: number[] }> = {
      register: { name: '注册', color: 'var(--accent)', data: t.register },
      active: { name: '活跃(DAU)', color: 'var(--ok)', data: t.active },
      recharge: { name: '充值(¥)', color: 'var(--warn)', data: t.recharge },
      tokens: { name: 'Token', color: '#6f5bf0', data: t.tokens }
    }
    return [map[trend]]
  }, [data.trends, trend])

  const modelCols: Column<ModelUsage>[] = [
    {
      key: 'label', title: '模型', sortable: true, value: (r) => r.label,
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }} className="ellipsis">{r.label}</div>
          <div className="tiny dim mono">{r.model}</div>
        </div>
      )
    },
    {
      key: 'category', title: '分类', width: 96,
      render: (r) => <Tag tone={r.category === 'text' ? 'accent' : r.category === 'reasoning' ? 'purple' : 'default'}>
        {{ text: '文本', reasoning: '深度思考', omni: '全模态', asr: 'ASR', tts: 'TTS', voiceclone: '音色克隆' }[r.category] || r.category}
      </Tag>
    },
    { key: 'requests', title: '请求数', align: 'right', sortable: true, render: (r) => fmtInt(r.requests) },
    { key: 'tokens_in', title: '输入 Token', align: 'right', sortable: true, render: (r) => (r.tokens_in ? fmtInt(r.tokens_in) : '—') },
    { key: 'tokens_cached', title: '缓存命中', align: 'right', sortable: true, render: (r) => (r.tokens_cached ? fmtInt(r.tokens_cached) : '—') },
    { key: 'tokens_out', title: '输出 Token', align: 'right', sortable: true, render: (r) => (r.tokens_out ? fmtInt(r.tokens_out) : '—') },
    {
      key: 'hit_rate', title: '命中率', align: 'right', sortable: true, width: 96,
      render: (r) => r.tokens_in > 0
        ? <span style={{ color: r.hit_rate > 65 ? 'var(--ok)' : r.hit_rate > 40 ? 'var(--warn)' : 'var(--text-2)', fontWeight: 650 }}>{fmtPct(r.hit_rate)}</span>
        : <span className="dim">—</span>
    },
    { key: 'points', title: '扣费积分', align: 'right', sortable: true, render: (r) => (r.points ? fmtInt(r.points) : <span className="dim">免费</span>) }
  ]

  const health = data.health
  const upDays = Math.floor(health.uptime_hours / 24)
  const upHours = health.uptime_hours % 24

  return (
    <>
      <PageHeader
        icon="chart"
        title="数据驾驶舱"
        desc="全站运营、AI 用量、存储与服务器健康的统一视图。所有数值按 UTC+8 自然日统计。"
        demo={demo || sessionDemo}
        reload={reload}
        loading={loading}
        actions={
          <>
            <button className="btn" onClick={() => navigate('security')}><Icon name="shield" size={14} /> 运维面板</button>
            <button className="btn btn-primary" onClick={() => navigate('billing')}><Icon name="credit-card" size={14} /> 计费配置</button>
          </>
        }
      />

      {err && (
        <div className="adm-note warn" style={{ marginBottom: 14 }}>
          <b>后端接口未就绪</b>：<span className="mono">{err}</span> — 当前展示内置演示数据，接入 <span className="mono">GET /api/admin/dashboard</span> 后自动切换为真实数据。
        </div>
      )}

      {/* ------------------------------------------------ KPI cards */}
      <div className="adm-stat-grid">
        <StatCard label="今日注册" value={fmtInt(data.stats.today_register)} icon="user" delta={data.deltas.today_register} />
        <StatCard label="累计注册" value={fmtInt(data.stats.total_users)} icon="users" delta={data.deltas.total_users} deltaSuffix="较昨日" />
        <StatCard label="DAU" value={fmtInt(data.stats.dau)} icon="chart" delta={data.deltas.dau} tone="ok" />
        <StatCard label="MAU" value={fmtInt(data.stats.mau)} icon="chart" delta={data.deltas.mau} tone="ok" />
        <StatCard label="全站文档总数" value={fmtInt(data.stats.total_docs)} icon="file-text" delta={data.deltas.total_docs} />
        <StatCard label="分享发布总数" value={fmtInt(data.stats.total_shares)} icon="share" delta={data.deltas.total_shares} />
        <StatCard label="今日充值金额" value={fmtMoney(data.stats.today_recharge, 0)} icon="coins" delta={data.deltas.today_recharge} tone="warn" />
        <StatCard label="累计充值金额" value={fmtMoney(data.stats.total_recharge, 0)} icon="credit-card" delta={data.deltas.total_recharge} tone="warn" />
      </div>

      {/* ------------------------------------------------ trends */}
      <Section
        title="趋势图"
        sub={`近 ${DAYS} 天`}
        icon="chart"
        actions={
          <div className="adm-seg">
            {([['register', '注册'], ['active', '活跃'], ['recharge', '充值'], ['tokens', 'Token']] as [TrendKey, string][]).map(([k, l]) => (
              <button key={k} className={cx(trend === k && 'active')} onClick={() => setTrend(k)}>{l}</button>
            ))}
          </div>
        }
      >
        <LineChart
          series={trendSeries}
          labels={data.trends.dates}
          height={220}
          area
          valueFmt={(v) => (trend === 'recharge' ? '¥' + fmtInt(v) : fmtInt(v))}
        />
      </Section>

      {/* ------------------------------------------------ AI usage */}
      <div className="adm-split" style={{ marginBottom: 16 }}>
        <Section
          title="AI 用量 · 按模型分组"
          sub="今日 / 累计"
          icon="robot"
          flush
          actions={<button className="btn btn-sm" onClick={() => navigate('ai')}>渠道池 <Icon name="chevron-right" size={12} /></button>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {[
              { l: '今日 Token 消耗', v: fmtInt(data.ai.today_tokens), s: 'tokens' },
              { l: '累计 Token 消耗', v: fmtInt(data.ai.total_tokens), s: 'tokens' },
              { l: '今日扣费积分', v: fmtInt(data.ai.today_points), s: 'points' },
              { l: '累计扣费积分', v: fmtInt(data.ai.total_points), s: 'points' }
            ].map((b, i) => (
              <div key={b.l} style={{ padding: '11px 14px', borderLeft: i ? '1px solid var(--border)' : undefined }}>
                <div className="tiny dim">{b.l}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{b.v}</div>
              </div>
            ))}
          </div>
          <DataTable
            columns={modelCols}
            rows={data.ai.by_model}
            rowKey={(r) => r.model}
            pageSize={8}
            hideSearch
            loading={loading && data.ai.by_model.length === 0}
            emptyText="暂无 AI 调用记录"
            footerNote="输入=含缓存命中的全部输入 token"
          />
        </Section>

        <div className="col" style={{ gap: 14 }}>
          <Section title="缓存命中率" icon="layers">
            <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <DonutChart value={cacheHit} max={100} label={fmtPct(cacheHit)} sublabel="cached / input" size={126} thickness={13} />
              <div className="col grow" style={{ gap: 7, minWidth: 130 }}>
                <div className="adm-row-between small">
                  <span className="muted">输入总量</span><b>{fmtInt(data.ai.by_model.reduce((a, b) => a + b.tokens_in, 0))}</b>
                </div>
                <div className="adm-row-between small">
                  <span className="muted">缓存命中</span>
                  <b style={{ color: 'var(--ok)' }}>{fmtInt(data.ai.by_model.reduce((a, b) => a + b.tokens_cached, 0))}</b>
                </div>
                <div className="adm-row-between small">
                  <span className="muted">未命中</span>
                  <b>{fmtInt(data.ai.by_model.reduce((a, b) => a + b.tokens_in - b.tokens_cached, 0))}</b>
                </div>
                <div className="divider" style={{ margin: '3px 0' }} />
                <div className="tiny dim" style={{ lineHeight: 1.6 }}>
                  命中缓存按 ¥0.02–0.025/1M 计费，显著低于未命中输入。
                </div>
              </div>
            </div>
          </Section>
          <Section title="Token 分类占比" icon="grid">
            <DonutChart
              value={0}
              max={1}
              size={120}
              thickness={13}
              label={fmtInt(catSegments.reduce((a, b) => a + b.value, 0))}
              sublabel="total tokens"
              segments={catSegments}
            />
          </Section>
        </div>
      </div>

      {/* ------------------------------------------------ storage */}
      <div className="adm-split" style={{ marginBottom: 16 }}>
        <Section
          title="公共 OSS 占用"
          sub={`近 ${DAYS} 天趋势`}
          icon="cloud"
          actions={<button className="btn btn-sm" onClick={() => navigate('oss')}>浏览目录 <Icon name="chevron-right" size={12} /></button>}
        >
          <div className="row" style={{ gap: 20, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <div className="tiny dim">已用容量</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtBytes(data.storage.total_bytes)}</div>
            </div>
            <div>
              <div className="tiny dim">总配额</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-2)' }}>{fmtBytes(data.storage.quota_bytes)}</div>
            </div>
            <div className="grow" style={{ minWidth: 160 }}>
              <Progress
                value={data.storage.total_bytes}
                max={data.storage.quota_bytes}
                label={<span className="muted">配额占用 {fmtPct((data.storage.total_bytes / (data.storage.quota_bytes || 1)) * 100)}</span>}
              />
            </div>
          </div>
          <LineChart
            series={[{ name: 'OSS 占用', color: '#0e7490', data: data.storage.trend }]}
            labels={data.trends.dates}
            height={168}
            area
            valueFmt={(v) => fmtBytes(v)}
          />
        </Section>

        <Section title="按用户占用 Top 10" icon="users" sub="含图片与备份">
          <BarList
            items={data.storage.top_users.map((u) => ({
              label: u.username,
              value: u.bytes,
              hint: fmtBytes(u.bytes)
            }))}
          />
        </Section>
      </div>

      {/* ------------------------------------------------ health + quick */}
      <div className="adm-split">
        <Section
          title="服务器健康"
          icon="server"
          sub={health.os}
          actions={<button className="btn btn-sm" onClick={() => navigate('security')}>详情</button>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
            {[
              { l: 'CPU 使用率', v: health.cpu, unit: '%' },
              { l: '内存使用率', v: health.mem, unit: '%' },
              { l: '磁盘使用率', v: health.disk, unit: '%' }
            ].map((m) => (
              <div key={m.l}>
                <div className="adm-row-between" style={{ fontSize: 'var(--fs-sm)', marginBottom: 5 }}>
                  <span className="muted">{m.l}</span>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNum(m.v)}{m.unit}</b>
                </div>
                <Progress value={m.v} />
              </div>
            ))}
          </div>
          <div className="divider" style={{ margin: '14px 0 12px' }} />
          <KV
            items={[
              ['系统负载', <span className="mono">{health.load.map((n) => n.toFixed(2)).join(' / ')} <span className="dim tiny">1m / 5m / 15m</span></span>],
              ['运行时长', <span>{upDays} 天 {upHours} 小时</span>],
              ['健康状态', health.cpu > 85 || health.mem > 90 || health.disk > 90
                ? <Tag tone="danger" dot>压力偏高</Tag>
                : health.disk > 80 ? <Tag tone="warn" dot>磁盘偏高</Tag> : <Tag tone="ok" dot>正常</Tag>],
              ['最近采集', <span className="muted">{fmtTimeAgo(new Date().toISOString())}</span>]
            ]}
          />
        </Section>

        <Section title="快捷入口" icon="grid">
          <div className="col" style={{ gap: 8 }}>
            {[
              { to: 'users', icon: 'users', t: '用户管理', d: '检索用户、调整积分与配额' },
              { to: 'billing', icon: 'credit-card', t: '模型定价', d: '配置三列 Token 计费与限时免费' },
              { to: 'ai', icon: 'robot', t: '渠道池与模型', d: '多 Key 轮询、同步上游模型' },
              { to: 'plugins', icon: 'puzzle', t: '插件审核', d: '待审核队列与版本回滚' },
              { to: 'releases', icon: 'download', t: '发布新版本', d: '上传安装包到公共 OSS' },
              { to: 'security', icon: 'shield', t: '安全审计', d: '操作日志、限流与备份' }
            ].map((q) => (
              <button key={q.to} className="adm-quick" onClick={() => navigate(q.to)}>
                <span className="adm-quick-ico"><Icon name={q.icon} size={15} /></span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="adm-quick-t" style={{ display: 'block' }}>{q.t}</span>
                  <span className="adm-quick-d">{q.d}</span>
                </span>
                <Icon name="chevron-right" size={13} style={{ color: 'var(--text-3)' }} />
              </button>
            ))}
          </div>
        </Section>
      </div>

      {bootstrap && (
        <div className="tiny dim" style={{ marginTop: 18, textAlign: 'center' }}>
          已连接管理接口 · bootstrap 字段 {Object.keys(bootstrap).length} 个 · <DemoBadge show={demo} />
        </div>
      )}
    </>
  )
}

const fmtNum = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '—')
