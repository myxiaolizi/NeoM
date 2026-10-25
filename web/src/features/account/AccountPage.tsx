/**
 * `/account/:tab?` — personal centre. Left menu + 8 modules.
 * Unauthenticated visitors are redirected to /login with a return path.
 */
import React, { Suspense, useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { SiteHeader } from '@/features/marketing/PortalChrome'
import { fmtPoints } from '@/features/marketing/portalKit'
import { Loading } from './AccountUI'
import ProfilePanel from './panels/ProfilePanel'
import StoragePanel from './panels/StoragePanel'
import AiPanel from './panels/AiPanel'
import BackupPanel from './panels/BackupPanel'
import SharesPanel from './panels/SharesPanel'
import BillingPanel from './panels/BillingPanel'
import PluginsPanel from './panels/PluginsPanel'
import SecurityPanel from './panels/SecurityPanel'
import '@/styles/portal-base.css'
import '@/styles/portal-account.css'

export interface PanelProps {
  user: any
  refreshUser: () => void
}

interface TabMeta {
  id: string
  label: string
  icon: string
  title: string
  desc: string
  hint?: string
}

export const ACCOUNT_TABS: TabMeta[] = [
  { id: 'profile', label: '个人资料', icon: 'user', title: '个人资料与账号安全', desc: '修改头像昵称、绑定邮箱手机、管理登录设备。' },
  { id: 'storage', label: '云存储', icon: 'cloud', title: '云存储设置', desc: '绑定自己的对象存储（OSS / COS / TOS / S3），文件直存你的账号下。' },
  { id: 'ai', label: 'AI 服务', icon: 'sparkles', title: 'AI 服务设置', desc: '选择官方统一通道或自带 Key，挑模型、定默认场景。', hint: '热门' },
  { id: 'backup', label: '备份与历史', icon: 'history', title: '备份与历史记录', desc: '查看云端快照与版本历史，下载或恢复到任意时间点。' },
  { id: 'shares', label: '我的分享', icon: 'share', title: '我的分享与发布', desc: '管理协作分享链接与 HTML 发布页，随时撤销。' },
  { id: 'billing', label: '积分与账单', icon: 'coins', title: '积分与账单', desc: '查看余额、充值、签到与每一笔 AI 消耗明细。' },
  { id: 'plugins', label: '我的插件', icon: 'puzzle', title: '我的插件', desc: '管理已安装插件，上传自定义插件包。' },
  { id: 'security', label: '安全中心', icon: 'shield', title: '安全中心', desc: '登录日志、当前会话与两步验证。' }
]

const PANEL_MAP: Record<string, React.ComponentType<PanelProps>> = {
  profile: ProfilePanel,
  storage: StoragePanel,
  ai: AiPanel,
  backup: BackupPanel,
  shares: SharesPanel,
  billing: BillingPanel,
  plugins: PluginsPanel,
  security: SecurityPanel
}

const ROLE_LABEL: Record<string, string> = { user: '普通用户', developer: '开发者', admin: '管理员' }

const AccountPage: React.FC = () => {
  const { tab } = useParams()
  const navigate = useNavigate()
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const openModal = useStore((s) => s.openModal)
  const setUser = useStore((s) => s.setUser)

  const active = tab && PANEL_MAP[tab] ? tab : 'profile'
  const meta = useMemo(() => ACCOUNT_TABS.find((t) => t.id === active) || ACCOUNT_TABS[0], [active])
  const Panel = PANEL_MAP[active]

  /* unknown tab → canonical path */
  useEffect(() => {
    if (tab && !PANEL_MAP[tab]) navigate('/account/' + active, { replace: true })
  }, [tab, active, navigate])

  useEffect(() => {
    if (authReady && !user) {
      navigate('/login?redirect=' + encodeURIComponent('/account/' + active), { replace: true })
    }
  }, [authReady, user, active, navigate])

  const refreshUser = () => {
    import('@/lib/api').then(({ api }) => {
      api
        .get<any>('/api/auth/me')
        .then((me) => setUser((me?.user || me) as any))
        .catch(() => {
          /* keep current user on transient failure */
        })
    })
  }

  if (!authReady) {
    return (
      <div className="portal">
        <SiteHeader compact />
        <Loading text="正在校验登录状态…" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="portal">
        <SiteHeader compact />
        <div className="share-gate-wrap" style={{ minHeight: '60vh' }}>
          <div className="share-gate">
            <span className="p-tile lg">
              <Icon name="user" size={20} />
            </span>
            <h2>请先登录</h2>
            <p>个人中心需要登录后访问。登录成功会自动回到当前页面。</p>
            <div className="col" style={{ gap: 8 }}>
              <button
                className="p-btn p-btn-primary p-btn-block"
                onClick={() => openModal('login', { redirect: '/account/' + active })}
              >
                <Icon name="login" size={15} /> 登录
              </button>
              <Link className="p-btn p-btn-block" to={'/login?redirect=' + encodeURIComponent('/account/' + active)}>
                使用登录页
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const initial = (user.nickname || user.username || 'N').slice(0, 1).toUpperCase()

  return (
    <div className="portal">
      <SiteHeader compact />

      <div className="acct">
        {/* ------------------------------------------------------ sidebar */}
        <aside className="acct-side">
          <div className="acct-who">
            <span className="acct-avatar">
              {user.avatar ? <img src={user.avatar} alt={user.nickname || user.username} loading="lazy" /> : initial}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="acct-name" title={user.nickname || user.username}>
                {user.nickname || user.username}
              </div>
              <div className="acct-sub">
                <span className={'badge ' + (user.role === 'admin' ? 'warn' : user.role === 'developer' ? '' : 'neutral')}>
                  {ROLE_LABEL[user.role] || user.role}
                </span>
                {user.status === 'banned' && <span className="badge danger">已封禁</span>}
              </div>
            </div>
          </div>

          <div className="acct-points">
            <span className="row" style={{ gap: 6 }}>
              <Icon name="coins" size={14} /> 我的积分
            </span>
            <b>{fmtPoints(user.points)}</b>
          </div>

          <nav className="acct-menu">
            {ACCOUNT_TABS.map((t) => (
              <Link
                key={t.id}
                to={'/account/' + t.id}
                className={'acct-mi' + (active === t.id ? ' active' : '')}
                style={{ textDecoration: 'none' }}
              >
                <Icon name={t.icon} size={15} />
                <span className="grow">{t.label}</span>
                {t.hint && <span className="acct-mi-hint">{t.hint}</span>}
              </Link>
            ))}
          </nav>

          <div className="acct-side-foot">
            <Link className="btn btn-sm" to="/app">
              <Icon name="arrow-left" size={13} /> 返回编辑器
            </Link>
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                try {
                  const { api, setToken } = await import('@/lib/api')
                  await api.post('/api/auth/logout', {})
                  setToken(null)
                } catch {
                  /* logout is best-effort; clear locally regardless */
                }
                setUser(null)
                navigate('/', { replace: true })
              }}
            >
              <Icon name="logout" size={13} /> 退出
            </button>
          </div>
        </aside>

        {/* --------------------------------------------------------- main */}
        <main className="acct-main">
          <div className="acct-head">
            <div>
              <h1>{meta.title}</h1>
              <p>{meta.desc}</p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link className="p-btn p-btn-sm" to="/app">
                <Icon name="edit" size={13} /> 打开编辑器
              </Link>
            </div>
          </div>

          <div className="acct-body">
            <Suspense fallback={<Loading />}>
              <Panel user={user} refreshUser={refreshUser} />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AccountPage
