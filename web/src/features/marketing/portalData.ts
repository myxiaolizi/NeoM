/**
 * Portal content — built-in copy and catalogues used as graceful fallbacks
 * when `GET /api/site/config`, `/api/plugins/store`, `/api/releases` and
 * `/api/site/docs` are unavailable. Also the static definition of the
 * 24 built-in plugins referenced by BUILTIN_PLUGINS in lib/contracts.
 */
import type { ReleaseAsset, StorePlugin, PluginManifest, AiScene } from '@/lib/contracts'
import { safeArr, pick } from './portalKit'

export const BRAND = {
  name: 'NeoM',
  slogan: '极速、AI 原生、全平台的 Markdown 知识库',
  domain: 'neom.app',
  repo: 'https://github.com/neom-app/neom',
  email: 'support@neom.app'
}

/* --------------------------------------------------------------- nav */
export interface NavLink {
  id: string
  label: string
  href: string
}
export const NAV_LINKS: NavLink[] = [
  { id: 'features', label: '功能', href: '#features' },
  { id: 'ai', label: 'AI', href: '#ai' },
  { id: 'plugins', label: '插件', href: '#plugins' },
  { id: 'sync', label: '同步', href: '#sync' },
  { id: 'multi', label: '多端', href: '#multi' },
  { id: 'pricing', label: '定价', href: '#pricing' }
]

/* ----------------------------------------------------------- features */
export interface FeatureCard {
  icon: string
  title: string
  desc: string
  tag?: string
}
export const FEATURE_CARDS: FeatureCard[] = [
  { icon: 'cpu', title: '极速轻量', desc: '冷启动 0.6s，10 万篇笔记滚动不掉帧；本地优先，离线可用。', tag: '性能' },
  { icon: 'layout-both', title: '类 Obsidian 布局', desc: '左侧文件树 + 多标签页 + 右侧面板，熟悉的双链笔记工作流。', tag: '布局' },
  { icon: 'columns', title: '四种视图模式', desc: '所见即所得、源码、分屏、只读预览，一个快捷键自由切换。' },
  { icon: 'window', title: 'Win11 Fluent 视觉', desc: '亚克力材质、圆角、柔和阴影与渐变光晕，深浅色自动跟随系统。' },
  { icon: 'sync', title: '多端实时同步', desc: '桌面 / 网页 / 移动端同一份内容，冲突自动比对，秒级同步。', tag: '同步' },
  { icon: 'cloud', title: 'S3 / OSS 存储', desc: '阿里云 OSS、腾讯云 COS、火山 TOS 等 7 家对象存储，也可用系统默认空间。' },
  { icon: 'puzzle', title: '24+ 插件生态', desc: '关系图谱、白板画布、数据库视图、幻灯片、网页发布…开箱即用。', tag: '插件' },
  { icon: 'more', title: '全局右键菜单', desc: '文件、标签、正文、表格、图片全场最右键，移动端长按同效。' },
  { icon: 'history', title: '历史版本与 Diff', desc: '每次保存留档，任意时间点对比与恢复，误删也能从回收站找回。' },
  { icon: 'users', title: '免登录协作', desc: '分享链接即开即读，可开启评论标注或协同编辑，带密码与有效期。' },
  { icon: 'hard-drive', title: '多仓库本地明文', desc: '本地仓库就是普通 Markdown 文件夹，随时用 Git 管理、随时迁移。' },
  { icon: 'command', title: '自定义快捷键', desc: '全部命令可改键，命令面板支持模糊搜索与最近使用。' }
]

/* ------------------------------------------------------------- plugins */
export interface CatalogPlugin {
  id: string
  name: string
  desc: string
  category: 'core' | 'visualization' | 'productivity' | 'media' | 'data' | 'ai' | 'publish'
  icon: string
}
/** The 24 built-in plugins (ids match BUILTIN_PLUGINS in lib/contracts.ts). */
export const PLUGIN_CATALOG: CatalogPlugin[] = [
  { id: 'canvas', name: '白板画布', desc: '无限画布自由排布卡片与连线，整理灵感与结构。', category: 'visualization', icon: 'canvas' },
  { id: 'note-restructure', name: '笔记重构', desc: '一键拆分、合并、重排笔记结构，长文变大纲。', category: 'productivity', icon: 'edit' },
  { id: 'tag-list', name: '标签列表', desc: '汇总全库标签与引用次数，支持按标签筛选聚合。', category: 'data', icon: 'tag' },
  { id: 'outgoing-links', name: '出链面板', desc: '列出当前笔记指向的所有页面与外链，快速跳转。', category: 'data', icon: 'link' },
  { id: 'outline', name: '大纲导航', desc: '按标题层级生成大纲，点击定位，支持折叠。', category: 'core', icon: 'list' },
  { id: 'publish', name: '网页发布', desc: '一键发布为独立 HTML 页，可选密码与评论挂件。', category: 'publish', icon: 'globe' },
  { id: 'backlinks', name: '反向链接', desc: '谁引用了这篇笔记，上下文片段直接预览。', category: 'data', icon: 'share' },
  { id: 'workspace', name: '工作区', desc: '保存与切换多套侧栏 / 面板布局，按场景切换。', category: 'core', icon: 'layout-both' },
  { id: 'graph', name: '关系图谱', desc: '全库知识网络可视化，支持筛选、聚类与局部聚焦。', category: 'visualization', icon: 'graph' },
  { id: 'slides', name: '幻灯片演示', desc: '把笔记按分隔符切成演示页，全屏放映。', category: 'publish', icon: 'slides' },
  { id: 'footnote-view', name: '脚注视图', desc: '抽出全部脚注集中阅读与编辑，正文更清爽。', category: 'core', icon: 'footnote' },
  { id: 'quick-switcher', name: '快速切换', desc: '模糊搜索文件与命令，键盘流跳转不离开双手。', category: 'core', icon: 'command' },
  { id: 'recorder', name: '录音速记', desc: '录音转文字并自动成稿，支持 AI 润色整理。', category: 'media', icon: 'mic' },
  { id: 'random-note', name: '随机漫游', desc: '随机打开一篇旧笔记，唤醒沉睡的灵感。', category: 'productivity', icon: 'shuffle' },
  { id: 'daily-notes', name: '每日笔记', desc: '按日期自动创建当日笔记，模板可自定义。', category: 'productivity', icon: 'calendar' },
  { id: 'bookmarks', name: '书签收藏', desc: '收藏常用页面并分组，一键回到工作现场。', category: 'core', icon: 'bookmark' },
  { id: 'properties', name: '文档属性', desc: '以表单方式编辑 YAML 元数据，支持类型校验。', category: 'core', icon: 'sliders' },
  { id: 'database', name: '数据库视图', desc: '把笔记集合渲染成表格、看板、画廊与日历。', category: 'data', icon: 'database' },
  { id: 'web-browser', name: '内置浏览器', desc: '侧栏打开网页并一键剪藏为 Markdown 笔记。', category: 'media', icon: 'browser' },
  { id: 'file-recovery', name: '文件恢复', desc: '回收站与历史快照双保险，按时间点还原。', category: 'core', icon: 'history' },
  { id: 'file-explorer', name: '文件浏览器', desc: '增强文件树：排序、筛选、批量移动与搜索。', category: 'core', icon: 'folder' },
  { id: 'slash-commands', name: '斜杠命令', desc: '输入 / 唤起块级命令，插入表格、公式、看板。', category: 'productivity', icon: 'code' },
  { id: 'page-preview', name: '悬浮预览', desc: '悬停链接即预览目标页面，不打断当前阅读。', category: 'core', icon: 'eye' },
  { id: 'word-count', name: '字数统计', desc: '实时字数、字符、段落与预计阅读时长统计。', category: 'core', icon: 'hash' }
]

export const PLUGIN_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'core', label: '核心' },
  { id: 'visualization', label: '可视化' },
  { id: 'productivity', label: '效率' },
  { id: 'media', label: '媒体' },
  { id: 'data', label: '数据' },
  { id: 'ai', label: 'AI' },
  { id: 'publish', label: '发布' }
]

export const CATEGORY_LABEL: Record<string, string> = PLUGIN_CATEGORIES.reduce<Record<string, string>>((acc, c) => {
  acc[c.id] = c.label
  return acc
}, {})

/** Fallback store entries derived from the built-in catalogue. */
export const FALLBACK_STORE_PLUGINS: StorePlugin[] = PLUGIN_CATALOG.map((p, i) => ({
  id: p.id,
  name: p.name,
  version: '1.0.0',
  description: p.desc,
  author: 'NeoM 官方',
  category: p.category,
  downloads: [128400, 96400, 88200, 64100, 152300, 41200, 77900, 52300, 118600, 38600, 45100, 96700, 33200, 27400, 88900, 61500, 50800, 73200, 39800, 44600, 105900, 57600, 68900, 121300][i] || 10000,
  rating: Number((4.4 + ((i * 7) % 6) / 10).toFixed(1)),
  icon: p.icon,
  screenshots: [],
  changelog: '首个公开版本：稳定运行，支持右键菜单与命令面板。',
  published_at: new Date(Date.now() - (i + 1) * 86400000 * 6).toISOString(),
  status: 'published',
  builtin: true
}))

/* ---------------------------------------------------------- platforms */
export interface PlatformMeta {
  key: string
  label: string
  short: string
  icon: string
  ext: string
  kind: string
  recommend?: boolean
}
export const PLATFORMS: PlatformMeta[] = [
  { key: 'win-x64', label: 'Windows 安装版', short: 'Windows', icon: 'windows', ext: '.exe', kind: '安装包' },
  { key: 'win-green', label: 'Windows 绿色版', short: 'Windows', icon: 'windows', ext: '.zip', kind: '免安装' },
  { key: 'mac-arm64', label: 'macOS ARM64', short: 'macOS', icon: 'apple', ext: '.dmg', kind: 'Apple Silicon' },
  { key: 'mac-x64', label: 'macOS Intel', short: 'macOS', icon: 'apple', ext: '.dmg', kind: 'Intel 芯片' },
  { key: 'android', label: 'Android', short: 'Android', icon: 'android', ext: '.apk', kind: '原生应用' },
  { key: 'ios', label: 'iOS', short: 'iOS', icon: 'apple', ext: '.ipa', kind: 'TestFlight / 侧载' },
  { key: 'linux-x64', label: 'Linux x64', short: 'Linux', icon: 'linux', ext: '.AppImage', kind: '通用包' }
]

export const HERO_PLATFORMS: PlatformMeta[] = PLATFORMS.filter((p) =>
  ['win-x64', 'mac-arm64', 'android', 'ios'].includes(p.key)
).concat([{ key: 'web', label: '网页版', short: 'Web', icon: 'globe', ext: '', kind: '浏览器直开' }])

export const PLATFORM_BY_KEY: Record<string, PlatformMeta> = PLATFORMS.concat([
  { key: 'web', label: '网页版', short: 'Web', icon: 'globe', ext: '', kind: '浏览器直开' }
]).reduce<Record<string, PlatformMeta>>((acc, p) => {
  acc[p.key] = p
  return acc
}, {})

/* ------------------------------------------------------------- releases */
/** Placeholder assets shown when /api/releases has nothing yet. */
export const FALLBACK_RELEASES: ReleaseAsset[] = PLATFORMS.map((p) => ({
  id: 0,
  platform: p.key as ReleaseAsset['platform'],
  version: '1.0.0',
  filename: `NeoM-1.0.0-${p.key}${p.ext}`,
  size: 0,
  url: '',
  sha256: '',
  changelog: '首个正式版。',
  channel: 'stable',
  published_at: ''
}))

export function normalizeReleases(raw: any): ReleaseAsset[] {
  const items = safeArr<any>(raw)
  const out: ReleaseAsset[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const platform = String(pick(it, ['platform', 'os', 'target', 'key'], '') || '')
    if (!platform) continue
    out.push({
      id: Number(pick(it, ['id'], 0)),
      platform: platform as ReleaseAsset['platform'],
      version: String(pick(it, ['version', 'ver'], '1.0.0')),
      filename: String(pick(it, ['filename', 'file', 'name'], '')),
      size: Number(pick(it, ['size', 'bytes'], 0)),
      url: String(pick(it, ['url', 'download_url', 'href', 'oss_url'], '')),
      sha256: String(pick(it, ['sha256', 'checksum', 'hash'], '')),
      changelog: String(pick(it, ['changelog', 'notes', 'release_notes'], '')),
      forced: !!pick(it, ['forced'], false),
      channel: (pick(it, ['channel'], 'stable') as ReleaseAsset['channel']) || 'stable',
      published_at: String(pick(it, ['published_at', 'created_at', 'date'], '')),
      downloads: Number(pick(it, ['downloads', 'download_count'], 0))
    })
  }
  return out
}

/* ---------------------------------------------------------- site config */
export interface SiteConfig {
  brand: string
  slogan: string
  bannerTitle: string
  bannerSub: string
  icp: string
  copyright: string
  github: string
  contactEmail: string
  announcements: string
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  brand: BRAND.name,
  slogan: BRAND.slogan,
  bannerTitle: '把知识库，装进一个极速的 Markdown 编辑器',
  bannerSub:
    '本地优先、AI 原生、全平台实时同步。类 Obsidian 的双链工作流，Win11 Fluent 的现代观感，24 款插件覆盖图谱、白板、数据库与发布。',
  icp: '京ICP备00000000号-1',
  copyright: `© ${new Date().getFullYear()} NeoM · 保留所有权利`,
  github: BRAND.repo,
  contactEmail: BRAND.email,
  announcements: ''
}

export function normalizeSiteConfig(raw: any): SiteConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_SITE_CONFIG
  const banner = raw.banner && typeof raw.banner === 'object' ? raw.banner : raw
  const footer = raw.footer && typeof raw.footer === 'object' ? raw.footer : raw
  return {
    brand: String(pick(raw, ['brand', 'name', 'site_name'], DEFAULT_SITE_CONFIG.brand)),
    slogan: String(pick(raw, ['slogan', 'tagline', 'description'], DEFAULT_SITE_CONFIG.slogan)),
    bannerTitle: String(pick(banner, ['title', 'banner_title', 'headline'], DEFAULT_SITE_CONFIG.bannerTitle)),
    bannerSub: String(pick(banner, ['subtitle', 'sub', 'desc', 'banner_subtitle'], DEFAULT_SITE_CONFIG.bannerSub)),
    icp: String(pick(footer, ['icp', 'beian', 'icp_number'], DEFAULT_SITE_CONFIG.icp)),
    copyright: String(pick(footer, ['copyright', 'copy'], DEFAULT_SITE_CONFIG.copyright)),
    github: String(pick(footer, ['github', 'repo'], DEFAULT_SITE_CONFIG.github)),
    contactEmail: String(pick(footer, ['email', 'contact'], DEFAULT_SITE_CONFIG.contactEmail)),
    announcements: String(pick(raw, ['announcement', 'notice'], DEFAULT_SITE_CONFIG.announcements))
  }
}

/* --------------------------------------------------------- announcement */
export function normalizeAnnouncement(raw: any): string {
  if (!raw) return ''
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw !== 'object') return ''
  if (pick(raw, ['enabled'], true) === false) return ''
  return String(pick(raw, ['text', 'content', 'message', 'title', 'announcement', 'notice'], '') || '').trim()
}

/* ------------------------------------------------------------- docs */
export const FALLBACK_DOCS: Record<'terms' | 'privacy', { title: string; content: string }> = {
  terms: {
    title: '用户服务协议',
    content: `# 用户服务协议

欢迎使用 NeoM（以下简称"本服务"）。在使用本服务前，请仔细阅读并同意本协议。

## 一、服务内容

本服务提供 Markdown 笔记编辑、云端同步、AI 辅助写作、插件扩展与内容分享等能力。部分能力（如 AI 调用、云端备份）会消耗账户积分。

## 二、账号与安全

1. 你应妥善保管账号与密码，因自身原因导致的账号泄露由你自行承担。
2. 不得将账号提供给他人用于违法用途。
3. 如发现异常登录，请立即修改密码并在「个人中心 → 安全」中下线可疑设备。

## 三、内容与数据

1. 你在本服务中创建的笔记内容归你所有。
2. 云端内容存储于对象存储（OSS/S3）中，本地仓库以明文 Markdown 保存，你随时可以导出或迁移。
3. 请勿上传违反法律法规的内容，违规内容将被屏蔽且不予退费。

## 四、AI 服务

1. 官方 AI 通道按模型价格与 Token 用量扣减积分，价格以「AI 服务设置」页展示为准。
2. 你也可以填写自己的 API Key 使用自定义通道，该模式下不扣减积分，费用由你与供应商结算。
3. AI 生成内容仅供参考，请自行核实其准确性。

## 五、积分与退款

积分充值后不可提现；因平台原因导致的服务不可用，可联系客服按未消耗比例补偿。

## 六、责任限制

本服务按"现状"提供。因不可抗力、网络故障、第三方服务中断导致的损失，在法律允许范围内不承担责任。

## 七、协议变更

本协议可能随功能调整而更新，更新后将在站内公告。继续使用即视为接受新版本。

> 本协议为示例文案，正式上线前请由运营/法务替换为正式版本。`
  },
  privacy: {
    title: '隐私政策',
    content: `# 隐私政策

我们非常重视你的隐私。本政策说明 NeoM 收集哪些信息、如何使用以及你享有的权利。

## 一、我们收集的信息

| 类型 | 内容 | 用途 |
|---|---|---|
| 账号信息 | 用户名、昵称、邮箱、手机号（可选） | 登录、找回、通知 |
| 设备信息 | 登录 IP、User-Agent、设备标识 | 异地登录提醒、会话管理 |
| 内容数据 | 你创建的 Markdown 笔记、附件 | 提供编辑与同步服务 |
| 使用数据 | AI 调用 Token 用量、积分变动 | 计费与账单展示 |

## 二、信息的使用

1. 仅用于提供、维护与改进本服务。
2. 不会将你的笔记内容用于模型训练。
3. 按监管要求保存登录日志，仅用于安全审计。

## 三、凭证保护

第三方 API Key、对象存储密钥在服务端加密存储（AES-256-GCM），接口永不回传明文，仅展示掩码。

## 四、Cookie 与本地存储

我们使用 localStorage 保存登录令牌 neom.token 与界面偏好（主题、布局）。你可以随时清除浏览器数据，这会导致需要重新登录。

## 五、共享

除以下情况，我们不会向第三方共享你的个人信息：
- 你主动开启的自定义 AI / 对象存储通道（数据直接发往你所配置的服务商）
- 法律法规要求或司法/行政机关依法调取

## 六、你的权利

你可以随时导出全部笔记、修改个人资料、注销账号。注销后云端内容将在 30 天内彻底删除。

## 七、联系我们

隐私相关问题请联系：privacy@neom.app

> 本政策为示例文案，正式上线前请由运营/法务替换为正式版本。`
  }
}

export function normalizeDoc(raw: any, key: 'terms' | 'privacy'): { title: string; content: string } {
  const fallback = FALLBACK_DOCS[key]
  if (!raw) return fallback
  if (typeof raw === 'string') return { title: fallback.title, content: raw }
  const content = String(pick(raw, ['content', 'body', 'text', 'markdown'], '') || '')
  if (!content) return fallback
  return { title: String(pick(raw, ['title', 'name'], fallback.title)), content }
}

/* ----------------------------------------------------------------- AI */
export const AI_SCENES: Array<{ key: AiScene; label: string; hint: string }> = [
  { key: 'chat', label: '对话生成', hint: '写作、润色、总结、翻译等主对话场景' },
  { key: 'naming', label: '快速命名', hint: '根据首段内容生成文件名' },
  { key: 'asr', label: '语音识别 (ASR)', hint: '录音转文字' },
  { key: 'tts', label: '语音合成 (TTS)', hint: '文本转语音朗读' }
]

export const AI_CAPABILITIES = [
  { icon: 'sparkles', title: 'AI 写作', desc: '续写、扩写、改写，按你的语气继续。' },
  { icon: 'edit', title: '润色', desc: '纠正语病与标点，保留原意只提质感。' },
  { icon: 'list', title: '总结', desc: '长文生成摘要、要点清单与待办抽取。' },
  { icon: 'globe', title: '翻译', desc: '中英日韩互译，术语表可固定。' },
  { icon: 'mic', title: '语音识别', desc: '录音速记转文字，自动分段标点。' },
  { icon: 'volume', title: '语音合成', desc: '笔记一键朗读，多音色可选。' },
  { icon: 'users', title: '音色克隆', desc: '上传样音克隆专属音色，朗读自己的声音。' }
]

/** Model family quick-pick guidance shown in the account AI panel. */
export const QUICK_PICK_GUIDE = [
  { family: 'pro', scene: '复杂任务', desc: '长文推理、多步改写、代码与结构化输出' },
  { family: 'flash', scene: '高频规模化', desc: '批量润色、命名、摘要，便宜且快' },
  { family: 'ultraspeed', scene: '强实时', desc: '输入即出字，对话与补全体验最好' },
  { family: 'asr', scene: '语音转文字', desc: '录音、会议、口述成稿' },
  { family: 'tts', scene: '文字转语音', desc: '朗读笔记、有声稿生成' },
  { family: 'voiceclone', scene: '声音克隆', desc: '用自己的音色朗读' },
  { family: 'voicedesign', scene: '自定义音色', desc: '用文字描述生成新音色' }
]

/** One-line purpose for each preset AI provider (shown on the provider cards). */
export const PROVIDER_PURPOSE: Record<string, string> = {
  mimo: '小米自研全模态：文本 / 语音识别 / 语音合成 / 音色克隆一站齐备，官方通道默认供应商',
  deepseek: '推理与代码见长，价格低，适合长文分析与结构化输出',
  qwen: '通义千问全系列，中文理解与文档处理稳定，含视觉与语音模型',
  tencent: '腾讯混元，企业级稳定性与合规支持，适合生产环境',
  zhipu: '智谱 GLM 系列，长上下文与工具调用成熟，适合 Agent 场景',
  volcengine: '火山方舟（豆包），高并发推理与低延迟流式输出',
  qianfan: '百度千帆，多模型聚合平台，可直接复用已有百度云额度',
  'openai-compatible': '任何兼容 OpenAI Chat Completions 协议的自建或第三方服务',
  anthropic: '兼容 Anthropic Messages 协议的服务（Claude 及其代理）'
}

/* ------------------------------------------------------------ storage */
export interface StorageVendor {
  id: string
  label: string
  endpointTpl: string
  regionHint: string
  docs: string
}
export const STORAGE_VENDORS: StorageVendor[] = [
  { id: 'aliyun-oss', label: '阿里云 OSS', endpointTpl: 'https://{bucket}.oss-{region}.aliyuncs.com', regionHint: 'cn-hangzhou', docs: 'https://help.aliyun.com/product/31815.html' },
  { id: 'tencent-cos', label: '腾讯云 COS', endpointTpl: 'https://{bucket}.cos.{region}.myqcloud.com', regionHint: 'ap-guangzhou', docs: 'https://cloud.tencent.com/document/product/436' },
  { id: 'volcengine-tos', label: '火山引擎 TOS', endpointTpl: 'https://{bucket}.tos-{region}.volces.com', regionHint: 'cn-beijing', docs: 'https://www.volcengine.com/docs/6349' },
  { id: 'baidu-bos', label: '百度云 BOS', endpointTpl: 'https://{bucket}.{region}.bcebos.com', regionHint: 'bj', docs: 'https://cloud.baidu.com/doc/BOS/index.html' },
  { id: 'jdcloud', label: '京东云 OSS', endpointTpl: 'https://{bucket}.s3.{region}.jdcloud-oss.com', regionHint: 'cn-north-1', docs: 'https://docs.jdcloud.com/cn/object-storage-service/' },
  { id: 'ksyun', label: '金山云 KS3', endpointTpl: 'https://{bucket}.ks3-{region}.ksyuncs.com', regionHint: 'cn-beijing', docs: 'https://docs.ksyun.com/documents/2305' },
  { id: 'custom-s3', label: '自定义 S3 兼容', endpointTpl: 'https://s3.example.com', regionHint: 'us-east-1', docs: 'https://docs.aws.amazon.com/s3/' },
  { id: 'system', label: '使用系统默认存储', endpointTpl: '', regionHint: '', docs: '' }
]

export const STORAGE_VENDOR_LABEL: Record<string, string> = STORAGE_VENDORS.reduce<Record<string, string>>((acc, v) => {
  acc[v.id] = v.label
  return acc
}, {})

/** Manifest skeleton shown by the developer guide. */
export const MANIFEST_EXAMPLE: PluginManifest = {
  id: 'hello-neom',
  name: 'Hello NeoM',
  version: '1.0.0',
  minAppVersion: '1.0.0',
  description: '一个最小的 NeoM 插件示例：注册命令 + 右侧面板。',
  author: 'you',
  category: 'productivity',
  icon: 'puzzle',
  builtin: false,
  entry: 'index.js',
  permissions: ['editor:write', 'files:read'],
  defaultEnabled: false,
  contributes: {
    rightPanel: true,
    commands: [{ id: 'plugin.hello-neom.insert', name: '插入问候语', hotkey: 'Mod+Shift+H' }]
  }
}
