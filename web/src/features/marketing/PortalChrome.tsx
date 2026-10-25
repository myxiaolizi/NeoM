/**
 * Portal chrome — shared header / footer / theme switch / policy dialog
 * for every public page (landing, store, download, share).
 */
import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { Dialog } from '@/components/Overlays'
import { toggleTheme } from '@/lib/theme'
import { BrandLock, MoonIcon, SunIcon } from './Brand'
import { NAV_LINKS, type SiteConfig, normalizeDoc } from './portalData'
import { api } from '@/lib/api'
import { useRemote } from './portalKit'

/* register the landing login dialog as soon as any portal chrome loads */
import '@/features/auth/LoginModal'

/* ------------------------------------------------------------ theme */
export const ThemeToggle: React.FC = () => {
  const theme = useStore((s) => s.theme)
  return (
    <button
      type="button"
      className="btn-icon"
      title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      aria-label="切换主题"
      onClick={() => toggleTheme()}
    >
      {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  )
}

/* ------------------------------------------------------------ header */
export interface SiteHeaderProps {
  /** when provided, nav links scroll inside the page instead of routing to '/#id' */
  onSection?: (id: string) => void
  active?: string
  /** hide the nav (auth-style pages) */
  compact?: boolean
}

export const SiteHeader: React.FC<SiteHeaderProps> = ({ onSection, active: activeProp, compact }) => {
  const user = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const location = useLocation()
  const headerRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState(activeProp || '')

  /* sticky shadow + section scroll-spy (landing only) */
  useEffect(() => {
    const scroller = headerRef.current?.closest('.portal') as HTMLElement | null
    const target: HTMLElement | Window = scroller || window
    const ids = NAV_LINKS.map((l) => l.id)
    const read = () => {
      setScrolled((scroller ? scroller.scrollTop : window.scrollY || 0) > 6)
      if (!onSection) return
      let current = ''
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top
        if (top <= 140) current = id
      }
      setActive(current)
    }
    read()
    target.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      target.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
    }
  }, [onSection])

  useEffect(() => {
    if (activeProp) setActive(activeProp)
  }, [activeProp])

  const nav = (
    <nav className="p-nav" aria-label="主导航">
      {NAV_LINKS.map((item) =>
        onSection ? (
          <button
            key={item.id}
            type="button"
            className={'p-navlink' + (active === item.id ? ' active' : '')}
            onClick={() => onSection(item.id)}
          >
            {item.label}
          </button>
        ) : (
          <Link key={item.id} className="p-navlink" to={'/#' + item.id}>
            {item.label}
          </Link>
        )
      )}
      <Link className="p-navlink" to="/plugins">
        商店
      </Link>
      <Link className="p-navlink" to="/download">
        下载
      </Link>
    </nav>
  )

  return (
    <header ref={headerRef} className={'p-header' + (scrolled ? ' scrolled' : '')}>
      <div className="p-header-inner">
        <Link className="p-brand" to="/" aria-label="NeoM 首页">
          <BrandLock size={28} />
        </Link>
        {!compact && nav}
        {compact && <span className="grow" />}
        <div className="p-actions">
          <ThemeToggle />
          {user ? (
            <>
              <Link className="p-btn p-btn-sm hide-xs" to="/account/profile">
                <Icon name="user" size={14} />
                {user.nickname || user.username}
              </Link>
              <Link className="p-btn p-btn-primary p-btn-sm" to="/app">
                进入编辑器
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                className="p-btn p-btn-sm"
                onClick={() =>
                  openModal('login', {
                    /* stay where the visitor is; landing itself returns to /app */
                    redirect: location.pathname === '/' ? '/app' : location.pathname + location.search
                  })
                }
              >
                登录
              </button>
              <Link className="p-btn p-btn-primary p-btn-sm" to="/register">
                注册
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------ footer */
export interface SiteFooterProps {
  config: SiteConfig
  onPolicy?: (which: 'terms' | 'privacy') => void
}

export const SiteFooter: React.FC<SiteFooterProps> = ({ config, onPolicy }) => (
  <footer className="p-footer">
    <div className="p-footer-inner">
      <div className="p-footer-col">
        <BrandLock size={26} />
        <p className="small muted" style={{ margin: '12px 0 14px', lineHeight: 1.7, maxWidth: 300 }}>
          {config.slogan}
        </p>
        <a className="p-footer-link" href={config.github} target="_blank" rel="noopener noreferrer">
          <span className="row" style={{ gap: 6 }}>
            <Icon name="external" size={13} /> GitHub 仓库
          </span>
        </a>
        <a className="p-footer-link" href={'mailto:' + config.contactEmail}>
          <span className="row" style={{ gap: 6 }}>
            <Icon name="send" size={13} /> {config.contactEmail}
          </span>
        </a>
      </div>

      <div className="p-footer-col">
        <h4>产品</h4>
        <Link to="/#features">核心特性</Link>
        <Link to="/#ai">AI 能力</Link>
        <Link to="/#plugins">插件生态</Link>
        <Link to="/download">全平台下载</Link>
        <Link to="/#pricing">定价与积分</Link>
      </div>

      <div className="p-footer-col">
        <h4>资源</h4>
        <Link to="/plugins">插件商店</Link>
        <Link to="/plugins/dev">插件开发指南</Link>
        <Link to="/app">打开编辑器</Link>
        <a href={config.github} target="_blank" rel="noopener noreferrer">
          更新日志
        </a>
      </div>

      <div className="p-footer-col">
        <h4>关于</h4>
        <button type="button" className="p-footer-link" onClick={() => onPolicy?.('terms')}>
          用户服务协议
        </button>
        <button type="button" className="p-footer-link" onClick={() => onPolicy?.('privacy')}>
          隐私政策
        </button>
        <Link to="/account/profile">个人中心</Link>
        <a href={config.github} target="_blank" rel="noopener noreferrer">
          加入社区
        </a>
      </div>
    </div>

    <div className="p-footer-bottom">
      <span>{config.copyright}</span>
      <div className="links">
        <span>{config.icp}</span>
        <button type="button" className="p-footer-link" style={{ margin: 0 }} onClick={() => onPolicy?.('terms')}>
          服务协议
        </button>
        <button type="button" className="p-footer-link" style={{ margin: 0 }} onClick={() => onPolicy?.('privacy')}>
          隐私政策
        </button>
      </div>
    </div>
  </footer>
)

/* ------------------------------------------------------ policy dialog */
export const DocsDialog: React.FC<{ which: 'terms' | 'privacy'; onClose: () => void }> = ({ which, onClose }) => {
  const remote = useRemote<any>('/api/site/docs?key=' + which, null)
  const [html, setHtml] = useState('')
  const doc = normalizeDoc(remote.data, which)

  useEffect(() => {
    let alive = true
    setHtml('')
    import('@/features/share/markdown')
      .then((m) => m.renderMarkdown(doc.content))
      .then((out) => {
        if (alive) setHtml(out)
      })
      .catch(() => {
        if (alive) setHtml('')
      })
    return () => {
      alive = false
    }
  }, [doc.content, which])

  return (
    <Dialog
      title={doc.title}
      icon={which === 'terms' ? 'file-text' : 'shield'}
      onClose={onClose}
      width={720}
      className="doc-modal"
      footer={
        <>
          <span className="tiny dim grow" style={{ textAlign: 'left' }}>
            {remote.degraded ? '后端协议接口暂不可用，当前展示内置示例文案' : '内容以线上最新版本为准'}
          </span>
          <button className="btn btn-primary" onClick={onClose}>
            我知道了
          </button>
        </>
      }
    >
      <div className="doc-modal-body">
        {html ? (
          <div className="p-md" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="p-md" style={{ whiteSpace: 'pre-wrap' }}>
            {doc.content}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/* -------------------------------------------------- centered auth frame */
export const AuthFrame: React.FC<{
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  badge?: React.ReactNode
}> = ({ title, subtitle, children, footer, badge }) => (
  <div className="portal">
    <div className="auth-topbar">
      <Link className="p-brand" to="/">
        <BrandLock size={26} />
      </Link>
      <div className="row" style={{ gap: 8 }}>
        <ThemeToggle />
        <Link className="p-btn p-btn-sm" to="/">
          返回首页
        </Link>
      </div>
    </div>
    <div className="auth-wrap">
      <div className="auth-side">
        <h1 className="auth-side-title">
          极速、AI 原生的
          <br />
          <span className="grad">Markdown 知识库</span>
        </h1>
        <p className="auth-side-sub">
          本地优先的明文仓库、多端秒级同步、24 款内置插件，以及一个懂你笔记的 AI 助手。
        </p>
        <ul className="auth-points">
          {[
            '本地明文 Markdown，随时迁移与 Git 版本管理',
            'S3 / OSS 私有云存储，内容永远是你的',
            'AI 写作、润色、总结、翻译、语音一条龙',
            'Win11 Fluent 设计，深浅色自动跟随系统'
          ].map((t) => (
            <li key={t}>
              <Icon name="check" size={14} /> <span>{t}</span>
            </li>
          ))}
        </ul>
        <div className="auth-side-foot tiny dim">© {new Date().getFullYear()} NeoM</div>
      </div>

      <div className="auth-main">
        <div className="auth-card p-card">
          {badge}
          <h2 className="auth-title">{title}</h2>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
          {children}
          {footer && <div className="auth-foot">{footer}</div>}
        </div>
      </div>
    </div>
  </div>
)
