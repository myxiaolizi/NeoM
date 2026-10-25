/**
 * File tree helpers shared by the sidebar, quick switcher and status bar.
 */
import type { FileNode, SortDir, SortKey } from '@/lib/contracts'

export const nameOf = (p: string) => p.split('/').pop() || p
export const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')
export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
export const depthOf = (p: string) => p.split('/').length - 1

export const isMarkdown = (name: string) => /\.(md|mdx|markdown|txt)$/i.test(name)

export const extOf = (name: string): FileNode['ext'] => {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  const ext = (m?.[1] || '').toLowerCase()
  if (ext === 'md') return 'md'
  if (ext === 'mdx') return 'mdx'
  if (ext === 'canvas') return 'canvas'
  if (ext === 'txt') return 'txt'
  if (ext === 'html' || ext === 'htm') return 'html'
  return 'other'
}

export interface TreeNode {
  node: FileNode
  children: TreeNode[]
  depth: number
}

/** Flat FileNode[] -> nested tree (root nodes first). */
export function buildTree(files: FileNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const f of files) map.set(f.path, { node: f, children: [], depth: depthOf(f.path) })
  const roots: TreeNode[] = []
  for (const f of files) {
    const item = map.get(f.path)!
    const parent = f.parent && map.get(f.parent)
    if (parent && parent.node.is_dir) parent.children.push(item)
    else if (!f.parent || !parent) roots.push(item)
  }
  return roots
}

const mtime = (f: FileNode) => {
  const t = Date.parse(f.mtime || f.ctime || '')
  return Number.isNaN(t) ? 0 : t
}
const ctime = (f: FileNode) => {
  const t = Date.parse(f.ctime || f.mtime || '')
  return Number.isNaN(t) ? 0 : t
}

export function sortNodes<T extends { node: FileNode } | FileNode>(list: T[], key: SortKey, dir: SortDir): T[] {
  const get = (x: T): FileNode => ('node' in x ? (x as { node: FileNode }).node : (x as FileNode))
  const sign = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const fa = get(a)
    const fb = get(b)
    if (fa.is_dir !== fb.is_dir) return fa.is_dir ? -1 : 1
    if (key === 'name') return fa.name.localeCompare(fb.name, 'zh-Hans-CN') * sign
    if (key === 'ctime') return (ctime(fa) - ctime(fb)) * sign
    return (mtime(fa) - mtime(fb)) * sign
  })
}

export function flattenTree(nodes: TreeNode[]): FileNode[] {
  const out: FileNode[] = []
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n.node)
      if (n.children.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Collect ancestor folder paths so a file becomes visible in a collapsed tree. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

export const formatBytes = (n: number) => {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export const formatTime = (iso: string) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = new Date(t)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const relativeTime = (iso: string) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  return formatTime(iso).slice(0, 10)
}
