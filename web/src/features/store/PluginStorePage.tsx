/**
 * `/plugins` — plugin store. Browsing works without login, installing requires it.
 */
import React, { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API, type InstalledPlugin, type StorePlugin } from '@/lib/contracts'
import { useStore } from '@/store'
import { Dialog } from '@/components/Overlays'
import { DocsDialog, SiteFooter, SiteHeader } from '@/features/marketing/PortalChrome'
import {
  CATEGORY_LABEL,
  DEFAULT_SITE_CONFIG,
  FALLBACK_STORE_PLUGINS,
  PLUGIN_CATEGORIES,
  normalizeSiteConfig
} from '@/features/marketing/portalData'
import { fmtDate, fmtNum, pick, safeArr, useRemote } from '@/features/marketing/portalKit'
import '@/styles/portal-base.css'
import '@/styles/portal-store.css'

type SortKey = 'downloads' | 'rating' | 'latest'

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'downloads', label: '下载量' },
  { id: 'rating', label: '评分' },
  { id: 'latest', label: '最新' }
]

const normalizeStore = (raw: any): StorePlugin => ({
  id: String(pick(raw, ['id', 'plugin_id'], '')),
  name: String(pick(raw, ['name', 'title'], '未命名插件')),
  version: String(pick(raw, ['version'], '1.0.0')),
  description: String(pick(raw, ['description', 'desc', 'summary'], '')),
  author: String(pick(raw, ['author', 'owner'], '未知作者')),
  category: String(pick(raw, ['category'], 'productivity')),
  downloads: Number(pick(raw, ['downloads', 'download_count'], 0)),
  rating: Number(pick(raw, ['rating', 'score'], 0)),
  icon: String(pick(raw, ['icon'], 'puzzle') || 'puzzle'),
  screenshots: safeArr<string>(pick(raw, ['screenshots', 'images'], [])).map(String),
  changelog: String(pick(raw, ['changelog', 'update_log'], '') || ''),
  published_at: String(pick(raw, ['published_at', 'created_at', 'date'], '')),
  status: (pick(raw, ['status'], 'published') as StorePlugin['status']) || 'published',
  builtin: !!pick(raw, ['builtin'], false)
})

const normalizeInstalled = (raw: any): InstalledPlugin => {
  const m = raw?.manifest || {}
  return {
    id: String(pick(raw, ['id', 'plugin_id'], '') || pick(m, ['id'], '')),
    version: String(pick(raw, ['version'], '') || pick(m, ['version'], '1.0.0')),
    enabled: pick(raw, ['enabled'], true) !== false,
    source: (pick(raw, ['source'], 'store') as InstalledPlugin['source']) || 'store',
    installed_at: String(pick(raw, ['installed_at', 'created_at'], '')),
    manifest: Object.keys(m).length ? m : undefined,
    update_available: pick(raw, ['update_available', 'latest_version'], undefined)
  }
}

const PERMISSION_HINTS: Record<string, string> = {
  'files:read': '读取你的笔记内容',
  'files:write': '创建与修改笔记文件',
  'editor:write': '写入当前编辑器正文',
  'net:fetch': '发起任意外部网络请求',
  'ai:chat': '调用 AI 接口（会消耗积分）',
  'ui:modal': '打开弹窗界面',
  'settings': '读写插件自身设置'
}

const PluginStorePage: React.FC = () => {
  const toast = useStore((s) => s.toast)
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)

  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SortKey>('downloads')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<StorePlugin | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [policy, setPolicy] = useState<'terms' | 'privacy' | null>(null)
  const [localEnabled, setLocalEnabled] = useState<Record<string, boolean>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const config = useRemote<any>('/api/site/config', DEFAULT_SITE_CONFIG, normalizeSiteConfig)
  const storeRemote = useRemote<any>(API.pluginsStore, FALLBACK_STORE_PLUGINS, (raw) => {
    const list = safeArr<any>(raw).map(normalizeStore).filter((p) => p.id)
    return list.length ? list : FALLBACK_STORE_PLUGINS
  })
  const installedRemote = useRemote<any>(
    user ? API.pluginsInstalled : null,
    [] as InstalledPlugin[],
    (raw) => safeArr<any>(raw).map(normalizeInstalled).filter((p) => p.id)
  )

  const installedMap = useMemo(() => {
    const m = new Map<string, InstalledPlugin>()
    for (const p of installedRemote.data) m.set(p.id, p)
    return m
  }, [installedRemote.data])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: storeRemote.data.length }
    for (const p of storeRemote.data) m[p.category] = (m[p.category] || 0) + 1
    return m
  }, [storeRemote.data])

  const plugins = useMemo(() => {
    let list = [...storeRemote.data]
    if (category !== 'all') list = list.filter((p) => p.category === category)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      if (sort === 'downloads') return b.downloads - a.downloads
      if (sort === 'rating') return b.rating - a.rating
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0
      return tb - ta
    })
    return list
  }, [storeRemote.data, category, query, sort])

  const isInstalled = (id: string) => installedMap.has(id)
  const isEnabled = (id: string) => {
    if (id in localEnabled) return localEnabled[id]
    return installedMap.get(id)?.enabled ?? false
  }
  const hasUpdate = (id: string) => {
    const inst = installedMap.get(id)
    const live = storeRemote.data.find((p) => p.id === id)
    if (!inst || !live) return false
    return !!inst.update_available || (live.version && inst.version && live.version !== inst.version)
  }

  const requireLogin = (): boolean => {
    if (user) return false
    toast({ kind: 'warn', text: '安装插件需要先登录' })
    openModal('login', { redirect: '/plugins' })
    return true
  }

  const install = async (p: StorePlugin) => {
    if (requireLogin()) return
    setBusy('install-' + p.id)
    try {
      await api.post(API.pluginsInstall, { id: p.id, version: p.version })
      toast({ kind: 'ok', text: `「${p.name}」安装成功` })
      installedRemote.reload()
      setLocalEnabled((s) => ({ ...s, [p.id]: true }))
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '安装失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  const update = async (p: StorePlugin) => {
    if (requireLogin()) return
    setBusy('update-' + p.id)
    try {
      await api.post(API.pluginsUpdate, { id: p.id })
      toast({ kind: 'ok', text: `「${p.name}」已更新到 v${p.version}` })
      installedRemote.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '更新失败' })
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (p: StorePlugin) => {
    if (requireLogin()) return
    const next = !isEnabled(p.id)
    setLocalEnabled((s) => ({ ...s, [p.id]: next }))
    setBusy('toggle-' + p.id)
    try {
      await api.post(API.pluginsToggle, { id: p.id, enabled: next })
      toast({ kind: 'ok', text: `${next ? '已启用' : '已停用'}「${p.name}」` })
    } catch (e: any) {
      setLocalEnabled((s) => ({ ...s, [p.id]: !next }))
      toast({ kind: 'error', text: e?.message || '操作失败' })
    } finally {
      setBusy(null)
    }
  }

  const uninstall = async (p: StorePlugin) => {
    if (requireLogin()) return
    setBusy('uninstall-' + p.id)
    try {
      await api.post(API.pluginsUninstall, { id: p.id })
      toast({ kind: 'ok', text: `已卸载「${p.name}」` })
      installedRemote.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '卸载失败' })
    } finally {
      setBusy(null)
    }
  }

  const upload = async (file: File) => {
    if (requireLogin()) return
    if (!/\.zip$/i.test(file.name)) {
      toast({ kind: 'warn', text: '请上传 .zip 插件包（根目录需含 manifest.json）' })
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.upload<any>(API.pluginsUpload, form)
      const name = String(pick(res, ['id'], '') || pick((res as any)?.manifest || {}, ['name'], file.name))
      toast({ kind: 'ok', text: `插件「${name}」已上传安装` })
      installedRemote.reload()
      storeRemote.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '上传失败，请检查插件包结构' })
    } finally {
      setUploading(false)
    }
  }

  const renderActions = (p: StorePlugin) => {
    const installed = isInstalled(p.id)
    const enabled = isEnabled(p.id)
    const updatable = hasUpdate(p.id)
    if (!installed) {
      return (
        <button className="btn btn-sm btn-primary" onClick={() => install(p)} disabled={busy === 'install-' + p.id}>
          {busy === 'install-' + p.id ? <span className="spinner" /> : <Icon name="download" size={12} />} 安装
        </button>
      )
    }
    return (
      <>
        {updatable ? (
          <button className="btn btn-sm btn-primary" onClick={() => update(p)} disabled={busy === 'update-' + p.id}>
            {busy === 'update-' + p.id ? <span className="spinner" /> : <Icon name="refresh" size={12} />} 更新
          </button>
        ) : (
          <button
            className="btn btn-sm"
            onClick={() => toggle(p)}
            disabled={busy === 'toggle-' + p.id}
            title={enabled ? '点击停用' : '点击启用'}
          >
            <span className={'switch' + (enabled ? ' on' : '')} style={{ pointerEvents: 'none' }} />
            {enabled ? '已启用' : '已停用'}
          </button>
        )}
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => uninstall(p)}
          disabled={busy === 'uninstall-' + p.id || p.builtin}
          title={p.builtin ? '内置插件不可卸载' : '卸载'}
        >
          <Icon name="trash" size={12} />
        </button>
      </>
    )
  }

  return (
    <div className="portal">
      <SiteHeader />

      <div className="p-page">
        <div className="p-page-head">
          <div>
            <div className="p-eyebrow">
              <Icon name="puzzle" size={13} /> 插件生态
            </div>
            <h1 className="p-title" style={{ fontSize: 26 }}>
              插件应用商店
            </h1>
            <p className="p-sub" style={{ fontSize: 13 }}>
              24 款官方插件 + 社区投稿。安装后可在编辑器功能区、侧栏、状态栏与命令面板使用。
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="p-btn p-btn-sm" to="/plugins/dev">
              <Icon name="code" size={13} /> 开发指南
            </Link>
            <Link className="p-btn p-btn-sm" to="/app">
              <Icon name="edit" size={13} /> 打开编辑器
            </Link>
          </div>
        </div>

        <div className="store-layout">
          {/* ------------------------------------------------ categories */}
          <aside className="store-side">
            <div className="store-side-title">分类</div>
            {PLUGIN_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={'store-cat' + (category === c.id ? ' active' : '')}
                onClick={() => setCategory(c.id)}
              >
                <Icon
                  name={
                    { all: 'grid', core: 'settings', visualization: 'graph', productivity: 'sparkles', media: 'video', data: 'database', ai: 'robot', publish: 'globe' }[
                      c.id
                    ] || 'grid'
                  }
                  size={14}
                />
                <span className="grow">{c.label}</span>
                <span className="n">{counts[c.id] || 0}</span>
              </button>
            ))}
          </aside>

          {/* ------------------------------------------------------ main */}
          <main className="store-main">
            <div className="store-toolbar">
              <div className="store-search">
                <Icon name="search" size={14} />
                <input
                  className="input"
                  placeholder="搜索插件名称、作者或关键词…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="row" style={{ gap: 4 }}>
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={'chip' + (sort === s.id ? ' active' : '')}
                    onClick={() => setSort(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <button className="btn btn-sm" onClick={storeRemote.reload} disabled={storeRemote.loading}>
                {storeRemote.loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
              </button>
            </div>

            {!user && (
              <div className="p-note" style={{ marginBottom: 14 }}>
                <Icon name="info" size={15} />
                <span className="grow">浏览商店无需登录；安装 / 卸载 / 启用插件需要登录账号。</span>
                <button className="btn btn-sm" onClick={() => openModal('login', { redirect: '/plugins' })}>
                  登录
                </button>
              </div>
            )}

            {storeRemote.degraded && !storeRemote.loading && (
              <div className="p-note warn" style={{ marginBottom: 14 }}>
                <Icon name="alert" size={15} />
                <span>插件商店接口暂不可用，当前展示内置的 24 款官方插件清单。</span>
              </div>
            )}

            {storeRemote.loading ? (
              <div className="store-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div className="store-card" key={i}>
                    <div className="store-card-top">
                      <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 11 }} />
                      <div className="grow">
                        <div className="skeleton p-skel" style={{ width: '62%', marginBottom: 7 }} />
                        <div className="skeleton p-skel" style={{ width: '40%', height: 9 }} />
                      </div>
                    </div>
                    <div className="skeleton p-skel" style={{ width: '100%', height: 32 }} />
                    <div className="skeleton p-skel" style={{ width: '50%', height: 10 }} />
                  </div>
                ))}
              </div>
            ) : plugins.length === 0 ? (
              <div className="p-state">
                <Icon name="search" size={22} />
                <strong>没有找到匹配的插件</strong>
                <span>试试换个关键词或切换分类</span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setQuery('')
                    setCategory('all')
                  }}
                >
                  清除筛选
                </button>
              </div>
            ) : (
              <div className="store-grid">
                {plugins.map((p) => {
                  const installed = isInstalled(p.id)
                  return (
                    <article className="store-card" key={p.id}>
                      <div className="store-card-top">
                        <span className="p-tile grad">
                          <Icon name={p.icon} size={18} />
                        </span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="store-card-name">
                            {p.name}
                            {installed && (
                              <span className={'badge ' + (isEnabled(p.id) ? 'ok' : 'neutral')}>
                                {isEnabled(p.id) ? '已启用' : '已安装'}
                              </span>
                            )}
                            {hasUpdate(p.id) && <span className="badge warn">可更新</span>}
                          </div>
                          <div className="store-card-author">
                            {p.author} · v{p.version} · {CATEGORY_LABEL[p.category] || p.category}
                          </div>
                        </div>
                      </div>

                      <div className="store-card-desc">{p.description}</div>

                      <div className="store-card-stats">
                        <span>
                          <Icon name="download" size={11} /> {fmtNum(p.downloads)}
                        </span>
                        <span className="rating">
                          <Icon name="star" size={11} filled /> {p.rating ? p.rating.toFixed(1) : '—'}
                        </span>
                        {p.builtin && (
                          <span>
                            <Icon name="shield" size={11} /> 官方
                          </span>
                        )}
                      </div>

                      <div className="store-card-actions">
                        {renderActions(p)}
                        <button className="btn btn-sm btn-ghost" onClick={() => setDetail(p)} style={{ marginLeft: 'auto' }}>
                          详情
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}

            {/* ----------------------------------------------- upload */}
            <div className="upload-band" style={{ marginTop: 22 }}>
              <span className="p-tile">
                <Icon name="upload" size={18} />
              </span>
              <div className="grow" style={{ minWidth: 200 }}>
                <div className="small" style={{ fontWeight: 650 }}>
                  自己上传安装
                </div>
                <div className="tiny muted" style={{ lineHeight: 1.6, marginTop: 2 }}>
                  打包为 zip（根目录含 manifest.json），上传后仅你自己可见、立即可用。
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <span className="spinner" /> : <Icon name="upload" size={13} />} 选择插件包
              </button>
              <Link className="btn btn-sm btn-ghost" to="/plugins/dev">
                查看打包规范
              </Link>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload(f)
                  e.target.value = ''
                }}
              />
            </div>
          </main>
        </div>
      </div>

      <SiteFooter config={config.data} onPolicy={(w) => setPolicy(w)} />

      {/* ------------------------------------------------------ detail */}
      {detail && (
        <Dialog
          title="插件详情"
          icon="puzzle"
          onClose={() => setDetail(null)}
          width={720}
          footer={
            <>
              <span className="tiny dim grow">
                {isInstalled(detail.id) ? '已安装 · 可在「我的插件」中管理' : '安装后可在编辑器中启用'}
              </span>
              <button className="btn" onClick={() => setDetail(null)}>
                关闭
              </button>
              {renderActions(detail)}
            </>
          }
        >
          <div className="store-detail">
            <div className="store-detail-head">
              <span className="p-tile grad">
                <Icon name={detail.icon} size={24} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="store-detail-name">{detail.name}</div>
                <div className="store-detail-meta">
                  <span>{detail.author}</span>
                  <span className="mono">v{detail.version}</span>
                  <span>{CATEGORY_LABEL[detail.category] || detail.category}</span>
                  <span>
                    <Icon name="download" size={11} /> {fmtNum(detail.downloads)}
                  </span>
                  <span>
                    <Icon name="star" size={11} filled /> {detail.rating ? detail.rating.toFixed(1) : '—'}
                  </span>
                  {detail.published_at && <span>发布于 {fmtDate(detail.published_at)}</span>}
                </div>
              </div>
            </div>

            <p className="small" style={{ margin: 0, lineHeight: 1.75, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
              {detail.description || '该插件没有提供详细描述。'}
            </p>

            <div>
              <div className="small" style={{ fontWeight: 650, marginBottom: 8 }}>
                <Icon name="image" size={13} /> 截图
              </div>
              <div className="store-shots">
                {(detail.screenshots?.length ? detail.screenshots.slice(0, 3) : [null, null, null]).map((src, i) =>
                  src ? (
                    <img
                      key={i}
                      src={src}
                      alt={`${detail.name} 截图 ${i + 1}`}
                      loading="lazy"
                      style={{ width: '100%', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
                    />
                  ) : (
                    <div className="store-shot" key={i}>
                      <Icon name="image" size={18} />
                      <span>截图占位</span>
                    </div>
                  )
                )}
              </div>
            </div>

            <div>
              <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>
                <Icon name="key" size={13} /> 权限说明
              </div>
              <div className="tiny dim" style={{ marginBottom: 6 }}>
                插件安装后只能使用以下声明过的权限，未声明的能力会被运行时阻断。
              </div>
              {(detail.builtin
                ? ['files:read', 'files:write', 'editor:write']
                : ['files:read', 'editor:write', 'net:fetch']
              ).map((perm) => (
                <div className="store-perm" key={perm}>
                  <code>{perm}</code>
                  <span>{PERMISSION_HINTS[perm] || '自定义权限，请谨慎授予'}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>
                <Icon name="history" size={13} /> 更新日志与版本历史
              </div>
              <div>
                <div className="store-log">
                  <span className="v">v{detail.version}</span>
                  {detail.changelog || '当前版本没有提供更新说明。'}
                  <span className="tiny dim"> · {detail.published_at ? fmtDate(detail.published_at) : '—'}</span>
                </div>
                <div className="store-log">
                  <span className="v">v1.0.0</span>
                  首个公开版本。
                </div>
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {policy && <DocsDialog which={policy} onClose={() => setPolicy(null)} />}
    </div>
  )
}

export default PluginStorePage
