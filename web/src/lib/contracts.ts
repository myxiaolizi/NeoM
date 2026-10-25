/**
 * NeoM shared contracts — single source of truth for FE/BE/desktop/mobile.
 * Copy this file verbatim into desktop/ and mobile/ when they need the types.
 */

/* ============================ API ENVELOPE ============================ */
export interface ApiOk<T> {
  status: true
  data: T
  msg?: string
}
export interface ApiErr {
  status: false
  msg: string
  code?: string
  data?: unknown
}
export type ApiResp<T> = ApiOk<T> | ApiErr

/* ============================ DOMAIN ============================ */
export type Theme = 'light' | 'dark' | 'system'
export type ViewMode = 'wysiwyg' | 'source' | 'split' | 'preview'
export type RibbonPosition = 'left' | 'right' | 'status-left' | 'status-right'
export type LeftViewMode = 'files' | 'outline' | 'outline-files'
export type PageWidth = 'standard' | 'wide' | 'full'
export type NamingMode = 'ai' | 'template'
export type SortKey = 'mtime' | 'ctime' | 'name'
export type SortDir = 'asc' | 'desc'

export interface User {
  id: number
  username: string
  email?: string | null
  phone?: string | null
  nickname: string
  avatar?: string | null
  role: 'user' | 'developer' | 'admin'
  points: number
  status: 'active' | 'banned'
  storage_quota_mb: number
  rpm_limit: number
  tpm_limit: number
  created_at: string
  last_login_at?: string | null
}

export interface Vault {
  id: number | string
  name: string
  path?: string          // local desktop path
  kind: 'local' | 'cloud'
  fileCount?: number
  updated_at?: string
}

export interface FileNode {
  id: string             // stable path-like key: "folder/sub/note.md"
  vault_id: string
  name: string           // basename with extension
  path: string           // relative path inside vault
  is_dir: boolean
  parent: string         // parent relative path ('' for root)
  size: number
  mtime: string
  ctime: string
  order?: number         // manual drag sort order for folders
  tags?: string[]
  starred?: boolean
  ext: 'md' | 'mdx' | 'canvas' | 'txt' | 'html' | 'other'
}

export interface DocContent {
  id: string
  path: string
  name: string
  content: string
  mtime: string
  version: number
  /** server-computed checksum used for conflict detection */
  etag: string
}

export interface VersionMeta {
  id: number
  doc_id: string
  path: string
  version: number
  size: number
  created_at: string
  reason: 'save' | 'auto' | 'restore' | 'snapshot' | 'import'
  device?: string
}

export interface AiProvider {
  id: string
  name: string
  kind: 'mimo' | 'deepseek' | 'qwen' | 'tencent' | 'zhipu' | 'volcengine' | 'qianfan' | 'openai-compatible' | 'anthropic'
  base_url_chat?: string
  base_url_responses?: string
  base_url_anthropic?: string
  api_doc_url: string
  needs_key: boolean
  builtin?: boolean
  enabled?: boolean
}

export interface AiModel {
  id: string                 // e.g. mimo-v2.6-pro
  provider_id: string
  label: string
  category: 'text' | 'omni' | 'reasoning' | 'asr' | 'tts' | 'voiceclone'
  context_window: number
  max_output: number
  rpm: number
  tpm: number
  /** pricing */
  billing: 'token' | 'audio' | 'call' | 'free'
  price_cache_in: number     // ¥ / 1M tokens
  price_in: number           // ¥ / 1M tokens
  price_out: number          // ¥ / 1M tokens
  price_audio_hour?: number  // ¥ / hour
  price_call?: number        // ¥ / call
  free_until?: string | null
  recommended_for?: string
  tag?: string
  enabled: boolean
}

export type AiScene = 'chat' | 'naming' | 'asr' | 'tts'

export interface AiSettings {
  mode: 'official' | 'custom'
  provider_id: string
  api_key?: string           // only for custom mode; never returned by server
  enabled_models: string[]
  defaults: Record<AiScene, string>
  tts_voice?: string
  temperature?: number
}

export interface StorageSettings {
  vendor: 'aliyun-oss' | 'tencent-cos' | 'volcengine-tos' | 'baidu-bos' | 'jdcloud' | 'ksyun' | 'custom-s3' | 'system'
  bucket?: string
  endpoint?: string
  region?: string
  access_key_id?: string
  access_key_secret?: string
  public_domain?: string
  prefix?: string
  path_style?: boolean
  test_ok?: boolean
  test_at?: string
}

export interface ShortcutMap {
  [commandId: string]: string   // e.g. "Mod+1", "Mod+Shift+K"
}

export interface AppSettings {
  theme: Theme
  accent: string
  viewMode: ViewMode
  pageWidth: PageWidth
  namingMode: NamingMode
  namingTemplate: string
  showToolbar: boolean
  ribbonVisible: boolean
  ribbonPosition: RibbonPosition
  ribbonItems: string[]
  leftSidebarVisible: boolean
  leftViewMode: LeftViewMode
  rightSidebarVisible: boolean
  rightItems: string[]
  statusItems: { wordcount: boolean; history: boolean; viewSwitch: boolean }
  recentEnabled: boolean
  recentCount: number
  sortKey: SortKey
  sortDir: SortDir
  shortcuts: ShortcutMap
  editorFontSize: number
  editorLineHeight: number
  autoSaveSeconds: number
  spellcheck: boolean
  lineNumbers: boolean
}

/* ============================ PLUGINS ============================ */
export interface PluginManifest {
  id: string
  name: string
  version: string
  minAppVersion: string
  description: string
  author: string
  category: 'core' | 'visualization' | 'productivity' | 'media' | 'data' | 'ai' | 'publish'
  icon: string
  builtin: boolean
  entry?: string
  permissions: string[]
  defaultEnabled: boolean
  /** where the plugin contributes UI */
  contributes: {
    ribbon?: boolean
    leftPanel?: boolean
    rightPanel?: boolean
    statusItem?: boolean
    commands?: PluginCommand[]
  }
}

export interface PluginCommand {
  id: string
  name: string
  hotkey?: string
}

export interface InstalledPlugin {
  id: string
  version: string
  enabled: boolean
  source: 'builtin' | 'store' | 'uploaded'
  installed_at: string
  manifest?: PluginManifest
  update_available?: string
}

export interface StorePlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  category: string
  downloads: number
  rating: number
  icon: string
  screenshots?: string[]
  changelog?: string
  published_at: string
  status: 'published' | 'pending' | 'rejected' | 'offline'
  builtin?: boolean
}

/* ============================ AI RUNTIME ============================ */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
}

export interface AiUsage {
  model: string
  prompt_tokens: number
  cached_tokens: number
  completion_tokens: number
  audio_seconds?: number
  points_cost: number
  latency_ms: number
}

export interface AiChatResult {
  content: string
  usage: AiUsage
  model: string
}

export interface PointLedgerItem {
  id: number
  kind: 'ai' | 'recharge' | 'refund' | 'admin-adjust' | 'signin' | 'register-gift' | 'redeem'
  points: number           // negative = spend
  balance_after: number
  model?: string
  prompt_tokens?: number
  cached_tokens?: number
  completion_tokens?: number
  audio_seconds?: number
  note?: string
  created_at: string
}

/* ============================ SHARE / PUBLISH ============================ */
export interface ShareLink {
  id: string
  doc_id: string
  doc_name: string
  mode: 'read' | 'comment' | 'edit'
  expires_at?: string | null
  password?: string | null
  url: string
  views: number
  comments: number
  created_at: string
  status: 'active' | 'blocked' | 'expired'
}

export interface PublishPage {
  id: string
  doc_id: string
  doc_name: string
  url: string
  encrypted: boolean
  views: number
  status: 'active' | 'blocked'
  created_at: string
}

/* ============================ RELEASES ============================ */
export interface ReleaseAsset {
  id: number
  platform: 'win-x64' | 'win-green' | 'mac-arm64' | 'mac-x64' | 'android' | 'ios' | 'linux-x64'
  version: string
  filename: string
  size: number
  url: string
  sha256?: string
  changelog?: string
  forced?: boolean
  channel: 'stable' | 'beta'
  published_at: string
  downloads?: number
}

/* ============================ API ROUTES ============================ */
export const API = {
  // health
  health: '/api/health',
  bootstrap: '/api/bootstrap',

  // auth
  authRegister: '/api/auth/register',
  authLogin: '/api/auth/login',
  authLogout: '/api/auth/logout',
  authMe: '/api/auth/me',
  authRefresh: '/api/auth/refresh',
  authProfile: '/api/auth/profile',
  authPassword: '/api/auth/password',
  authSessions: '/api/auth/sessions',
  authBind: '/api/auth/bind',

  // files (cloud vault)
  filesTree: '/api/files/tree',
  filesList: '/api/files/list',
  filesRead: '/api/files/read',
  filesWrite: '/api/files/write',
  filesCreate: '/api/files/create',
  filesMkdir: '/api/files/mkdir',
  filesRename: '/api/files/rename',
  filesMove: '/api/files/move',
  filesCopy: '/api/files/copy',
  filesDelete: '/api/files/delete',
  filesSearch: '/api/files/search',
  filesRecent: '/api/files/recent',
  filesSort: '/api/files/sort',
  filesSync: '/api/files/sync',
  filesExport: '/api/files/export',
  filesImport: '/api/files/import',
  filesConflict: '/api/files/conflict',

  // versions
  versionsList: '/api/versions/list',
  versionsRead: '/api/versions/read',
  versionsRestore: '/api/versions/restore',
  versionsSnapshot: '/api/versions/snapshot',
  versionsDiff: '/api/versions/diff',

  // share & publish
  shareCreate: '/api/share/create',
  shareList: '/api/share/list',
  shareRevoke: '/api/share/revoke',
  shareGet: '/api/share/get',
  shareComment: '/api/share/comment',
  publishCreate: '/api/publish/create',
  publishList: '/api/publish/list',
  publishRevoke: '/api/publish/revoke',

  // ai
  aiProviders: '/api/ai/providers',
  aiModels: '/api/ai/models',
  aiChat: '/api/ai/chat',
  aiChatStream: '/api/ai/chat/stream',
  aiAsr: '/api/ai/asr',
  aiTts: '/api/ai/tts',
  aiTtsVoices: '/api/ai/tts/voices',
  aiFetchModels: '/api/ai/fetch-models',
  aiSettings: '/api/ai/settings',
  aiTest: '/api/ai/test',

  // billing
  pointsBalance: '/api/billing/balance',
  pointsLedger: '/api/billing/ledger',
  pointsPackages: '/api/billing/packages',
  pointsRecharge: '/api/billing/recharge',
  pointsRedeem: '/api/billing/redeem',
  pointsOrders: '/api/billing/orders',
  pointsSignin: '/api/billing/signin',

  // storage settings
  storageGet: '/api/storage/settings',
  storageSave: '/api/storage/settings',
  storageTest: '/api/storage/test',
  storageUpload: '/api/storage/upload',

  // plugins
  pluginsInstalled: '/api/plugins/installed',
  pluginsStore: '/api/plugins/store',
  pluginsInstall: '/api/plugins/install',
  pluginsUninstall: '/api/plugins/uninstall',
  pluginsToggle: '/api/plugins/toggle',
  pluginsUpload: '/api/plugins/upload',
  pluginsUpdate: '/api/plugins/update',
  pluginsManifest: '/api/plugins/manifest',

  // releases / downloads
  releases: '/api/releases',
  releasesCheck: '/api/releases/check',

  // public site config
  siteConfig: '/api/site/config',
  siteAnnouncement: '/api/site/announcement',
  siteDocs: '/api/site/docs',

  // admin
  adminLogin: '/api/admin/login',
  adminDashboard: '/api/admin/dashboard',
  adminUsers: '/api/admin/users',
  adminUser: '/api/admin/user',
  adminPoints: '/api/admin/points',
  adminChannels: '/api/admin/channels',
  adminModels: '/api/admin/models',
  adminPricing: '/api/admin/pricing',
  adminOrders: '/api/admin/orders',
  adminRedeem: '/api/admin/redeem',
  adminPlugins: '/api/admin/plugins',
  adminShares: '/api/admin/shares',
  adminComments: '/api/admin/comments',
  adminReleases: '/api/admin/releases',
  adminOss: '/api/admin/oss',
  adminSite: '/api/admin/site',
  adminSecurity: '/api/admin/security',
  adminAudit: '/api/admin/audit',
  adminStats: '/api/admin/stats',
  adminBackup: '/api/admin/backup'
} as const

/* ============================ LOCAL EVENTS ============================ */
export const EVT = {
  docSaved: 'neom:doc-saved',
  docOpened: 'neom:doc-opened',
  docClosed: 'neom:doc-closed',
  fileTreeChanged: 'neom:file-tree-changed',
  aiInsert: 'neom:ai-insert',
  aiReplaceSelection: 'neom:ai-replace',
  commandRun: 'neom:command',
  themeChanged: 'neom:theme',
  settingsChanged: 'neom:settings',
  toast: 'neom:toast',
  conflict: 'neom:conflict'
} as const

/* ============================ DEFAULT SETTINGS ============================ */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  'file.new': 'Mod+N',
  'file.open': 'Mod+O',
  'file.save': 'Mod+S',
  'file.saveAs': 'Mod+Shift+S',
  'file.export': 'Mod+Shift+E',
  'app.commandPalette': 'Mod+P',
  'app.quickSwitcher': 'Mod+Shift+P',
  'app.search': 'Mod+Shift+F',
  'app.settings': 'Mod+,',
  'view.toggle': 'Mod+E',
  'view.source': 'Mod+Shift+E',
  'view.wysiwyg': 'Mod+Shift+W',
  'view.preview': 'Mod+Shift+R',
  'edit.find': 'Mod+F',
  'edit.replace': 'Mod+H',
  'edit.bold': 'Mod+B',
  'edit.italic': 'Mod+I',
  'edit.strike': 'Mod+Shift+X',
  'edit.inlineCode': 'Mod+Shift+C',
  'edit.link': 'Mod+K',
  'edit.highlight': 'Mod+Shift+H',
  'h1': 'Mod+1',
  'h2': 'Mod+2',
  'h3': 'Mod+3',
  'h4': 'Mod+4',
  'h5': 'Mod+5',
  'h6': 'Mod+6',
  'para.normal': 'Mod+0',
  'list.todo': 'Mod+Shift+T',
  'list.ul': 'Mod+Shift+8',
  'list.ol': 'Mod+Shift+7',
  'app.toggleLeft': 'Mod+Shift+L',
  'app.toggleRight': 'Mod+Shift+A',
  'app.toggleRibbon': 'Mod+Shift+B',
  'ai.assistant': 'Mod+Shift+I',
  'ai.polish': 'Mod+Shift+U',
  'ai.summary': 'Mod+Shift+M',
  'graph.open': 'Mod+G',
  'canvas.open': 'Mod+Shift+O',
  'daily.open': 'Mod+D',
  'tab.close': 'Mod+W',
  'tab.closeOthers': 'Mod+Alt+W',
  'tab.next': 'Ctrl+Tab',
  'tab.prev': 'Ctrl+Shift+Tab'
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accent: '#2f6fed',
  viewMode: 'wysiwyg',
  pageWidth: 'standard',
  namingMode: 'template',
  namingTemplate: 'YY年MM月DD日HHMM-【{title}】',
  showToolbar: true,
  ribbonVisible: true,
  ribbonPosition: 'left',
  ribbonItems: ['files', 'search', 'outline', 'tags', 'graph', 'canvas', 'calendar', 'ai', 'settings'],
  leftSidebarVisible: true,
  leftViewMode: 'files',
  rightSidebarVisible: false,
  rightItems: ['ai', 'fileinfo', 'backlinks', 'outline'],
  statusItems: { wordcount: true, history: true, viewSwitch: true },
  recentEnabled: true,
  recentCount: 8,
  sortKey: 'mtime',
  sortDir: 'desc',
  shortcuts: DEFAULT_SHORTCUTS,
  editorFontSize: 16,
  editorLineHeight: 1.75,
  autoSaveSeconds: 20,
  spellcheck: false,
  lineNumbers: false
}

/* ============================ BUILTIN PLUGIN IDS ============================ */
export const BUILTIN_PLUGINS = [
  'canvas', 'note-restructure', 'tag-list', 'outgoing-links', 'outline', 'publish',
  'backlinks', 'workspace', 'graph', 'slides', 'footnote-view', 'quick-switcher',
  'recorder', 'random-note', 'daily-notes', 'bookmarks', 'properties', 'database',
  'web-browser', 'file-recovery', 'file-explorer', 'slash-commands', 'page-preview',
  'word-count'
] as const

export const AI_PROVIDERS: AiProvider[] = [
  { id: 'mimo', name: '小米 mimo', kind: 'mimo', base_url_chat: 'https://api.xiaomimimo.com/v1/chat/completions', base_url_responses: 'https://api.xiaomimimo.com/v1/responses', base_url_anthropic: 'https://api.xiaomimimo.com/anthropic/v1/messages', api_doc_url: 'https://api.xiaomimimo.com', needs_key: true, builtin: true },
  { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', base_url_chat: 'https://api.deepseek.com/v1/chat/completions', api_doc_url: 'https://platform.deepseek.com/api_keys', needs_key: true, builtin: true },
  { id: 'qwen', name: '通义千问', kind: 'qwen', base_url_chat: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', api_doc_url: 'https://bailian.console.aliyun.com/', needs_key: true, builtin: true },
  { id: 'tencent', name: '腾讯云', kind: 'tencent', base_url_chat: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', api_doc_url: 'https://console.cloud.tencent.com/hunyuan/api-key', needs_key: true, builtin: true },
  { id: 'zhipu', name: '智谱 Zhipu', kind: 'zhipu', base_url_chat: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', api_doc_url: 'https://open.bigmodel.cn/usercenter/apikeys', needs_key: true, builtin: true },
  { id: 'volcengine', name: '火山引擎', kind: 'volcengine', base_url_chat: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', api_doc_url: 'https://console.volcengine.com/ark', needs_key: true, builtin: true },
  { id: 'qianfan', name: '百度千帆', kind: 'qianfan', base_url_chat: 'https://qianfan.baidubce.com/v2/chat/completions', api_doc_url: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application', needs_key: true, builtin: true },
  { id: 'openai-compatible', name: '自定义 [OI] 兼容', kind: 'openai-compatible', base_url_chat: '', api_doc_url: '', needs_key: true, builtin: false },
  { id: 'anthropic', name: '自定义 Anthropic 兼容', kind: 'anthropic', base_url_anthropic: '', api_doc_url: '', needs_key: true, builtin: false }
]
