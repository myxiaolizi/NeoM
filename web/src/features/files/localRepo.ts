/**
 * Local-first repository for the offline / logged-out editor mode.
 *
 * Metadata index lives in localStorage, document bodies are stored in
 * localStorage while small and fall back to IndexedDB for larger payloads.
 * All calls are async so the upper layers can treat it exactly like the cloud
 * vault (`lib/fs.ts`).
 */
import type { FileNode } from '@/lib/contracts'
import { copyName, sanitizeName, simpleHash, timestampName } from '@/lib/fs'
import { extOf, nameOf, parentOf } from './fileUtils'

const VAULT = 'local-web'
const IDX_KEY = 'neom.local.files'
const VER_KEY = 'neom.local.versions'
const docKey = (p: string) => 'neom.local.doc:' + p
const LS_LIMIT = 180_000 // store bodies <= this in localStorage, else IndexedDB

/* ------------------------------------------------------------------ idb */
const DB_NAME = 'neom-local'
const STORE = 'kv'
let dbPromise: Promise<IDBDatabase | null> | null = null

const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

const idbRequest = <T>(req: IDBRequest<T>): Promise<T | null> =>
  new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => resolve(null)
  })

const idbGet = async (key: string): Promise<string | null> => {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(STORE, 'readonly')
    return await idbRequest(tx.objectStore(STORE).get(key))
  } catch {
    return null
  }
}

const idbSet = async (key: string, value: string): Promise<boolean> => {
  const db = await openDb()
  if (!db) return false
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    return true
  } catch {
    return false
  }
}

const idbDel = async (key: string): Promise<void> => {
  const db = await openDb()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
  } catch {
    /* noop */
  }
}

/* ------------------------------------------------------------------ index */
const readIndex = (): FileNode[] => {
  try {
    const raw = localStorage.getItem(IDX_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as FileNode[]) : []
  } catch {
    return []
  }
}

const writeIndex = (files: FileNode[]) => {
  try {
    localStorage.setItem(IDX_KEY, JSON.stringify(files))
  } catch {
    /* quota — ignore, bodies already degrade to IndexedDB */
  }
}

const now = () => new Date().toISOString()

const makeNode = (path: string, isDir: boolean, content = ''): FileNode => ({
  id: path,
  vault_id: VAULT,
  name: nameOf(path),
  path,
  is_dir: isDir,
  parent: parentOf(path),
  size: isDir ? 0 : new Blob([content]).size,
  mtime: now(),
  ctime: now(),
  ext: isDir ? 'other' : extOf(nameOf(path))
})

const uniquePath = (files: FileNode[], dir: string, name: string): string => {
  const taken = new Set(files.map((f) => f.path))
  let candidate = dir ? `${dir}/${name}` : name
  if (!taken.has(candidate)) return candidate
  const ext = /\.\w+$/.exec(name)?.[0] || ''
  const stem = ext ? name.slice(0, -ext.length) : name
  let i = 2
  while (taken.has(candidate)) {
    candidate = dir ? `${dir}/${stem}-${i}${ext}` : `${stem}-${i}${ext}`
    i += 1
  }
  return candidate
}

const ensureDirNodes = (files: FileNode[], dir: string): FileNode[] => {
  if (!dir) return files
  const out = [...files]
  const parts = dir.split('/')
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('/')
    if (!out.some((f) => f.path === p)) out.push(makeNode(p, true))
  }
  return out
}

/* ------------------------------------------------------------------ bodies */
export const getContent = async (path: string): Promise<string | null> => {
  const ls = localStorage.getItem(docKey(path))
  if (ls !== null) return ls
  return idbGet(docKey(path))
}

export const putContent = async (path: string, content: string): Promise<void> => {
  if (content.length <= LS_LIMIT) {
    try {
      localStorage.setItem(docKey(path), content)
      await idbDel(docKey(path))
      return
    } catch {
      /* fall through to IDB */
    }
  }
  localStorage.removeItem(docKey(path))
  await idbSet(docKey(path), content)
}

const dropContent = async (path: string) => {
  localStorage.removeItem(docKey(path))
  await idbDel(docKey(path))
}

/* ------------------------------------------------------------------ versions */
export interface LocalVersionMeta {
  id: number
  path: string
  version: number
  size: number
  created_at: string
  reason: 'save' | 'auto' | 'restore' | 'snapshot' | 'import'
}

type VersionIndex = Record<string, LocalVersionMeta[]>

const readVersions = (): VersionIndex => {
  try {
    return JSON.parse(localStorage.getItem(VER_KEY) || '{}') as VersionIndex
  } catch {
    return {}
  }
}
const writeVersions = (idx: VersionIndex) => {
  try {
    localStorage.setItem(VER_KEY, JSON.stringify(idx))
  } catch {
    /* ignore */
  }
}

const MAX_VERSIONS = 40

export const pushVersion = async (path: string, content: string, reason: LocalVersionMeta['reason'] = 'save') => {
  const idx = readVersions()
  const list = idx[path] || []
  const id = Date.now() + Math.floor(Math.random() * 1000)
  const version = (list[0]?.version || 0) + 1
  await idbSet(`ver:${id}`, content)
  list.unshift({ id, path, version, size: new Blob([content]).size, created_at: now(), reason })
  idx[path] = list.slice(0, MAX_VERSIONS)
  writeVersions(idx)
}

/* ------------------------------------------------------------------ api */
export const localRepo = {
  vault: VAULT,
  getContent,
  putContent,

  async list(): Promise<FileNode[]> {
    return readIndex()
  },

  async read(path: string) {
    const files = readIndex()
    const node = files.find((f) => f.path === path)
    if (!node) throw new Error('文件不存在：' + path)
    const content = (await getContent(path)) ?? ''
    return {
      path,
      name: node.name,
      content,
      etag: simpleHash(content),
      mtime: node.mtime,
      version: 1,
      absPath: undefined as string | undefined
    }
  },

  async write(path: string, content: string, opts: { snapshot?: boolean } = {}) {
    let files = readIndex()
    files = ensureDirNodes(files, parentOf(path))
    const existing = files.find((f) => f.path === path)
    if (opts.snapshot && existing) {
      const old = await getContent(path)
      if (old != null && old !== content) await pushVersion(path, old, 'save')
    }
    await putContent(path, content)
    const size = new Blob([content]).size
    if (existing) {
      files = files.map((f) =>
        f.path === path ? { ...f, size, mtime: now(), ctime: f.ctime || now() } : f
      )
    } else {
      files.push({ ...makeNode(path, false, content), size })
    }
    writeIndex(files)
    return {
      path,
      name: nameOf(path),
      etag: simpleHash(content),
      version: 1,
      mtime: now(),
      renamed: false
    }
  },

  async create(dir = '', title = '') {
    const files = readIndex()
    const name = timestampName(title || '未命名')
    const path = uniquePath(ensureDirNodes(files, dir), dir, name)
    await putContent(path, title ? `# ${title}\n\n` : '')
    const next = ensureDirNodes(files, dir)
    next.push(makeNode(path, false, title || ''))
    writeIndex(next)
    return { path, name: nameOf(path) }
  },

  async mkdir(parent: string, name: string) {
    const files = readIndex()
    const path = uniquePath(files, parent, sanitizeName(name) || '新建文件夹')
    const next = ensureDirNodes(files, parent)
    next.push(makeNode(path, true))
    writeIndex(next)
    return { path }
  },

  async rename(from: string, to: string) {
    const files = readIndex()
    const target = sanitizeName(to)
    if (!target) throw new Error('名称不能为空')
    const nextPath = parentOf(from) ? `${parentOf(from)}/${target}` : target
    if (files.some((f) => f.path === nextPath)) throw new Error('已存在同名文件')
    const isDir = files.find((f) => f.path === from)?.is_dir
    const content = isDir ? null : await getContent(from)
    const filesNext = files.map((f) => {
      if (f.path === from) {
        return { ...f, id: nextPath, path: nextPath, name: nameOf(nextPath), parent: parentOf(nextPath), ext: extOf(nameOf(nextPath)), mtime: now() }
      }
      if (isDir && f.path.startsWith(from + '/')) {
        const np = nextPath + f.path.slice(from.length)
        return { ...f, id: np, path: np, parent: parentOf(np), mtime: now() }
      }
      return f
    })
    writeIndex(filesNext)
    if (content != null) {
      await putContent(nextPath, content)
      await dropContent(from)
    }
    return { path: nextPath }
  },

  async move(from: string, to: string) {
    const files = readIndex()
    const target = parentOf(from) === '' ? to : `${parentOf(from)}/${to}`
    const node = files.find((f) => f.path === from)
    if (!node) throw new Error('文件不存在')
    const isDir = node.is_dir
    if (files.some((f) => f.path === target)) throw new Error('目标位置已存在同名项')
    const content = isDir ? null : await getContent(from)
    const filesNext = files.map((f) => {
      if (f.path === from) {
        return { ...f, id: target, path: target, name: nameOf(target), parent: parentOf(target), mtime: now() }
      }
      if (isDir && f.path.startsWith(from + '/')) {
        const np = target + f.path.slice(from.length)
        return { ...f, id: np, path: np, parent: parentOf(np), mtime: now() }
      }
      return f
    })
    writeIndex(filesNext)
    if (content != null) {
      await putContent(target, content)
      await dropContent(from)
    }
    return { path: target }
  },

  async copy(from: string, to?: string) {
    const files = readIndex()
    const content = (await getContent(from)) ?? ''
    const target = to || copyName(from)
    const finalPath = uniquePath(files, '', target)
    await putContent(finalPath, content)
    writeIndex([...files, makeNode(finalPath, false, content)])
    return { path: finalPath }
  },

  async remove(path: string) {
    const files = readIndex()
    const victims = files.filter((f) => f.path === path || f.path.startsWith(path + '/'))
    for (const v of victims) if (!v.is_dir) await dropContent(v.path)
    writeIndex(files.filter((f) => !victims.includes(f)))
    return { ok: true }
  },

  async search(q: string, scope: 'all' | 'name' | 'content' | 'tag' = 'all') {
    const needle = q.trim()
    if (!needle) return { hits: [] as { path: string; name: string; matches: { line: number; text: string }[] }[] }
    const files = readIndex().filter((f) => !f.is_dir)
    const lower = needle.toLowerCase()
    const hits: { path: string; name: string; matches: { line: number; text: string }[] }[] = []
    for (const f of files) {
      const matches: { line: number; text: string }[] = []
      if (scope === 'all' || scope === 'name') {
        if (f.name.toLowerCase().includes(lower)) matches.push({ line: 0, text: f.name })
      }
      if (scope === 'all' || scope === 'content' || scope === 'tag') {
        if (!matches.length) {
          const content = (await getContent(f.path)) ?? ''
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length && matches.length < 12; i++) {
            if (lines[i].toLowerCase().includes(lower) && (scope !== 'tag' || /#[\w-]+/.test(lines[i]))) {
              matches.push({ line: i + 1, text: lines[i].slice(0, 240) })
            }
          }
        }
      }
      if (matches.length) hits.push({ path: f.path, name: f.name, matches: matches.slice(0, 12) })
      if (hits.length >= 120) break
    }
    return { hits }
  },

  async recent(limit = 8) {
    return readIndex()
      .filter((f) => !f.is_dir)
      .sort((a, b) => (Date.parse(b.mtime) || 0) - (Date.parse(a.mtime) || 0))
      .slice(0, limit)
      .map((f) => ({ name: f.name, path: f.path, isDir: false, size: f.size, mtime: f.mtime, ctime: f.ctime, parent: f.parent }))
  },

  async persistSort(orders: { path: string; order: number }[]) {
    const byPath = new Map(orders.map((o) => [o.path, o.order]))
    const files = readIndex().map((f) => (byPath.has(f.path) ? { ...f, order: byPath.get(f.path) } : f))
    writeIndex(files)
    return { ok: true }
  },

  async sync() {
    return { pulled: 0, pushed: 0, conflicts: 0 }
  },

  async listVersions(path: string): Promise<LocalVersionMeta[]> {
    return readVersions()[path] || []
  },

  async readVersion(id: number): Promise<{ content: string }> {
    const content = await idbGet(`ver:${id}`)
    return { content: content ?? '' }
  },

  async restoreVersion(path: string, id: number) {
    const { content } = await localRepo.readVersion(id)
    await localRepo.write(path, content)
    await pushVersion(path, content, 'restore')
    return { ok: true }
  },

  async snapshot(path: string, content: string, reason: LocalVersionMeta['reason'] = 'snapshot') {
    await pushVersion(path, content, reason)
    return { ok: true }
  },

  /** Seed a couple of files so the first-run experience is not an empty void. */
  async seed() {
    if (readIndex().length) return
    const welcome = [
      '# 欢迎',
      '',
      '在这里写下第一条笔记。',
      '',
      '## 快捷操作',
      '',
      '- `Ctrl+N` 新建文档',
      '- `Ctrl+P` 命令面板',
      '- `Ctrl+S` 立即保存',
      '- `Ctrl+Shift+F` 全文搜索',
      '',
      '> 未登录时文档保存在本地，登录后自动使用云端仓库。',
      ''
    ].join('\n')
    const { path } = await this.create('', '欢迎')
    await this.write(path, welcome)
    await pushVersion(path, welcome, 'snapshot')
  },

  clearAll() {
    localStorage.removeItem(IDX_KEY)
    localStorage.removeItem(VER_KEY)
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('neom.local.doc:')) localStorage.removeItem(k)
    }
  }
}

export default localRepo
