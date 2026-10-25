/**
 * Shell command registration. Every editor action is registered here so the
 * command palette, ribbon, menus and the shortcut engine share one registry.
 */
import { useStore } from '@/store'
import { registerCommands } from '@/lib/commands'
import { eventToShortcut, isBrowserReserved, shortcutLabel, normalizeShortcut } from '@/lib/commands'
import { DEFAULT_SETTINGS } from '@/lib/contracts'
import { isDesktop } from '@/lib/platform'
import { currentVault, fileService, reloadFileTree } from '@/features/files/fileService'
import { openFile, saveActiveTab, saveAllDirty } from '@/features/editor/docRepo'
import {
  bold,
  codeBlock,
  divider,
  footnote,
  formula,
  heading,
  highlight,
  inlineCode,
  insertImage,
  insertLink,
  italic,
  orderedList,
  quote,
  strike,
  table,
  todoList,
  unorderedList
} from '@/features/editor/mdActions'
import { runAiAction } from '@/features/editor/aiActions'
import { exportCurrentDoc } from '@/features/editor/exportDoc'
import { closeTabSafely } from '@/features/editor/tabMenu'

const st = () => useStore.getState()

/* ------------------------------------------------------------------ files */
export async function cmdNewFile() {
  try {
    const res = await fileService.create(currentVault())
    await reloadFileTree(true)
    openFile(res.path, { preview: false })
    st().toast({ kind: 'ok', text: '已新建文档' })
  } catch (e) {
    // local fallback so the action never dead-ends
    const { localRepo } = await import('@/features/files/localRepo')
    const res = await localRepo.create('', '未命名')
    st().setActiveVault('local-web')
    await reloadFileTree(true)
    openFile(res.path, { preview: false })
    st().toast({ kind: 'info', text: '云端不可用，已在本地仓库新建' })
    void e
  }
}

export async function cmdSave() {
  const ok = await saveActiveTab(true)
  if (ok) st().toast({ kind: 'ok', text: '已保存' })
}

export async function cmdExport(format: 'docx' | 'pdf' | 'html' | 'md' = 'html') {
  await exportCurrentDoc(format)
}

export function cycleView() {
  const order = ['wysiwyg', 'source', 'split', 'preview'] as const
  const cur = st().viewMode
  st().setViewMode(order[(order.indexOf(cur) + 1) % order.length])
}

function cyclePageWidth() {
  const order = ['standard', 'wide', 'full'] as const
  st().setPageWidth(order[(order.indexOf(st().pageWidth) + 1) % order.length])
}

function nextTab(dir: 1 | -1) {
  const s = st()
  if (!s.tabs.length) return
  const idx = s.tabs.findIndex((t) => t.id === s.activeTabId)
  const next = s.tabs[(idx + dir + s.tabs.length) % s.tabs.length]
  if (next) s.setActiveTab(next.id)
}

export function openFind(replace: boolean) {
  const s = st()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  if (!tab) return s.toast({ kind: 'warn', text: '请先打开一篇文档' })
  window.dispatchEvent(new CustomEvent('neom:open-find', { detail: { path: tab.path, replace } }))
}

/* ------------------------------------------------------------- registration */
let installed = false

export function registerShellCommands() {
  if (installed) return
  installed = true

  const shortcuts = st().settings.shortcuts || DEFAULT_SETTINGS.shortcuts
  const sc = (id: string) => shortcuts[id] || DEFAULT_SETTINGS.shortcuts[id]

  registerCommands([
    /* ---------------- file */
    {
      id: 'file.new',
      title: '新建文档',
      subtitle: '创建一篇新的 Markdown 文档',
      category: '文件',
      icon: 'file-plus',
      shortcut: sc('file.new'),
      keywords: 'new create 新建',
      run: cmdNewFile
    },
    {
      id: 'file.open',
      title: '打开文件',
      subtitle: '从文件树中打开文档',
      category: '文件',
      icon: 'folder-open',
      shortcut: sc('file.open'),
      run: () => st().setPaletteOpen(true)
    },
    {
      id: 'file.save',
      title: '保存',
      subtitle: '立即保存当前文档',
      category: '文件',
      icon: 'save',
      shortcut: sc('file.save'),
      run: cmdSave
    },
    {
      id: 'file.saveAll',
      title: '保存全部',
      subtitle: '保存所有未保存的文档',
      category: '文件',
      icon: 'save',
      run: async () => {
        await saveAllDirty(false)
        st().toast({ kind: 'ok', text: '已保存全部文档' })
      }
    },
    {
      id: 'file.export',
      title: '导出当前文档',
      subtitle: '导出为 Word / PDF / HTML / Markdown',
      category: '文件',
      icon: 'download',
      shortcut: sc('file.export'),
      run: () => void cmdExport('html')
    },
    {
      id: 'file.exportDocx',
      title: '导出为 Word',
      category: '文件',
      icon: 'download',
      run: () => void cmdExport('docx')
    },
    {
      id: 'file.exportPdf',
      title: '导出为 PDF',
      category: '文件',
      icon: 'download',
      run: () => void cmdExport('pdf')
    },
    {
      id: 'file.exportHtml',
      title: '导出为 HTML',
      category: '文件',
      icon: 'download',
      run: () => void cmdExport('html')
    },
    {
      id: 'file.exportMd',
      title: '导出为 Markdown',
      category: '文件',
      icon: 'download',
      run: () => void cmdExport('md')
    },
    {
      id: 'file.sync',
      title: '同步仓库',
      subtitle: '与云端双向同步',
      category: '文件',
      icon: 'sync',
      run: async () => {
        try {
          const r = await fileService.sync(currentVault())
          await reloadFileTree(true)
          st().toast({ kind: 'ok', text: `同步完成：拉取 ${r?.pulled ?? 0}，推送 ${r?.pushed ?? 0}` })
        } catch {
          st().toast({ kind: 'warn', text: '当前离线，无法同步' })
        }
      }
    },
    {
      id: 'file.reveal',
      title: '打开文件所在文件夹',
      category: '文件',
      icon: 'folder-open',
      when: () => isDesktop,
      run: async () => {
        const { revealCurrentFile } = await import('@/features/files/pathActions')
        await revealCurrentFile()
      }
    },
    {
      id: 'file.copyPath',
      title: '复制文件路径',
      category: '文件',
      icon: 'copy',
      run: async () => {
        const { copyCurrentPath } = await import('@/features/files/pathActions')
        await copyCurrentPath()
      }
    },

    /* ---------------- tabs */
    {
      id: 'tab.close',
      title: '关闭当前标签',
      category: '标签页',
      icon: 'x',
      shortcut: sc('tab.close'),
      run: () => {
        const s = st()
        if (s.activeTabId) closeTabSafely(s.activeTabId)
      }
    },
    {
      id: 'tab.closeOthers',
      title: '关闭其他标签',
      category: '标签页',
      icon: 'x',
      shortcut: sc('tab.closeOthers'),
      run: () => {
        const s = st()
        if (s.activeTabId) s.closeOtherTabs(s.activeTabId)
      }
    },
    { id: 'tab.next', title: '下一个标签', category: '标签页', icon: 'chevron-right', shortcut: sc('tab.next'), run: () => nextTab(1) },
    { id: 'tab.prev', title: '上一个标签', category: '标签页', icon: 'chevron-left', shortcut: sc('tab.prev'), run: () => nextTab(-1) },

    /* ---------------- app */
    {
      id: 'app.commandPalette',
      title: '命令面板',
      subtitle: '搜索并执行任意命令',
      category: '应用',
      icon: 'command',
      shortcut: sc('app.commandPalette'),
      run: () => st().setPaletteOpen(!st().paletteOpen)
    },
    {
      id: 'app.search',
      title: '全文搜索',
      subtitle: '在左侧栏搜索文件名与正文',
      category: '应用',
      icon: 'search',
      shortcut: sc('app.search'),
      run: () => {
        st().toggleLeft(true)
        st().setLeftPanel('search')
      }
    },
    {
      id: 'app.settings',
      title: '编辑器设置',
      category: '应用',
      icon: 'settings',
      shortcut: sc('app.settings'),
      run: async () => (await import('@/shell/SettingsDialog')).openSettings()
    },
    {
      id: 'app.toggleLeft',
      title: '切换左侧边栏',
      category: '应用',
      icon: 'sidebar',
      shortcut: sc('app.toggleLeft'),
      run: () => st().toggleLeft()
    },
    {
      id: 'app.toggleRight',
      title: '切换 AI 侧栏',
      category: '应用',
      icon: 'sparkles',
      shortcut: sc('app.toggleRight'),
      run: () => st().toggleRight()
    },
    {
      id: 'app.toggleRibbon',
      title: '切换功能区',
      category: '应用',
      icon: 'sliders',
      shortcut: sc('app.toggleRibbon'),
      run: () => st().toggleRibbon()
    },
    {
      id: 'app.toggleToolbar',
      title: '切换格式工具栏',
      category: '应用',
      icon: 'sliders',
      run: () => st().updateSettings({ showToolbar: !st().settings.showToolbar })
    },
    {
      id: 'app.history',
      title: '查看历史版本',
      category: '应用',
      icon: 'history',
      run: () => {
        st().toggleLeft(true)
        st().setLeftPanel('history')
      }
    },
    {
      id: 'app.outline',
      title: '显示大纲',
      category: '应用',
      icon: 'list',
      run: () => {
        st().toggleLeft(true)
        st().setLeftPanel('outline')
      }
    },

    /* ---------------- view */
    { id: 'view.toggle', title: '切换视图模式', category: '视图', icon: 'eye', shortcut: sc('view.toggle'), run: cycleView },
    { id: 'view.wysiwyg', title: '所见即所得', category: '视图', icon: 'edit', shortcut: sc('view.wysiwyg'), run: () => st().setViewMode('wysiwyg') },
    { id: 'view.source', title: '源码模式', category: '视图', icon: 'code', shortcut: sc('view.source'), run: () => st().setViewMode('source') },
    { id: 'view.split', title: '对照模式', category: '视图', icon: 'columns', run: () => st().setViewMode('split') },
    { id: 'view.preview', title: '阅读视图', category: '视图', icon: 'eye', shortcut: sc('view.preview'), run: () => st().setViewMode('preview') },
    { id: 'view.pageWidth', title: '切换页宽', category: '视图', icon: 'maximize', run: cyclePageWidth },
    { id: 'view.widthStandard', title: '页宽：标准', category: '视图', icon: 'maximize', run: () => st().setPageWidth('standard') },
    { id: 'view.widthWide', title: '页宽：宽', category: '视图', icon: 'maximize', run: () => st().setPageWidth('wide') },
    { id: 'view.widthFull', title: '页宽：铺满', category: '视图', icon: 'maximize', run: () => st().setPageWidth('full') },
    { id: 'view.splitVertical', title: '左右分屏', category: '视图', icon: 'columns', run: () => st().setSplitMode('vertical') },
    { id: 'view.splitHorizontal', title: '上下分屏', category: '视图', icon: 'rows', run: () => st().setSplitMode('horizontal') },
    { id: 'view.splitNone', title: '取消分屏', category: '视图', icon: 'maximize', run: () => st().setSplitMode('none') },

    /* ---------------- edit */
    { id: 'edit.find', title: '查找', category: '编辑', icon: 'search', shortcut: sc('edit.find'), run: () => openFind(false) },
    { id: 'edit.replace', title: '替换', category: '编辑', icon: 'edit', shortcut: sc('edit.replace'), run: () => openFind(true) },
    { id: 'edit.selectAll', title: '全选', category: '编辑', icon: 'check', run: () => document.execCommand('selectAll') },
    { id: 'edit.copyPath', title: '复制当前文档路径', category: '编辑', icon: 'copy', run: async () => {
      const s = st()
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      if (!tab) return
      await navigator.clipboard?.writeText(tab.path)
      s.toast({ kind: 'ok', text: '路径已复制' })
    } },

    /* ---------------- formatting */
    { id: 'edit.bold', title: '加粗', category: '格式', icon: 'bold', shortcut: sc('edit.bold'), run: bold },
    { id: 'edit.italic', title: '斜体', category: '格式', icon: 'italic', shortcut: sc('edit.italic'), run: italic },
    { id: 'edit.strike', title: '删除线', category: '格式', icon: 'strike', shortcut: sc('edit.strike'), run: strike },
    { id: 'edit.inlineCode', title: '行内代码', category: '格式', icon: 'code', shortcut: sc('edit.inlineCode'), run: inlineCode },
    { id: 'edit.codeBlock', title: '代码块', category: '格式', icon: 'code-block', run: codeBlock },
    { id: 'edit.highlight', title: '高亮', category: '格式', icon: 'highlight', shortcut: sc('edit.highlight'), run: highlight },
    { id: 'edit.link', title: '插入链接', category: '格式', icon: 'link', shortcut: sc('edit.link'), run: () => void insertLink() },
    { id: 'edit.image', title: '插入图片', category: '格式', icon: 'image', run: () => void insertImage() },
    { id: 'edit.table', title: '插入表格', category: '格式', icon: 'table', run: table },
    { id: 'edit.formula', title: '插入公式', category: '格式', icon: 'formula', run: formula },
    { id: 'edit.divider', title: '插入分割线', category: '格式', icon: 'hr', run: divider },
    { id: 'edit.footnote', title: '插入脚注', category: '格式', icon: 'footnote', run: footnote },
    { id: 'edit.quote', title: '引用', category: '格式', icon: 'quote', run: quote },
    { id: 'list.todo', title: '待办列表', category: '格式', icon: 'list-todo', shortcut: sc('list.todo'), run: todoList },
    { id: 'list.ul', title: '无序列表', category: '格式', icon: 'list', shortcut: sc('list.ul'), run: unorderedList },
    { id: 'list.ol', title: '有序列表', category: '格式', icon: 'list-ordered', shortcut: sc('list.ol'), run: orderedList },
    { id: 'para.normal', title: '正文段落', category: '格式', icon: 'file-text', shortcut: sc('para.normal'), run: () => heading(0) },
    ...[1, 2, 3, 4, 5, 6].map((lv) => ({
      id: 'h' + lv,
      title: `H${lv} 标题`,
      subtitle: `${lv} 级标题`,
      category: '格式',
      icon: 'headings',
      shortcut: sc('h' + lv),
      run: () => heading(lv)
    })),

    /* ---------------- AI */
    { id: 'ai.assistant', title: 'AI 助手', category: 'AI', icon: 'sparkles', shortcut: sc('ai.assistant'), run: () => {
      st().toggleRight(true)
      st().setRightPanel('ai')
    } },
    { id: 'ai.continue', title: 'AI 续写', category: 'AI', icon: 'sparkles', run: () => void runAiAction('continue') },
    { id: 'ai.polish', title: 'AI 润色', category: 'AI', icon: 'edit', shortcut: sc('ai.polish'), run: () => void runAiAction('polish') },
    { id: 'ai.format', title: 'AI 排版', category: 'AI', icon: 'list', run: () => void runAiAction('format') },
    { id: 'ai.summary', title: 'AI 总结', category: 'AI', icon: 'file-text', shortcut: sc('ai.summary'), run: () => void runAiAction('summary') },
    { id: 'ai.translate', title: 'AI 翻译', category: 'AI', icon: 'globe', run: () => void runAiAction('translate') },
    { id: 'ai.read', title: '朗读选中内容', category: 'AI', icon: 'volume', run: async () => {
      const { readSelectionAloud } = await import('@/features/editor/aiActions')
      await readSelectionAloud()
    } }
  ])
}

/**
 * Browser-reserved shortcut guard.
 *
 * `lib/commands` refuses to run any command whose chord the browser owns. In a
 * web build that would silently break Ctrl+S / Ctrl+P / Ctrl+F, which *are*
 * interceptable via preventDefault. So: chords we can legally take over are
 * re-dispatched here, and only genuinely un-interceptable ones (Ctrl+T, Ctrl+N,
 * Ctrl+W, Ctrl+Tab …) surface the "download the desktop client" hint.
 */
const INTERCEPTABLE_IN_WEB = new Set([
  'Control+S',
  'Control+Shift+S',
  'Control+P',
  'Control+Shift+P',
  'Control+F',
  'Control+Shift+F',
  'Control+H',
  'Control+O',
  'Control+Shift+E'
])

export function installBrowserReservedHint() {
  const onKey = (e: KeyboardEvent) => {
    const combo = eventToShortcut(e)
    if (!combo) return
    const map = st().settings.shortcuts || DEFAULT_SETTINGS.shortcuts
    const entry = Object.entries(map).find(([, v]) => normalizeShortcut(v) === combo)
    if (!entry) return
    const [cmdId, chord] = entry
    if (!isBrowserReserved(chord)) return

    if (INTERCEPTABLE_IN_WEB.has(combo)) {
      // take the chord back from the browser and run the command ourselves
      e.preventDefault()
      e.stopPropagation()
      void (async () => {
        const { runCommand } = await import('@/lib/commands')
        await runCommand(cmdId)
      })()
      return
    }

    st().toast({
      kind: 'warn',
      text: `快捷键 ${shortcutLabel(chord)} 被浏览器占用，建议下载桌面客户端`,
      timeout: 4200
    })
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}

/** Dirty-document guard before the window unloads. */
export function installUnloadGuard() {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    const dirty = st().tabs.some((t) => t.dirty)
    if (!dirty) return
    void saveAllDirty(false)
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => window.removeEventListener('beforeunload', onBeforeUnload)
}

export const shortcutHints = () => {
  const map = st().settings.shortcuts || DEFAULT_SETTINGS.shortcuts
  return Object.entries(map).map(([id, key]) => ({ id, key, label: shortcutLabel(key) }))
}
