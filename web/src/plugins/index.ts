/**
 * NeoM plugin system — public entry point.
 *
 * The shell does exactly one thing at boot:
 *   import { registerAllPlugins } from '@/plugins'
 *   registerAllPlugins(hostApi)          // hostApi is built from the editor
 * then renders panels via `pluginRegistry[id].renderPanel?.({ context })`
 * or asks for a whole-page view via `pluginRegistry[id].fullScreen?.(el)`.
 */
import React, { Suspense } from 'react'
import type { Command } from '@/lib/commands'
import { eventToShortcut, isBrowserReserved, normalizeShortcut, runCommand } from '@/lib/commands'
import type { InstalledPlugin, PluginManifest } from '@/lib/contracts'
import { PLUGIN_DEFS, defOf, type PluginDef } from './defs'
import { PANELS, STATUS_PANELS } from './panels'
import {
  activate,
  activePluginIds,
  bootRuntime,
  deactivate,
  getPluginContext,
  isEnabled,
  listRuntimes,
  loadThirdPartyPlugin,
  pluginSettings,
  publishInstalled,
  registerRuntime,
  setEnabled,
  syncInstalled,
  toggleEnabled
} from './runtime'
import { closeAllPluginWindows, isWindowOpen, mountFullScreen, openPluginWindow, togglePluginWindow } from './fullscreen'
import type { PanelProps, PluginContext, PluginHostApi, PluginRuntime } from './types'

export type { PanelProps, PluginContext, PluginHostApi, PluginRuntime } from './types'
export { getPluginContext, pluginSettings } from './runtime'
export { openPluginWindow, togglePluginWindow, closeAllPluginWindows, mountFullScreen, isWindowOpen } from './fullscreen'
export { M, manifestOf, builtinIds } from './manifests'
export {
  activate,
  deactivate,
  isEnabled,
  setEnabled,
  toggleEnabled,
  syncInstalled,
  publishInstalled,
  loadThirdPartyPlugin,
  listRuntimes
} from './runtime'

const h = React.createElement

const loadingNode = h('div', { className: 'plg-fs-loading' }, h('span', { className: 'spinner' }))

/** Lazy left/side panel renderer. */
const renderLazy = (Comp: React.ComponentType<PanelProps> | undefined) =>
  Comp
    ? (props: { context: PluginContext }) => h(Suspense, { fallback: loadingNode }, h(Comp, props))
    : undefined

const buildRuntime = (def: PluginDef): PluginRuntime => {
  const id = def.manifest.id
  const commands: Command[] = (def.commands || []).map((c) => ({
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    category: c.category || def.manifest.name,
    icon: c.icon || def.ribbonIcon,
    shortcut: c.shortcut,
    keywords: c.keywords,
    pluginId: id,
    run: () => c.run(getPluginContext(id))
  }))

  const PanelComp = def.panel ? PANELS[def.panel] : undefined
  const RightComp = def.rightPanel ? PANELS[def.rightPanel] : undefined
  const StatusComp = def.statusItem ? STATUS_PANELS[id] : undefined

  const rt: PluginRuntime = {
    id,
    manifest: def.manifest,
    ribbonIcon: def.ribbonIcon,
    commands,
    renderPanel: renderLazy(PanelComp),
    renderLeftPanel: renderLazy(PanelComp),
    renderRightPanel: renderLazy(RightComp || PanelComp),
    renderStatusItem: StatusComp
      ? () => h(Suspense, { fallback: null }, h(StatusComp, { context: getPluginContext(id) }))
      : undefined,
    onActivate: def.onActivate ? (ctx) => def.onActivate!(ctx) : undefined,
    onDeactivate: def.onDeactivate,
    fullScreen: def.fullScreen
      ? (container: HTMLElement | null) => mountFullScreen(id, getPluginContext(id), container)
      : undefined
  }
  return rt
}

/** All built-in runtimes, keyed by plugin id. Populated at import time. */
export const pluginRegistry: Record<string, PluginRuntime> = {}

for (const def of PLUGIN_DEFS) {
  const runtime = buildRuntime(def)
  pluginRegistry[runtime.id] = runtime
  registerRuntime(runtime)
}

/** 25 built-in manifests (24 original + AI assistant). */
export const pluginManifests: PluginManifest[] = PLUGIN_DEFS.map((d) => d.manifest)

export const getPluginRuntime = (id: string): PluginRuntime | undefined => pluginRegistry[id]

export const getPluginManifests = () => pluginManifests

/** Panel component for direct shell usage (`<Suspense><AiChatPanel context/>`). */
export const AiChatPanel = PANELS.ai

/* --------------------------------------------------------------- hotkeys */
let hotkeyOff: (() => void) | null = null

/**
 * Plugin hotkeys are declared on commands (`shortcut`), not in the global
 * settings map, so we own a small listener. The core shortcut engine runs in
 * the capture phase and stops propagation, so mapped shell shortcuts win.
 */
const installPluginHotkeys = () => {
  if (hotkeyOff) return hotkeyOff
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    const combo = eventToShortcut(e)
    if (!combo || !combo.includes('+')) return
    const target = e.target as HTMLElement | null
    const inField = !!target?.closest('input, textarea, [contenteditable="true"], .vditor-reset')
    for (const rt of listRuntimes()) {
      if (!isEnabled(rt.id)) continue
      for (const cmd of rt.commands || []) {
        if (!cmd.shortcut) continue
        if (normalizeShortcut(cmd.shortcut) !== combo) continue
        if (isBrowserReserved(cmd.shortcut)) continue
        // single-letter commands must not hijack typing
        if (inField && !/^(Control|Meta)\+/.test(combo)) continue
        e.preventDefault()
        e.stopPropagation()
        runCommand(cmd.id)
        return
      }
    }
  }
  window.addEventListener('keydown', onKey)
  hotkeyOff = () => window.removeEventListener('keydown', onKey)
  return hotkeyOff
}

/* ------------------------------------------------------------ bootstrap */
let booted = false

/**
 * Called once by the shell at startup.
 * Registers commands for enabled plugins, publishes manifests into the store,
 * then syncs enable-state with `/api/plugins/installed` (offline-tolerant).
 */
export function registerAllPlugins(hostApi: PluginHostApi): void {
  bootRuntime(Object.values(pluginRegistry), hostApi)
  installPluginHotkeys()
  booted = true
  syncInstalled()
    .then(({ online }) => {
      if (!online) return
      for (const rt of Object.values(pluginRegistry)) {
        if (isEnabled(rt.id)) activate(rt.id)
        else deactivate(rt.id)
      }
      publishInstalled()
    })
    .catch(() => { /* offline-first */ })
}

/** Whether registerAllPlugins() already ran. */
export const isBooted = () => booted

/** Convenience for ribbon buttons: open a plugin by id (panel or full-screen). */
export const openPluginById = (id: string): boolean => {
  const def = defOf(id)
  const ctx = getPluginContext(id)
  if (!def) return false
  if (!isEnabled(id)) {
    ctx.toast(`插件「${def.manifest.name}」已停用`, 'warn')
    return false
  }
  if (def.fullScreen) openPluginWindow(id, ctx, { full: true })
  else openPluginWindow(id, ctx)
  return true
}

/** Enabled plugin ids in ribbon order — handy for building the ribbon. */
export const enabledPluginIds = () => pluginManifests.filter((m) => isEnabled(m.id)).map((m) => m.id)

/** Ribbon contributions for the shell. */
export const ribbonItems = () =>
  pluginManifests
    .filter((m) => isEnabled(m.id) && m.contributes.ribbon)
    .map((m) => ({ id: m.id, icon: defOf(m.id)?.ribbonIcon || m.icon, name: m.name }))

/** Status-bar contributions (word-count today). */
export const statusItems = () =>
  pluginManifests
    .filter((m) => isEnabled(m.id) && m.contributes.statusItem)
    .map((m) => ({ id: m.id, render: pluginRegistry[m.id]?.renderStatusItem }))

/** Installed plugin rows for the account/plugins page. */
export const installedPlugins = (): InstalledPlugin[] => {
  const state = new Map(listRuntimes().map((r) => [r.id, r]))
  return pluginManifests.map((m) => ({
    id: m.id,
    version: state.get(m.id)?.manifest.version || m.version,
    enabled: isEnabled(m.id),
    source: m.builtin ? 'builtin' : 'uploaded',
    installed_at: '',
    manifest: m
  }))
}

/** Active (activated) plugin ids — diagnostics helper. */
export const activeIds = activePluginIds

export default {
  pluginRegistry,
  pluginManifests,
  registerAllPlugins,
  getPluginRuntime,
  openPluginById,
  AiChatPanel
}
