/**
 * ai — AI 服务设置
 * mode(official/custom) · 9 providers · model picker · scene defaults · pricing
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { AI_PROVIDERS, API, type AiModel, type AiScene, type AiSettings } from '@/lib/contracts'
import { useStore } from '@/store'
import { AI_SCENES, PROVIDER_PURPOSE, QUICK_PICK_GUIDE } from '@/features/marketing/portalData'
import { fmtDate, fmtPrice, pick, safeArr } from '@/features/marketing/portalKit'
import { EmptyBox, ErrorBox, Field, FormFooter, Loading, Section } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

interface ProviderState {
  apiKey: string
  baseUrl: string
  models: AiModel[] | null
  fetching: boolean
  testing: boolean
  testMsg: string
  testOk: boolean | null
}

const emptyProviderState = (): ProviderState => ({
  apiKey: '',
  baseUrl: '',
  models: null,
  fetching: false,
  testing: false,
  testMsg: '',
  testOk: null
})

const normalizeModel = (raw: any, providerId: string): AiModel => ({
  id: String(pick(raw, ['id', 'model', 'model_id', 'name'], '')),
  provider_id: String(pick(raw, ['provider_id', 'providerId'], providerId)),
  label: String(pick(raw, ['label', 'name', 'display_name'], pick(raw, ['id', 'model'], ''))),
  category: (pick(raw, ['category', 'type', 'kind'], 'text') as AiModel['category']) || 'text',
  context_window: Number(pick(raw, ['context_window', 'contextWindow', 'context_length'], 0)),
  max_output: Number(pick(raw, ['max_output', 'maxOutput'], 0)),
  rpm: Number(pick(raw, ['rpm'], 0)),
  tpm: Number(pick(raw, ['tpm'], 0)),
  billing: (pick(raw, ['billing'], 'token') as AiModel['billing']) || 'token',
  price_cache_in: Number(pick(raw, ['price_cache_in', 'priceCacheIn'], 0)),
  price_in: Number(pick(raw, ['price_in', 'priceIn'], 0)),
  price_out: Number(pick(raw, ['price_out', 'priceOut'], 0)),
  price_audio_hour: Number(pick(raw, ['price_audio_hour', 'priceAudioHour'], 0)),
  price_call: Number(pick(raw, ['price_call', 'priceCall'], 0)),
  free_until: pick(raw, ['free_until', 'freeUntil'], null),
  recommended_for: String(pick(raw, ['recommended_for', 'recommendedFor'], '') || ''),
  tag: String(pick(raw, ['tag'], '') || ''),
  enabled: pick(raw, ['enabled'], true) !== false
})

const CATEGORY_LABEL: Record<string, string> = {
  text: '文本',
  omni: '全模态',
  reasoning: '推理',
  asr: '语音识别',
  tts: '语音合成',
  voiceclone: '音色克隆'
}

const AiPanel: React.FC<PanelProps> = ({ user }) => {
  const toast = useStore((s) => s.toast)

  const [mode, setMode] = useState<'official' | 'custom'>('official')
  const [activeProvider, setActiveProvider] = useState('mimo')
  const [providerState, setProviderState] = useState<Record<string, ProviderState>>({})
  const [enabledModels, setEnabledModels] = useState<string[]>([])
  const [defaults, setDefaults] = useState<Record<AiScene, string>>({ chat: '', naming: '', asr: '', tts: '' })
  const [ttsVoice, setTtsVoice] = useState('')
  const [temperature, setTemperature] = useState<number | ''>('')

  const [catalog, setCatalog] = useState<AiModel[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogErr, setCatalogErr] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({})
  const [voices, setVoices] = useState<Array<{ id: string; name: string; lang?: string; desc?: string }>>([])

  const current = providerState[activeProvider] || emptyProviderState()
  const providerMeta = useMemo(() => AI_PROVIDERS.find((p) => p.id === activeProvider) || AI_PROVIDERS[0], [activeProvider])

  const patchProvider = (id: string, p: Partial<ProviderState>) =>
    setProviderState((s) => ({ ...s, [id]: { ...(s[id] || emptyProviderState()), ...p } }))

  /* ------------------------------------------------------------- load */
  const loadCatalog = () => {
    setCatalogLoading(true)
    setCatalogErr('')
    api
      .get<any>(API.aiModels)
      .then((raw) => {
        const list = safeArr<any>(raw).map((m) => normalizeModel(m, String(pick(m, ['provider_id'], '')))).filter((m) => m.id)
        setCatalog(list)
      })
      .catch((e: any) => setCatalogErr(e?.message || '模型目录加载失败'))
      .finally(() => setCatalogLoading(false))
  }

  const loadSettings = () => {
    setSettingsLoading(true)
    api
      .get<any>(API.aiSettings)
      .then((raw) => {
        const cfg = (raw?.settings || raw || {}) as any
        const nextMode = (pick(cfg, ['mode'], 'official') as 'official' | 'custom') || 'official'
        setMode(nextMode)
        const pid = String(pick(cfg, ['provider_id', 'providerId'], 'mimo') || 'mimo')
        setActiveProvider(pid)
        const enabled = safeArr<string>(pick(cfg, ['enabled_models', 'enabledModels'], []))
        setEnabledModels(enabled.map(String))
        const d = (pick(cfg, ['defaults', 'defaults_json'], {}) || {}) as Record<string, string>
        setDefaults({
          chat: String(d.chat || ''),
          naming: String(d.naming || ''),
          asr: String(d.asr || ''),
          tts: String(d.tts || '')
        })
        setTtsVoice(String(pick(cfg, ['tts_voice', 'ttsVoice'], '') || ''))
        const t = pick(cfg, ['temperature'], '')
        setTemperature(typeof t === 'number' ? t : '')
        const keys = (pick(cfg, ['has_key', 'hasKey'], {}) || {}) as Record<string, boolean>
        if (cfg.provider_id) keys[pid] = !!pick(cfg, ['has_api_key', 'hasApiKey'], false) || keys[pid] || false
        setHasKey(keys)
      })
      .catch(() => {
        /* first run / backend not ready: keep defaults, official mode still works */
      })
      .finally(() => setSettingsLoading(false))
  }

  useEffect(() => {
    loadCatalog()
    loadSettings()
    api
      .get<any>(API.aiTtsVoices)
      .then((raw) => setVoices(safeArr<any>(raw).map((v) => ({ id: String(pick(v, ['id', 'voice'], '')), name: String(pick(v, ['name', 'label'], '')), lang: pick(v, ['lang'], ''), desc: pick(v, ['desc', 'description'], '') }))))
      .catch(() => setVoices([]))
  }, [])

  /* --------------------------------------------------------- providers */
  const fetchModels = async (providerId: string) => {
    const st = providerState[providerId] || emptyProviderState()
    if (!st.apiKey && !hasKey[providerId]) {
      toast({ kind: 'warn', text: '请先填写该供应商的 API Key' })
      return
    }
    patchProvider(providerId, { fetching: true, testMsg: '' })
    try {
      const raw = await api.post<any>(API.aiFetchModels, {
        providerId,
        provider_id: providerId,
        apiKey: st.apiKey || undefined,
        baseUrl: st.baseUrl || undefined
      })
      const models = safeArr<any>(pick(raw, ['models', 'list', 'data'], raw)).map((m) => normalizeModel(m, providerId)).filter((m) => m.id)
      patchProvider(providerId, { models, fetching: false, testMsg: `成功拉取 ${models.length} 个模型`, testOk: true })
      if (models.length === 0) toast({ kind: 'warn', text: '上游返回了空模型列表，请检查 Key 权限' })
      else toast({ kind: 'ok', text: `已拉取 ${models.length} 个模型` })
    } catch (e: any) {
      patchProvider(providerId, { fetching: false, testMsg: e?.message || '拉取失败', testOk: false })
      toast({ kind: 'error', text: e?.message || '拉取模型列表失败' })
    }
  }

  const testProvider = async (providerId: string) => {
    const st = providerState[providerId] || emptyProviderState()
    if (!st.apiKey && !hasKey[providerId]) {
      toast({ kind: 'warn', text: '请先填写该供应商的 API Key' })
      return
    }
    patchProvider(providerId, { testing: true, testMsg: '' })
    const t0 = performance.now()
    try {
      const raw = await api.post<any>(API.aiTest, {
        providerId,
        provider_id: providerId,
        apiKey: st.apiKey || undefined,
        baseUrl: st.baseUrl || undefined
      })
      const ok = pick(raw, ['ok', 'success'], true) !== false
      const latency = Number(pick(raw, ['latencyMs', 'latency_ms', 'latency'], Math.round(performance.now() - t0)))
      patchProvider(providerId, {
        testing: false,
        testOk: ok,
        testMsg: `${ok ? '连接正常' : '连接失败'} · 延迟 ${latency} ms${pick(raw, ['msg'], '') ? ' · ' + pick(raw, ['msg'], '') : ''}`
      })
      toast({ kind: ok ? 'ok' : 'warn', text: ok ? `连接正常（${latency}ms）` : '连通性测试未通过' })
    } catch (e: any) {
      patchProvider(providerId, { testing: false, testOk: false, testMsg: e?.message || '测试失败' })
    }
  }

  /* ------------------------------------------------------------ models */
  const enabledCatalog = useMemo(() => {
    const list = catalog.length ? catalog : []
    return list
  }, [catalog])

  const toggleModel = (id: string) =>
    setEnabledModels((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  /** models usable for a given scene (ASR/TTS restricted by category) */
  const modelsForScene = (scene: AiScene) => {
    const pool = enabledModels.length ? catalog.filter((m) => enabledModels.includes(m.id)) : catalog
    if (scene === 'asr') return pool.filter((m) => m.category === 'asr')
    if (scene === 'tts') return pool.filter((m) => m.category === 'tts' || m.category === 'voiceclone')
    return pool.filter((m) => m.category !== 'asr' && m.category !== 'tts' && m.category !== 'voiceclone')
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload: Partial<AiSettings> & Record<string, unknown> = {
        mode,
        provider_id: activeProvider,
        providerId: activeProvider,
        enabled_models: enabledModels,
        enabledModels,
        defaults,
        tts_voice: ttsVoice || undefined,
        temperature: temperature === '' ? undefined : Number(temperature)
      }
      const key = current.apiKey.trim()
      if (key) payload.api_key = key
      if (current.baseUrl.trim()) payload.base_url = current.baseUrl.trim()
      await api.post(API.aiSettings, payload)
      if (key) setHasKey((h) => ({ ...h, [activeProvider]: true }))
      patchProvider(activeProvider, { apiKey: '' })
      toast({ kind: 'ok', text: 'AI 设置已保存' })
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '保存失败，请稍后重试' })
    } finally {
      setSaving(false)
    }
  }

  const freeModel = (m: AiModel) => {
    if (!m.free_until) return false
    const t = new Date(String(m.free_until).replace(' ', 'T')).getTime()
    return isFinite(t) && t > Date.now()
  }

  return (
    <>
      {/* ------------------------------------------------------ mode */}
      <Section
        icon="sparkles"
        title="使用模式"
        desc="官方通道开箱即用、按用量扣积分；自定义通道使用你自己的 Key，不扣积分。"
        actions={
          <a className="btn btn-sm" href="https://neom.app/docs/ai" target="_blank" rel="noopener noreferrer">
            <Icon name="help" size={13} /> 计费说明
          </a>
        }
      >
        <div className="ac-mode-grid">
          <button
            type="button"
            className={'ac-mode' + (mode === 'official' ? ' active' : '')}
            onClick={() => setMode('official')}
          >
            <span className="radio" />
            <div>
              <div className="t">使用官方统一 AI 接口（扣积分）</div>
              <div className="d">
                无需任何配置，直接使用 NeoM 官方渠道。按模型实时价格从积分扣减，账单明细可查。
                当前余额 <b>{user?.points ?? 0}</b> 积分。
              </div>
            </div>
          </button>
          <button
            type="button"
            className={'ac-mode' + (mode === 'custom' ? ' active' : '')}
            onClick={() => setMode('custom')}
          >
            <span className="radio" />
            <div>
              <div className="t">使用个人自定义 API Key</div>
              <div className="d">
                填入下方任一供应商的 Key，请求直连上游。不扣积分，费用由你与服务商结算，适合已有额度或需要特定模型的用户。
              </div>
            </div>
          </button>
        </div>

        {mode === 'official' && (
          <div className="p-note" style={{ marginTop: 14 }}>
            <Icon name="info" size={15} />
            <span>
              官方通道的可用模型由管理员配置。下方「启用模型」与「场景默认模型」同样生效；价格表展示的是官方扣费标准。
            </span>
          </div>
        )}
      </Section>

      {/* -------------------------------------------------- providers */}
      <Section
        icon="key"
        title="API 供应商"
        desc="选择你已开通的供应商并填写 Key。Key 加密存储于服务端，接口只回传掩码。"
        actions={<span className="badge neutral">{AI_PROVIDERS.length} 家</span>}
      >
        {AI_PROVIDERS.map((p) => {
          const st = providerState[p.id] || emptyProviderState()
          const isActive = activeProvider === p.id
          const keySaved = hasKey[p.id]
          return (
            <div className={'ac-provider' + (isActive ? ' active' : '')} key={p.id}>
              <div className="ac-provider-head">
                <span className="ac-provider-name">
                  <Icon name={p.builtin ? 'cloud' : 'server'} size={14} />
                  {p.name}
                  {p.builtin && <span className="badge neutral">预设</span>}
                  {keySaved && <span className="badge ok">已配置</span>}
                </span>
                <span className="tiny dim" style={{ flex: '1 1 240px', minWidth: 160, lineHeight: 1.5 }}>
                  {PROVIDER_PURPOSE[p.id] || '自定义供应商，请填写 Base URL 与 API Key'}
                </span>
                <div className="ac-provider-actions">
                  {p.api_doc_url && (
                    <a className="btn btn-sm" href={p.api_doc_url} target="_blank" rel="noopener noreferrer">
                      <Icon name="external" size={12} /> 前往获取 API Key
                    </a>
                  )}
                  <button
                    className="btn btn-sm"
                    disabled={st.fetching}
                    onClick={() => {
                      setActiveProvider(p.id)
                      fetchModels(p.id)
                    }}
                  >
                    {st.fetching ? <span className="spinner" /> : <Icon name="list" size={12} />} 拉取模型列表
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={st.testing}
                    onClick={() => {
                      setActiveProvider(p.id)
                      testProvider(p.id)
                    }}
                  >
                    {st.testing ? <span className="spinner" /> : <Icon name="wifi" size={12} />} 测试连通性
                  </button>
                  <button className={'btn btn-sm' + (isActive ? ' btn-primary' : ' btn-ghost')} onClick={() => setActiveProvider(p.id)}>
                    {isActive ? '当前使用' : '设为当前'}
                  </button>
                </div>
              </div>

              {(isActive || st.models || st.testMsg) && (
                <div className="ac-provider-body">
                  <div className="ac-kline">
                    <input
                      className="input mono grow"
                      type="password"
                      autoComplete="off"
                      placeholder={keySaved ? '••••••••••（已保存，留空则不修改）' : `粘贴 ${p.name} 的 API Key`}
                      value={st.apiKey}
                      onFocus={() => setActiveProvider(p.id)}
                      onChange={(e) => patchProvider(p.id, { apiKey: e.target.value })}
                    />
                    {!p.builtin && (
                      <input
                        className="input mono"
                        style={{ maxWidth: 300 }}
                        placeholder={p.kind === 'anthropic' ? 'Base URL（如 https://api.anthropic.com）' : 'Base URL（如 https://api.example.com/v1）'}
                        value={st.baseUrl}
                        onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })}
                      />
                    )}
                  </div>

                  <div className="tiny dim">
                    接口地址：
                    <span className="mono">
                      {p.base_url_chat || p.base_url_anthropic || '（自定义，需填写 Base URL）'}
                    </span>
                    {p.needs_key ? ' · 需要 API Key' : ''}
                  </div>

                  {st.testMsg && (
                    <div
                      className="tiny"
                      style={{
                        color: st.testOk === false ? 'var(--danger)' : st.testOk ? 'var(--ok)' : 'var(--text-3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <Icon name={st.testOk === false ? 'alert' : st.testOk ? 'check' : 'info'} size={12} />
                      {st.testMsg}
                    </div>
                  )}

                  {st.models && (
                    <div>
                      <div className="tiny dim" style={{ marginBottom: 6 }}>
                        上游返回 {st.models.length} 个模型（点击加入启用列表）：
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {st.models.slice(0, 60).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={'chip' + (enabledModels.includes(m.id) ? ' active' : '')}
                            onClick={() => toggleModel(m.id)}
                            title={m.id}
                          >
                            {m.label || m.id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Section>

      {/* -------------------------------------------- model selection */}
      <Section
        icon="sliders"
        title="启用模型与场景默认"
        desc="勾选你希望出现在 AI 面板里的模型，并为四个场景各自指定默认模型。"
        actions={
          <button className="btn btn-sm" onClick={loadCatalog} disabled={catalogLoading}>
            {catalogLoading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新目录
          </button>
        }
      >
        {settingsLoading ? (
          <Loading />
        ) : (
          <>
            {catalogLoading ? (
              <Loading text="正在加载模型目录…" />
            ) : catalogErr ? (
              <ErrorBox message={catalogErr} onRetry={loadCatalog} />
            ) : enabledCatalog.length === 0 ? (
              <EmptyBox
                icon="robot"
                title="模型目录为空"
                desc="后端尚未配置可用模型；你仍可使用「拉取模型列表」从上游直接获取模型。"
              />
            ) : (
              <>
                <div className="row" style={{ marginBottom: 10, gap: 8 }}>
                  <span className="small muted grow">共 {enabledCatalog.length} 个可用模型</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEnabledModels(enabledCatalog.map((m) => m.id))}>
                    全选
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEnabledModels([])}>
                    清空
                  </button>
                </div>
                <div className="ac-model-list">
                  {enabledCatalog.map((m) => (
                    <label className="ac-model-check" key={m.id}>
                      <input
                        type="checkbox"
                        checked={enabledModels.includes(m.id)}
                        onChange={() => toggleModel(m.id)}
                      />
                      <span>
                        <span>
                          {m.label || m.id}
                          {freeModel(m) && <span className="badge ok" style={{ marginLeft: 6 }}>限免</span>}
                          {m.tag && <span className="badge neutral" style={{ marginLeft: 6 }}>{m.tag}</span>}
                        </span>
                        <span className="id">{m.id}</span>
                        <span className="id">
                          {CATEGORY_LABEL[m.category] || m.category}
                          {m.context_window ? ` · ${Math.round(m.context_window / 1000)}K 上下文` : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="ac-scene-grid" style={{ marginTop: 18 }}>
              {AI_SCENES.map((scene) => {
                const pool = modelsForScene(scene.key)
                return (
                  <Field key={scene.key} label={scene.label} hint={scene.hint}>
                    <select
                      className="select"
                      value={defaults[scene.key] || ''}
                      onChange={(e) => setDefaults((d) => ({ ...d, [scene.key]: e.target.value }))}
                    >
                      <option value="">未设置</option>
                      {pool.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label || m.id}
                        </option>
                      ))}
                    </select>
                  </Field>
                )
              })}
              <Field label="默认音色（TTS）" hint={voices.length ? `${voices.length} 个可用音色` : '后端未返回音色列表'}>
                <select className="select" value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)}>
                  <option value="">未设置</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name || v.id}
                      {v.lang ? ` (${v.lang})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Temperature" hint="0–2，留空使用模型默认">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="默认"
                />
              </Field>
            </div>
          </>
        )}

        <FormFooter note="保存后编辑器内的 AI 面板会立即使用新配置">
          <button className="btn" onClick={loadSettings} disabled={settingsLoading}>
            重新读取
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : <Icon name="save" size={13} />} 保存设置
          </button>
        </FormFooter>
      </Section>

      {/* ---------------------------------------------------- pricing */}
      <Section
        icon="coins"
        title="模型价格与选型"
        desc="单位：¥ / 百万 tokens；语音类按音频时长计价。官方通道按此标准从积分扣减。"
      >
        {catalog.length === 0 ? (
          <EmptyBox icon="chart" title="暂无价格数据" desc="模型目录接入后会展示每个模型的缓存输入 / 未命中输入 / 输出价格。" />
        ) : (
          <div className="ac-price-table">
            <table className="table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>类型</th>
                  <th className="num">缓存输入</th>
                  <th className="num">未命中输入</th>
                  <th className="num">输出</th>
                  <th className="num">音频 / 小时</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <b>{m.label || m.id}</b>
                        {m.tag && <span className="badge neutral">{m.tag}</span>}
                      </div>
                      <div className="tiny dim mono">{m.id}</div>
                    </td>
                    <td>{CATEGORY_LABEL[m.category] || m.category}</td>
                    <td className="num">{fmtPrice(m.price_cache_in)}</td>
                    <td className="num">{fmtPrice(m.price_in)}</td>
                    <td className="num">{fmtPrice(m.price_out)}</td>
                    <td className="num">{m.price_audio_hour ? fmtPrice(m.price_audio_hour) : '—'}</td>
                    <td>
                      {freeModel(m) ? (
                        <span className="badge ok">限免至 {fmtDate(m.free_until)}</span>
                      ) : m.billing === 'free' ? (
                        <span className="badge ok">免费</span>
                      ) : (
                        <span className="badge neutral">计费</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <div className="small" style={{ fontWeight: 650, marginBottom: 8 }}>
            <Icon name="help" size={14} /> 快速选型指南
          </div>
          <div className="ac-price-table">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>型号族</th>
                  <th style={{ width: 130 }}>适用场景</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {QUICK_PICK_GUIDE.map((g) => (
                  <tr key={g.family}>
                    <td>
                      <code className="mono">{g.family}</code>
                    </td>
                    <td>{g.scene}</td>
                    <td className="muted">{g.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-note" style={{ marginTop: 16 }}>
          <Icon name="info" size={15} />
          <span>
            扣费口径：缓存命中输入按 <b>缓存输入价</b>、未命中按 <b>输入价</b>、生成内容按 <b>输出价</b> 分别计价；
            语音识别按音频小时、语音合成按字符/次计价。自定义 Key 模式不产生积分扣减，但请求仍会记录用量。
          </span>
        </div>
      </Section>
    </>
  )
}

export default AiPanel
