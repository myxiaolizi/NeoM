/**
 * Platform abstraction. Web / Electron desktop / Capacitor mobile.
 * Exposed by preload in Electron: window.neom
 */
export type Platform = 'web' | 'windows' | 'macos' | 'linux' | 'android' | 'ios'

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const bridge = (typeof window !== 'undefined' ? (window as any).neom : null) || {}

export const isDesktop = !!bridge.isDesktop
export const isElectron = isDesktop
export const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.()
export const isMobileUA = /android|iphone|ipad|ipod/i.test(ua)
export const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

export const platform: Platform = isDesktop
  ? bridge.platform === 'darwin'
    ? 'macos'
    : bridge.platform === 'win32'
      ? 'windows'
      : 'linux'
  : isCapacitor
    ? /iphone|ipad|ipod/i.test(ua)
      ? 'ios'
      : 'android'
    : 'web'

export const isMac = platform === 'macos'
export const modKey = isMac ? 'Meta' : 'Control'
export const modLabel = isMac ? '⌘' : 'Ctrl'
export const altLabel = isMac ? '⌥' : 'Alt'
export const shiftLabel = isMac ? '⇧' : 'Shift'

export interface LocalFileApi {
  openVault: () => Promise<{ path: string; name: string } | null>
  readDir: (dir: string) => Promise<{ name: string; path: string; isDir: boolean; size: number; mtime: number; ctime: number }[]>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<boolean>
  deleteFile: (path: string) => Promise<boolean>
  createDir: (path: string) => Promise<boolean>
  rename: (from: string, to: string) => Promise<boolean>
  move: (from: string, to: string) => Promise<boolean>
  revealInFolder: (path: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  setTitle: (title: string) => Promise<void>
  associateMd: () => Promise<boolean>
  isMdAssociated: () => Promise<boolean>
  onOpenFile: (cb: (path: string) => void) => void
  recentVaults: () => Promise<{ path: string; name: string }[]>
  store: { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> }
  update: {
    check: () => Promise<{ version: string; url: string; notes: string } | null>
    download: (url: string) => Promise<void>
    install: () => Promise<void>
  }
}

export const local: LocalFileApi | null = isDesktop ? (bridge.local as LocalFileApi) : null

/** Set window/document title to current file (platform requirement) */
export const setWindowTitle = (fileTitle: string) => {
  const t = fileTitle || 'NeoM'
  document.title = t
  if (isDesktop && local?.setTitle) local.setTitle(t).catch(() => {})
}

/** Reveal a local file in Explorer/Finder */
export const revealPath = async (p: string) => {
  if (isDesktop && local?.revealInFolder) { await local.revealInFolder(p); return }
  console.info('[NeoM] reveal path is desktop-only:', p)
}

/** Platform-specific labels for the statusbar path chip */
export const pathSeparator = platform === 'windows' ? '\\' : '/'

export const canAssociateMd = platform === 'windows' || platform === 'macos'

export const hasNativeShortcutRisk = platform === 'web'

export const platformLabels: Record<Platform, string> = {
  web: '网页版',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS'
}

export default { isDesktop, platform, modKey, modLabel, local, setWindowTitle, revealPath }
