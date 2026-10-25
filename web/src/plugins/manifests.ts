/**
 * The 24 built-in plugin manifests + the AI assistant plugin (25th).
 * `BUILTIN_PLUGINS` in `lib/contracts.ts` lists the original 24; `ai` is
 * registered here as an extra built-in so the shell can mount its panel.
 */
import type { PluginManifest, PluginCommand } from '@/lib/contracts'

const V = '1.0.0'
const MIN = '1.0.0'

const cmd = (id: string, name: string, hotkey?: string): PluginCommand => ({ id, name, hotkey })

const base = (p: Partial<PluginManifest> & Pick<PluginManifest, 'id' | 'name' | 'description' | 'category' | 'icon'>): PluginManifest => ({
  id: p.id,
  name: p.name,
  version: V,
  minAppVersion: MIN,
  description: p.description,
  author: 'NeoM',
  category: p.category,
  icon: p.icon,
  builtin: true,
  permissions: p.permissions || ['files:read', 'files:write'],
  defaultEnabled: p.defaultEnabled !== false,
  contributes: p.contributes || { ribbon: true, leftPanel: true },
  ...(p.entry ? { entry: p.entry } : {})
})

export const M = {
  canvas: base({
    id: 'canvas',
    name: '白板画布',
    description: '无限画布：卡片/便签/连线/框选，思维导图布局，保存为 .canvas 文件',
    category: 'visualization',
    icon: 'canvas',
    permissions: ['files:read', 'files:write'],
    contributes: {
      ribbon: true,
      leftPanel: true,
      commands: [cmd('plugin.canvas.open', '打开白板', 'Mod+Shift+O'), cmd('plugin.canvas.save', '保存白板')]
    }
  }),
  'note-restructure': base({
    id: 'note-restructure',
    name: '笔记重组',
    description: '拆分 / 合并 / 章节重排：把长文档拆成多篇，或把多篇合成一篇',
    category: 'productivity',
    icon: 'scissors',
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.noteRestructure.open', '笔记重组')] }
  }),
  'tag-list': base({
    id: 'tag-list',
    name: '标签列表',
    description: '扫描全库 #标签，按 / 层级树状聚合、计数与筛选',
    category: 'data',
    icon: 'tag',
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.tagList.open', '打开标签列表')] }
  }),
  'outgoing-links': base({
    id: 'outgoing-links',
    name: '出链',
    description: '当前文档的内部 [[链接]] 与外部链接列表，点击直达',
    category: 'core',
    icon: 'external',
    contributes: { ribbon: false, leftPanel: false, rightPanel: true, commands: [cmd('plugin.outgoingLinks.open', '查看出链')] }
  }),
  outline: base({
    id: 'outline',
    name: '大纲',
    description: 'H1-H6 树形大纲，点击跳转，拖拽重排标题（正文一起移动）',
    category: 'core',
    icon: 'headings',
    contributes: { ribbon: true, leftPanel: true, rightPanel: true, commands: [cmd('plugin.outline.open', '打开大纲')] }
  }),
  publish: base({
    id: 'publish',
    name: '发布',
    description: '一键把当前文档发布为公开/加密 HTML 页面并管理链接',
    category: 'publish',
    icon: 'globe',
    permissions: ['files:read', 'publish:write'],
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.publish.open', '发布当前文档')] }
  }),
  backlinks: base({
    id: 'backlinks',
    name: '反向链接',
    description: '全库扫描引用当前文档的笔记并展示上下文片段',
    category: 'core',
    icon: 'link',
    contributes: { ribbon: false, leftPanel: false, rightPanel: true, commands: [cmd('plugin.backlinks.open', '查看反向链接')] }
  }),
  workspace: base({
    id: 'workspace',
    name: '工作区',
    description: '保存/恢复布局快照：标签页、侧栏、视图模式、分屏',
    category: 'productivity',
    icon: 'layers',
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.workspace.save', '保存当前工作区'), cmd('plugin.workspace.open', '打开工作区')] }
  }),
  graph: base({
    id: 'graph',
    name: '关系图谱',
    description: '自研力导向图：节点=笔记，边=[[链接]]，支持全库/局部、拖拽、缩放',
    category: 'visualization',
    icon: 'graph',
    permissions: ['files:read'],
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.graph.open', '打开关系图谱', 'Mod+G')] }
  }),
  slides: base({
    id: 'slides',
    name: '幻灯片',
    description: '按 --- 分隔符把 Markdown 渲染成幻灯片，全屏放映，支持 ??? 备注',
    category: 'visualization',
    icon: 'slides',
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.slides.present', '开始放映'), cmd('plugin.slides.open', '幻灯片列表')] }
  }),
  'footnote-view': base({
    id: 'footnote-view',
    name: '脚注视图',
    description: '集中列出文档所有 [^id] 引用与定义，可直接编辑定义写回',
    category: 'core',
    icon: 'footnote',
    contributes: { ribbon: false, leftPanel: false, rightPanel: true, commands: [cmd('plugin.footnoteView.open', '查看脚注')] }
  }),
  'quick-switcher': base({
    id: 'quick-switcher',
    name: '快速切换',
    description: 'Ctrl+Shift+P 模糊搜索文件名/标题并跳转（自带弹窗，不依赖 shell）',
    category: 'productivity',
    icon: 'command',
    contributes: { ribbon: false, leftPanel: false, commands: [cmd('plugin.quickSwitcher.open', '快速切换文件', 'Mod+Shift+P')] }
  }),
  recorder: base({
    id: 'recorder',
    name: '录音机',
    description: 'MediaRecorder 录音上传并插入音频，一键 POST /api/ai/asr 转文字',
    category: 'media',
    icon: 'mic',
    permissions: ['files:read', 'files:write', 'storage:upload', 'ai:asr'],
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.recorder.open', '打开录音机')] }
  }),
  'random-note': base({
    id: 'random-note',
    name: '漫游笔记',
    description: '随机抽一篇库内笔记打开，附「回顾」卡片',
    category: 'core',
    icon: 'shuffle',
    permissions: ['files:read'],
    contributes: { ribbon: true, leftPanel: false, commands: [cmd('plugin.randomNote.open', '随机漫游一篇笔记')] }
  }),
  'daily-notes': base({
    id: 'daily-notes',
    name: '日记',
    description: '按日期创建/打开 日记/YYYY-MM-DD.md，月历视图与可编辑模板',
    category: 'productivity',
    icon: 'calendar',
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.dailyNotes.today', '打开今日日记', 'Mod+D'), cmd('plugin.dailyNotes.open', '日记视图')] }
  }),
  bookmarks: base({
    id: 'bookmarks',
    name: '书签',
    description: '收藏文件/文件夹/搜索词/标题段落，侧栏树展示一键直达',
    category: 'productivity',
    icon: 'bookmark',
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.bookmarks.add', '收藏当前位置'), cmd('plugin.bookmarks.open', '打开书签')] }
  }),
  properties: base({
    id: 'properties',
    name: '属性列表',
    description: 'YAML frontmatter 可视化编辑（text/number/date/checkbox/list）+ 全库统计',
    category: 'data',
    icon: 'sliders',
    contributes: { ribbon: true, leftPanel: true, rightPanel: true, commands: [cmd('plugin.properties.open', '编辑属性')] }
  }),
  database: base({
    id: 'database',
    name: '数据库',
    description: '类 Notion 表格/看板：按文件夹或标签聚合笔记，frontmatter 作列，拖拽改状态',
    category: 'data',
    icon: 'database',
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.database.open', '打开数据库视图')] }
  }),
  'web-browser': base({
    id: 'web-browser',
    name: '网页浏览器',
    description: '分屏内嵌浏览器 + 网页剪藏：URL/HTML 转 Markdown 存入仓库',
    category: 'media',
    icon: 'browser',
    permissions: ['files:read', 'files:write', 'net:fetch'],
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.webBrowser.open', '打开网页浏览器'), cmd('plugin.webBrowser.clip', '网页剪藏')] }
  }),
  'file-recovery': base({
    id: 'file-recovery',
    name: '文件恢复',
    description: '本地快照环形缓冲（30 次/文件）+ 回收站恢复被删文档',
    category: 'core',
    icon: 'history',
    permissions: ['files:read', 'files:write'],
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.fileRecovery.open', '文件恢复')] }
  }),
  'file-explorer': base({
    id: 'file-explorer',
    name: '文件列表',
    description: '增强文件树：多选、批量操作、扩展名过滤、折叠全部、多仓切换',
    category: 'core',
    icon: 'folder',
    permissions: ['files:read', 'files:write'],
    contributes: { ribbon: true, leftPanel: true, commands: [cmd('plugin.fileExplorer.open', '打开文件列表')] }
  }),
  'slash-commands': base({
    id: 'slash-commands',
    name: '斜杠命令',
    description: '输入 / 弹出快捷插入菜单（标题/表格/代码/公式/待办/AI/日期/模板）',
    category: 'productivity',
    icon: 'command',
    contributes: { ribbon: false, leftPanel: false, commands: [cmd('plugin.slashCommands.open', '插入斜杠命令')] }
  }),
  'page-preview': base({
    id: 'page-preview',
    name: '页面预览',
    description: '悬停 [[链接]] 弹出目标笔记前 20 行预览窗（自监听 DOM + Portal）',
    category: 'core',
    icon: 'eye',
    permissions: ['files:read'],
    contributes: { ribbon: false, leftPanel: false, commands: [cmd('plugin.pagePreview.toggle', '开关悬停预览')] }
  }),
  'word-count': base({
    id: 'word-count',
    name: '字数统计',
    description: '实时字数/字符/行/段落/预计阅读时长，状态栏与详情弹窗',
    category: 'core',
    icon: 'chart',
    contributes: { ribbon: false, leftPanel: false, statusItem: true, commands: [cmd('plugin.wordCount.details', '字数统计详情')] }
  }),
  ai: base({
    id: 'ai',
    name: 'AI 助手',
    description: '右侧 AI 对话面板 + 正文内联润色：续写/润色/扩写/缩写/翻译/总结/排版/标题/朗读',
    category: 'ai',
    icon: 'sparkles',
    permissions: ['files:read', 'files:write', 'ai:chat', 'ai:tts', 'ai:asr'],
    contributes: {
      ribbon: true,
      leftPanel: false,
      rightPanel: true,
      commands: [
        cmd('plugin.ai.chat', 'AI 对话', 'Mod+Shift+I'),
        cmd('plugin.ai.continue', 'AI 续写'),
        cmd('plugin.ai.polish', 'AI 润色', 'Mod+Shift+U'),
        cmd('plugin.ai.expand', 'AI 扩写'),
        cmd('plugin.ai.shorten', 'AI 缩写'),
        cmd('plugin.ai.translate', 'AI 翻译'),
        cmd('plugin.ai.summary', 'AI 总结', 'Mod+Shift+M'),
        cmd('plugin.ai.format', 'AI 排版'),
        cmd('plugin.ai.title', 'AI 生成标题'),
        cmd('plugin.ai.tts', 'AI 朗读')
      ]
    }
  })
} as const satisfies Record<string, PluginManifest>

/** All 25 built-in manifests, in ribbon order. */
export const pluginManifests: PluginManifest[] = Object.values(M)

export const manifestOf = (id: string): PluginManifest | undefined =>
  (M as Record<string, PluginManifest>)[id]

export const builtinIds = pluginManifests.map((m) => m.id)
