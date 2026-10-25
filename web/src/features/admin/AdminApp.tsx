/**
 * NeoM Admin console — shell, auth gate, routing.
 * Mounted at /admin/* from App.tsx.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useStore } from '@/store'
import { api, getToken, setToken } from '@/lib/api'
import { cx } from './components'
import '../../styles/admin.css'

import Dashboard from './modules/Dashboard'
import Users from './modules/Users'
import AiConsole from './modules/AiConsole'
import Billing from './modules/Billing'
import Plugins from './modules/Plugins'
import Shares from './modules/Shares'
import Releases from './modules/Releases'
import Oss from './modules/Oss'
import SiteConfig from './modules/SiteConfig'
import Security from './modules/Security'

/* ------------------------------------------------------------------ types */
export interface AdminIdentity {
  id?: number
  username: string
  nickname?: string
  role?: string
  avatar?: string | null
}

export interface AdminCtxValue {
  admin: AdminIdentity
  /** backend unreachable → demo mode (every module shows 演示数据) */
  demo: boolean
  login: (token: string, admin: AdminIdentity, demo?: boolean) => void
  logout: () => void
  bootstrap: Record<string, unknown> | null
  setBootstrap: (v: Record<string, unknown> | null) => void
}

const AdminCtx = createContext<AdminCtxValue>({
  admin: { username: 'admin' },
  demo: false,
  login: () => {},
  logout: () => {},
  bootstrap: null,
  setBootstrap: () => {}
})

export const useAdmin = () => useContext(AdminCtx)

/* --------------------------------------------------------------- nav def */
interface NavItem { to: string; label: string; icon: string; desc: string; group: string }
const NAV: NavItem[] = [
  { to: 'dashboard', label: '数据驾驶舱', icon: 'chart', desc: '全站指标总览与趋势', group: '运营' },
  { to: 'users', label: '用户与权限', icon: 'users', desc: '账号、角色、积分与配额', group: '运营' },
  { to: 'ai', label: 'AI 接口与渠道', icon: 'robot', desc: '供应商渠道、Key 池、模型目录', group: '智能' },
  { to: 'billing', label: '商业化计费', icon: 'credit-card', desc: '定价、积分、支付、卡密、财务', group: '智能' },
  { to: 'plugins', label: '插件开放平台', icon: 'puzzle', desc: '内置插件、上架审核、版本与安全', group: '生态' },
  { to: 'shares', label: '分享与发布监管', icon: 'share', desc: '分享链接、发布页、评论与敏感词', group: '生态' },
  { to: 'releases', label: '客户端版本', icon: 'download', desc: '全平台安装包与更新策略', group: '运维' },
  { to: 'oss', label: '公共 OSS 备份', icon: 'cloud', desc: '对象存储、目录浏览、清理', group: '运维' },
  { to: 'site', label: '门户与站点', icon: 'globe', desc: '首屏文案、协议、注册与公告', group: '运维' },
  { to: 'security', label: '系统安全运维', icon: 'shield', desc: '审计、限流、备份、错误日志', group: '运维' }
]
const GROUPS = ['运营', '智能', '生态', '运维']

const ADMIN_TOKEN_NOTE = 'neom.admin.session'
const ADMIN_DEMO_KEY = 'neom.admin.demo'

const readSession = (): AdminIdentity | null => {
  try {
    const raw = localStorage.getItem(ADMIN_TOKEN_NOTE)
    return raw ? (JSON.parse(raw) as AdminIdentity) : null
  } catch { return null }
}
const writeSession = (a: AdminIdentity | null) => {
  try {
    if (a) localStorage.setItem(ADMIN_TOKEN_NOTE, JSON.stringify(a))
    else localStorage.removeItem(ADMIN_TOKEN_NOTE)
  } catch { /* quota — ignore */ }
}

/* ------------------------------------------------------------ login page */
const LoginPage: React.FC<{ onDone: (t: string | null, a: AdminIdentity, demo?: boolean) => void; notice?: string }> = ({ onDone, notice }) => {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await api.post<{ token?: string; accessToken?: string; user?: AdminIdentity }>('/api/admin/login', {
        username: username.trim(),
        password
      })
      const tk = (res && (res.token || res.accessToken)) || null
      if (!tk) throw new Error('登录响应缺少 token')
      setToken(tk)
      const who: AdminIdentity = (res?.user as AdminIdentity) || { username: username.trim(), role: 'admin' }
      writeSession(who)
      localStorage.removeItem(ADMIN_DEMO_KEY)
      onDone(tk, who, false)
    } catch (e2) {
      const eo = e2 as { message?: string; statusCode?: number; code?: string }
      const status = eo.statusCode
      if (status === 401 || status === 400 || status === 403 || eo.code === 'BAD_CREDENTIALS') {
        setErr(eo.message || '账号或密码错误')
      } else if (!status || status === 404 || status >= 500 || eo.code === 'HTTP_404') {
        setOffline(true)
        setErr(`无法连接管理接口（${eo.message || '网络错误'}）。后端 /api/admin/* 可能尚未就绪。`)
      } else {
        setErr(eo.message || '登录失败')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="adm-login-wrap">
      <form className="adm-login" onSubmit={submit}>
        <div className="row" style={{ gap: 10, marginBottom: 16 }}>
          <span className="adm-brand-mark" style={{ width: 32, height: 32, borderRadius: 10, fontSize: 13 }}>N</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>NeoM 管理控制台</div>
            <div className="tiny dim">ACL · role=admin required</div>
          </div>
        </div>
        <h1>管理员登录</h1>
        <p className="adm-login-sub">使用宝塔面板管理账号进入。所有操作都会写入审计日志。</p>
        {notice && <div className="adm-note" style={{ marginBottom: 12 }}>{notice}</div>}
        {err && <div className="adm-login-err">{err}</div>}
        <div className="field">
          <label>管理员账号</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>密码</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="NeoM@2026"
            autoComplete="current-password"
          />
        </div>
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> : <Icon name="lock" size={15} />}
          进入控制台
        </button>
        {offline && (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ marginTop: 8 }}
            onClick={() => {
              localStorage.setItem(ADMIN_DEMO_KEY, '1')
              onDone(null, { username: username.trim() || 'admin', role: 'admin' }, true)
            }}
          >
            <Icon name="info" size={14} /> 后端不可用？以演示数据进入
          </button>
        )}
        <div className="tiny dim" style={{ marginTop: 14, lineHeight: 1.6 }}>
          · 未登录或非 admin 角色无法访问任何 /api/admin/* 接口<br />
          · 401 会自动返回此页面
        </div>
      </form>
    </div>
  )
}

/* ----------------------------------------------------------- side nav */
const SideNav: React.FC<{ collapsed: boolean; onToggle: () => void; admin: AdminIdentity; demo: boolean }> = ({ collapsed, admin, demo }) => {
  const body = (
    <>
      <div className="adm-brand">
        <span className="adm-brand-mark">N</span>
        {!collapsed && (
          <div className="adm-brand-text">
            <span className="adm-brand-title">NeoM Admin</span>
            <span className="adm-brand-sub">control plane</span>
          </div>
        )}
      </div>
      <nav className="adm-nav">
        {GROUPS.map((g) => {
          const items = NAV.filter((n) => n.group === g)
          if (!items.length) return null
          return (
            <div key={g}>
              {!collapsed && <div className="adm-nav-group">{g}</div>}
              {collapsed && <div style={{ height: 8 }} />}
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) => cx('adm-nav-item', isActive && 'active')}
                  title={collapsed ? n.label : n.desc}
                >
                  <Icon name={n.icon} size={16} />
                  {!collapsed && <span className="adm-nav-label">{n.label}</span>}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="adm-side-foot">
        {!collapsed && (
          <div className="row tiny dim" style={{ padding: '0 4px 4px', gap: 6 }}>
            <Icon name={demo ? 'info' : 'check'} size={12} />
            {demo ? '演示模式（后端未连接）' : `已登录：${admin.username}`}
          </div>
        )}
      </div>
    </>
  )
  return <aside className={cx('adm-side', collapsed && 'collapsed')}>{body}</aside>
}

/* --------------------------------------------------------------- layout */
const AdminLayout: React.FC = () => {
  const { admin, demo, logout, bootstrap } = useAdmin()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useStore((s) => s.toast)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('neom.admin.nav') === '1')
  const [q, setQ] = useState('')
  const [bell, setBell] = useState(false)
  const [menu, setMenu] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem('neom.admin.nav', collapsed ? '1' : '0')
  }, [collapsed])

  const current = useMemo(() => {
    const seg = location.pathname.replace(/^\/admin\/?/, '').split('/')[0] || 'dashboard'
    return NAV.find((n) => n.to === seg) || NAV[0]
  }, [location.pathname])

  const hits = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return []
    return NAV.filter((n) => (n.label + n.desc + n.to).toLowerCase().includes(k)).slice(0, 6)
  }, [q])

  // ⌘K / Ctrl+K focuses the global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const alerts = useMemo(() => {
    const list: { icon: string; text: string; to?: string; tone?: 'warn' | 'danger' }[] = []
    const b = bootstrap as Record<string, any> | null
    if (b) {
      const pending = Number(b.plugins_pending || b.pending_plugins || 0)
      if (pending > 0) list.push({ icon: 'puzzle', text: `${pending} 个插件待审核`, to: 'plugins', tone: 'warn' })
      const failed = Number(b.channels_failed || 0)
      if (failed > 0) list.push({ icon: 'robot', text: `${failed} 个 AI 渠道异常`, to: 'ai', tone: 'danger' })
      const refunds = Number(b.orders_refund_pending || 0)
      if (refunds > 0) list.push({ icon: 'credit-card', text: `${refunds} 笔退款待处理`, to: 'billing', tone: 'warn' })
    }
    if (!list.length && demo) {
      list.push(
        { icon: 'puzzle', text: '2 个插件待审核（演示）', to: 'plugins', tone: 'warn' },
        { icon: 'credit-card', text: '1 笔退款待处理（演示）', to: 'billing', tone: 'warn' },
        { icon: 'server', text: '磁盘使用率 78%（演示）', to: 'dashboard' }
      )
    }
    if (!list.length) list.push({ icon: 'check', text: '暂无待处理告警' })
    return list
  }, [bootstrap, demo])

  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const toggleTheme = () => {
    const next = (document.documentElement.dataset.theme || theme) === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('neom.theme', next) } catch { /* ignore */ }
    setTheme(next as 'light' | 'dark')
  }

  return (
    <div className="adm-root">
      <SideNav collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} admin={admin} demo={demo} />
      <div className="adm-main">
        <header className="adm-top">
          <button className="btn-icon" onClick={() => setCollapsed((v) => !v)} title={collapsed ? '展开导航' : '收起导航'}>
            <Icon name="sidebar" size={15} />
          </button>
          <div className="adm-crumb">
            <Icon name={current.icon} size={14} />
            <span>管理后台</span>
            <Icon name="chevron-right" size={11} />
            <b className="ellipsis">{current.label}</b>
          </div>

          <div className="adm-top-search" style={{ marginLeft: 'auto' }}>
            <span className="adm-ts-icon"><Icon name="search" size={13} /></span>
            <input
              ref={searchRef}
              className="input"
              placeholder="搜索功能或模块…  Ctrl K"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hits[0]) { navigate(hits[0].to); setQ('') }
                if (e.key === 'Escape') setQ('')
              }}
            />
            {hits.length > 0 && (
              <div className="adm-pop" style={{ left: 0, right: 'auto', top: 34 }}>
                {hits.map((h) => (
                  <button
                    key={h.to}
                    className="menu-item"
                    onClick={() => { navigate(h.to); setQ('') }}
                  >
                    <Icon name={h.icon} size={14} />
                    <span className="menu-label">{h.label}</span>
                    <span className="menu-hint">{h.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="btn-icon" onClick={toggleTheme} title="切换明/深色">
            <Icon name={(document.documentElement.dataset.theme || 'light') === 'dark' ? 'sparkles' : 'ai'} size={15} />
          </button>

          <div style={{ position: 'relative' }}>
            <button className="btn-icon" onClick={() => { setBell((v) => !v); setMenu(false) }} title="通知">
              <Icon name="bell" size={15} />
              {alerts.some((a) => a.tone) && (
                <i style={{
                  position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--danger)', border: '1px solid var(--surface)'
                }} />
              )}
            </button>
            {bell && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setBell(false)} />
                <div className="adm-pop">
                  <div className="menu-title">待处理事项</div>
                  {alerts.map((a, i) => (
                    <div
                      key={i}
                      className="adm-pop-item"
                      style={{ cursor: a.to ? 'pointer' : 'default', alignItems: 'center' }}
                      onClick={() => { if (a.to) { navigate(a.to); setBell(false) } }}
                    >
                      <Icon name={a.icon} size={14} style={{ color: a.tone === 'danger' ? 'var(--danger)' : a.tone === 'warn' ? 'var(--warn)' : 'var(--ok)' }} />
                      <span className="grow">{a.text}</span>
                      {a.to && <Icon name="chevron-right" size={12} />}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              className="row"
              style={{ border: 'none', background: 'transparent', padding: '2px 6px 2px 2px', borderRadius: 99, gap: 7 }}
              onClick={() => { setMenu((v) => !v); setBell(false) }}
            >
              <span className="adm-avatar">{(admin.nickname || admin.username || 'A').slice(0, 1)}</span>
              <span className="small" style={{ fontWeight: 600, maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {admin.nickname || admin.username}
              </span>
              <Icon name="chevron-down" size={11} />
            </button>
            {menu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setMenu(false)} />
                <div className="adm-pop" style={{ width: 224 }}>
                  <div style={{ padding: '8px 10px 6px' }}>
                    <div style={{ fontWeight: 650 }}>{admin.nickname || admin.username}</div>
                    <div className="tiny dim">{admin.role || 'admin'} · {demo ? '演示模式' : '在线'}</div>
                  </div>
                  <div className="menu-divider" />
                  <button className="menu-item" onClick={() => { setMenu(false); navigate('/app') }}>
                    <Icon name="edit" size={14} /><span className="menu-label">返回编辑器</span>
                  </button>
                  <button className="menu-item" onClick={() => { setMenu(false); navigate('site') }}>
                    <Icon name="settings" size={14} /><span className="menu-label">站点设置</span>
                  </button>
                  <button className="menu-item" onClick={() => { setMenu(false); navigate('security') }}>
                    <Icon name="shield" size={14} /><span className="menu-label">操作审计</span>
                  </button>
                  <div className="menu-divider" />
                  <button className="menu-item danger" onClick={() => { setMenu(false); logout() }}>
                    <Icon name="logout" size={14} /><span className="menu-label">退出登录</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="adm-body">
          <div className="adm-page">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ root */
type Phase = 'checking' | 'login' | 'ready'

export default function AdminApp() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [admin, setAdmin] = useState<AdminIdentity>({ username: 'admin' })
  const [demo, setDemo] = useState(false)
  const [bootstrap, setBootstrap] = useState<Record<string, unknown> | null>(null)
  const [notice, setNotice] = useState<string | undefined>()
  const user = useStore((s) => s.user)

  const login = useCallback((token: string | null, who: AdminIdentity, isDemo = false) => {
    if (token) setToken(token)
    setAdmin(who)
    setDemo(isDemo)
    writeSession(who)
    setPhase('ready')
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    writeSession(null)
    localStorage.removeItem(ADMIN_DEMO_KEY)
    setDemo(false)
    setBootstrap(null)
    setNotice('已安全退出管理控制台。')
    setPhase('login')
  }, [])

  /* auth gate -------------------------------------------------------- */
  useEffect(() => {
    let alive = true
    ;(async () => {
      // explicit demo session (backend unavailable last time)
      if (localStorage.getItem(ADMIN_DEMO_KEY) === '1') {
        if (alive) {
          const s = readSession()
          setAdmin(s || { username: 'admin', role: 'admin' })
          setDemo(true)
          setPhase('ready')
        }
        return
      }
      const tk = getToken()
      if (!tk) {
        if (alive) {
          setNotice(user ? `当前账号「${user.username}」不是管理员，请使用管理员账号登录。` : undefined)
          setPhase('login')
        }
        return
      }
      try {
        const d = await api.get<Record<string, unknown>>('/api/admin/dashboard')
        if (!alive) return
        setBootstrap(d || null)
        const s = readSession()
        setAdmin(s || { username: user?.username || 'admin', role: 'admin' })
        setDemo(false)
        setPhase('ready')
      } catch (e) {
        if (!alive) return
        const err = e as { statusCode?: number; message?: string }
        if (err.statusCode === 401 || err.statusCode === 403 || !getToken()) {
          writeSession(null)
          setPhase('login')
          setNotice(
            err.statusCode === 403
              ? '当前账号没有管理员权限（role≠admin）。'
              : '登录状态已过期或接口未就绪，请重新登录。'
          )
        } else {
          // backend not deployed yet → read-only demo console
          const s = readSession()
          setAdmin(s || { username: 'admin', role: 'admin' })
          setDemo(true)
          setPhase('ready')
        }
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ctx = useMemo<AdminCtxValue>(
    () => ({ admin, demo, login: (t, w, d) => login(t, w, d), logout, bootstrap, setBootstrap }),
    [admin, demo, login, logout, bootstrap]
  )

  if (phase === 'checking') {
    return (
      <div className="adm-login-wrap">
        <div className="col center" style={{ gap: 12 }}>
          <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <div className="dim small">正在校验管理员权限…</div>
        </div>
      </div>
    )
  }

  if (phase === 'login') {
    return <LoginPage onDone={(t, who, d) => login(t, who, d)} notice={notice} />
  }

  return (
    <AdminCtx.Provider value={ctx}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="users" element={<Users />} />
          <Route path="ai" element={<AiConsole />} />
          <Route path="billing" element={<Billing />} />
          <Route path="plugins" element={<Plugins />} />
          <Route path="shares" element={<Shares />} />
          <Route path="releases" element={<Releases />} />
          <Route path="oss" element={<Oss />} />
          <Route path="site" element={<SiteConfig />} />
          <Route path="security" element={<Security />} />
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>
      </Routes>
    </AdminCtx.Provider>
  )
}
