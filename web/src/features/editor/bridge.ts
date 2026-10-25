/**
 * Editor bridge — lets shell commands / menus talk to the live editor instance
 * without prop-drilling or importing Vditor everywhere.
 */
export type BridgeKey = 'main' | 'side'

export interface EditorBridge {
  key: BridgeKey
  path: string
  mode: 'wysiwyg' | 'source' | 'split' | 'preview'
  /** raw markdown value */
  getValue(): string
  /** replace the whole document */
  setValue(md: string): void
  /** replace current selection (or insert at caret) */
  insert(md: string): void
  /** alias used by menus */
  insertMD(md: string): void
  getSelection(): string
  focus(): void
  /** DOM root of the rendered content, used for find highlighting */
  contentRoot(): HTMLElement | null
  /** scroll to a heading by visible text */
  scrollToHeading(text: string, level?: number): boolean
}

const bridges = new Map<BridgeKey, EditorBridge>()
let focused: BridgeKey = 'main'

export const registerBridge = (key: BridgeKey, bridge: EditorBridge) => {
  bridges.set(key, bridge)
}

export const unregisterBridge = (key: BridgeKey, path?: string) => {
  const cur = bridges.get(key)
  if (cur && (!path || cur.path === path)) bridges.delete(key)
}

export const setFocusedBridge = (key: BridgeKey) => {
  if (bridges.has(key)) focused = key
}

export const getBridge = (key?: BridgeKey): EditorBridge | null => {
  if (key) return bridges.get(key) || null
  return bridges.get(focused) || bridges.get('main') || null
}

export const getBridgeFor = (path: string): EditorBridge | null => {
  for (const b of bridges.values()) if (b.path === path) return b
  return null
}

/* convenience wrappers ------------------------------------------------ */
export const editorValue = () => getBridge()?.getValue() ?? ''
export const editorSelection = () => getBridge()?.getSelection() ?? ''
export const editorInsert = (md: string) => getBridge()?.insert(md)
export const editorSetValue = (md: string) => getBridge()?.setValue(md)
export const editorFocus = () => getBridge()?.focus()
