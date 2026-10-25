/**
 * NeoM global store (zustand). Single source of runtime UI state.
 * All shell features import from '@/store' — do not create parallel stores.
 */
import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type FileNode,
  type InstalledPlugin,
  type LeftViewMode,
  type PageWidth,
  type PluginManifest,
  type RibbonPosition,
  type ViewMode,
  type User
} from './lib/contracts'

export interface Tab {
  id: string
  path: string          // vault-relative path, unique per tab
  name: string
  dirty: boolean
  viewMode: ViewMode
  scrollTop?: number
  cursor?: number
  pinned?: boolean
  preview?: boolean     // opened via single click (preview tab, replaced by next click)
  splitOf?: string | null
  group: 'main' | 'side'   // side = split pane
}

export type SplitMode = 'none' | 'horizontal' | 'vertical'

export interface Toast {
  id: string
  kind: 'info' | 'ok' | 'warn' | 'error'
  text: string
  action?: { label: string; run: () => void }
  timeout?: number
}

export interface ContextMenuItem {
  id: string
  label?: string
  icon?: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  submenu?: ContextMenuItem[]
  run?: () => void | Promise<void>
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
  title?: string
}

export interface ModalState {
  id: string
  props?: Record<string, unknown>
}

export interface WordStats {
  words: number
  chars: number
  charsNoSpace: number
  lines: number
  paragraphs: number
  readingMinutes: number
}

export interface ConflictInfo {
  path: string
  localContent: string
  remoteContent: string
  remoteMtime: string
  device: string
}

interface State {
  /* ---------- auth ---------- */
  user: User | null
  authReady: boolean
  setUser: (u: User | null) => void
  setAuthReady: (v: boolean) => void

  /* ---------- settings ---------- */
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void
  resetSettings: () => void

  /* ---------- vault / files ---------- */
  vaults: { id: string; name: string; path?: string; kind: 'local' | 'cloud' }[]
  activeVault: string
  setVaults: (v: State['vaults']) => void
  setActiveVault: (id: string) => void
  files: FileNode[]
  setFiles: (f: FileNode[]) => void
  patchFile: (path: string, patch: Partial<FileNode>) => void
  removeFile: (path: string) => void
  expanded: Record<string, boolean>
  toggleExpanded: (path: string) => void
  selectedPath: string | null
  setSelectedPath: (p: string | null) => void
  recent: string[]
  pushRecent: (path: string) => void

  /* ---------- tabs ---------- */
  tabs: Tab[]
  activeTabId: string | null
  splitMode: SplitMode
  splitTabId: string | null
  openTab: (path: string, opts?: { name?: string; viewMode?: ViewMode; preview?: boolean; group?: 'main' | 'side' }) => void
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeTabsToRight: (id: string) => void
  closeAllTabs: () => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, patch: Partial<Tab>) => void
  setSplitMode: (m: SplitMode) => void
  setSplitTab: (id: string | null) => void
  reorderTabs: (from: number, to: number) => void

  /* ---------- ui ---------- */
  leftVisible: boolean
  rightVisible: boolean
  ribbonVisible: boolean
  toggleLeft: (v?: boolean) => void
  toggleRight: (v?: boolean) => void
  toggleRibbon: (v?: boolean) => void
  leftView: LeftViewMode
  setLeftView: (v: LeftViewMode) => void
  rightPanel: string
  setRightPanel: (id: string) => void
  leftPanel: string | null       // active left panel: 'search' | 'history' | 'tags' | ...
  setLeftPanel: (id: string | null) => void
  pageWidth: PageWidth
  setPageWidth: (w: PageWidth) => void
  viewMode: ViewMode
  setViewMode: (v: ViewMode) => void
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
  mobileDrawer: 'left' | 'right' | null
  setMobileDrawer: (d: 'left' | 'right' | null) => void

  /* ---------- overlays ---------- */
  contextMenu: ContextMenuState | null
  openContextMenu: (s: ContextMenuState) => void
  closeContextMenu: () => void
  modal: ModalState | null
  openModal: (id: string, props?: Record<string, unknown>) => void
  closeModal: () => void
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
  quickSwitcherOpen: boolean
  setQuickSwitcherOpen: (v: boolean) => void
  searchQuery: string
  setSearchQuery: (q: string) => void

  /* ---------- toasts ---------- */
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'> | string) => void
  dismissToast: (id: string) => void

  /* ---------- stats ---------- */
  stats: WordStats
  setStats: (s: WordStats) => void

  /* ---------- plugins ---------- */
  plugins: InstalledPlugin[]
  pluginManifests: Record<string, PluginManifest>
  setPlugins: (p: InstalledPlugin[]) => void
  setPluginManifests: (m: Record<string, PluginManifest>) => void
  togglePlugin: (id: string) => Promise<void>
  isPluginEnabled: (id: string) => boolean

  /* ---------- conflict ---------- */
  conflict: ConflictInfo | null
  setConflict: (c: ConflictInfo | null) => void

  /* ---------- ai ---------- */
  aiOpen: boolean
  setAiOpen: (v: boolean) => void
  aiModel: string | null
  setAiModel: (m: string) => void
  aiPanelBusy: boolean
  setAiPanelBusy: (v: boolean) => void
}

const loadJSON = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...JSON.parse(raw) } as T
  } catch {
    return fallback
  }
}

const persistedSettings = loadJSON<AppSettings>('neom.settings', DEFAULT_SETTINGS)

export const useStore = create<State>((set, get) => ({
  /* auth */
  user: null,
  authReady: false,
  setUser: (u) => set({ user: u }),
  setAuthReady: (v) => set({ authReady: v }),

  /* settings */
  settings: persistedSettings,
  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    localStorage.setItem('neom.settings', JSON.stringify(next))
    set({ settings: next })
  },
  resetSettings: () => {
    localStorage.setItem('neom.settings', JSON.stringify(DEFAULT_SETTINGS))
    set({ settings: DEFAULT_SETTINGS })
  },

  /* vault */
  vaults: [{ id: 'cloud', name: '云端仓库', kind: 'cloud' }],
  activeVault: 'cloud',
  setVaults: (v) => set({ vaults: v }),
  setActiveVault: (id) => set({ activeVault: id }),
  files: [],
  setFiles: (f) => set({ files: f }),
  patchFile: (path, patch) =>
    set((s) => ({ files: s.files.map((f) => (f.path === path ? { ...f, ...patch } : f)) })),
  removeFile: (path) => set((s) => ({ files: s.files.filter((f) => f.path !== path && !f.path.startsWith(path + '/')) })),
  expanded: {},
  toggleExpanded: (path) => set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),
  selectedPath: null,
  setSelectedPath: (p) => set({ selectedPath: p }),
  recent: JSON.parse(localStorage.getItem('neom.recent') || '[]'),
  pushRecent: (path) => {
    const next = [path, ...get().recent.filter((p) => p !== path)].slice(0, 40)
    localStorage.setItem('neom.recent', JSON.stringify(next))
    set({ recent: next })
  },

  /* tabs */
  tabs: [],
  activeTabId: null,
  splitMode: 'none',
  splitTabId: null,
  openTab: (path, opts = {}) => {
    const s = get()
    const name = opts.name || path.split('/').pop() || path
    const existing = s.tabs.find((t) => t.path === path && (t.group === (opts.group || 'main')))
    if (existing && !opts.preview) {
      set({ activeTabId: existing.id })
      return
    }
    if (existing && opts.preview) {
      set({ activeTabId: existing.id })
      return
    }
    // replace preview tab when single-clicking files
    const previewIdx = s.tabs.findIndex((t) => t.preview && t.group === 'main')
    const tab: Tab = {
      id: `${path}#${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      path,
      name,
      dirty: false,
      viewMode: opts.viewMode || s.viewMode,
      group: opts.group || 'main',
      preview: !!opts.preview
    }
    let tabs = [...s.tabs]
    if (opts.preview && previewIdx >= 0) tabs[previewIdx] = tab
    else tabs.push(tab)
    set({ tabs, activeTabId: tab.id })
    s.pushRecent(path)
  },
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeTabId = s.activeTabId
      if (s.activeTabId === id) activeTabId = tabs[Math.max(0, idx - 1)]?.id ?? null
      const splitTabId = s.splitTabId === id ? null : s.splitTabId
      return { tabs, activeTabId, splitTabId }
    }),
  closeOtherTabs: (id) =>
    set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeTabId: id })),
  closeTabsToRight: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      return { tabs: s.tabs.slice(0, idx + 1), activeTabId: id }
    }),
  closeAllTabs: () => set({ tabs: [], activeTabId: null, splitMode: 'none', splitTabId: null }),
  setActiveTab: (id) => set({ activeTabId: id }),
  updateTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  setSplitMode: (m) => set({ splitMode: m }),
  setSplitTab: (id) => set({ splitTabId: id }),
  reorderTabs: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { tabs }
    }),

  /* ui */
  leftVisible: persistedSettings.leftSidebarVisible,
  rightVisible: persistedSettings.rightSidebarVisible,
  ribbonVisible: persistedSettings.ribbonVisible,
  toggleLeft: (v) => set((s) => ({ leftVisible: v ?? !s.leftVisible })),
  toggleRight: (v) => set((s) => ({ rightVisible: v ?? !s.rightVisible })),
  toggleRibbon: (v) => set((s) => ({ ribbonVisible: v ?? !s.ribbonVisible })),
  leftView: persistedSettings.leftViewMode,
  setLeftView: (v) => set({ leftView: v }),
  rightPanel: persistedSettings.rightItems?.[0] || 'ai',
  setRightPanel: (id) => set({ rightPanel: id }),
  leftPanel: null,
  setLeftPanel: (id) => set({ leftPanel: id }),
  pageWidth: persistedSettings.pageWidth,
  setPageWidth: (w) => {
    get().updateSettings({ pageWidth: w })
    set({ pageWidth: w })
  },
  viewMode: persistedSettings.viewMode,
  setViewMode: (v) => {
    get().updateSettings({ viewMode: v })
    set((s) => ({
      viewMode: v,
      tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, viewMode: v } : t))
    }))
  },
  theme: (document.documentElement.dataset.theme as 'light' | 'dark') || 'light',
  setTheme: (t) => set({ theme: t }),
  mobileDrawer: null,
  setMobileDrawer: (d) => set({ mobileDrawer: d }),

  /* overlays */
  contextMenu: null,
  openContextMenu: (c) => set({ contextMenu: c }),
  closeContextMenu: () => set({ contextMenu: null }),
  modal: null,
  openModal: (id, props) => set({ modal: { id, props } }),
  closeModal: () => set({ modal: null }),
  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  quickSwitcherOpen: false,
  setQuickSwitcherOpen: (v) => set({ quickSwitcherOpen: v }),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  /* toasts */
  toasts: [],
  toast: (t) => {
    const id = Math.random().toString(36).slice(2)
    const item: Toast = typeof t === 'string' ? { id, kind: 'info', text: t } : { id, ...t }
    set((s) => ({ toasts: [...s.toasts, item] }))
    const ms = item.timeout ?? 3200
    if (ms > 0) setTimeout(() => get().dismissToast(id), ms)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  /* stats */
  stats: { words: 0, chars: 0, charsNoSpace: 0, lines: 0, paragraphs: 0, readingMinutes: 0 },
  setStats: (s) => set({ stats: s }),

  /* plugins */
  plugins: [],
  pluginManifests: {},
  setPlugins: (p) => set({ plugins: p }),
  setPluginManifests: (m) => set({ pluginManifests: m }),
  togglePlugin: async (id) => {
    const cur = get().plugins.find((p) => p.id === id)
    if (!cur) return
    const enabled = !cur.enabled
    set((s) => ({ plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled } : p)) }))
    try {
      await fetch(`/api/plugins/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, enabled })
      })
    } catch { /* offline-first: local state stands */ }
    const m = get().pluginManifests[id]
    get().toast({ kind: 'ok', text: `${enabled ? '已启用' : '已停用'}插件「${m?.name || id}」` })
  },
  isPluginEnabled: (id) => !!get().plugins.find((p) => p.id === id)?.enabled,

  /* conflict */
  conflict: null,
  setConflict: (c) => set({ conflict: c }),

  /* ai */
  aiOpen: false,
  setAiOpen: (v) => set({ aiOpen: v }),
  aiModel: null,
  setAiModel: (m) => set({ aiModel: m }),
  aiPanelBusy: false,
  setAiPanelBusy: (v) => set({ aiPanelBusy: v })
}))

/* ---------- selectors / helpers ---------- */
export const useActiveTab = () => useStore((s) => s.tabs.find((t) => t.id === s.activeTabId) || null)
export const useIsDesktop = () => !!(window as any).neom?.isDesktop
export const useIsMobile = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || window.innerWidth < 768
