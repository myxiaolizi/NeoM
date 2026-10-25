/**
 * Landing page sections. Every section is defensive: catalogue content works
 * without a backend, live data only enriches it.
 */
import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { AI_PROVIDERS, type ReleaseAsset, type StorePlugin } from '@/lib/contracts'
import {
  AI_CAPABILITIES,
  CATEGORY_LABEL,
  FEATURE_CARDS,
  PLATFORM_BY_KEY,
  PLATFORMS,
  PLUGIN_CATALOG,
  PROVIDER_PURPOSE,
  type FeatureCard
} from './portalData'
import { AiMock, DatabaseMock, EditorMock, GraphMock, SyncFlow } from './AppMocks'
import { fmtBytes, fmtDate } from './portalKit'

/* ------------------------------------------------------------ features */
export const FeatureSection: React.FC<{ features?: FeatureCard[] }> = ({ features }) => {
  const items = features?.length ? features : FEATURE_CARDS
  return (
    <section className="p-section" id="features">
      <div className="p-head">
        <div>
          <div className="p-eyebrow">
            <Icon name="layers" size={13} /> 核心特性
          </div>
          <h2 className="p-title">该有的都有，不该卡的一点都不卡</h2>
          <p className="p-sub">
            把 Obsidian 的双链结构、Win11 的现代观感、云端多端同步和 AI 助手放进同一个编辑器里，12 项能力开箱即用。
          </p>
        </div>
        <Link className="p-btn" to="/app">
          <Icon name="play" size={14} /> 直接打开试用
        </Link>
      </div>

      <div className="feat-grid">
        {items.map((f) => (
          <article className="p-card p-card-inter feat" key={f.title}>
            <div className="feat-head">
              <span className="p-tile">
                <Icon name={f.icon} size={18} />
              </span>
              <span className="feat-title">{f.title}</span>
              {f.tag && <span className="feat-tag">{f.tag}</span>}
            </div>
            <p className="feat-desc">{f.desc}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ ai */
export const AiSection: React.FC = () => {
  const providers = AI_PROVIDERS.filter((p) => p.builtin)
  return (
    <section className="p-section" id="ai">
      <div className="p-eyebrow">
        <Icon name="sparkles" size={13} /> AI 赋能
      </div>
      <h2 className="p-title">写作、润色、总结、翻译、语音，一个入口全搞定</h2>
      <p className="p-sub">
        选中即用，也可在右侧面板连续对话。官方统一接口按量扣积分，也可以填自己的 API Key 走自定义通道——数据由你掌握。
      </p>

      <div className="ai-band" style={{ marginTop: 30 }}>
        <div>
          <div className="ai-caps">
            {AI_CAPABILITIES.map((c) => (
              <div className="ai-cap" key={c.title}>
                <span className="p-tile" style={{ width: 30, height: 30, borderRadius: 9 }}>
                  <Icon name={c.icon} size={15} />
                </span>
                <div>
                  <div className="t">{c.title}</div>
                  <div className="d">{c.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="prov-row">
            <span className="lbl">预设供应商</span>
            {providers.map((p) => (
              <span className="prov" key={p.id} title={PROVIDER_PURPOSE[p.id] || p.name}>
                {p.name}
              </span>
            ))}
          </div>

          <div className="ai-billing">
            <Icon name="coins" size={15} />
            <span>
              官方通道按模型价格计费：缓存输入 / 未命中输入 / 输出分别计价，ASR 按音频时长、TTS 按字符；每次调用写入账单明
              细。自定义 Key 模式<b>不扣积分</b>。
            </span>
          </div>
        </div>

        <div>
          <AiMock />
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- plugins */
export interface PluginSectionProps {
  plugins: StorePlugin[]
  loading?: boolean
}

export const PluginSection: React.FC<PluginSectionProps> = ({ plugins, loading }) => {
  /** built-in catalogue is the base; live store data overrides name/description */
  const items = useMemo(() => {
    const byId = new Map(plugins.map((p) => [p.id, p]))
    const merged = PLUGIN_CATALOG.map((c) => {
      const live = byId.get(c.id)
      byId.delete(c.id)
      return {
        id: c.id,
        name: live?.name || c.name,
        desc: live?.description || c.desc,
        category: live?.category || c.category,
        icon: live?.icon || c.icon
      }
    })
    /** store-only plugins (community uploads) are appended after the built-ins */
    for (const extra of byId.values()) {
      if (merged.length >= 32) break
      merged.push({
        id: extra.id,
        name: extra.name,
        desc: extra.description,
        category: extra.category,
        icon: extra.icon || 'puzzle'
      })
    }
    return merged
  }, [plugins])

  return (
    <section className="p-section" id="plugins">
      <div className="p-head">
        <div>
          <div className="p-eyebrow">
            <Icon name="puzzle" size={13} /> 插件生态
          </div>
          <h2 className="p-title">
            {plugins.length > 0 ? `24 款内置插件 · 商店共 ${plugins.length} 款` : '24 款内置插件，开箱即用'}
          </h2>
          <p className="p-sub">
            每个插件独立可关，安装即用。支持从商店一键安装，也能打包自己的插件上传，或加载本地开发中的目录。
          </p>
        </div>
        <Link className="p-btn p-btn-soft" to="/plugins">
          <Icon name="grid" size={14} /> 浏览插件商店
        </Link>
      </div>

      <div className="plug-grid">
        {items.map((p) => (
          <article className="plug" key={p.id}>
            <span className="p-tile">
              <Icon name={p.icon} size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="plug-name">
                {p.name}
                <span className="cat">{CATEGORY_LABEL[p.category] || p.category}</span>
              </div>
              <div className="plug-desc">{p.desc}</div>
            </div>
          </article>
        ))}
      </div>

      <div className="row" style={{ marginTop: 22, gap: 10, flexWrap: 'wrap' }}>
        <Link className="p-btn p-btn-sm" to="/plugins">
          全部插件
        </Link>
        <Link className="p-btn p-btn-sm" to="/plugins/dev">
          <Icon name="code" size={13} /> 开发自己的插件
        </Link>
        <span className="tiny dim">插件命令统一前缀 plugin.&lt;id&gt;.&lt;action&gt;，可在命令面板搜索</span>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ showcase */
const SHOWCASE = [
  { id: 'editor', label: '编辑器', icon: 'file-text', caption: '左树右文 + 多标签页，四种视图随时切换，状态栏实时统计字数与同步状态。' },
  { id: 'ai', label: 'AI 面板', icon: 'sparkles', caption: '右侧常驻 AI 面板：选中文本润色、整理会议记录、翻译段落，一键插入正文。' },
  { id: 'graph', label: '关系图谱', icon: 'graph', caption: '全库双链关系可视化，按标签与目录筛选，点击节点直接跳转。' },
  { id: 'db', label: '数据库视图', icon: 'database', caption: '把笔记集合渲染成表格 / 看板 / 画廊，字段即 YAML 属性。' }
] as const

export const ShowcaseSection: React.FC = () => {
  const [tab, setTab] = useState<(typeof SHOWCASE)[number]['id']>('editor')
  const current = SHOWCASE.find((s) => s.id === tab) || SHOWCASE[0]
  return (
    <section className="p-section" id="sync">
      <div className="p-eyebrow">
        <Icon name="sync" size={13} /> 同步与演示
      </div>
      <h2 className="p-title">三端同一份笔记，改一个字都秒同步</h2>
      <p className="p-sub">
        云端仓库落在你自己的 S3/OSS 里，桌面端可同时挂载本地明文仓库。冲突自动比对，历史版本与 Diff 随时可回。
      </p>

      <div className="sync-wrap">
        <div>
          <div className="sync-list">
            {[
              { icon: 'sync', t: '秒级双向同步', d: '保存即推送，多端拉取带 etag 校验，冲突弹窗并排比对，不会静默覆盖。' },
              { icon: 'cloud', t: '自己的云存储', d: '支持 7 家对象存储 + 自定义 S3，未配置时使用系统默认空间里的专属目录。' },
              { icon: 'hard-drive', t: '本地明文仓库', d: '桌面端直接读写文件夹里的 .md 文件，可 Git 管理、可随时迁走。' },
              { icon: 'history', t: '版本与回收站', d: '每次保存留档，按时间点恢复；删除进回收站，误删也能救回来。' }
            ].map((x) => (
              <div className="sync-item" key={x.t}>
                <span className="p-tile">
                  <Icon name={x.icon} size={17} />
                </span>
                <div>
                  <div className="t">{x.t}</div>
                  <div className="d">{x.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <SyncFlow />
      </div>

      <div className="show-tabs">
        {SHOWCASE.map((s) => (
          <button
            key={s.id}
            type="button"
            className={'chip' + (tab === s.id ? ' active' : '')}
            onClick={() => setTab(s.id)}
          >
            <Icon name={s.icon} size={13} /> {s.label}
          </button>
        ))}
      </div>
      <div className="show-stage">
        {current.id === 'editor' && <EditorMock />}
        {current.id === 'ai' && <AiMock />}
        {current.id === 'graph' && <GraphMock />}
        {current.id === 'db' && <DatabaseMock />}
      </div>
      <p className="show-caption">{current.caption}</p>
    </section>
  )
}

/* ------------------------------------------------------------ download */
export interface DownloadSectionProps {
  releases: ReleaseAsset[]
  loading?: boolean
  degraded?: boolean
}

const CARD_PLATFORMS = PLATFORMS.filter((p) => p.key !== 'linux-x64')

export const DownloadSection: React.FC<DownloadSectionProps> = ({ releases, loading, degraded }) => (
  <section className="p-section" id="multi">
    <div className="p-head">
      <div>
        <div className="p-eyebrow">
          <Icon name="monitor" size={13} /> 多端下载
        </div>
        <h2 className="p-title">6 个平台，一个账号用到底</h2>
        <p className="p-sub">
          安装包托管在对象存储直链，下载即用。{degraded ? '（发布信息接口暂不可用，以下版本信息为占位）' : ''}
        </p>
      </div>
      <Link className="p-btn" to="/download">
        <Icon name="download" size={14} /> 下载中心
      </Link>
    </div>

    <div className="dl-grid">
      {CARD_PLATFORMS.map((p) => {
        const rel = releases.find((r) => r.platform === p.key)
        const ready = !!rel?.url
        return (
          <article className="p-card p-card-inter dl-card" key={p.key}>
            <div className="dl-head">
              <span className="p-tile grad">
                <Icon name={p.icon} size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="dl-name">{p.label}</div>
                <div className="dl-kind">
                  {p.kind} · {p.ext}
                </div>
              </div>
              <span className="dl-shot badge neutral">{ready ? 'v' + (rel?.version || '1.0.0') : '即将发布'}</span>
            </div>
            <div className="dl-meta">
              <div>
                <span className="k">版本</span>
                <span className="v">{rel?.version || '—'}</span>
              </div>
              <div>
                <span className="k">大小</span>
                <span className="v">{rel?.size ? fmtBytes(rel.size) : '—'}</span>
              </div>
              <div>
                <span className="k">发布日期</span>
                <span className="v">{rel?.published_at ? fmtDate(rel.published_at) : '—'}</span>
              </div>
              <div>
                <span className="k">渠道</span>
                <span className="v">{rel?.channel === 'beta' ? 'Beta' : '稳定版'}</span>
              </div>
            </div>
            {ready ? (
              <a className="p-btn p-btn-primary p-btn-block" href={rel!.url} download={rel!.filename || undefined}>
                <Icon name="download" size={15} /> 下载安装包
              </a>
            ) : (
              <button className="p-btn p-btn-block" disabled title={loading ? '正在获取发布信息…' : '该平台安装包尚未发布'}>
                {loading ? (
                  <>
                    <span className="spinner" /> 获取中…
                  </>
                ) : (
                  '即将发布'
                )}
              </button>
            )}
          </article>
        )
      })}
    </div>

    <div className="row" style={{ marginTop: 18, gap: 10, flexWrap: 'wrap' }}>
      <span className="tiny dim">
        还有 Linux x64 · Web 网页版（免安装）· 局域网自部署版本，详见
        <Link to="/download"> 下载中心</Link>
      </span>
    </div>
  </section>
)

/* ------------------------------------------------------------- pricing */
const PLANS = [
  {
    name: 'Free',
    price: '0',
    unit: '永久免费',
    desc: '个人开始记录足够用',
    hot: false,
    items: ['本地 + 云端仓库（5 GB）', '全部 24 款内置插件', '注册赠送体验积分', 'AI 每日少量免费额度', '免登录协作与发布']
  },
  {
    name: 'Pro',
    price: '19',
    unit: '每月',
    desc: '重度写作与 AI 使用者',
    hot: true,
    items: ['云端 100 GB + 私有 OSS 直连', '每月赠送 200 万 AI 积分', '更高并发与更长的历史版本', '语音识别 / 合成 / 音色克隆', '插件商店优先更新']
  },
  {
    name: 'Team',
    price: '面议',
    unit: '按席位',
    desc: '团队协作与私有化',
    hot: false,
    items: ['团队空间与共享仓库', '成员配额与审计日志', '私有化部署与自定义域名', '专属技术支持']
  }
]

export const PricingSection: React.FC = () => (
  <section className="p-section" id="pricing">
    <div className="p-eyebrow">
      <Icon name="credit-card" size={13} /> 定价
    </div>
    <h2 className="p-title">免费开始，AI 用量按积分计</h2>
    <p className="p-sub">
      编辑器本身永久免费。AI 能力采用积分制：充值或签到得积分，按模型实际用量扣减，账单明细逐条可查，不充值也能用自定义 Key。
    </p>

    <div className="price-grid">
      {PLANS.map((plan) => (
        <article className={'p-card price-card' + (plan.hot ? ' hot' : '')} key={plan.name}>
          <div>
            <div className="price-name">{plan.name}</div>
            <div className="price-amount">
              {plan.price === '面议' ? '面议' : `¥${plan.price}`}
              {plan.price !== '面议' && <small>{plan.unit}</small>}
            </div>
            <div className="tiny dim" style={{ marginTop: 6 }}>
              {plan.desc}
            </div>
          </div>
          <ul className="price-list">
            {plan.items.map((t) => (
              <li key={t}>
                <Icon name="check" size={13} /> {t}
              </li>
            ))}
          </ul>
          <Link className={'p-btn p-btn-block' + (plan.hot ? ' p-btn-primary' : '')} to={plan.name === 'Team' ? '/download' : '/register'}>
            {plan.name === 'Team' ? '联系我们' : '免费开始'}
          </Link>
        </article>
      ))}
    </div>

    <div className="p-note" style={{ marginTop: 20 }}>
      <Icon name="info" size={15} />
      <span>
        积分为内部计价单位：1 积分 = ¥0.01 的 AI 调用额度。官方通道按模型价格（缓存输入 / 未命中输入 / 输出分别计价，ASR 按音频时长）扣减；
        自定义 API Key 模式不扣积分。充值后不可提现，余额长期有效。
      </span>
    </div>
  </section>
)

/* ----------------------------------------------------------- CTA band */
export const CtaBand: React.FC<{ onLogin: () => void }> = ({ onLogin }) => (
  <section className="p-section tight">
    <div className="cta-band">
      <h2>现在就把笔记搬到 NeoM</h2>
      <p>本地明文 Markdown，随时可迁走；导入现有 Obsidian / Typora 仓库只需选择文件夹。</p>
      <div className="row">
        <Link className="p-btn p-btn-lg" to="/app">
          <Icon name="play" size={16} /> 立即使用（免费）
        </Link>
        <button type="button" className="p-btn p-btn-lg ghost" onClick={onLogin}>
          <Icon name="login" size={16} /> 已有账号，登录
        </button>
      </div>
    </div>
  </section>
)

/* ------------------------------------------------------- hero platform row */
export const HeroPlatformRow: React.FC<{ platforms: Array<{ key: string; short: string; icon: string }> }> = ({
  platforms
}) => (
  <div className="hero-plat">
    <span className="label">支持平台</span>
    {platforms.map((p) => (
      <Link className="plat-pill" key={p.key} to="/download">
        <Icon name={p.icon} size={14} /> {p.short}
      </Link>
    ))}
    <span className="tiny dim" style={{ marginLeft: 4 }}>
      同一账号
    </span>
  </div>
)

/** small helper re-exported for Landing's release lookups */
export const releaseFor = (releases: ReleaseAsset[], platform: string) =>
  releases.find((r) => r.platform === platform) || null

export const platformLabel = (key: string) => PLATFORM_BY_KEY[key]?.short || key

export const PLUGIN_COUNT = PLUGIN_CATALOG.length
