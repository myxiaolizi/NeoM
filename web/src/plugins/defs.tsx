/**
 * Static plugin definitions: manifest + contribution points + commands.
 * Panels are referenced by key into the lazy registry (`panels.ts`).
 */
import type { PluginContext } from './types'
import type { PluginManifest } from '@/lib/contracts'
import { M } from './manifests'
import { openPluginWindow, togglePluginWindow } from './fullscreen'

export interface CmdSpec {
  id: string
  title: string
  icon?: string
  shortcut?: string
  category?: string
  subtitle?: string
  keywords?: string
  run: (ctx: PluginContext) => void | Promise<void>
}

export interface PluginDef {
  manifest: PluginManifest
  /** key into PANELS */
  panel?: string
  rightPanel?: string
  /** status bar contribution (word-count) */
  statusItem?: boolean
  ribbonIcon?: string
  /** panels that want the edge-to-edge host (canvas / graph / slides / browser) */
  fullScreen?: boolean
  commands?: CmdSpec[]
  onActivate?: (ctx: PluginContext) => void
  onDeactivate?: () => void
}

const open = (key: string, full = false) => (ctx: PluginContext) => openPluginWindow(key, ctx, { full })
const toggle = (key: string, full = false) => (ctx: PluginContext) => togglePluginWindow(key, ctx, { full })

const lazyCall = (loader: () => Promise<any>, fn: string) => async (ctx: PluginContext) => {
  try {
    const mod = await loader()
    await mod?.[fn]?.(ctx)
  } catch (e: any) {
    ctx.toast(e?.message || '插件操作失败', 'error')
  }
}

export const PLUGIN_DEFS: PluginDef[] = [
  /* 1 ───────────────────────────────────────────────────────── ca n v a s */
  {
    manifest: M.canvas,
    panel: 'canvas',
    fullScreen: true,
    ribbonIcon: 'canvas',
    commands: [
      { id: 'plugin.canvas.open', title: '打开白板', icon: 'canvas', shortcut: 'Mod+Shift+O', run: open('canvas', true) },
      { id: 'plugin.canvas.new', title: '新建白板（空白）', icon: 'plus', run: lazyCall(() => import('./items/canvas'), 'newBoard') },
      { id: 'plugin.canvas.save', title: '保存白板到仓库', icon: 'save', run: lazyCall(() => import('./items/canvas'), 'saveBoard') }
    ]
  },
  /* 2 ─────────────────────────────────────────────── note-restructure */
  {
    manifest: M['note-restructure'],
    panel: 'note-restructure',
    ribbonIcon: 'scissors',
    commands: [{ id: 'plugin.noteRestructure.open', title: '笔记重组（拆分/合并/重排）', icon: 'scissors', run: open('note-restructure') }]
  },
  /* 3 ──────────────────────────────────────────────────── tag-list */
  {
    manifest: M['tag-list'],
    panel: 'tag-list',
    ribbonIcon: 'tag',
    commands: [{ id: 'plugin.tagList.open', title: '标签列表', icon: 'tag', run: open('tag-list') }]
  },
  /* 4 ────────────────────────────────────────────── outgoing-links */
  {
    manifest: M['outgoing-links'],
    panel: 'outgoing-links',
    rightPanel: 'outgoing-links',
    commands: [{ id: 'plugin.outgoingLinks.open', title: '查看当前文档出链', icon: 'external', run: open('outgoing-links') }]
  },
  /* 5 ───────────────────────────────────────────────────── outline */
  {
    manifest: M.outline,
    panel: 'outline',
    rightPanel: 'outline',
    ribbonIcon: 'headings',
    commands: [{ id: 'plugin.outline.open', title: '大纲', icon: 'headings', run: open('outline') }]
  },
  /* 6 ───────────────────────────────────────────────────── publish */
  {
    manifest: M.publish,
    panel: 'publish',
    ribbonIcon: 'globe',
    commands: [{ id: 'plugin.publish.open', title: '发布当前文档为网页', icon: 'globe', run: open('publish') }]
  },
  /* 7 ─────────────────────────────────────────────────── backlinks */
  {
    manifest: M.backlinks,
    panel: 'backlinks',
    rightPanel: 'backlinks',
    commands: [{ id: 'plugin.backlinks.open', title: '反向链接', icon: 'link', run: open('backlinks') }]
  },
  /* 8 ─────────────────────────────────────────────────── workspace */
  {
    manifest: M.workspace,
    panel: 'workspace',
    ribbonIcon: 'layers',
    commands: [
      { id: 'plugin.workspace.save', title: '保存当前工作区快照', icon: 'save', run: lazyCall(() => import('./items/workspace'), 'saveQuick') },
      { id: 'plugin.workspace.open', title: '工作区管理', icon: 'layers', run: open('workspace') }
    ]
  },
  /* 9 ─────────────────────────────────────────────────────── graph */
  {
    manifest: M.graph,
    panel: 'graph',
    fullScreen: true,
    ribbonIcon: 'graph',
    commands: [
      { id: 'plugin.graph.open', title: '关系图谱（全库）', icon: 'graph', shortcut: 'Mod+G', run: open('graph', true) },
      { id: 'plugin.graph.local', title: '关系图谱（当前笔记 2 跳）', icon: 'graph', run: lazyCall(() => import('./items/graph'), 'openLocalGraph') }
    ]
  },
  /* 10 ────────────────────────────────────────────────────── slides */
  {
    manifest: M.slides,
    panel: 'slides',
    fullScreen: true,
    ribbonIcon: 'slides',
    commands: [
      { id: 'plugin.slides.present', title: '开始放映（--- 分页）', icon: 'play', run: lazyCall(() => import('./items/slides'), 'presentCurrent') },
      { id: 'plugin.slides.open', title: '幻灯片面板', icon: 'slides', run: open('slides') }
    ]
  },
  /* 11 ────────────────────────────────────────────── footnote-view */
  {
    manifest: M['footnote-view'],
    panel: 'footnote-view',
    rightPanel: 'footnote-view',
    commands: [{ id: 'plugin.footnoteView.open', title: '脚注视图', icon: 'footnote', run: open('footnote-view') }]
  },
  /* 12 ────────────────────────────────────────────── quick-switcher */
  {
    manifest: M['quick-switcher'],
    commands: [
      { id: 'plugin.quickSwitcher.open', title: '快速切换文件', icon: 'command', shortcut: 'Mod+Shift+P', keywords: 'switch palette jump', run: lazyCall(() => import('./items/quick-switcher'), 'openSwitcher') }
    ]
  },
  /* 13 ──────────────────────────────────────────────────── recorder */
  {
    manifest: M.recorder,
    panel: 'recorder',
    ribbonIcon: 'mic',
    commands: [{ id: 'plugin.recorder.open', title: '录音机 / 语音转文字', icon: 'mic', run: open('recorder') }]
  },
  /* 14 ───────────────────────────────────────────────── random-note */
  {
    manifest: M['random-note'],
    ribbonIcon: 'shuffle',
    commands: [
      { id: 'plugin.randomNote.open', title: '漫游：随机打开一篇笔记', icon: 'shuffle', run: lazyCall(() => import('./items/random-note'), 'openRandom') }
    ]
  },
  /* 15 ───────────────────────────────────────────────── daily-notes */
  {
    manifest: M['daily-notes'],
    panel: 'daily-notes',
    ribbonIcon: 'calendar',
    commands: [
      { id: 'plugin.dailyNotes.today', title: '打开今日日记', icon: 'calendar', shortcut: 'Mod+D', run: lazyCall(() => import('./items/daily-notes'), 'openToday') },
      { id: 'plugin.dailyNotes.open', title: '日记日历', icon: 'calendar', run: open('daily-notes') }
    ]
  },
  /* 16 ─────────────────────────────────────────────────── bookmarks */
  {
    manifest: M.bookmarks,
    panel: 'bookmarks',
    ribbonIcon: 'bookmark',
    commands: [
      { id: 'plugin.bookmarks.add', title: '收藏当前位置', icon: 'bookmark', run: lazyCall(() => import('./items/bookmarks'), 'addCurrent') },
      { id: 'plugin.bookmarks.open', title: '书签列表', icon: 'bookmark', run: open('bookmarks') }
    ]
  },
  /* 17 ────────────────────────────────────────────────── properties */
  {
    manifest: M.properties,
    panel: 'properties',
    rightPanel: 'properties',
    ribbonIcon: 'sliders',
    commands: [
      { id: 'plugin.properties.open', title: '属性列表 / frontmatter 编辑', icon: 'sliders', run: open('properties') },
      { id: 'plugin.properties.stats', title: '全库属性统计', icon: 'chart', run: lazyCall(() => import('./items/properties'), 'openStats') }
    ]
  },
  /* 18 ──────────────────────────────────────────────────── database */
  {
    manifest: M.database,
    panel: 'database',
    ribbonIcon: 'database',
    commands: [{ id: 'plugin.database.open', title: '数据库视图（表格/看板）', icon: 'database', run: open('database') }]
  },
  /* 19 ───────────────────────────────────────────────── web-browser */
  {
    manifest: M['web-browser'],
    panel: 'web-browser',
    fullScreen: true,
    ribbonIcon: 'browser',
    commands: [
      { id: 'plugin.webBrowser.open', title: '网页浏览器', icon: 'browser', run: open('web-browser', true) },
      { id: 'plugin.webBrowser.clip', title: '网页剪藏（URL → Markdown）', icon: 'scissors', run: lazyCall(() => import('./items/web-browser'), 'openClipper') }
    ]
  },
  /* 20 ─────────────────────────────────────────────── file-recovery */
  {
    manifest: M['file-recovery'],
    panel: 'file-recovery',
    ribbonIcon: 'history',
    commands: [
      { id: 'plugin.fileRecovery.open', title: '文件恢复 / 回收站', icon: 'history', run: open('file-recovery') },
      { id: 'plugin.fileRecovery.snapshot', title: '立即为当前文档创建本地快照', icon: 'camera', run: lazyCall(() => import('./items/file-recovery'), 'snapshotCurrent') }
    ],
    onActivate: (ctx) => { import('./items/file-recovery').then((m) => m.installAutoSnapshot(ctx)).catch(() => {}) },
    onDeactivate: () => { import('./items/file-recovery').then((m) => m.uninstallAutoSnapshot()).catch(() => {}) }
  },
  /* 21 ─────────────────────────────────────────────── file-explorer */
  {
    manifest: M['file-explorer'],
    panel: 'file-explorer',
    ribbonIcon: 'folder',
    commands: [{ id: 'plugin.fileExplorer.open', title: '文件列表（增强）', icon: 'folder', run: open('file-explorer') }]
  },
  /* 22 ─────────────────────────────────────────────── slash-commands */
  {
    manifest: M['slash-commands'],
    commands: [
      { id: 'plugin.slashCommands.open', title: '插入斜杠命令', icon: 'command', run: lazyCall(() => import('./items/slash-commands'), 'openSlashMenu') }
    ],
    onActivate: (ctx) => { import('./items/slash-commands').then((m) => m.installSlashWatcher(ctx)).catch(() => {}) },
    onDeactivate: () => { import('./items/slash-commands').then((m) => m.uninstallSlashWatcher()).catch(() => {}) }
  },
  /* 23 ───────────────────────────────────────────────── page-preview */
  {
    manifest: M['page-preview'],
    commands: [
      { id: 'plugin.pagePreview.toggle', title: '开关 Wiki 链接悬停预览', icon: 'eye', run: lazyCall(() => import('./items/page-preview'), 'togglePreview') }
    ],
    onActivate: (ctx) => { import('./items/page-preview').then((m) => m.installPreview(ctx)).catch(() => {}) },
    onDeactivate: () => { import('./items/page-preview').then((m) => m.uninstallPreview()).catch(() => {}) }
  },
  /* 24 ────────────────────────────────────────────────── word-count */
  {
    manifest: M['word-count'],
    panel: 'word-count',
    statusItem: true,
    commands: [{ id: 'plugin.wordCount.details', title: '字数统计详情', icon: 'chart', run: open('word-count') }]
  },
  /* 25 ────────────────────────────────────────────────────────── ai */
  {
    manifest: M.ai,
    panel: 'ai',
    rightPanel: 'ai',
    ribbonIcon: 'sparkles',
    commands: [
      { id: 'plugin.ai.chat', title: 'AI 对话助手', icon: 'sparkles', shortcut: 'Mod+Shift+I', run: lazyCall(() => import('./items/ai'), 'openAiChat') },
      { id: 'plugin.ai.continue', title: 'AI 续写', icon: 'ai', run: lazyCall(() => import('./items/ai'), 'polishContinue') },
      { id: 'plugin.ai.polish', title: 'AI 润色选中内容', icon: 'sparkles', shortcut: 'Mod+Shift+U', run: lazyCall(() => import('./items/ai'), 'polishSelection') },
      { id: 'plugin.ai.expand', title: 'AI 扩写', icon: 'ai', run: lazyCall(() => import('./items/ai'), 'polishExpand') },
      { id: 'plugin.ai.shorten', title: 'AI 缩写', icon: 'ai', run: lazyCall(() => import('./items/ai'), 'polishShorten') },
      { id: 'plugin.ai.translate', title: 'AI 翻译', icon: 'ai', run: lazyCall(() => import('./items/ai'), 'polishTranslate') },
      { id: 'plugin.ai.summary', title: 'AI 总结文档', icon: 'ai', shortcut: 'Mod+Shift+M', run: lazyCall(() => import('./items/ai'), 'polishSummary') },
      { id: 'plugin.ai.format', title: 'AI 排版整理', icon: 'ai', run: lazyCall(() => import('./items/ai'), 'polishFormat') },
      { id: 'plugin.ai.title', title: 'AI 生成标题', icon: 'ai', run: lazyCall(() => import('./items/ai'), 'polishTitle') },
      { id: 'plugin.ai.tts', title: 'AI 朗读选中内容', icon: 'volume', run: lazyCall(() => import('./items/ai'), 'speakSelection') }
    ]
  }
]

export const defOf = (id: string) => PLUGIN_DEFS.find((d) => d.manifest.id === id)
