/**
 * Plugin runtime contracts — the ONLY surface the shell touches.
 * Kept dependency-free (types only) so both `runtime.ts` and `index.ts`
 * can import it without cycles.
 */
import type { ReactNode } from 'react'
import type { Command } from '@/lib/commands'
import type { PluginManifest } from '@/lib/contracts'

export type ToastKind = 'info' | 'ok' | 'warn' | 'error'

/** Vault bridge handed to plugins. Never touches fetch directly. */
export interface PluginVault {
  list: () => Promise<any[]>
  read: (path: string) => Promise<any>
  write: (path: string, content: string) => Promise<any>
  /** optional extras the shell MAY provide */
  remove?: (path: string) => Promise<any>
  rename?: (from: string, to: string) => Promise<any>
  mkdir?: (parent: string, name: string) => Promise<any>
}

export interface PluginSettingsApi {
  get: <T>(key: string, fallback: T) => T
  set: (key: string, value: unknown) => void
  all: () => Record<string, unknown>
}

/** Per-plugin context built by the runtime from the host API. */
export interface PluginContext {
  /** plugin id this context belongs to (settings scope) */
  readonly id: string
  openFile: (path: string) => void
  createFile: (name?: string, content?: string, dir?: string) => Promise<string>
  getActiveContent: () => string
  insertText: (text: string) => void
  replaceSelection: (text: string) => void
  toast: (msg: string, kind?: ToastKind) => void
  vault: PluginVault
  api: { get: any; post: any; put: any; del: any }
  settings: PluginSettingsApi

  /* ---- stable optional helpers (shell may provide) ---- */
  getActivePath?: () => string | null
  openModal: (id: string, props?: Record<string, unknown>) => void
  closeModal: () => void
  /** render an arbitrary node in the shell's full-screen layer */
  openFullScreen: (node: ReactNode) => void
  closeFullScreen: () => void
  /** ask the shell to reload the file tree / invalidate caches */
  refreshTree: () => void
}

/**
 * Everything the shell must supply once at boot.
 * `registerAllPlugins(hostApi)` consumes this.
 */
export interface PluginHostApi {
  openFile: (path: string) => void
  createFile: (name?: string, content?: string, dir?: string) => Promise<string>
  getActiveContent: () => string
  insertText: (text: string) => void
  replaceSelection: (text: string) => void
  toast: (msg: string, kind?: ToastKind) => void
  vault: PluginVault
  api: { get: any; post: any; put: any; del: any }
  openModal: (id: string, props?: Record<string, unknown>) => void
  closeModal: () => void
  fullScreenHost?: (node: ReactNode | null) => void
  getActivePath?: () => string | null
  refreshTree?: () => void
}

/** A live plugin: manifest + UI contribution points. */
export interface PluginRuntime {
  id: string
  manifest: PluginManifest
  renderPanel?: (props: { context: PluginContext }) => ReactNode
  /** alias kept for shells that call it `renderLeftPanel` */
  renderLeftPanel?: (props: { context: PluginContext }) => ReactNode
  renderRightPanel?: (props: { context: PluginContext }) => ReactNode
  renderStatusItem?: () => ReactNode
  ribbonIcon?: string
  onActivate?: (ctx: PluginContext) => void
  onDeactivate?: () => void
  commands?: Command[]
  /** imperative mount for canvas / graph / slides / browser整页视图 */
  fullScreen?: (container: HTMLElement | null) => void
}

/** Props every lazy panel component receives. */
export interface PanelProps {
  context: PluginContext
  /** true when mounted through `runtime.fullScreen()` */
  full?: boolean
  onClose?: () => void
}

export type PanelComponent = React.ComponentType<PanelProps>
