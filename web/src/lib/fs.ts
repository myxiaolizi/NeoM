/**
 * Client-side file service. Abstracts cloud vault (S3/OSS via API) and
 * local vault (Electron FS bridge). All features go through this module.
 */
import { api } from './api'
import type { ApiOk } from './contracts'
import { local, isDesktop } from './platform'

export interface FsEntry {
  name: string
  path: string          // vault-relative
  isDir: boolean
  size: number
  mtime: string
  ctime: string
  order?: number
  parent: string
  absPath?: string      // desktop local absolute path
}

export type VaultKind = 'cloud' | 'local'

export interface OpenDoc {
  path: string
  name: string
  content: string
  etag: string
  mtime: string
  version: number
  absPath?: string
}

const toISO = (ms: number) => new Date(ms).toISOString()

/* ------------------------------------------------------------------ local */
const localRoots = new Map<string, string>() // vaultId -> abs root

export const setLocalRoot = (vaultId: string, root: string) => localRoots.set(vaultId, root)

async function walkLocal(vaultId: string): Promise<FsEntry[]> {
  const root = localRoots.get(vaultId)
  if (!root || !local) return []
  const out: FsEntry[] = []
  const rec = async (dir: string, rel: string) => {
    const items = await local.readDir(dir)
    for (const it of items) {
      if (it.name.startsWith('.')) continue
      const relPath = rel ? `${rel}/${it.name}` : it.name
      out.push({
        name: it.name,
        path: relPath,
        isDir: it.isDir,
        size: it.isDir ? 0 : it.size,
        mtime: toISO(it.mtime),
        ctime: toISO(it.ctime),
        parent: rel,
        absPath: it.path
      })
      if (it.isDir) await rec(it.path, relPath)
    }
  }
  await rec(root, '')
  return out
}

/* ----------------------------------------------------------------- cloud */
export const fs = {
  async list(vaultId: string): Promise<FsEntry[]> {
    if (isDesktop && vaultId !== 'cloud' && localRoots.has(vaultId)) return walkLocal(vaultId)
    const rows = await api.get<FsEntry[]>(`/api/files/tree?vault=${encodeURIComponent(vaultId)}`)
    return rows
  },

  async read(vaultId: string, path: string): Promise<OpenDoc> {
    if (isDesktop && localRoots.has(vaultId)) {
      const root = localRoots.get(vaultId)!
      const abs = root + '/' + path
      const content = await local!.readFile(abs)
      const st = (await local!.readDir(root)).find((x) => x.path === abs)
      return {
        path,
        name: path.split('/').pop() || path,
        content,
        etag: simpleHash(content),
        mtime: st ? toISO(st.mtime) : new Date().toISOString(),
        version: 1,
        absPath: abs
      }
    }
    return api.get<OpenDoc>(`/api/files/read?path=${encodeURIComponent(path)}&vault=${encodeURIComponent(vaultId)}`)
  },

  async write(
    vaultId: string,
    path: string,
    content: string,
    opts: { baseEtag?: string; naming?: 'keep' | 'ai' | 'template'; title?: string } = {}
  ): Promise<{ path: string; name: string; etag: string; version: number; mtime: string; renamed: boolean }> {
    if (isDesktop && localRoots.has(vaultId)) {
      const root = localRoots.get(vaultId)!
      const abs = root + '/' + path
      await local!.writeFile(abs, content)
      return {
        path,
        name: path.split('/').pop() || path,
        etag: simpleHash(content),
        version: 1,
        mtime: new Date().toISOString(),
        renamed: false
      }
    }
    return api.post(`/api/files/write?vault=${encodeURIComponent(vaultId)}`, {
      path,
      content,
      baseEtag: opts.baseEtag,
      naming: opts.naming || 'keep',
      title: opts.title
    })
  },

  async create(vaultId: string, dir = '', title = ''): Promise<{ path: string; name: string }> {
    if (isDesktop && localRoots.has(vaultId)) {
      const name = timestampName(title)
      const rel = dir ? `${dir}/${name}` : name
      const abs = localRoots.get(vaultId)! + '/' + rel
      await local!.writeFile(abs, '')
      return { path: rel, name }
    }
    return api.post(`/api/files/create?vault=${encodeURIComponent(vaultId)}`, { dir, title })
  },

  async mkdir(vaultId: string, parent: string, name: string): Promise<{ path: string }> {
    if (isDesktop && localRoots.has(vaultId)) {
      const rel = parent ? `${parent}/${name}` : name
      await local!.createDir(localRoots.get(vaultId)! + '/' + rel)
      return { path: rel }
    }
    return api.post(`/api/files/mkdir?vault=${encodeURIComponent(vaultId)}`, { parent, name })
  },

  async rename(vaultId: string, from: string, to: string): Promise<{ path: string }> {
    if (isDesktop && localRoots.has(vaultId)) {
      const root = localRoots.get(vaultId)!
      await local!.rename(root + '/' + from, root + '/' + to)
      return { path: to }
    }
    return api.post(`/api/files/rename?vault=${encodeURIComponent(vaultId)}`, { from, to })
  },

  async move(vaultId: string, from: string, to: string) {
    if (isDesktop && localRoots.has(vaultId)) {
      const root = localRoots.get(vaultId)!
      await local!.move(root + '/' + from, root + '/' + to)
      return { path: to }
    }
    return api.post(`/api/files/move?vault=${encodeURIComponent(vaultId)}`, { from, to })
  },

  async copy(vaultId: string, from: string, to?: string) {
    if (isDesktop && localRoots.has(vaultId)) {
      const root = localRoots.get(vaultId)!
      const content = await local!.readFile(root + '/' + from)
      const target = to || copyName(from)
      await local!.writeFile(root + '/' + target, content)
      return { path: target }
    }
    return api.post(`/api/files/copy?vault=${encodeURIComponent(vaultId)}`, { from, to })
  },

  async remove(vaultId: string, path: string) {
    if (isDesktop && localRoots.has(vaultId)) {
      await local!.deleteFile(localRoots.get(vaultId)! + '/' + path)
      return { ok: true }
    }
    return api.post(`/api/files/delete?vault=${encodeURIComponent(vaultId)}`, { path })
  },

  async search(vaultId: string, q: string, scope: 'all' | 'name' | 'content' | 'tag' = 'all') {
    return api.get<{
      hits: { path: string; name: string; matches: { line: number; text: string }[] }[]
    }>(`/api/files/search?q=${encodeURIComponent(q)}&scope=${scope}&vault=${encodeURIComponent(vaultId)}`)
  },

  async recent(vaultId: string, limit = 8) {
    return api.get<FsEntry[]>(`/api/files/recent?limit=${limit}&vault=${encodeURIComponent(vaultId)}`)
  },

  async persistSort(vaultId: string, orders: { path: string; order: number }[]) {
    return api.post(`/api/files/sort?vault=${encodeURIComponent(vaultId)}`, { orders })
  },

  async sync(vaultId: string) {
    return api.post<{ pulled: number; pushed: number; conflicts: number }>(
      `/api/files/sync?vault=${encodeURIComponent(vaultId)}`,
      {}
    )
  }
}

/* ----------------------------------------------------------------- utils */
export const simpleHash = (s: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Naming mode 2 — YY年MM月DD日HHMM-【title】 */
export const timestampName = (title = '未命名') => {
  const d = new Date()
  const stamp = `${pad(d.getFullYear() % 100)}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日${pad(d.getHours())}${pad(d.getMinutes())}`
  const safe = (title || '未命名').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 40) || '未命名'
  return `${stamp}-【${safe}】.md`
}

export const copyName = (path: string) => {
  const base = path.split('/').pop() || 'file'
  const dot = base.lastIndexOf('.')
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : '.md'
  return path.split('/').slice(0, -1).concat(`${stem}-副本${stamp}${ext}`).join('/').replace(/^\//, '')
}

export const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120)

export const ensureMdExt = (name: string) => (/\.\w+$/.test(name) ? name : name + '.md')

export const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')

export const depthOf = (p: string) => p.split('/').length - 1
