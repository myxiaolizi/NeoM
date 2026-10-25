/**
 * Plugin runtime core — registry, enable/disable, persisted settings,
 * server sync, and the sandboxed third-party plugin loader.
 *
 * The shell only needs `registerAllPlugins(hostApi)` from `./index`.
 */
import { registerCommands, unregisterCommands, type Command } from '@/lib/commands'
import { API, type InstalledPlugin, type PluginManifest } from '@/lib/contracts'
import { useStore } from '@/store'
import type {
  PluginContext,
  PluginHostApi,
  PluginRuntime,
  PluginSettingsApi,
  ToastKind
} from './types'
import { invalidateVault } from './vault'

const ENABLED_KEY = 'neom.plugins.enabled'
const SETTINGS_PREFIX = 'neom.plugin.'

/* ------------------------------------------------------------------ host */
let hostApi: PluginHostApi | null = null

export const setHostApi = (api: PluginHostApi) => { hostApi = api }
export const getHostApi = () => hostApi

const noop = () => {}

/** Safe fallback host so panels can render before the shell finishes booting. */
const fallbackHost = (): PluginHostApi => {
  const st = useStore.getState()
  return {
    openFile: (p) => st.openTab(p),
    createFile: async (name, content, dir) => {
      const path = [dir, name || `未命名-${Date.now()}.md`].filter(Boolean).join('/')
      try {
        await (hostApi || fallbackHost()).vault.write(path, content || '')
      } catch { /* best effort */ }
      return path
    },
    getActiveContent: () => '',
    insertText: noop,
    replaceSelection: noop,
    toast: (msg, kind) => st.toast({ kind: (kind || 'info') as ToastKind, text: msg }),
    vault: {
      list: async () => st.files,
      read: async (p: string) => ({ path: p, name: p.split('/').pop() || p, content: '', etag: '', mtime: '', version: 1 }),
      write: async (p: string, c: string) => ({ path: p, content: c })
    },
    api: {
      get: async () => null,
      post: async () => null,
      put: async () => null,
      del: async () => null
    },
    openModal: (id, props) => st.openModal(id, props),
    closeModal: () => st.closeModal(),
    getActivePath: () => st.tabs.find((t) => t.id === st.activeTabId)?.path || null,
    refreshTree: noop
  }
}

const effectiveHost = (): PluginHostApi => hostApi || fallbackHost()

/* -------------------------------------------------------------- settings */
const settingsCache = new Map<string, Record<string, unknown>>()

const loadSettings = (id: string): Record<string, unknown> => {
  const hit = settingsCache.get(id)
  if (hit) return hit
  let data: Record<string, unknown> = {}
  try {
    const raw = localStorage.getItem(SETTINGS_PREFIX + id)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed
    }
  } catch { /* ignore corrupt */ }
  settingsCache.set(id, data)
  return data
}

const persistSettings = (id: string, data: Record<string, unknown>) => {
  settingsCache.set(id, data)
  try { localStorage.setItem(SETTINGS_PREFIX + id, JSON.stringify(data)) } catch { /* quota */ }
}

/** Settings handle for a plugin — public because the settings UI uses it too. */
export const pluginSettings = (id: string): PluginSettingsApi => ({
  get: <T,>(key: string, fallback: T): T => {
    const data = loadSettings(id)
    return (key in data ? (data[key] as T) : fallback)
  },
  set: (key, value) => {
    const data = { ...loadSettings(id), [key]: value }
    persistSettings(id, data)
  },
  all: () => ({ ...loadSettings(id) })
})

/* --------------------------------------------------------------- context */
const contextCache = new Map<string, PluginContext>()

export const getPluginContext = (id: string): PluginContext => {
  const hit = contextCache.get(id)
  if (hit) return hit
  const ctx: PluginContext = {
    id,
    openFile: (path) => effectiveHost().openFile(path),
    createFile: (name, content, dir) => effectiveHost().createFile(name, content, dir),
    getActiveContent: () => {
      try { return effectiveHost().getActiveContent() || '' } catch { return '' }
    },
    insertText: (text) => { try { effectiveHost().insertText(text) } catch { /* noop */ } },
    replaceSelection: (text) => { try { effectiveHost().replaceSelection(text) } catch { /* noop */ } },
    toast: (msg, kind) => effectiveHost().toast(msg, kind),
    vault: {
      list: async () => (await effectiveHost().vault.list()) || [],
      read: async (p) => effectiveHost().vault.read(p),
      write: async (p, c) => {
        const r = await effectiveHost().vault.write(p, c)
        invalidateVault()
        return r
      },
      remove: effectiveHost().vault.remove ? (p: string) => effectiveHost().vault.remove!(p) : undefined,
      rename: effectiveHost().vault.rename ? (a: string, b: string) => effectiveHost().vault.rename!(a, b) : undefined,
      mkdir: effectiveHost().vault.mkdir ? (a: string, b: string) => effectiveHost().vault.mkdir!(a, b) : undefined
    },
    api: {
      get: (...a: any[]) => effectiveHost().api.get(...a),
      post: (...a: any[]) => effectiveHost().api.post(...a),
      put: (...a: any[]) => effectiveHost().api.put(...a),
      del: (...a: any[]) => effectiveHost().api.del(...a)
    },
    settings: pluginSettings(id),
    getActivePath: () => {
      try { return effectiveHost().getActivePath?.() ?? null } catch { return null }
    },
    openModal: (mid, props) => effectiveHost().openModal(mid, props),
    closeModal: () => effectiveHost().closeModal(),
    openFullScreen: (node) => effectiveHost().fullScreenHost?.(node),
    closeFullScreen: () => effectiveHost().fullScreenHost?.(null),
    refreshTree: () => effectiveHost().refreshTree?.()
  }
  contextCache.set(id, ctx)
  return ctx
}

/** Drop cached contexts (host changed → all delegates must be rebuilt). */
export const resetContexts = () => { contextCache.clear() }

/* -------------------------------------------------------------- registry */
const registry = new Map<string, PluginRuntime>()
const activeIds = new Set<string>()

export const registerRuntime = (rt: PluginRuntime) => { registry.set(rt.id, rt) }
export const unregisterRuntime = (id: string) => {
  deactivate(id)
  registry.delete(id)
}
export const getRuntime = (id: string) => registry.get(id)
export const listRuntimes = () => Array.from(registry.values())

/* --------------------------------------------------- enabled / activation */
const readEnabledMap = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

let enabledMap = readEnabledMap()

const persistEnabledMap = () => {
  try { localStorage.setItem(ENABLED_KEY, JSON.stringify(enabledMap)) } catch { /* quota */ }
}

export const isEnabled = (id: string): boolean => {
  if (id in enabledMap) return enabledMap[id]
  return registry.get(id)?.manifest.defaultEnabled ?? false
}

export const registerCommandsFor = (rt: PluginRuntime) => {
  const cmds = (rt.commands || []) as Command[]
  if (cmds.length) registerCommands(cmds)
}

export const activate = (id: string) => {
  const rt = registry.get(id)
  if (!rt || activeIds.has(id)) return
  activeIds.add(id)
  try {
    registerCommandsFor(rt)
    rt.onActivate?.(getPluginContext(id))
  } catch (e) {
    console.error(`[NeoM] 插件 ${id} 激活失败`, e)
    useStore.getState().toast({ kind: 'error', text: `插件「${rt.manifest.name}」激活失败` })
  }
}

export const deactivate = (id: string) => {
  const rt = registry.get(id)
  if (!rt || !activeIds.has(id)) return
  activeIds.delete(id)
  try {
    unregisterCommands((rt.commands || []).map((c) => c.id))
    rt.onDeactivate?.()
  } catch (e) {
    console.error(`[NeoM] 插件 ${id} 停用失败`, e)
  }
}

export const isActive = (id: string) => activeIds.has(id)
export const activePluginIds = () => Array.from(activeIds)

/** Enable/disable a plugin: persists locally, syncs commands, tells the server. */
export const setEnabled = async (id: string, enabled: boolean, opts: { syncServer?: boolean } = {}) => {
  enabledMap = { ...enabledMap, [id]: enabled }
  persistEnabledMap()
  if (enabled) activate(id)
  else deactivate(id)
  publishInstalled()
  if (opts.syncServer !== false) {
    try {
      await effectiveHost().api.post(API.pluginsToggle, { id, enabled })
    } catch { /* offline-first: local state is authoritative */ }
  }
}

export const toggleEnabled = (id: string) => setEnabled(id, !isEnabled(id))

/** Write the current manifest+enabled state into the zustand store. */
export const publishInstalled = () => {
  const all = listRuntimes().length ? listRuntimes() : []
  const installed: InstalledPlugin[] = all.map((rt) => ({
    id: rt.id,
    version: rt.manifest.version,
    enabled: isEnabled(rt.id),
    source: rt.manifest.builtin ? 'builtin' : 'uploaded',
    installed_at: new Date().toISOString(),
    manifest: rt.manifest
  }))
  const store = useStore.getState()
  if (installed.length) {
    store.setPlugins(installed)
    store.setPluginManifests(Object.fromEntries(all.map((rt) => [rt.id, rt.manifest])))
  }
}

/**
 * Pull `/api/plugins/installed`; merge `enabled` flags into the local map.
 * Offline (or unauthenticated) → local state stands untouched.
 */
export const syncInstalled = async (): Promise<{ online: boolean; count: number }> => {
  try {
    const rows = await effectiveHost().api.get(API.pluginsInstalled)
    const list = (Array.isArray(rows) ? rows : rows?.plugins || []) as InstalledPlugin[]
    if (!list.length) { publishInstalled(); return { online: true, count: 0 } }
    for (const row of list) {
      if (!row || !row.id) continue
      // server only overrides when it explicitly reports a state
      if (typeof row.enabled === 'boolean') enabledMap = { ...enabledMap, [row.id]: row.enabled }
    }
    persistEnabledMap()
    publishInstalled()
    return { online: true, count: list.length }
  } catch {
    publishInstalled()
    return { online: false, count: 0 }
  }
}

/* ------------------------------------------------------- third-party load */
export interface ThirdPartyPlugin {
  id: string
  /** absolute or /uploads/... URL of the ESM entry */
  entry: string
  manifest: PluginManifest
}

/** Restrict a context to the manifest's declared permissions. */
export const restrictContext = (base: PluginContext, manifest: PluginManifest): PluginContext => {
  const perms = new Set(manifest.permissions || [])
  const canWrite = perms.has('files:write')
  const deny = (what: string): never => {
    throw new Error(`插件「${manifest.name}」未声明 ${what} 权限，操作已阻止`)
  }
  return {
    ...base,
    settings: pluginSettings(manifest.id),
    createFile: async () => deny('files:write'),
    insertText: () => (canWrite ? base.insertText.bind(base) : deny('files:write')),
    replaceSelection: () => (canWrite ? base.replaceSelection.bind(base) : deny('files:write')),
    vault: {
      list: base.vault.list,
      read: base.vault.read,
      write: async (p, c) => (canWrite ? base.vault.write(p, c) : deny('files:write')),
      remove: canWrite ? base.vault.remove : undefined,
      rename: canWrite ? base.vault.rename : undefined,
      mkdir: canWrite ? base.vault.mkdir : undefined
    },
    api: perms.has('net:fetch')
      ? base.api
      : {
          get: async (url: string) => (/^\/api\/ai\//.test(url) && perms.has('ai:chat') ? base.api.get(url) : null),
          post: async (url: string, body?: unknown) => (/^\/api\/ai\//.test(url) && perms.has('ai:chat') ? base.api.post(url, body) : null),
          put: async () => null,
          del: async () => null
        }
  }
}

/**
 * Dynamically import a third-party plugin entry and build a runtime.
 * Errors are contained: the plugin is marked failed and a toast shown.
 */
export const loadThirdPartyPlugin = async (def: ThirdPartyPlugin): Promise<PluginRuntime | null> => {
  const { id, entry, manifest } = def
  try {
    const mod: any = await import(/* @vite-ignore */ entry)
    const factory = mod?.default ?? mod?.plugin ?? mod
    const ctx = restrictContext(getPluginContext(id), manifest)
    const produced = typeof factory === 'function' ? await factory(ctx) : factory
    const rt: PluginRuntime = {
      id,
      manifest: { ...manifest, builtin: false, entry },
      ribbonIcon: produced?.ribbonIcon,
      renderPanel: produced?.renderPanel,
      renderRightPanel: produced?.renderRightPanel,
      renderStatusItem: produced?.renderStatusItem,
      onActivate: produced?.onActivate,
      onDeactivate: produced?.onDeactivate,
      commands: (produced?.commands || []).map((c: any) => ({
        category: c.category || manifest.name,
        pluginId: id,
        ...c,
        id: c.id?.startsWith('plugin.') ? c.id : `plugin.${id}.${c.id || c.action || 'run'}`
      })),
      fullScreen: produced?.fullScreen
    }
    registerRuntime(rt)
    if (isEnabled(id)) activate(id)
    publishInstalled()
    return rt
  } catch (e: any) {
    console.error(`[NeoM] 第三方插件 ${id} 加载失败`, e)
    useStore.getState().toast({ kind: 'error', text: `插件「${manifest.name}」加载失败：${e?.message || '未知错误'}` })
    return null
  }
}

/** Boot helper: register builtin runtimes then activate the enabled subset. */
export const bootRuntime = (runtimes: PluginRuntime[], api: PluginHostApi) => {
  setHostApi(api)
  resetContexts()
  runtimes.forEach(registerRuntime)
  publishInstalled()
  runtimes.forEach((rt) => { if (isEnabled(rt.id)) activate(rt.id) })
}

/** Test-only / teardown helper. */
export const shutdownRuntime = () => {
  Array.from(activeIds).forEach(deactivate)
  registry.clear()
  contextCache.clear()
  settingsCache.clear()
}
