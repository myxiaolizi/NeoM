/**
 * Document repository — the single source of truth for open document bodies.
 *
 * File metadata / tabs live in the global zustand store; document *content*
 * lives here so typing does not rerender the whole shell. Every mutation
 * replaces the entry object so `useSyncExternalStore` consumers update.
 */
import { useSyncExternalStore } from 'react'
import { useStore } from '@/store'
import { ApiError } from '@/lib/api'
import { fileService, currentVault } from '@/features/files/fileService'
import { nameOf, parentOf } from '@/features/files/fileUtils'
import { decideDocName } from './naming'
import { computeStats } from './wordCount'

export interface DocEntry {
  path: string
  name: string
  content: string
  etag: string
  mtime: string
  version: number
  absPath?: string
  dirty: boolean
  loading: boolean
  error: string | null
  offline: boolean
  /** user renamed manually — naming rules must not override it */
  userNamed: boolean
  /** the automatic naming rule already ran once for this document */
  namingApplied: boolean
  /** bumped when content is replaced from outside the editor */
  nonce: number
}

const docs = new Map<string, DocEntry>()
const listeners = new Set<() => void>()
const saving = new Map<string, Promise<boolean>>()

const emit = () => {
  for (const l of listeners) {
    try {
      l()
    } catch {
      /* listener errors must not break persistence */
    }
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getDocEntry = (path: string | null | undefined): DocEntry | null =>
  path ? docs.get(path) || null : null

export const listOpenDocs = () => Array.from(docs.values())

/** React hook for one document. */
export function useDoc(path: string | null | undefined): DocEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => (path ? docs.get(path) || null : null),
    () => null
  )
}

const blank = (path: string, content = ''): DocEntry => ({
  path,
  name: nameOf(path),
  content,
  etag: '',
  mtime: new Date().toISOString(),
  version: 1,
  dirty: false,
  loading: true,
  error: null,
  offline: false,
  userNamed: false,
  namingApplied: false,
  nonce: 0
})

const tidy = (path: string, patch: Partial<DocEntry>) => {
  const cur = docs.get(path)
  if (!cur) return null
  const next = { ...cur, ...patch }
  docs.set(path, next)
  emit()
  return next
}

/* ------------------------------------------------------------ tab plumbing */
const tabsOf = (path: string) => useStore.getState().tabs.filter((t) => t.path === path)

export function syncTab(path: string, patch: { dirty?: boolean; name?: string; viewMode?: 'wysiwyg' | 'source' | 'split' | 'preview' }) {
  const st = useStore.getState()
  for (const t of st.tabs.filter((x) => x.path === path)) st.updateTab(t.id, patch)
}

/* ------------------------------------------------------------ loading */
export async function loadDoc(path: string, opts: { force?: boolean } = {}): Promise<DocEntry | null> {
  const existing = docs.get(path)
  if (existing && !existing.loading && !opts.force) return existing
  if (!existing) {
    docs.set(path, blank(path))
    emit()
  }
  try {
    const doc = await fileService.read(currentVault(), path)
    const cur = docs.get(path)
    const keepDirty = !!cur?.dirty && !!cur?.content && opts.force
    const next: DocEntry = {
      ...(cur || blank(path)),
      name: doc.name || nameOf(path),
      content: keepDirty ? cur!.content : doc.content,
      etag: doc.etag || '',
      mtime: doc.mtime || new Date().toISOString(),
      version: doc.version || 1,
      absPath: (doc as { absPath?: string }).absPath,
      loading: false,
      error: null,
      offline: !!(doc as { offline?: boolean }).offline,
      nonce: (cur?.nonce || 0) + 1
    }
    docs.set(path, next)
    emit()
    return next
  } catch (e) {
    const cur = docs.get(path)
    docs.set(path, {
      ...(cur || blank(path)),
      loading: false,
      error: (e as Error)?.message || '打开失败'
    })
    emit()
    return docs.get(path) || null
  }
}

export function ensureDoc(path: string): DocEntry | null {
  if (!docs.has(path)) {
    docs.set(path, blank(path))
    emit()
    void loadDoc(path)
  }
  return docs.get(path) || null
}

/* ------------------------------------------------------------ editing */
let statsTimer: number | null = null
const scheduleStats = (path: string, content: string) => {
  if (statsTimer !== null) window.clearTimeout(statsTimer)
  statsTimer = window.setTimeout(() => {
    statsTimer = null
    const st = useStore.getState()
    if (st.tabs.find((t) => t.id === st.activeTabId)?.path !== path) return
    st.setStats(computeStats(content))
  }, 260)
}

export function setDocContent(path: string, content: string) {
  const cur = docs.get(path)
  if (!cur) return
  if (cur.content === content) return
  const next = { ...cur, content, dirty: true }
  docs.set(path, next)
  syncTab(path, { dirty: true })
  scheduleStats(path, content)
  emit()
}

/** Replace content from an external source (restore / conflict resolution). */
export function applyDocContent(path: string, content: string, extra: Partial<DocEntry> = {}) {
  const cur = docs.get(path)
  if (!cur) return
  docs.set(path, { ...cur, ...extra, content, dirty: false, nonce: cur.nonce + 1 })
  syncTab(path, { dirty: false })
  const st = useStore.getState()
  if (st.tabs.find((t) => t.id === st.activeTabId)?.path === path) st.setStats(computeStats(content))
  emit()
}

export function markUserNamed(path: string) {
  const cur = docs.get(path)
  if (cur) tidy(path, { userNamed: true })
}

export function forgetDoc(path: string) {
  docs.delete(path)
  emit()
}

/* ------------------------------------------------------------ saving */
function moveDoc(oldPath: string, newPath: string) {
  const cur = docs.get(oldPath)
  if (!cur) return
  docs.delete(oldPath)
  docs.set(newPath, { ...cur, path: newPath, name: nameOf(newPath) })
  emit()
}

/** Keep store + doc map consistent after a rename. */
export function rebindPath(oldPath: string, newPath: string) {
  moveDoc(oldPath, newPath)
  const st = useStore.getState()
  for (const t of st.tabs.filter((x) => x.path === oldPath)) {
    st.updateTab(t.id, { path: newPath, name: nameOf(newPath) })
  }
  const files = st.files.map((f) =>
    f.path === oldPath
      ? { ...f, id: newPath, path: newPath, name: nameOf(newPath), parent: parentOf(newPath) }
      : f
  )
  st.setFiles(files)
  syncTab(newPath, { dirty: false })
}

export interface SaveOptions {
  /** allow the naming rules to rename the file */
  naming?: boolean
  /** force overwrite even if the etag drifted (conflict resolution) */
  force?: boolean
  /** quiet mode: no toasts */
  silent?: boolean
}

export async function saveDoc(path: string, opts: SaveOptions = {}): Promise<boolean> {
  const inflight = saving.get(path)
  if (inflight) return inflight
  const task = (async () => {
    let cur = docs.get(path)
    if (!cur || cur.loading) return false
    const st = useStore.getState()
    const vault = currentVault()
    let target = path

    // 1. automatic naming — runs at most once per document, and only when the
    //    body actually has text and the user has never renamed the file.
    if (
      opts.naming !== false &&
      !cur.userNamed &&
      !cur.namingApplied &&
      !isCanvasLike(cur.name) &&
      cur.content.trim()
    ) {
      try {
        const nextName = await decideDocName(cur.content, cur.name)
        cur = tidy(path, { namingApplied: true }) || cur
        if (nextName && nextName !== cur.name) {
          const dir = parentOf(path)
          const to = dir ? `${dir}/${nextName}` : nextName
          await fileService.rename(vault, path, to)
          rebindPath(path, to)
          target = to
          cur = docs.get(to)!
        }
      } catch {
        /* rename failure must not block saving the body */
      }
    }

    try {
      const res = await fileService.write(vault, target, cur.content, {
        baseEtag: opts.force ? undefined : cur.etag || undefined,
        naming: 'keep'
      })
      docs.set(target, {
        ...cur,
        etag: res.etag || cur.etag,
        mtime: res.mtime || new Date().toISOString(),
        version: res.version || cur.version,
        dirty: false,
        offline: !!res.offline,
        error: null
      })
      syncTab(target, { dirty: false })
      const files = useStore.getState().files.map((f) =>
        f.path === target ? { ...f, mtime: res.mtime || f.mtime, size: cur.content.length } : f
      )
      useStore.getState().setFiles(files)
      window.dispatchEvent(new CustomEvent('neom:doc-saved', { detail: { path: target } }))
      if (res.offline && !opts.silent) {
        st.toast({ kind: 'warn', text: '当前离线，内容已保存到本地缓存，恢复连接后请再次保存' })
      }
      emit()
      return true
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        const remote = (e.data as { remote?: { content?: string; mtime?: string; device?: string } })?.remote
        st.setConflict({
          path: target,
          localContent: cur.content,
          remoteContent: remote?.content ?? '',
          remoteMtime: remote?.mtime ?? new Date().toISOString(),
          device: remote?.device ?? '其他设备'
        })
        return false
      }
      if (!opts.silent) st.toast({ kind: 'error', text: '保存失败：' + ((e as Error)?.message || '未知错误') })
      return false
    }
  })().finally(() => saving.delete(path))

  saving.set(path, task)
  return task
}

const isCanvasLike = (name: string) => /\.(canvas|png|jpg|jpeg|gif|svg|webp|pdf)$/i.test(name)

export function isDirty(path: string) {
  return !!docs.get(path)?.dirty
}

/** Save every dirty open document (tab switch / window blur). */
export async function saveAllDirty(naming = false) {
  for (const d of Array.from(docs.values())) {
    if (d.dirty && !d.loading) await saveDoc(d.path, { naming, silent: true })
  }
}

export async function saveActiveTab(naming = false): Promise<boolean> {
  const st = useStore.getState()
  const tab = st.tabs.find((t) => t.id === st.activeTabId)
  if (!tab) return false
  if (tab.path === '__welcome__') return false
  return saveDoc(tab.path, { naming })
}

/* ------------------------------------------------------------ open / close */
export interface OpenOptions {
  name?: string
  preview?: boolean
  group?: 'main' | 'side'
  viewMode?: 'wysiwyg' | 'source' | 'split' | 'preview'
}

export function openFile(path: string, opts: OpenOptions = {}) {
  const st = useStore.getState()
  const existing = st.tabs.find((t) => t.path === path && t.group === (opts.group || 'main'))
  if (existing && !opts.preview) {
    st.setActiveTab(existing.id)
    ensureDoc(path)
    return existing.id
  }
  const name = opts.name || nameOf(path)
  ensureDoc(path)
  st.openTab(path, { name, preview: opts.preview, group: opts.group, viewMode: opts.viewMode })
  const after = useStore.getState()
  const tab = after.tabs.find((t) => t.path === path && t.group === (opts.group || 'main'))
  if (tab) {
    const entry = docs.get(path)
    if (entry) after.updateTab(tab.id, { dirty: entry.dirty })
    if (opts.group === 'side') after.setSplitTab(tab.id)
  }
  return tab?.id || null
}

export function closeFile(path: string) {
  const st = useStore.getState()
  if (docs.get(path)?.dirty) void saveDoc(path, { naming: false, silent: true })
  const stillOpen = st.tabs.some((t) => t.path === path)
  if (!stillOpen) docs.delete(path)
  emit()
}

/* ------------------------------------------------------------ conflict helpers */
export async function resolveConflictKeepLocal(): Promise<boolean> {
  const c = useStore.getState().conflict
  if (!c) return false
  const ok = await saveDoc(c.path, { force: true, naming: false, silent: true })
  if (ok) {
    useStore.getState().setConflict(null)
    useStore.getState().toast({ kind: 'ok', text: '已用本地内容覆盖远端' })
  }
  return ok
}

export function resolveConflictKeepRemote() {
  const st = useStore.getState()
  const c = st.conflict
  if (!c) return
  applyDocContent(c.path, c.remoteContent, { mtime: c.remoteMtime, dirty: false })
  st.setConflict(null)
  st.toast({ kind: 'ok', text: '已载入远端版本' })
}

export async function resolveConflictSaveCopy(): Promise<string | null> {
  const st = useStore.getState()
  const c = st.conflict
  if (!c) return null
  const vault = currentVault()
  const dir = parentOf(c.path)
  const created = await fileService.create(vault, dir, '冲突副本')
  const res = await fileService.write(vault, created.path, c.localContent, { naming: 'keep' })
  applyDocContent(c.path, c.remoteContent, { mtime: c.remoteMtime, dirty: false })
  st.setConflict(null)
  st.toast({ kind: 'ok', text: '本地内容已另存为「' + nameOf(res.path) + '」' })
  return res.path
}

/* ------------------------------------------------------------ misc */
export function refreshDocStats(path: string) {
  const st = useStore.getState()
  if (st.tabs.find((t) => t.id === st.activeTabId)?.path !== path) return
  const entry = docs.get(path)
  if (entry) st.setStats(computeStats(entry.content))
}

export function getActiveDoc(): DocEntry | null {
  const st = useStore.getState()
  const tab = st.tabs.find((t) => t.id === st.activeTabId)
  return tab ? docs.get(tab.path) || null : null
}
