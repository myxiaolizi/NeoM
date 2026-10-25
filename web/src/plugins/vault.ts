/**
 * Whole-vault index used by tag-list / backlinks / graph / database /
 * properties / daily-notes. Reads every doc once, parses it once, and keeps
 * the result in memory with a TTL + invalidate() hook so the big panels never
 * re-scan on every keystroke.
 */
import type { PluginContext } from './types'
import { EVT } from '@/lib/contracts'
import {
  extractHeadings,
  extractLinks,
  extractTags,
  isDoc,
  parseFrontmatter,
  stemOf,
  type DocLink,
  type Heading
} from './utils'

export interface ScanDoc {
  path: string
  name: string
  stem: string
  dir: string
  content: string
  mtime: string
  size: number
  tags: string[]
  links: DocLink[]
  headings: Heading[]
  frontmatter: Record<string, unknown>
  hasFrontmatter: boolean
}

const TTL = 15_000
const CONCURRENCY = 6

let cache: ScanDoc[] | null = null
let cachedAt = 0
let inflight: Promise<ScanDoc[]> | null = null
const listeners = new Set<(docs: ScanDoc[] | null) => void>()

export const subscribeVault = (fn: (docs: ScanDoc[] | null) => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const invalidateVault = () => {
  cache = null
  cachedAt = 0
  inflight = null
  listeners.forEach((l) => { try { l(null) } catch { /* ignore */ } })
}

/* global listeners: any file mutation elsewhere (shell) resets the cache */
if (typeof window !== 'undefined') {
  const reset = () => invalidateVault()
  window.addEventListener(EVT.docSaved, reset)
  window.addEventListener(EVT.fileTreeChanged, reset)
}

const toContent = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof (v as { content?: unknown }).content === 'string') {
    return (v as { content: string }).content
  }
  return ''
}

/** Read one doc through the plugin vault bridge, normalising the envelope. */
export const readDoc = async (ctx: PluginContext, path: string): Promise<{ content: string; mtime: string }> => {
  const raw = await ctx.vault.read(path)
  const content = toContent(raw)
  const mtime = (raw && (raw.mtime || raw.modified)) || ''
  return { content, mtime: String(mtime || '') }
}

export const writeDoc = async (ctx: PluginContext, path: string, content: string) => {
  const res = await ctx.vault.write(path, content)
  invalidateVault()
  return res
}

const parseDoc = (item: any, content: string): ScanDoc => {
  const path: string = item?.path || item?.id || ''
  const fm = parseFrontmatter(content)
  return {
    path,
    name: item?.name || path.split('/').pop() || path,
    stem: stemOf(path),
    dir: path.split('/').slice(0, -1).join('/'),
    content,
    mtime: String(item?.mtime || ''),
    size: content.length,
    tags: extractTags(content),
    links: extractLinks(content),
    headings: extractHeadings(content),
    frontmatter: fm.data,
    hasFrontmatter: fm.has
  }
}

/** Scan the whole vault (cached). `force` ignores the TTL. */
export const scanVault = async (ctx: PluginContext, opts: { force?: boolean; onProgress?: (n: number, total: number) => void } = {}): Promise<ScanDoc[]> => {
  if (!opts.force && cache && Date.now() - cachedAt < TTL) return cache
  if (inflight && !opts.force) return inflight
  const boot = async (): Promise<ScanDoc[]> => {
    const tree = (await ctx.vault.list()) || []
    const files = (Array.isArray(tree) ? tree : []).filter((f: any) => {
      if (!f) return false
      if (f.is_dir || f.isDir) return false
      const p = f.path || f.id || ''
      return isDoc(p)
    })
    const out: ScanDoc[] = new Array(files.length)
    let cursor = 0
    let done = 0
    const worker = async () => {
      while (cursor < files.length) {
        const idx = cursor++
        const item = files[idx]
        try {
          const { content } = await readDoc(ctx, item.path || item.id)
          out[idx] = parseDoc(item, content)
        } catch {
          out[idx] = parseDoc(item, '')
        }
        done++
        opts.onProgress?.(done, files.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length || 1) }, worker))
    const docs = out.filter(Boolean)
    docs.sort((a, b) => a.path.localeCompare(b.path))
    cache = docs
    cachedAt = Date.now()
    listeners.forEach((l) => { try { l(docs) } catch { /* ignore */ } })
    return docs
  }
  inflight = boot().finally(() => { inflight = null })
  return inflight
}

export const getCachedVault = (): ScanDoc[] => cache || []

/** Resolve a `[[link]]` target to a scanned doc (by path, then by stem). */
export const resolveLink = (docs: ScanDoc[], target: string): ScanDoc | undefined => {
  const t = target.split('#')[0].split('|')[0].trim().replace(/^\/+/, '').replace(/\.(md|mdx|txt)$/i, '')
  if (!t) return undefined
  const lower = t.toLowerCase()
  return (
    docs.find((d) => d.path.replace(/\.(md|mdx|txt|canvas)$/i, '').toLowerCase() === lower) ||
    docs.find((d) => d.stem.toLowerCase() === lower) ||
    docs.find((d) => d.stem.toLowerCase().endsWith('/' + lower.split('/').pop()!)) ||
    docs.find((d) => d.path.toLowerCase().includes(lower))
  )
}

/** Every doc that references `target` (path or stem). */
export const backlinkDocs = (docs: ScanDoc[], targetPath: string) => {
  const target = docs.find((d) => d.path === targetPath)
  const stems = new Set<string>()
  if (target) { stems.add(target.stem.toLowerCase()); stems.add(targetPath.replace(/\.(md|mdx|txt)$/i, '').toLowerCase()) }
  const base = (targetPath.split('/').pop() || '').replace(/\.(md|mdx|txt)$/i, '').toLowerCase()
  if (base) stems.add(base)
  const res: { doc: ScanDoc; contexts: { line: number; text: string }[] }[] = []
  for (const d of docs) {
    if (d.path === targetPath) continue
    const hits = d.links.filter((l) => l.kind === 'wiki' && stems.has(linkStemLower(l.target)))
    if (!hits.length) continue
    const content = d.content
    const ctxs = hits.slice(0, 6).map((h) => {
      const start = content.lastIndexOf('\n', h.offset) + 1
      const end = content.indexOf('\n', h.offset)
      return { line: lineNumberAt(content, h.offset), text: content.slice(start, end < 0 ? content.length : end) }
    })
    res.push({ doc: d, contexts: ctxs })
  }
  return res
}

const lineNumberAt = (text: string, offset: number) => {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

const linkStemLower = (t: string) => {
  const b = t.split('#')[0].split('|')[0].trim().replace(/^\/+/, '').split('/').pop() || ''
  return b.replace(/\.(md|mdx|txt)$/i, '').toLowerCase()
}

/** Tag tree with counts: `a/b/c` becomes nested nodes. */
export interface TagNode {
  name: string
  full: string
  count: number
  docs: string[]
  children: TagNode[]
}

export const buildTagTree = (docs: ScanDoc[]): TagNode[] => {
  const root: TagNode = { name: '', full: '', count: 0, docs: [], children: [] }
  const map = new Map<string, TagNode>()
  for (const d of docs) {
    for (const tag of d.tags) {
      const parts = tag.split('/')
      let prefix = ''
      let parent = root
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part
        let node = map.get(prefix.toLowerCase())
        if (!node) {
          node = { name: part, full: prefix, count: 0, docs: [], children: [] }
          map.set(prefix.toLowerCase(), node)
          parent.children.push(node)
        }
        if (!node.docs.includes(d.path)) node.docs.push(d.path)
        node.count = node.docs.length
        parent = node
      }
    }
  }
  const sortRec = (n: TagNode) => {
    n.children.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    n.children.forEach(sortRec)
  }
  root.children.forEach(sortRec)
  return root.children
}

/** Flatten every frontmatter key with counts for the properties panel. */
export const collectPropertyStats = (docs: ScanDoc[]) => {
  const map = new Map<string, { key: string; count: number; types: Set<string>; samples: unknown[] }>()
  for (const d of docs) {
    for (const [k, v] of Object.entries(d.frontmatter)) {
      let row = map.get(k)
      if (!row) { row = { key: k, count: 0, types: new Set(), samples: [] }; map.set(k, row) }
      row.count++
      row.types.add(Array.isArray(v) ? 'list' : typeof v)
      if (row.samples.length < 3) row.samples.push(v)
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).map((r) => ({
    key: r.key,
    count: r.count,
    types: Array.from(r.types) as string[],
    samples: r.samples
  }))
}

export const docsInFolder = (docs: ScanDoc[], folder: string) =>
  !folder ? docs : docs.filter((d) => d.dir === folder || d.dir.startsWith(folder + '/'))

export const docsWithTag = (docs: ScanDoc[], tag: string) => {
  const t = tag.toLowerCase()
  return docs.filter((d) => d.tags.some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(t + '/')))
}
