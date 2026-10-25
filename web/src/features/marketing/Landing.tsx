/**
 * NeoM landing page (`/`) — the public product front door.
 * All content degrades gracefully to built-in copy when the API is unavailable.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import '@/styles/portal-base.css'
import '@/styles/portal-marketing.css'
import { DocsDialog, SiteFooter, SiteHeader } from './PortalChrome'
import { EditorMock } from './AppMocks'
import {
  CtaBand,
  DownloadSection,
  FeatureSection,
  HeroPlatformRow,
  PluginSection,
  PricingSection,
  ShowcaseSection,
  AiSection
} from './Sections'
import { HERO_PLATFORMS, DEFAULT_SITE_CONFIG, FALLBACK_RELEASES, normalizeAnnouncement, normalizeSiteConfig, normalizeReleases } from './portalData'
import type { StorePlugin, ReleaseAsset } from '@/lib/contracts'
import { localFlag, safeArr, useRemote, scrollToSection } from './portalKit'

const Landing: React.FC = () => {
  const openModal = useStore((s) => s.openModal)
  const user = useStore((s) => s.user)
  const location = useLocation()
  const [policy, setPolicy] = useState<'terms' | 'privacy' | null>(null)
  const [annDismissed, setAnnDismissed] = useState(false)

  const config = useRemote<any>('/api/site/config', DEFAULT_SITE_CONFIG, normalizeSiteConfig)
  const announcement = useRemote<any>('/api/site/announcement', '', normalizeAnnouncement)
  const store = useRemote<any>('/api/plugins/store?category=&q=', [] as StorePlugin[], (raw) => safeArr<StorePlugin>(raw))
  const releases = useRemote<any>('/api/releases', FALLBACK_RELEASES, (raw) => {
    const list = normalizeReleases(raw)
    return list.length ? list : FALLBACK_RELEASES
  })

  const site = config.data
  const ann = announcement.data

  /* dismissible announcement, keyed by its content */
  useEffect(() => {
    if (!ann) return
    setAnnDismissed(localFlag.get('neom.ann.dismissed') === ann)
  }, [ann])

  /* deep link support: /#features from other pages */
  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.replace('#', '')
    const t = window.setTimeout(() => scrollToSection(id), 80)
    return () => window.clearTimeout(t)
  }, [location.hash])

  const [titleA, titleB] = useMemo(() => {
    const t = site.bannerTitle || ''
    const idx = t.search(/[，,]/)
    if (idx < 0) return [t, '']
    return [t.slice(0, idx + 1), t.slice(idx + 1)]
  }, [site.bannerTitle])

  const openLogin = () => openModal('login', { redirect: '/app' })

  return (
    <div className="portal">
      {!!ann && !annDismissed && (
        <div className="ann">
          <Icon name="bell" size={14} />
          <span>{ann}</span>
          <button
            type="button"
            className="ann-close"
            aria-label="关闭公告"
            onClick={() => {
              setAnnDismissed(true)
              localFlag.set('neom.ann.dismissed', ann)
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      <SiteHeader onSection={scrollToSection} />

      {/* ---------------------------------------------------------- hero */}
      <section className="hero">
        <div className="hero-inner">
          <div>
            <a className="hero-pill" href="#multi">
              <span className="tag">v1.0.0</span>
              <span>全平台正式版已发布 · 查看更新</span>
              <Icon name="chevron-right" size={13} />
            </a>

            <h1 className="hero-h1">
              {titleA}
              {titleB && <span className="grad">{titleB}</span>}
            </h1>

            <p className="hero-sub">{site.bannerSub}</p>

            <div className="hero-cta">
              <Link className="p-btn p-btn-primary p-btn-lg" to="/app">
                <Icon name="play" size={16} /> 立即使用（免费）
              </Link>
              <Link className="p-btn p-btn-lg" to="/download">
                <Icon name="download" size={16} /> 下载全平台客户端
              </Link>
            </div>

            <HeroPlatformRow platforms={HERO_PLATFORMS} />

            <div className="hero-stats">
              {[
                { n: '24+', l: '内置插件' },
                { n: '6 端', l: '实时同步' },
                { n: '<1s', l: '冷启动' },
                { n: '100%', l: '本地明文' }
              ].map((s) => (
                <div className="hero-stat" key={s.l}>
                  <b>{s.n}</b>
                  <span>{s.l}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-mock">
            <EditorMock />
            <div className="float-card a">
              <Icon name="cloud" size={15} />
              <span>
                <b>已同步</b> · 3 台设备
              </span>
            </div>
            <div className="float-card b">
              <Icon name="sparkles" size={15} />
              <span>
                AI 润色完成 <b>0.8s</b>
              </span>
            </div>
          </div>
        </div>
      </section>

      <FeatureSection />

      <AiSection />

      <PluginSection plugins={store.data} loading={store.loading} />

      <ShowcaseSection />

      <DownloadSection
        releases={releases.data}
        loading={releases.loading}
        degraded={releases.degraded || !releases.data.some((r: ReleaseAsset) => !!r.url)}
      />

      <PricingSection />

      <CtaBand onLogin={openLogin} />

      <SiteFooter config={site} onPolicy={(which) => setPolicy(which)} />

      {policy && <DocsDialog which={policy} onClose={() => setPolicy(null)} />}
    </div>
  )
}

export default Landing
