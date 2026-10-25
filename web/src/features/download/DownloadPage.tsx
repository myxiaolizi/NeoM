/**
 * `/download` — release centre. Pulls OSS direct links from `GET /api/releases`
 * and highlights the build that matches the visitor's current platform.
 */
import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { Dialog } from '@/components/Overlays'
import { useStore } from '@/store'
import { DocsDialog, SiteFooter, SiteHeader } from '@/features/marketing/PortalChrome'
import {
  DEFAULT_SITE_CONFIG,
  FALLBACK_RELEASES,
  PLATFORMS,
  PLATFORM_BY_KEY,
  normalizeReleases,
  normalizeSiteConfig
} from '@/features/marketing/portalData'
import { copyText, detectPlatform, fmtBytes, fmtDate, useRemote } from '@/features/marketing/portalKit'
import type { ReleaseAsset } from '@/lib/contracts'
import '@/styles/portal-base.css'
import '@/styles/portal-download.css'

const MAIN_PLATFORMS = PLATFORMS.filter((p) => p.key !== 'linux-x64')

const REQUIREMENTS = [
  {
    icon: 'windows',
    title: 'Windows',
    items: ['Windows 10 1809 (x64) 及以上 / Windows 11', '4 GB 内存，300 MB 可用磁盘', '支持 .md 文件关联与开机自启'],
    key: 'win-x64'
  },
  {
    icon: 'apple',
    title: 'macOS',
    items: ['macOS 12 Monterey 及以上', 'Apple Silicon 与 Intel 双架构独立安装包', '首次打开需在「隐私与安全性」中放行'],
    key: 'mac-arm64'
  },
  {
    icon: 'android',
    title: 'Android',
    items: ['Android 8.0 及以上', '支持离线写作与相册插图', 'APK 直装，无需应用商店'],
    key: 'android'
  },
  {
    icon: 'smartphone',
    title: 'iOS',
    items: ['iOS 15 及以上', '通过 TestFlight 或自签 IPA 安装', '支持语音速记与分享扩展'],
    key: 'ios'
  }
]

const DownloadPage: React.FC = () => {
  const toast = useStore((s) => s.toast)
  const [policy, setPolicy] = useState<'terms' | 'privacy' | null>(null)
  const [changelog, setChangelog] = useState<ReleaseAsset | null>(null)

  const config = useRemote<any>('/api/site/config', DEFAULT_SITE_CONFIG, normalizeSiteConfig)
  const releases = useRemote<any>('/api/releases', FALLBACK_RELEASES, (raw) => {
    const list = normalizeReleases(raw)
    return list.length ? list : FALLBACK_RELEASES
  })

  const list = releases.data
  const detected = useMemo(() => detectPlatform(), [])
  const detectedMeta = PLATFORM_BY_KEY[detected]

  const find = (platform: string) => list.find((r) => r.platform === platform) || null
  const recommended = (detected !== 'web' && find(detected)) || find('win-x64') || list[0] || null
  const nonePublished = !list.some((r) => !!r.url)

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyText(text)
    toast({ kind: ok ? 'ok' : 'warn', text: ok ? `${label}已复制` : '复制失败，请手动选择文本' })
  }

  return (
    <div className="portal">
      <SiteHeader />

      <div className="p-page">
        {/* ------------------------------------------------------ hero */}
        <section className="dl-hero">
          <div style={{ minWidth: 0, flex: '1 1 420px' }}>
            <span className="detect">
              <Icon name={detectedMeta?.icon || 'globe'} size={13} />
              {detected === 'web'
                ? '未识别到桌面/移动系统 · 可直接使用网页版'
                : `已识别当前系统：${detectedMeta?.label || detected}`}
            </span>
            <h1>下载 NeoM 客户端</h1>
            <p>
              桌面端可读写本地明文仓库并关联 .md 文件；移动端支持离线写作与语音速记。安装包由对象存储直链分发，下载后即可安装。
            </p>
            <div className="hero-actions">
              {recommended?.url ? (
                <a className="p-btn p-btn-primary p-btn-lg" href={recommended.url} download={recommended.filename || undefined}>
                  <Icon name="download" size={16} /> 下载 {PLATFORM_BY_KEY[recommended.platform]?.label || recommended.platform}
                </a>
              ) : (
                <button className="p-btn p-btn-primary p-btn-lg" disabled>
                  <Icon name="download" size={16} /> {releases.loading ? '正在获取发布信息…' : '安装包即将发布'}
                </button>
              )}
              <Link className="p-btn p-btn-lg" to="/app">
                <Icon name="globe" size={16} /> 使用网页版
              </Link>
            </div>
            {nonePublished && !releases.loading && (
              <div className="p-note warn" style={{ marginTop: 16 }}>
                <Icon name="info" size={15} />
                <span>
                  发布信息接口暂未返回可下载的安装包，当前展示占位版本。管理员上传安装包后此处会自动显示真实版本、大小与校验值。
                </span>
              </div>
            )}
          </div>

          <div className="dl-hero-qr">
            <div className="qr-box" title="移动端扫码下载（上线后生成）">
              <div className="grid">
                {Array.from({ length: 25 }).map((_, i) => (
                  <i key={i} />
                ))}
              </div>
              扫码占位
            </div>
            <div className="tiny dim" style={{ marginTop: 8, maxWidth: 104 }}>
              移动端二维码
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ platform cards */}
        <div className="p-page-head" style={{ marginTop: 34, marginBottom: 0 }}>
          <div>
            <h2 className="p-title" style={{ fontSize: 20 }}>
              平台安装包
            </h2>
            <p className="p-sub" style={{ fontSize: 13 }}>
              共 {MAIN_PLATFORMS.length} 个平台 · 版本信息来自发布接口
            </p>
          </div>
          <span className="tiny dim">
            {releases.loading ? (
              <span className="row" style={{ gap: 6 }}>
                <span className="spinner" /> 正在同步发布信息…
              </span>
            ) : releases.degraded ? (
              '接口不可用 · 展示内置占位'
            ) : (
              `已同步 ${list.length} 条发布记录`
            )}
          </span>
        </div>

        <div className="dl-big-grid">
          {MAIN_PLATFORMS.map((p) => {
            const rel = find(p.key)
            const ready = !!rel?.url
            const isRecommended = recommended?.platform === p.key
            return (
              <article className={'p-card dl-big' + (isRecommended ? ' recommended' : '')} key={p.key}>
                <div className="dl-big-top">
                  <span className="p-tile grad lg">
                    <Icon name={p.icon} size={20} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="dl-big-name">
                      {p.label}
                      {isRecommended && <span className="badge">推荐</span>}
                    </div>
                    <div className="dl-big-sub">
                      {p.kind} · {p.ext}
                    </div>
                  </div>
                  <span className={'badge ' + (ready ? 'ok' : 'neutral')} style={{ marginLeft: 'auto' }}>
                    {ready ? '可下载' : '即将发布'}
                  </span>
                </div>

                <div className="dl-big-meta">
                  <div>
                    <div className="k">版本</div>
                    <div className="v">{rel?.version || '—'}</div>
                  </div>
                  <div>
                    <div className="k">文件大小</div>
                    <div className="v">{rel?.size ? fmtBytes(rel.size) : '—'}</div>
                  </div>
                  <div>
                    <div className="k">发布日期</div>
                    <div className="v">{rel?.published_at ? fmtDate(rel.published_at) : '—'}</div>
                  </div>
                  <div>
                    <div className="k">渠道</div>
                    <div className="v">{rel?.channel === 'beta' ? 'Beta 测试' : '稳定版'}</div>
                  </div>
                </div>

                <div className="dl-big-changelog">
                  <span className="dim">更新日志：</span>
                  {rel?.changelog || '暂无更新说明'}
                </div>

                {rel?.sha256 && (
                  <div className="sha-row">
                    <Icon name="key" size={12} />
                    <code title={rel.sha256}>{rel.sha256}</code>
                    <button
                      type="button"
                      className="btn-icon"
                      style={{ width: 22, height: 22 }}
                      title="复制 SHA256"
                      onClick={() => handleCopy(rel.sha256 || '', 'SHA256')}
                    >
                      <Icon name="copy" size={12} />
                    </button>
                  </div>
                )}

                <div className="dl-big-actions">
                  {ready ? (
                    <a className="p-btn p-btn-primary grow" href={rel!.url} download={rel!.filename || undefined}>
                      <Icon name="download" size={15} /> 下载
                    </a>
                  ) : (
                    <button className="p-btn grow" disabled>
                      即将发布
                    </button>
                  )}
                  <button
                    type="button"
                    className="p-btn p-btn-sm"
                    disabled={!rel}
                    onClick={() => rel && setChangelog(rel)}
                  >
                    更新日志
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        {/* ------------------------------------------------- detail table */}
        <div className="p-page-head" style={{ marginTop: 38, marginBottom: 0 }}>
          <div>
            <h2 className="p-title" style={{ fontSize: 20 }}>
              全部发布记录
            </h2>
            <p className="p-sub" style={{ fontSize: 13 }}>
              含 Linux 与绿色版；校验值用于校验安装包完整性。
            </p>
          </div>
        </div>

        <div className="dl-table-wrap">
          {releases.loading ? (
            <div className="p-state">
              <span className="spinner" />
              <span>正在获取发布记录…</span>
            </div>
          ) : list.length === 0 ? (
            <div className="p-state">
              <Icon name="download" size={22} />
              <strong>暂无发布记录</strong>
              <span>安装包上传后会自动出现在这里</span>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>平台</th>
                  <th>文件</th>
                  <th>版本</th>
                  <th className="num">大小</th>
                  <th>发布日期</th>
                  <th>SHA256</th>
                  <th style={{ width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={`${r.platform}-${r.version}-${i}`}>
                    <td>
                      <span className="row" style={{ gap: 7 }}>
                        <Icon name={PLATFORM_BY_KEY[r.platform]?.icon || 'monitor'} size={14} />
                        {PLATFORM_BY_KEY[r.platform]?.label || r.platform}
                      </span>
                    </td>
                    <td>
                      <span className="file">
                        <Icon name="file" size={12} />
                        {r.filename || '—'}
                      </span>
                    </td>
                    <td>{r.version}</td>
                    <td className="num">{r.size ? fmtBytes(r.size) : '—'}</td>
                    <td>{r.published_at ? fmtDate(r.published_at) : '—'}</td>
                    <td>
                      <span className="mono-sm">{r.sha256 ? r.sha256.slice(0, 12) + '…' : '—'}</span>
                    </td>
                    <td>
                      {r.url ? (
                        <a className="btn btn-sm btn-primary" href={r.url} download={r.filename || undefined}>
                          下载
                        </a>
                      ) : (
                        <button className="btn btn-sm" disabled>
                          待发布
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ------------------------------------------------- requirements */}
        <div className="p-page-head" style={{ marginTop: 38, marginBottom: 0 }}>
          <div>
            <h2 className="p-title" style={{ fontSize: 20 }}>
              系统要求
            </h2>
            <p className="p-sub" style={{ fontSize: 13 }}>
              网页版无安装要求，仅需现代浏览器（Chrome / Edge 100+、Safari 15+）。
            </p>
          </div>
        </div>

        <div className="req-grid">
          {REQUIREMENTS.map((r) => (
            <div className="p-card req-card" key={r.title}>
              <span className="p-tile">
                <Icon name={r.icon} size={18} />
              </span>
              <div>
                <div className="t">{r.title}</div>
                <ul>
                  {r.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <div className="p-note" style={{ marginTop: 20 }}>
          <Icon name="shield" size={15} />
          <span>
            所有安装包均通过 HTTPS 从对象存储直链下载。若下载中断或校验不通过，请重新下载并核对 SHA256；Windows 绿色版解压即用，无需安装。
          </span>
        </div>
      </div>

      <SiteFooter config={config.data} onPolicy={(w) => setPolicy(w)} />

      {changelog && (
        <Dialog
          title={`${PLATFORM_BY_KEY[changelog.platform]?.label || changelog.platform} · v${changelog.version} 更新日志`}
          icon="history"
          onClose={() => setChangelog(null)}
          width={620}
          footer={
            <button className="btn btn-primary" onClick={() => setChangelog(null)}>
              关闭
            </button>
          }
        >
          <div className="small" style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {changelog.changelog || '暂无更新说明。'}
          </div>
          <div className="divider" />
          <div className="tiny dim" style={{ lineHeight: 1.9 }}>
            文件名：{changelog.filename || '—'}
            <br />
            大小：{changelog.size ? fmtBytes(changelog.size) : '—'} · 发布日期：
            {changelog.published_at ? fmtDate(changelog.published_at, true) : '—'}
            <br />
            SHA256：{changelog.sha256 || '—'}
          </div>
        </Dialog>
      )}

      {policy && <DocsDialog which={policy} onClose={() => setPolicy(null)} />}
    </div>
  )
}

export default DownloadPage
