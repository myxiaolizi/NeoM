/**
 * File service facade. Routes every file operation either to the cloud vault
 * (`lib/fs.ts` → `/api/files/*`) or to the local-first repository used when
 * the user is not signed in / the network is down.
 */
import { API, type FileNode } from '@/lib/contracts'
import { api, ApiError } from '@/lib/api'
import { fs } from '@/lib/fs'
import { localRepo } from './localRepo'
import { useStore } from '@/store'
import { extOf, nameOf, parentOf } from './fileUtils'

export const LOCAL_VAULT = 'local-web'
export const isLocalVault = (vault: string) => vault === LOCAL_VAULT

const TREE_CACHE = (vault: string) => `neom.cache.tree:${vault}`
const DOC_CACHE = (vault: string, path: string) => `neom.cache.doc:${vault}:${path}`

/**
 * FileNode (contracts) has no absolute-path field, but the desktop status bar
 * and "reveal in folder" need one. Keep it in a side channel keyed by path.
 */
const absPaths = new Map<string, string>()
export const rememberAbsPath = (path: string, abs: string | undefined) => {
  if (abs) absPaths.set(path, abs)
}
export const absPathOf = (path: string): string | undefined => absPaths.get(path)

export const currentVault = () => useStore.getState().activeVault || 'cloud'

const toNode = (vault: string, e: {
  name: string
  path: string
  isDir?: boolean
  is_dir?: boolean
  size?: number
  mtime?: string
  ctime?: string
  order?: number
  parent?: string
}): FileNode => {
  const isDir = !!(e.isDir ?? e.is_dir)
  const parent = e.parent ?? parentOf(e.path)
  return {
    id: e.path,
    vault_id: vault,
    name: e.name || nameOf(e.path),
    path: e.path,
    is_dir: isDir,
    parent,
    size: e.size || 0,
    mtime: e.mtime || new Date().toISOString(),
    ctime: e.ctime || e.mtime || new Date().toISOString(),
    order: e.order,
    ext: isDir ? 'other' : extOf(e.name || e.path)
  }
}

const cacheTree = (vault: string, files: FileNode[]) => {
  try {
    localStorage.setItem(TREE_CACHE(vault), JSON.stringify(files))
  } catch {
    /* ignore quota */
  }
}
const readCachedTree = (vault: string): FileNode[] => {
  try {
    return JSON.parse(localStorage.getItem(TREE_CACHE(vault)) || '[]') as FileNode[]
  } catch {
    return []
  }
}

export interface WriteResult {
  path: string
  name: string
  etag: string
  version: number
  mtime: string
  renamed: boolean
  offline?: boolean
}

export const fileService = {
  isLocal: isLocalVault,

  /* ------------------------------------------------------------ read side */
  async list(vault = currentVault()): Promise<FileNode[]> {
    if (isLocalVault(vault)) {
      const nodes = await localRepo.list()
      return nodes
    }
    try {
      const rows = await fs.list(vault)
      for (const e of rows) rememberAbsPath(e.path, (e as { absPath?: string }).absPath)
      const nodes = rows.map((e) => toNode(vault, e))
      cacheTree(vault, nodes)
      return nodes
    } catch {
      return readCachedTree(vault)
    }
  },

  async read(vault: string, path: string) {
    if (isLocalVault(vault)) return localRepo.read(path)
    try {
      const doc = await fs.read(vault, path)
      rememberAbsPath(path, doc.absPath)
      try {
        localStorage.setItem(DOC_CACHE(vault, path), doc.content)
      } catch {
        /* ignore */
      }
      return doc
    } catch (e) {
      const cached =
        localStorage.getItem(DOC_CACHE(vault, path)) ?? (await localRepo.getContent(path))
      if (cached != null) {
        return {
          path,
          name: nameOf(path),
          content: cached,
          etag: '',
          mtime: new Date().toISOString(),
          version: 1,
          absPath: undefined as string | undefined,
          offline: true
        }
      }
      throw e
    }
  },

  /* ------------------------------------------------------------ write side */
  async write(
    vault: string,
    path: string,
    content: string,
    opts: { baseEtag?: string; naming?: 'keep' | 'ai' | 'template'; title?: string } = {}
  ): Promise<WriteResult> {
    if (isLocalVault(vault)) return localRepo.write(path, content, { snapshot: true })
    try {
      const res = await fs.write(vault, path, content, opts)
      try {
        localStorage.setItem(DOC_CACHE(vault, path), content)
      } catch {
        /* ignore */
      }
      return { ...res, renamed: !!res.renamed }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') throw e
      // network failure: keep the body locally so nothing is lost
      await localRepo.putContent(path, content)
      try {
        localStorage.setItem(DOC_CACHE(vault, path), content)
      } catch {
        /* ignore */
      }
      return {
        path,
        name: nameOf(path),
        etag: (await import('@/lib/fs')).simpleHash(content),
        version: 1,
        mtime: new Date().toISOString(),
        renamed: false,
        offline: true
      }
    }
  },

  async create(vault: string, dir = '', title = '') {
    if (isLocalVault(vault)) return localRepo.create(dir, title)
    return fs.create(vault, dir, title)
  },

  async mkdir(vault: string, parent: string, name: string) {
    if (isLocalVault(vault)) return localRepo.mkdir(parent, name)
    return fs.mkdir(vault, parent, name)
  },

  async rename(vault: string, from: string, to: string) {
    if (isLocalVault(vault)) return localRepo.rename(from, to)
    return fs.rename(vault, from, to)
  },

  async move(vault: string, from: string, to: string) {
    if (isLocalVault(vault)) return localRepo.move(from, to)
    return fs.move(vault, from, to)
  },

  async copy(vault: string, from: string, to?: string) {
    if (isLocalVault(vault)) return localRepo.copy(from, to)
    return fs.copy(vault, from, to)
  },

  async remove(vault: string, path: string) {
    if (isLocalVault(vault)) return localRepo.remove(path)
    return fs.remove(vault, path)
  },

  async persistSort(vault: string, orders: { path: string; order: number }[]) {
    if (isLocalVault(vault)) return localRepo.persistSort(orders)
    return fs.persistSort(vault, orders)
  },

  async sync(vault: string) {
    if (isLocalVault(vault)) return localRepo.sync()
    return fs.sync(vault)
  },

  /* ------------------------------------------------------------ search */
  async search(vault: string, q: string, scope: 'all' | 'name' | 'content' | 'tag' = 'all') {
    if (isLocalVault(vault)) return localRepo.search(q, scope)
    try {
      return await fs.search(vault, q, scope)
    } catch {
      return localSearch(q, scope)
    }
  },

  async recent(vault: string, limit = 8) {
    if (isLocalVault(vault)) return localRepo.recent(limit)
    try {
      return await fs.recent(vault, limit)
    } catch {
      return useStore
        .getState()
        .files.filter((f) => !f.is_dir)
        .sort((a, b) => (Date.parse(b.mtime) || 0) - (Date.parse(a.mtime) || 0))
        .slice(0, limit)
        .map((f) => ({ name: f.name, path: f.path, isDir: false, size: f.size, mtime: f.mtime, ctime: f.ctime, parent: f.parent }))
    }
  },

  /* ------------------------------------------------------------ versions */
  async listVersions(vault: string, path: string) {
    if (isLocalVault(vault)) {
      const list = await localRepo.listVersions(path)
      return list.map((v) => ({
        id: v.id,
        doc_id: path,
        path,
        version: v.version,
        size: v.size,
        created_at: v.created_at,
        reason: v.reason,
        device: '本地'
      }))
    }
    return api.get<{
      id: number
      doc_id: string
      path: string
      version: number
      size: number
      created_at: string
      reason: 'save' | 'auto' | 'restore' | 'snapshot' | 'import'
      device?: string
    }[]>(`${API.versionsList}?path=${encodeURIComponent(path)}&vault=${encodeURIComponent(vault)}&limit=50`)
  },

  async readVersion(vault: string, id: number): Promise<{ content: string }> {
    if (isLocalVault(vault)) return localRepo.readVersion(id)
    return api.get<{ content: string }>(`${API.versionsRead}?id=${id}`)
  },

  async restoreVersion(vault: string, path: string, id: number) {
    if (isLocalVault(vault)) return localRepo.restoreVersion(path, id)
    return api.post(API.versionsRestore, { id, vault })
  },

  async snapshot(vault: string, path: string, content: string, reason = 'snapshot') {
    if (isLocalVault(vault)) return localRepo.snapshot(path, content, reason as 'snapshot')
    return api.post(API.versionsSnapshot, { path, content, reason })
  }
}

/* ------------------------------------------------------------- local search */
export function localSearch(q: string, scope: 'all' | 'name' | 'content' | 'tag' = 'all') {
  const needle = q.trim().toLowerCase()
  const hits: { path: string; name: string; matches: { line: number; text: string }[] }[] = []
  if (!needle) return { hits }
  const files = useStore.getState().files.filter((f) => !f.is_dir)
  for (const f of files) {
    const matches: { line: number; text: string }[] = []
    if ((scope === 'all' || scope === 'name') && f.name.toLowerCase().includes(needle)) {
      matches.push({ line: 0, text: f.name })
    }
    if (scope === 'all' || scope === 'content' || scope === 'tag') {
      const cached = localStorage.getItem(DOC_CACHE(useStore.getState().activeVault, f.path))
      if (cached) {
        const lines = cached.split(/\r?\n/)
        for (let i = 0; i < lines.length && matches.length < 12; i++) {
          if (lines[i].toLowerCase().includes(needle)) matches.push({ line: i + 1, text: lines[i].slice(0, 240) })
        }
      }
    }
    if (matches.length) hits.push({ path: f.path, name: f.name, matches })
    if (hits.length >= 100) break
  }
  return { hits }
}

/* --------------------------------------------------------- tree refreshing */
let loadingPromise: Promise<FileNode[]> | null = null

export async function reloadFileTree(force = false): Promise<FileNode[]> {
  const st = useStore.getState()
  if (loadingPromise && !force) return loadingPromise
  loadingPromise = (async () => {
    try {
      const nodes = await fileService.list(st.activeVault)
      useStore.getState().setFiles(nodes)
      window.dispatchEvent(new CustomEvent('neom:file-tree-changed'))
      return nodes
    } catch {
      return useStore.getState().files
    } finally {
      loadingPromise = null
    }
  })()
  return loadingPromise
}

export default fileService
