/**
 * Path helpers for the status bar / context menus.
 */
import { useStore } from '@/store'
import { isDesktop, local, revealPath, pathSeparator } from '@/lib/platform'
import { fileService, currentVault, absPathOf } from './fileService'

const activePath = () => {
  const st = useStore.getState()
  const tab = st.tabs.find((t) => t.id === st.activeTabId)
  return tab?.path || null
}

/** Absolute local path of the active document (desktop only). */
export async function currentAbsPath(): Promise<string | null> {
  const path = activePath()
  if (!path) return null
  const known = absPathOf(path)
  if (known) return known
  const bridge = (window as unknown as { neom?: { vaultPath?: string; local?: { vaultPath?: string } } }).neom
  const root = bridge?.vaultPath || bridge?.local?.vaultPath
  if (root) return root.replace(/[\\/]+$/, '') + pathSeparator + path.split('/').join(pathSeparator)
  return null
}

/**
 * Status-bar path text. Desktop local files show the full absolute path ending
 * with the file name; cloud files show the vault-relative path.
 */
export function fmtPathForStatus(absPath: string | null, relPath: string): string {
  if (absPath) {
    if (isDesktop) return absPath
    return relPath
  }
  return relPath
}

export async function revealCurrentFile() {
  const abs = await currentAbsPath()
  const st = useStore.getState()
  if (!abs) {
    const path = activePath()
    if (!path) return
    // cloud file → reveal in the left tree
    st.toggleLeft(true)
    st.setLeftPanel(null)
    st.setLeftView('files')
    st.setSelectedPath(path)
    return
  }
  await revealPath(abs)
}

export async function copyCurrentPath() {
  const st = useStore.getState()
  const abs = await currentAbsPath()
  const rel = activePath()
  const text = abs || rel
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    st.toast({ kind: 'ok', text: abs ? '绝对路径已复制' : '路径已复制' })
  } catch {
    st.toast({ kind: 'error', text: '复制失败' })
  }
}

/** Reveal any path (used by file tree menus). */
export async function revealAnyPath(path: string) {
  const st = useStore.getState()
  const known = absPathOf(path)
  if (known) {
    await revealPath(known)
    return
  }
  const bridge = (window as unknown as { neom?: { vaultPath?: string } }).neom
  const root = bridge?.vaultPath
  if (root && isDesktop && local) {
    await revealPath(root.replace(/[\\/]+$/, '') + pathSeparator + path.split('/').join(pathSeparator))
    return
  }
  st.toggleLeft(true)
  st.setLeftView('files')
  st.setSelectedPath(path)
  st.toast({ kind: 'info', text: '云端文档已在左侧文件树中定位' })
}

export const absoluteOf = async (path: string): Promise<string> => {
  const known = absPathOf(path)
  if (known) return known
  const bridge = (window as unknown as { neom?: { vaultPath?: string } }).neom
  const root = bridge?.vaultPath
  return root ? root.replace(/[\\/]+$/, '') + pathSeparator + path.split('/').join(pathSeparator) : path
}

export { fileService, currentVault }
