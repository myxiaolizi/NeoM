import React, { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store'
import { api, setUnauthorizedHandler } from './lib/api'
import { GlobalOverlays } from './components/Overlays'
import { setWindowTitle } from './lib/platform'

const Landing = lazy(() => import('./features/marketing/Landing'))
const Login = lazy(() => import('./features/auth/Login'))
const Register = lazy(() => import('./features/auth/Register'))
const EditorApp = lazy(() => import('./shell/EditorApp'))
const Account = lazy(() => import('./features/account/AccountPage'))
const Admin = lazy(() => import('./features/admin/AdminApp'))
const PluginStore = lazy(() => import('./features/store/PluginStorePage'))
const PluginDevGuide = lazy(() => import('./features/store/PluginDevGuide'))
const DownloadPage = lazy(() => import('./features/download/DownloadPage'))
const SharePage = lazy(() => import('./features/share/SharePage'))
const MobileApp = lazy(() => import('./shell/MobileApp'))

const Loading = () => (
  <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-app)' }}>
    <div className="center col" style={{ gap: 14 }}>
      <div className="spinner" style={{ width: 26, height: 26, borderWidth: 3 }} />
      <div className="dim small">NeoM 正在启动…</div>
    </div>
  </div>
)

const isMobileViewport = () =>
  typeof window !== 'undefined' &&
  (/android|iphone|ipad|ipod/i.test(navigator.userAgent) || window.innerWidth < 768)

export default function App() {
  const setUser = useStore((s) => s.setUser)
  const setAuthReady = useStore((s) => s.setAuthReady)
  const user = useStore((s) => s.user)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // Only the signed-in-only areas bounce to /login. The editor deliberately
    // does NOT: NeoM must stay fully usable without an account (local mode).
    setUnauthorizedHandler(() => {
      const p = location.pathname
      if (!p.startsWith('/account') && !p.startsWith('/admin')) return
      navigate('/login?redirect=' + encodeURIComponent(p), { replace: true })
    })
  }, [navigate, location.pathname])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // `/api/auth/me` returns the profile either flat or wrapped in { user }.
        const me = await api.get<any>('/api/auth/me')
        if (alive) setUser((me?.user || me) ?? null)
      } catch {
        if (alive) setUser(null)
      } finally {
        if (alive) setAuthReady(true)
      }
    })()
    return () => { alive = false }
  }, [setUser, setAuthReady])

  // Outside the editor there is no document open: restore the product title.
  useEffect(() => {
    if (!location.pathname.startsWith('/app')) setWindowTitle('NeoM')
  }, [location.pathname])

  const mobile = isMobileViewport()

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/app" element={mobile ? <MobileApp /> : <EditorApp />} />
        <Route path="/app/:path/*" element={mobile ? <MobileApp /> : <EditorApp />} />
        <Route path="/account/:tab?" element={<Account />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="/plugins" element={<PluginStore />} />
        <Route path="/plugins/dev" element={<PluginDevGuide />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/s/:id" element={<SharePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GlobalOverlays />
    </Suspense>
  )
}
