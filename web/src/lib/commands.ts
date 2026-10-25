/**
 * Command registry + shortcut engine.
 * Every UI action (built-in or plugin) is registered here so the command
 * palette, ribbon, context menus and shortcuts all share one source.
 */
import { useStore } from '@/store'
import { isMac, modKey, modLabel, isDesktop } from './platform'
import { DEFAULT_SETTINGS, type ShortcutMap } from './contracts'

export interface Command {
  id: string
  title: string
  subtitle?: string
  category: string
  icon?: string
  shortcut?: string        // "Mod+P"
  run: () => void | Promise<void>
  when?: () => boolean
  pluginId?: string
  keywords?: string
}

const registry = new Map<string, Command>()
const listeners = new Set<() => void>()

export const registerCommand = (cmd: Command) => {
  registry.set(cmd.id, cmd)
  listeners.forEach((l) => l())
  return () => { registry.delete(cmd.id); listeners.forEach((l) => l()) }
}

export const registerCommands = (cmds: Command[]) => {
  cmds.forEach((c) => registry.set(c.id, c))
  listeners.forEach((l) => l())
}

export const unregisterCommands = (ids: string[]) => {
  ids.forEach((id) => registry.delete(id))
  listeners.forEach((l) => l())
}

export const getCommands = () => Array.from(registry.values())

export const onCommandsChanged = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const runCommand = async (id: string) => {
  const cmd = registry.get(id)
  if (!cmd) {
    useStore.getState().toast({ kind: 'warn', text: `命令不存在：${id}` })
    return
  }
  if (cmd.when && !cmd.when()) return
  try {
    await cmd.run()
  } catch (e: any) {
    useStore.getState().toast({ kind: 'error', text: e?.message || '命令执行失败' })
  }
}

/* ------------------------------------------------------------ shortcuts */
/** Normalize a shortcut string to a canonical form, e.g. "Mod+Shift+P" */
export const normalizeShortcut = (s: string): string => {
  if (!s) return ''
  const parts = s
    .replace(/\s+/g, '')
    .replace(/⌘/g, 'Meta')
    .replace(/⌥/g, 'Alt')
    .replace(/⇧/g, 'Shift')
    .replace(/⌃/g, 'Control')
    .split('+')
    .filter(Boolean)
  const mods: string[] = []
  let key = ''
  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === 'mod') mods.push(isMac ? 'Meta' : 'Control')
    else if (low === 'ctrl' || low === 'control') mods.push('Control')
    else if (low === 'meta' || low === 'cmd' || low === 'command') mods.push('Meta')
    else if (low === 'shift') mods.push('Shift')
    else if (low === 'alt' || low === 'option') mods.push('Alt')
    else key = p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
  }
  const order = ['Control', 'Meta', 'Alt', 'Shift']
  const sorted = order.filter((o) => mods.includes(o))
  return [...sorted, key].join('+')
}

export const eventToShortcut = (e: KeyboardEvent): string => {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.metaKey) mods.push('Meta')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const k = e.key
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(k)) return ''
  let key = k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1)
  if (k === ' ') key = 'Space'
  if (k === 'ArrowUp') key = 'Up'
  if (k === 'ArrowDown') key = 'Down'
  if (k === 'ArrowLeft') key = 'Left'
  if (k === 'ArrowRight') key = 'Right'
  if (k === 'Escape') key = 'Esc'
  const order = ['Control', 'Meta', 'Alt', 'Shift']
  return [...order.filter((o) => mods.includes(o)), key].join('+')
}

/** Pretty label for display, platform aware */
export const shortcutLabel = (s: string) => {
  const n = normalizeShortcut(s)
  if (!n) return ''
  return n
    .split('+')
    .map((p) => {
      if (p === 'Control') return isMac ? '⌃' : 'Ctrl'
      if (p === 'Meta') return isMac ? '⌘' : 'Win'
      if (p === 'Alt') return isMac ? '⌥' : 'Alt'
      if (p === 'Shift') return isMac ? '⇧' : 'Shift'
      return p
    })
    .join(isMac ? '' : '+')
}

/** Browser shortcuts that cannot be intercepted in web builds */
const BROWSER_RESERVED = [
  'Control+S', 'Control+W', 'Control+T', 'Control+N', 'Control+Shift+N', 'Control+Shift+T',
  'Control+Tab', 'Control+Shift+Tab', 'Control+L', 'Control+D', 'Control+Shift+B', 'Control+H',
  'Control+J', 'Control+U', 'Control+Shift+I', 'Control+Shift+J', 'Control+Shift+C', 'Control+P',
  'Control+O', 'Control+Shift+S', 'Control+Shift+W', 'Meta+S', 'Meta+T', 'Meta+N', 'Meta+W',
  'Meta+Q', 'Meta+L', 'Meta+P', 'Meta+Shift+N'
]

export const isBrowserReserved = (shortcut: string) =>
  !isDesktop && BROWSER_RESERVED.includes(normalizeShortcut(shortcut))

export const shortcutMap = (): ShortcutMap => useStore.getState().settings.shortcuts || DEFAULT_SETTINGS.shortcuts

/** Install the global keydown handler. Call once from the app shell. */
export const installShortcutEngine = () => {
  const onKey = (e: KeyboardEvent) => {
    // Inside Vditor / inputs we still allow Mod-based shortcuts but not plain keys
    const combo = eventToShortcut(e)
    if (!combo) return
    const map = shortcutMap()
    const entry = Object.entries(map).find(([, v]) => normalizeShortcut(v) === combo)
    if (!entry) return
    const [cmdId] = entry

    // In web builds, blocked browser combos must surface an actionable hint
    if (isBrowserReserved(map[cmdId])) {
      return
    }

    const cmd = registry.get(cmdId)
    if (!cmd) return
    if (cmd.when && !cmd.when()) return
    e.preventDefault()
    e.stopPropagation()
    runCommand(cmdId)
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}

/** Fuzzy score used by command palette / quick switcher */
export const fuzzyScore = (text: string, query: string): number => {
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (t.includes(q)) return 100 + (t.startsWith(q) ? 50 : 0) - t.length * 0.01
  let ti = 0
  let score = 0
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i], ti)
    if (idx < 0) return 0
    score += 10 - Math.min(9, idx - ti)
    ti = idx + 1
  }
  return score
}
