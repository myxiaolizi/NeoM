/**
 * Module 3 — 官方 AI 接口与渠道池
 * Provider channels, multi-key pools, connectivity test, sync-models diff, model table.
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  ConfirmDialog, DataTable, Drawer, Field, KV, Note, PageHeader, Section, Switch, Tabs, Tag, Toolbar,
  callApi, copyText, cx, fmtInt, fmtTimeAgo, maskSecret, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList, pickOne, rndInt, seq } from '../data'
import { useAdmin } from '../AdminApp'

/* ------------------------------------------------------------------ types */
export type ChannelProtocol = 'openai' | 'anthropic'
export interface ChannelKey {
  id: string
  key: string          // masked on the wire
  weight: number
  enabled: boolean
  fail_count: number
  last_ok_at: string | null
  latency_ms: number | null
  note?: string
}
export interface Channel {
  id: string
  name: string
  protocol: ChannelProtocol
  base_url: string
  model_prefix?: string
  enabled: boolean
  weight: number
  strategy: 'round-robin' | 'weighted' | 'failover'
  auto_failover: boolean
  keys: ChannelKey[]
  fail_count: number
  last_ok_at: string | null
  is_builtin?: boolean
  remark?: string
}

export type ModelCategory = 'text' | 'omni' | 'reasoning' | 'asr' | 'tts' | 'voiceclone'
export interface AdminModel {
  id: string
  provider_id: string
  label: string
  category: ModelCategory
  context_window: number
  max_output: number
  rpm: number
  tpm: number
  enabled: boolean
  recommended?: boolean
  recommended_for?: string
  tag?: string
  price_in?: number
  price_cache_in?: number
  price_out?: number
}

const CAT_META: Record<ModelCategory, { label: string; tone: 'accent' | 'purple' | 'warn' | 'ok' | 'default' }> = {
  text: { label: '文本生成', tone: 'accent' },
  omni: { label: '全模态', tone: 'purple' },
  reasoning: { label: '深度思考', tone: 'purple' },
  asr: { label: 'ASR', tone: 'warn' },
  tts: { label: 'TTS', tone: 'ok' },
  voiceclone: { label: '音色克隆', tone: 'default' }
}

/* --------------------------------------------------------------- demo data */
const MIMO_MODELS: Omit<AdminModel, 'provider_id'>[] = [
  { id: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro', category: 'text', context_window: 1_000_000, max_output: 128_000, rpm: 60, tpm: 1_000_000, enabled: true, recommended: true, recommended_for: '写作 / 长文档', tag: '推荐', price_in: 3, price_cache_in: 0.025, price_out: 6 },
  { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash', category: 'text', context_window: 1_000_000, max_output: 128_000, rpm: 300, tpm: 4_000_000, enabled: true, recommended: true, recommended_for: '日常 / 命名', tag: '高性价比', price_in: 1, price_cache_in: 0.02, price_out: 2 },
  { id: 'mimo-v2.6-pro-ultraspeed', label: 'MiMo V2.6 Pro UltraSpeed', category: 'reasoning', context_window: 1_000_000, max_output: 128_000, rpm: 30, tpm: 600_000, enabled: true, recommended: true, recommended_for: '深度推理', tag: '极速推理', price_in: 3, price_cache_in: 0.025, price_out: 6 },
  { id: 'mimo-v2.6-omni', label: 'MiMo V2.6 Omni', category: 'omni', context_window: 1_000_000, max_output: 128_000, rpm: 40, tpm: 800_000, enabled: true, recommended: false, recommended_for: '图文混合', tag: '全模态', price_in: 1.5, price_cache_in: 0.02, price_out: 3 },
  { id: 'mimo-asr-1', label: 'MiMo ASR 1', category: 'asr', context_window: 8_000, max_output: 2_000, rpm: 120, tpm: 200_000, enabled: true, recommended: false, recommended_for: '会议转写', tag: '语音识别' },
  { id: 'mimo-tts-1', label: 'MiMo TTS 1', category: 'tts', context_window: 8_000, max_output: 2_000, rpm: 120, tpm: 200_000, enabled: true, recommended: true, recommended_for: '朗读 / 播客', tag: '限时免费' },
  { id: 'mimo-tts-voicedesign', label: 'MiMo TTS VoiceDesign', category: 'tts', context_window: 8_000, max_output: 2_000, rpm: 60, tpm: 100_000, enabled: true, recommended: false, recommended_for: '定制音色', tag: '限时免费' },
  { id: 'mimo-tts-voiceclone', label: 'MiMo TTS VoiceClone', category: 'voiceclone', context_window: 8_000, max_output: 2_000, rpm: 30, tpm: 60_000, enabled: true, recommended: false, recommended_for: '音色克隆', tag: '内测' }
]

const demoChannels = (): Channel[] => [
  {
    id: 'ch-mimo-official',
    name: '小米 mimo 官方（默认）',
    protocol: 'openai',
    base_url: 'https://api.xiaomimimo.com/v1',
    enabled: true,
    weight: 100,
    strategy: 'weighted',
    auto_failover: true,
    is_builtin: true,
    remark: '官方内置渠道，模型由 admin/models 统一维护',
    fail_count: 0,
    last_ok_at: new Date(Date.now() - 42_000).toISOString(),
    keys: [
      { id: 'k1', key: 'sk-mimo-9f2c8a41b7d34e0a9c1d', weight: 60, enabled: true, fail_count: 0, last_ok_at: new Date(Date.now() - 42_000).toISOString(), latency_ms: 218, note: '主 Key' },
      { id: 'k2', key: 'sk-mimo-4b7e1d93c8a24f60b2e5', weight: 40, enabled: true, fail_count: 1, last_ok_at: new Date(Date.now() - 6 * 60_000).toISOString(), latency_ms: 264, note: '备用 Key' }
    ]
  },
  {
    id: 'ch-mimo-anthropic',
    name: '小米 mimo · Anthropic 协议',
    protocol: 'anthropic',
    base_url: 'https://api.xiaomimimo.com/anthropic/v1',
    enabled: true,
    weight: 50,
    strategy: 'failover',
    auto_failover: true,
    is_builtin: true,
    remark: 'Anthropic messages 兼容端点',
    fail_count: 2,
    last_ok_at: new Date(Date.now() - 18 * 60_000).toISOString(),
    keys: [{ id: 'k3', key: 'sk-mimo-ant-1a2b3c4d5e6f7a8b', weight: 100, enabled: true, fail_count: 2, last_ok_at: new Date(Date.now() - 18 * 60_000).toISOString(), latency_ms: 412 }]
  },
  {
    id: 'ch-deepseek',
    name: 'DeepSeek 官方',
    protocol: 'openai',
    base_url: 'https://api.deepseek.com/v1',
    enabled: true,
    weight: 40,
    strategy: 'round-robin',
    auto_failover: true,
    fail_count: 0,
    last_ok_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    keys: [
      { id: 'k4', key: 'sk-ds-7c8d9e0f1a2b3c4d', weight: 50, enabled: true, fail_count: 0, last_ok_at: new Date(Date.now() - 3 * 60_000).toISOString(), latency_ms: 486 },
      { id: 'k5', key: 'sk-ds-5f6a7b8c9d0e1f2a', weight: 50, enabled: false, fail_count: 14, last_ok_at: null, latency_ms: null, note: '已因额度耗尽停用' }
    ]
  },
  {
    id: 'ch-qwen',
    name: '通义千问（DashScope）',
    protocol: 'openai',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    enabled: false,
    weight: 20,
    strategy: 'weighted',
    auto_failover: true,
    fail_count: 6,
    last_ok_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
    keys: [{ id: 'k6', key: 'sk-qw-3a2b1c0d9e8f7a6b', weight: 100, enabled: true, fail_count: 6, last_ok_at: new Date(Date.now() - 4 * 3600_000).toISOString(), latency_ms: 640 }]
  }
]

const demoModels = (): AdminModel[] => MIMO_MODELS.map((m) => ({ ...m, provider_id: 'mimo' }))

/* --------------------------------------------------------------- module */
export default function AiConsole() {
  const { demo: sessionDemo } = useAdmin()
  const toast = useToast()
  const { ask, node: confirmNode } = useConfirm()
  const [tab, setTab] = useState<'channels' | 'models' | 'usage'>('channels')

  /* --------------------------------------------------- channels */
  const chState = useApiData<Channel[]>(
    async () => {
      const raw = await api.get<unknown>('/api/admin/channels')
      const list = asList<Channel>(raw).map((c) => ({
        ...c,
        strategy: (c.strategy as Channel['strategy']) || 'weighted',
        auto_failover: c.auto_failover !== false,
        keys: asList<ChannelKey>(c.keys).length ? asList<ChannelKey>(c.keys) : []
      }))
      if (!list.length) throw new Error('空渠道列表')
      return list
    },
    demoChannels()
  )
  const channels = chState.data

  const [chDrawer, setChDrawer] = useState<Channel | 'new' | null>(null)
  const [chForm, setChForm] = useState({ name: '', protocol: 'openai' as ChannelProtocol, base_url: '', weight: '50', strategy: 'weighted' as Channel['strategy'], auto_failover: true, remark: '' })
  const [chSaving, setChSaving] = useState(false)

  const openChannel = (c: Channel | 'new') => {
    if (c === 'new') {
      setChForm({ name: '', protocol: 'openai', base_url: 'https://', weight: '50', strategy: 'weighted', auto_failover: true, remark: '' })
    } else {
      setChForm({
        name: c.name, protocol: c.protocol, base_url: c.base_url, weight: String(c.weight),
        strategy: c.strategy, auto_failover: c.auto_failover, remark: c.remark || ''
      })
    }
    setChDrawer(c)
  }

  const saveChannel = async () => {
    if (!chForm.name.trim() || !chForm.base_url.trim()) { toast({ kind: 'warn', text: '渠道名称与 Base URL 必填' }); return }
    setChSaving(true)
    const payload = { ...chForm, weight: Number(chForm.weight) || 50 }
    const r = chDrawer === 'new'
      ? await callApi(() => api.post('/api/admin/channels', payload), '渠道已创建')
      : await callApi(() => api.put(`/api/admin/channels/${(chDrawer as Channel).id}`, payload), '渠道已保存')
    setChSaving(false)
    if (r.ok) { setChDrawer(null); chState.reload() }
  }

  const toggleChannel = async (c: Channel, on: boolean) => {
    chState.setData((p) => p.map((x) => (x.id === c.id ? { ...x, enabled: on } : x)))
    await callApi(() => api.put(`/api/admin/channels/${c.id}`, { enabled: on }), on ? '渠道已启用' : '渠道已停用')
  }

  const deleteChannel = async (c: Channel) => {
    const ok = await ask({
      title: '删除渠道', danger: true,
      message: <>将删除渠道 <b>{c.name}</b> 及其 <b>{c.keys.length}</b> 个 Key。删除后该渠道不再参与调度，历史调用记录保留。</>,
      confirmText: '删除渠道'
    })
    if (!ok) return
    const r = await callApi(() => api.del(`/api/admin/channels/${c.id}`), '渠道已删除')
    if (r.ok) chState.setData((p) => p.filter((x) => x.id !== c.id))
  }

  /* --------------------------------------------------- keys */
  const [keyFor, setKeyFor] = useState<Channel | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newKeyWeight, setNewKeyWeight] = useState('50')
  const [testing, setTesting] = useState<string | null>(null)

  const addKey = async () => {
    if (!keyFor || !newKey.trim()) { toast({ kind: 'warn', text: '请填写 API Key' }); return }
    const payload = { key: newKey.trim(), weight: Number(newKeyWeight) || 50, enabled: true }
    const r = await callApi(() => api.post(`/api/admin/channels/${keyFor.id}/keys`, payload), 'Key 已添加')
    const created: ChannelKey = {
      id: 'k' + Date.now(), key: newKey.trim(), weight: Number(newKeyWeight) || 50,
      enabled: true, fail_count: 0, last_ok_at: null, latency_ms: null
    }
    const target = keyFor
    chState.setData((p) => p.map((c) => (c.id === target.id ? { ...c, keys: [...c.keys, created] } : c)))
    if (keyFor) setKeyFor({ ...keyFor, keys: [...keyFor.keys, created] })
    setNewKey('')
    if (!r.ok) toast({ kind: 'info', text: '演示模式：Key 仅在本次会话生效' })
  }

  const removeKey = async (c: Channel, k: ChannelKey) => {
    const ok = await ask({ title: '删除 Key', danger: true, message: <>将从渠道 <b>{c.name}</b> 删除 Key <span className="mono">{maskSecret(k.key)}</span>？</>, confirmText: '删除' })
    if (!ok) return
    await callApi(() => api.del(`/api/admin/channels/${c.id}/keys/${k.id}`), 'Key 已删除')
    const upd = (list: Channel[]) => list.map((x) => (x.id === c.id ? { ...x, keys: x.keys.filter((y) => y.id !== k.id) } : x))
    chState.setData(upd)
    setKeyFor((f) => (f && f.id === c.id ? { ...f, keys: f.keys.filter((y) => y.id !== k.id) } : f))
  }

  const testChannel = async (c: Channel, k?: ChannelKey) => {
    const tid = k ? k.id : c.id
    setTesting(tid)
    const t0 = performance.now()
    let latency = 0
    let ok = false
    try {
      const res = await api.post<{ ok?: boolean; latencyMs?: number }>('/api/admin/channels/test', {
        channelId: c.id, keyId: k?.id, baseUrl: c.base_url, protocol: c.protocol
      })
      ok = res?.ok !== false
      latency = Math.round(res?.latencyMs ?? performance.now() - t0)
    } catch {
      await new Promise((r) => setTimeout(r, 260 + Math.random() * 340))
      latency = Math.round(performance.now() - t0)
      ok = true
      toast({ kind: 'info', text: '演示测速：后端接口未就绪，延迟为本地模拟值' })
    }
    setTesting(null)
    const now = new Date().toISOString()
    chState.setData((prev) =>
      prev.map((x) =>
        x.id !== c.id ? x : ({
          ...x,
          last_ok_at: ok ? now : x.last_ok_at,
          fail_count: ok ? x.fail_count : x.fail_count + 1,
          keys: x.keys.map((y) => (k && y.id === k.id ? { ...y, latency_ms: latency, last_ok_at: ok ? now : y.last_ok_at, fail_count: ok ? y.fail_count : y.fail_count + 1 } : y))
        })
      )
    )
    toast({ kind: ok ? 'ok' : 'error', text: ok ? `连通正常 · ${latency} ms` : '连通失败，请检查 Base URL 与 Key' })
  }

  /* --------------------------------------------------- sync models */
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ added: string[]; updated: string[]; removed: string[]; demo?: boolean } | null>(null)
  const syncModels = async () => {
    setSyncing(true)
    try {
      const raw = await api.post<{ added?: string[]; updated?: string[]; removed?: string[] }>('/api/admin/channels/sync-models', {})
      setSyncResult({
        added: asList<string>(raw?.added),
        updated: asList<string>(raw?.updated),
        removed: asList<string>(raw?.removed),
        demo: false
      })
      toast({ kind: 'ok', text: '上游模型已同步' })
      modelState.reload()
    } catch {
      setSyncResult({
        added: ['mimo-v2.6-flash-lite', 'mimo-embed-1'],
        updated: ['mimo-v2.6-pro', 'mimo-tts-1'],
        removed: ['mimo-v2.5-pro-legacy'],
        demo: true
      })
      toast({ kind: 'info', text: '演示数据：展示同步 diff 效果' })
    } finally {
      setSyncing(false)
    }
  }

  /* --------------------------------------------------- models */
  const modelState = useApiData<AdminModel[]>(
    async () => {
      const raw = await api.get<unknown>('/api/admin/models')
      const list = asList<AdminModel>(raw)
      if (!list.length) throw new Error('空模型列表')
      return list.map((m) => ({ ...m, enabled: m.enabled !== false }))
    },
    demoModels()
  )
  const models = modelState.data
  const [catFilter, setCatFilter] = useState<'all' | ModelCategory>('all')
  const [mDrawer, setMDrawer] = useState<AdminModel | null>(null)
  const [mForm, setMForm] = useState({ rpm: '', tpm: '', max_output: '', label: '', tag: '', recommended_for: '' })

  const openModel = (m: AdminModel) => {
    setMForm({
      rpm: String(m.rpm), tpm: String(m.tpm), max_output: String(m.max_output),
      label: m.label, tag: m.tag || '', recommended_for: m.recommended_for || ''
    })
    setMDrawer(m)
  }
  const saveModel = async () => {
    if (!mDrawer) return
    const payload = {
      rpm: Number(mForm.rpm) || 0, tpm: Number(mForm.tpm) || 0,
      max_output: Number(mForm.max_output) || 0, label: mForm.label,
      tag: mForm.tag, recommended_for: mForm.recommended_for
    }
    const r = await callApi(() => api.put(`/api/admin/models/${mDrawer.id}`, payload), '模型配置已保存')
    if (r.ok) {
      modelState.setData((p) => p.map((x) => (x.id === mDrawer.id ? { ...x, ...payload } : x)))
      setMDrawer(null)
    }
  }
  const toggleModel = async (m: AdminModel, on: boolean) => {
    modelState.setData((p) => p.map((x) => (x.id === m.id ? { ...x, enabled: on } : x)))
    await callApi(() => api.put(`/api/admin/models/${m.id}`, { enabled: on }), on ? '模型已启用' : '模型已停用')
  }
  const toggleRecommend = async (m: AdminModel, on: boolean) => {
    modelState.setData((p) => p.map((x) => (x.id === m.id ? { ...x, recommended: on } : x)))
    await callApi(() => api.put(`/api/admin/models/${m.id}`, { recommended: on }), on ? '已加入前端推荐' : '已取消推荐')
  }

  const filteredModels = useMemo(
    () => (catFilter === 'all' ? models : models.filter((m) => m.category === catFilter)),
    [models, catFilter]
  )

  const chCols: Column<Channel>[] = [
    {
      key: 'name', title: '渠道', sortable: true, value: (c) => c.name,
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600 }} className="ellipsis">{c.name}</span>
            {c.is_builtin && <Tag tone="accent">内置</Tag>}
            {!c.enabled && <Tag tone="danger">已停用</Tag>}
          </div>
          <div className="tiny dim mono ellipsis">{c.base_url}</div>
        </div>
      )
    },
    {
      key: 'protocol', title: '协议', width: 104,
      render: (c) => <Tag tone={c.protocol === 'anthropic' ? 'purple' : 'accent'}>{c.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'}</Tag>
    },
    {
      key: 'keys', title: 'Key 数', align: 'center', width: 82, sortable: true, value: (c) => c.keys.length,
      render: (c) => (
        <button className="btn btn-sm btn-ghost" onClick={() => setKeyFor(c)} title="管理 Key 池">
          <Icon name="key" size={12} /> {c.keys.length}
        </button>
      )
    },
    { key: 'weight', title: '权重', align: 'right', width: 68, sortable: true, render: (c) => fmtInt(c.weight) },
    {
      key: 'strategy', title: '调度策略', width: 116,
      render: (c) => <span className="small muted">{{ 'round-robin': '轮询', weighted: '加权', failover: '故障转移' }[c.strategy]}</span>
    },
    {
      key: 'fail_count', title: '失败', align: 'right', width: 68, sortable: true,
      render: (c) => <span style={{ color: c.fail_count > 3 ? 'var(--danger)' : c.fail_count ? 'var(--warn)' : 'var(--text-3)', fontWeight: c.fail_count ? 700 : 400 }}>{c.fail_count}</span>
    },
    { key: 'last_ok_at', title: '最后成功', sortable: true, render: (c) => <span className="small muted">{c.last_ok_at ? fmtTimeAgo(c.last_ok_at) : '从未成功'}</span> },
    {
      key: 'enabled', title: '启用', align: 'center', width: 62,
      render: (c) => <Switch on={c.enabled} onChange={(v) => toggleChannel(c, v)} />
    },
    {
      key: 'act', title: '操作', align: 'right', width: 132,
      render: (c) => (
        <div className="row" style={{ gap: 3, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-ghost" disabled={testing === c.id} onClick={() => testChannel(c)} title="测速">
            {testing === c.id ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Icon name="wifi" size={13} />}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => openChannel(c)} title="编辑"><Icon name="edit" size={13} /></button>
          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteChannel(c)} title="删除"><Icon name="trash" size={13} /></button>
        </div>
      )
    }
  ]

  const modelCols: Column<AdminModel>[] = [
    {
      key: 'label', title: '模型', sortable: true, value: (m) => m.label,
      render: (m) => (
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{m.label}</span>
            {m.recommended && <Tag tone="ok">推荐</Tag>}
            {m.tag && <Tag tone="accent">{m.tag}</Tag>}
          </div>
          <div className="tiny dim mono">{m.id}</div>
        </div>
      )
    },
    {
      key: 'category', title: '分类', width: 106, sortable: true,
      render: (m) => <Tag tone={CAT_META[m.category].tone}>{CAT_META[m.category].label}</Tag>
    },
    {
      key: 'context_window', title: '上下文', align: 'right', width: 92, sortable: true,
      render: (m) => m.context_window >= 1_000_000 ? '1M' : m.context_window >= 8000 ? Math.round(m.context_window / 1000) + 'K' : fmtInt(m.context_window)
    },
    {
      key: 'max_output', title: '最大输出', align: 'right', width: 96, sortable: true,
      render: (m) => m.max_output >= 1000 ? Math.round(m.max_output / 1000) + 'K' : fmtInt(m.max_output)
    },
    { key: 'rpm', title: 'RPM', align: 'right', width: 76, sortable: true, render: (m) => fmtInt(m.rpm) },
    { key: 'tpm', title: 'TPM', align: 'right', width: 106, sortable: true, render: (m) => fmtInt(m.tpm) },
    {
      key: 'price', title: '定价 ¥/1M', align: 'right', width: 150,
      render: (m) => m.price_in === undefined
        ? <span className="dim small">见计费模块</span>
        : <span className="small mono">{m.price_cache_in} / {m.price_in} / {m.price_out}</span>
    },
    {
      key: 'recommended', title: '前端推荐', align: 'center', width: 86,
      render: (m) => <Switch on={!!m.recommended} onChange={(v) => toggleRecommend(m, v)} title="是否出现在用户端模型选择器推荐位" />
    },
    { key: 'enabled', title: '启用', align: 'center', width: 62, render: (m) => <Switch on={m.enabled} onChange={(v) => toggleModel(m, v)} /> },
    {
      key: 'act', title: '', align: 'right', width: 54,
      render: (m) => <button className="btn btn-sm btn-ghost" onClick={() => openModel(m)}><Icon name="edit" size={13} /></button>
    }
  ]

  const usage = useMemo(() => {
    const byCat = new Map<ModelCategory, number>()
    models.forEach((m) => byCat.set(m.category, (byCat.get(m.category) || 0) + 1))
    return Array.from(byCat.entries())
  }, [models])

  return (
    <>
      <PageHeader
        icon="robot"
        title="官方 AI 接口与渠道池"
        desc="维护上游供应商渠道、多 Key 负载均衡与模型目录。官方渠道优先，失败自动切换到备用 Key。"
        demo={chState.demo || modelState.demo || sessionDemo}
        reload={() => { chState.reload(); modelState.reload() }}
        loading={chState.loading || modelState.loading}
        actions={
          <>
            <button className="btn" onClick={syncModels} disabled={syncing}>
              {syncing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name="sync" size={14} />}
              同步上游模型
            </button>
            <button className="btn btn-primary" onClick={() => openChannel('new')}><Icon name="plus" size={14} /> 新增渠道</button>
          </>
        }
      />

      {syncResult && (
        <div className="card adm-section" style={{ borderColor: 'var(--accent)' }}>
          <div className="adm-card-head">
            <h3><Icon name="sync" size={15} /> 模型同步结果 {syncResult.demo && <Tag tone="warn">演示</Tag>}</h3>
            <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setSyncResult(null)}><Icon name="x" size={14} /></button>
          </div>
          <div className="adm-card-body">
            <div className="adm-cols adm-cols-3">
              {[
                { t: '新增模型', list: syncResult.added, tone: 'ok' as const, icon: 'plus' },
                { t: '更新模型', list: syncResult.updated, tone: 'accent' as const, icon: 'refresh' },
                { t: '下架模型', list: syncResult.removed, tone: 'danger' as const, icon: 'minus' }
              ].map((g) => (
                <div key={g.t}>
                  <div className="row" style={{ gap: 6, marginBottom: 7 }}>
                    <Tag tone={g.tone}><Icon name={g.icon} size={10} /> {g.t}</Tag>
                    <span className="tiny dim">{g.list.length} 个</span>
                  </div>
                  {g.list.length === 0 ? <div className="tiny dim">无变化</div> : (
                    <div className="col" style={{ gap: 4 }}>
                      {g.list.map((id) => <div key={id} className="mono small adm-code" style={{ padding: '3px 7px' }}>{id}</div>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card adm-section">
        <Tabs
          active={tab}
          onChange={(t) => setTab(t as typeof tab)}
          items={[
            { id: 'channels', label: '供应商渠道', count: channels.length },
            { id: 'models', label: '模型管理', count: models.length },
            { id: 'usage', label: '渠道概览' }
          ]}
        />
        {tab === 'channels' && (
          <>
            <Toolbar right={<span className="tiny dim">共 {channels.length} 个渠道 · {channels.reduce((a, b) => a + b.keys.length, 0)} 个 Key</span>}>
              <Note style={{ padding: '5px 9px', fontSize: 'var(--fs-xs)' }}>
                启用的渠道按权重参与调度；Key 池支持轮询 / 加权 / 故障转移三种策略。
              </Note>
            </Toolbar>
            <DataTable
              columns={chCols}
              rows={channels}
              rowKey={(c) => c.id}
              loading={chState.loading}
              pageSize={10}
              emptyText="还没有配置任何渠道"
              emptyIcon="robot"
            />
          </>
        )}

        {tab === 'models' && (
          <>
            <Toolbar
              right={
                <div className="adm-seg">
                  <button className={catFilter === 'all' ? 'active' : ''} onClick={() => setCatFilter('all')}>全部</button>
                  {(Object.keys(CAT_META) as ModelCategory[]).map((c) => (
                    <button key={c} className={catFilter === c ? 'active' : ''} onClick={() => setCatFilter(c)}>{CAT_META[c].label}</button>
                  ))}
                </div>
              }
            >
              <Note style={{ padding: '5px 9px', fontSize: 'var(--fs-xs)' }}>
                小米 mimo 默认渠道 · {models.length} 个模型。上下文 1M / 8K，最大输出 128K / 8K / 2K。
              </Note>
            </Toolbar>
            <DataTable
              columns={modelCols}
              rows={filteredModels}
              rowKey={(m) => m.id}
              loading={modelState.loading}
              pageSize={12}
              emptyText="该分类下没有模型"
              emptyIcon="robot"
            />
          </>
        )}

        {tab === 'usage' && (
          <div className="adm-card-body">
            <div className="adm-cols adm-cols-2">
              <div>
                <h4 style={{ margin: '0 0 10px', fontSize: 'var(--fs-md)' }}>各渠道 Key 健康度</h4>
                <DataTable
                  columns={[
                    { key: 'name', title: '渠道', render: (c: Channel) => c.name },
                    { key: 'keys', title: 'Key', align: 'center', render: (c: Channel) => c.keys.length },
                    {
                      key: 'health', title: '健康', render: (c: Channel) => {
                        const bad = c.keys.filter((k) => k.fail_count > 3 || !k.enabled).length
                        return bad === 0 ? <Tag tone="ok" dot>全部可用</Tag> : <Tag tone="warn" dot>{bad} 个异常</Tag>
                      }
                    },
                    {
                      key: 'lat', title: '平均延迟', align: 'right',
                      render: (c: Channel) => {
                        const lat = c.keys.map((k) => k.latency_ms).filter((x): x is number => typeof x === 'number')
                        return lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) + ' ms' : '—'
                      }
                    }
                  ]}
                  rows={channels}
                  rowKey={(c) => c.id}
                  pageSize={6}
                  hideSearch
                  noPager
                />
              </div>
              <div>
                <h4 style={{ margin: '0 0 10px', fontSize: 'var(--fs-md)' }}>模型分类分布</h4>
                <div className="adm-bars">
                  {usage.map(([cat, n]) => (
                    <div className="adm-bar-row" key={cat}>
                      <span>{CAT_META[cat].label}</span>
                      <div className="adm-bar-track"><div className="adm-bar-fill" style={{ width: `${(n / Math.max(...usage.map((u) => u[1]))) * 100}%` }} /></div>
                      <span className="adm-bar-val">{n} 个</span>
                    </div>
                  ))}
                </div>
                <div className="divider" />
                <KV
                  items={[
                    ['官方渠道状态', channels.some((c) => c.enabled && c.is_builtin) ? <Tag tone="ok" dot>可用</Tag> : <Tag tone="danger" dot>不可用</Tag>],
                    ['自动故障切换', channels.every((c) => c.auto_failover) ? <Tag tone="ok">全部开启</Tag> : <Tag tone="warn">部分关闭</Tag>],
                    ['启用模型数', `${models.filter((m) => m.enabled).length} / ${models.length}`],
                    ['推荐模型数', String(models.filter((m) => m.recommended).length)]
                  ]}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------- channel drawer */}
      <Drawer
        open={chDrawer !== null}
        title={chDrawer === 'new' ? '新增供应商渠道' : `编辑渠道 · ${(chDrawer as Channel)?.name || ''}`}
        icon="robot"
        onClose={() => setChDrawer(null)}
        footer={
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => setChDrawer(null)} disabled={chSaving}>取消</button>
            <button className="btn btn-primary" onClick={saveChannel} disabled={chSaving}>
              {chSaving && <span className="spinner" style={{ width: 12, height: 12 }} />} 保存渠道
            </button>
          </>
        }
      >
        <div className="adm-form-grid">
          <Field label="渠道名称" required>
            <input className="input" value={chForm.name} onChange={(e) => setChForm({ ...chForm, name: e.target.value })} placeholder="例如 小米 mimo 官方" />
          </Field>
          <Field label="协议类型" required hint="决定请求体与响应解析格式">
            <select className="select" value={chForm.protocol} onChange={(e) => setChForm({ ...chForm, protocol: e.target.value as ChannelProtocol })}>
              <option value="openai">OpenAI 兼容（/chat/completions）</option>
              <option value="anthropic">Anthropic（/messages）</option>
            </select>
          </Field>
        </div>
        <Field label="Base URL" required hint="不含 /chat/completions 后缀">
          <input className="input mono" value={chForm.base_url} onChange={(e) => setChForm({ ...chForm, base_url: e.target.value })} placeholder="https://api.xiaomimimo.com/v1" />
        </Field>
        <div className="adm-form-grid">
          <Field label="调度权重" hint="数值越大分配到的流量越多">
            <input className="input" type="number" value={chForm.weight} onChange={(e) => setChForm({ ...chForm, weight: e.target.value })} />
          </Field>
          <Field label="负载均衡策略">
            <select className="select" value={chForm.strategy} onChange={(e) => setChForm({ ...chForm, strategy: e.target.value as Channel['strategy'] })}>
              <option value="weighted">加权随机</option>
              <option value="round-robin">轮询</option>
              <option value="failover">优先级故障转移</option>
            </select>
          </Field>
        </div>
        <Field label="故障自动切换" hint="主 Key 连续失败时自动切换到下一个可用 Key">
          <div className="row">
            <Switch on={chForm.auto_failover} onChange={(v) => setChForm({ ...chForm, auto_failover: v })} />
            <span className="small muted">{chForm.auto_failover ? '已开启' : '已关闭'}</span>
          </div>
        </Field>
        <Field label="备注">
          <textarea className="textarea" rows={2} value={chForm.remark} onChange={(e) => setChForm({ ...chForm, remark: e.target.value })} />
        </Field>
        <Note>新增渠道后请到「Key 池」补充至少一个 API Key，否则该渠道不参与调度。</Note>
      </Drawer>

      {/* --------------------------------------------- key pool drawer */}
      <Drawer
        open={!!keyFor}
        wide
        title={`Key 池 · ${keyFor?.name || ''}`}
        icon="key"
        onClose={() => setKeyFor(null)}
        sub={`${keyFor?.keys.length || 0} 个 Key`}
        footer={
          <>
            <button className="btn" onClick={() => keyFor && testChannel(keyFor)} disabled={testing === keyFor?.id}>
              <Icon name="wifi" size={13} /> 测速全部
            </button>
            <span className="spacer" />
            <button className="btn" onClick={() => setKeyFor(null)}>关闭</button>
          </>
        }
      >
        {keyFor && (
          <>
            <Note>Key 仅显示尾部 4 位。删除后立即从调度中移除；权重用于加权策略下的流量分配。</Note>
            <div className="card" style={{ margin: '12px 0' }}>
              <div className="adm-card-body">
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    className="input mono grow"
                    placeholder="粘贴新的 API Key（sk-…）"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    style={{ minWidth: 200 }}
                  />
                  <input className="input" style={{ width: 92 }} type="number" value={newKeyWeight} onChange={(e) => setNewKeyWeight(e.target.value)} title="权重" />
                  <button className="btn btn-primary" onClick={addKey}><Icon name="plus" size={13} /> 添加 Key</button>
                </div>
              </div>
            </div>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Key（脱敏）</th>
                  <th style={{ width: 78 }}>权重</th>
                  <th style={{ width: 100 }}>延迟</th>
                  <th style={{ width: 78 }}>失败</th>
                  <th style={{ width: 110 }}>最后成功</th>
                  <th style={{ width: 62 }} className="center">启用</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {keyFor.keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="mono small">{maskSecret(k.key)}</span>
                        <button className="btn-icon" style={{ width: 20, height: 20 }} onClick={async () => { await copyText(k.key); toast({ kind: 'ok', text: 'Key 已复制到剪贴板' }) }} title="复制完整 Key">
                          <Icon name="copy" size={11} />
                        </button>
                      </div>
                      {k.note && <div className="tiny dim">{k.note}</div>}
                    </td>
                    <td className="num">{k.weight}</td>
                    <td className="num">{k.latency_ms ? k.latency_ms + ' ms' : <span className="dim">—</span>}</td>
                    <td className="num" style={{ color: k.fail_count ? 'var(--danger)' : undefined }}>{k.fail_count}</td>
                    <td><span className="small muted">{k.last_ok_at ? fmtTimeAgo(k.last_ok_at) : '从未'}</span></td>
                    <td className="center">
                      <Switch
                        on={k.enabled}
                        onChange={(v) => {
                          const target = keyFor
                          const upd = (list: Channel[]) => list.map((c) => (c.id === target.id ? { ...c, keys: c.keys.map((y) => (y.id === k.id ? { ...y, enabled: v } : y)) } : c))
                          chState.setData(upd)
                          setKeyFor((f) => (f ? { ...f, keys: f.keys.map((y) => (y.id === k.id ? { ...y, enabled: v } : y)) } : f))
                          callApi(() => api.put(`/api/admin/channels/${target.id}/keys/${k.id}`, { enabled: v }), v ? 'Key 已启用' : 'Key 已停用')
                        }}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 3, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-ghost" disabled={testing === k.id} onClick={() => testChannel(keyFor, k)} title="测速">
                          {testing === k.id ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <Icon name="wifi" size={12} />}
                        </button>
                        <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => removeKey(keyFor, k)}>
                          <Icon name="trash" size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {keyFor.keys.length === 0 && (
                  <tr><td colSpan={7}><div className="empty"><Icon name="key" size={22} /><div>该渠道还没有 Key，请在上方添加</div></div></td></tr>
                )}
              </tbody>
            </table>
            <div className="divider" />
            <KV
              items={[
                ['渠道协议', <Tag tone={keyFor.protocol === 'anthropic' ? 'purple' : 'accent'}>{keyFor.protocol}</Tag>],
                ['Base URL', <span className="mono small">{keyFor.base_url}</span>],
                ['调度策略', <span>{{ 'round-robin': '轮询', weighted: '加权', failover: '故障转移' }[keyFor.strategy]}</span>],
                ['自动切换', keyFor.auto_failover ? <Tag tone="ok" dot>开启</Tag> : <Tag tone="danger" dot>关闭</Tag>]
              ]}
            />
          </>
        )}
      </Drawer>

      {/* --------------------------------------------- model drawer */}
      <Drawer
        open={!!mDrawer}
        title={`模型配置 · ${mDrawer?.label || ''}`}
        icon="robot"
        onClose={() => setMDrawer(null)}
        footer={
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => setMDrawer(null)}>取消</button>
            <button className="btn btn-primary" onClick={saveModel}><Icon name="save" size={14} /> 保存</button>
          </>
        }
      >
        {mDrawer && (
          <>
            <KV
              items={[
                ['模型 ID', <span className="mono small">{mDrawer.id}</span>],
                ['分类', <Tag tone={CAT_META[mDrawer.category].tone}>{CAT_META[mDrawer.category].label}</Tag>],
                ['上下文窗口', mDrawer.context_window >= 1_000_000 ? '1M tokens' : fmtInt(mDrawer.context_window)],
                ['定价', mDrawer.price_in === undefined ? '未配置（到计费模块设置）' : `缓存 ${mDrawer.price_cache_in} / 输入 ${mDrawer.price_in} / 输出 ${mDrawer.price_out} ¥1M`]
              ]}
            />
            <div className="divider" />
            <div className="adm-form-grid">
              <Field label="显示名称"><input className="input" value={mForm.label} onChange={(e) => setMForm({ ...mForm, label: e.target.value })} /></Field>
              <Field label="最大输出 tokens"><input className="input" type="number" value={mForm.max_output} onChange={(e) => setMForm({ ...mForm, max_output: e.target.value })} /></Field>
              <Field label="RPM 限制（每分钟请求）"><input className="input" type="number" value={mForm.rpm} onChange={(e) => setMForm({ ...mForm, rpm: e.target.value })} /></Field>
              <Field label="TPM 限制（每分钟 Token）"><input className="input" type="number" value={mForm.tpm} onChange={(e) => setMForm({ ...mForm, tpm: e.target.value })} /></Field>
              <Field label="推荐标签" hint="显示在用户端模型卡片上"><input className="input" value={mForm.tag} onChange={(e) => setMForm({ ...mForm, tag: e.target.value })} placeholder="例如 限时免费" /></Field>
              <Field label="前端推荐选型标签" hint="引导用户按场景选择"><input className="input" value={mForm.recommended_for} onChange={(e) => setMForm({ ...mForm, recommended_for: e.target.value })} placeholder="例如 写作 / 长文档" /></Field>
            </div>
            <Note>模型定价请在「商业化计费 → 模型定价配置」中设置，支持按百万 Token / 音频时长 / 按次 / 限时免费四种计费方式。</Note>
          </>
        )}
      </Drawer>

      {confirmNode}
    </>
  )
}
