/**
 * Markdown inspection helpers shared by the built-in plugins.
 * Everything here is pure (no DOM, no fetch) so it can be unit tested.
 */

export interface Heading {
  level: number
  text: string
  line: number
  offset: number
  /** offset of the end of the heading block (exclusive) */
  endOffset: number
}

export interface DocLink {
  kind: 'wiki' | 'md'
  /** resolved target text: file stem for wiki links, href for md links */
  target: string
  href: string
  alias?: string
  raw: string
  offset: number
  external: boolean
}

export interface FootnoteRef {
  id: string
  offset: number
  line: number
}

export interface FootnoteDef {
  id: string
  text: string
  offset: number
  line: number
  /** offset right after the definition block (for rewriting) */
  endOffset: number
}

export interface Frontmatter {
  has: boolean
  data: Record<string, unknown>
  body: string
  /** raw yaml chunk including the --- fences */
  raw: string
}

export const baseName = (p: string) => (p || '').split('/').filter(Boolean).pop() || ''
export const stemOf = (p: string) => baseName(p).replace(/\.(md|mdx|txt|canvas|html?|json)$/i, '')
export const extOf = (p: string) => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}
export const isDoc = (p: string) => /\.(md|mdx|txt|canvas)$/i.test(p)
export const isMarkdown = (p: string) => /\.(md|mdx)$/i.test(p)
export const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')
export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/')

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Blank out fenced code blocks and inline code while preserving offsets. */
export const maskCode = (md: string): string => {
  let out = md.replace(/```[\s\S]*?(?:```|$)/g, (m) => m.replace(/[^\n]/g, ' '))
  out = out.replace(/~~~[\s\S]*?(?:~~~|$)/g, (m) => m.replace(/[^\n]/g, ' '))
  out = out.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
  return out
}

export const lineOf = (text: string, offset: number) => {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/* -------------------------------------------------------------- frontmatter */
const YAML_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export const parseFrontmatter = (content: string): Frontmatter => {
  const m = YAML_RE.exec(content || '')
  if (!m) return { has: false, data: {}, body: content || '', raw: '' }
  return { has: true, data: parseYamlLite(m[1]), body: (content || '').slice(m[0].length), raw: m[0] }
}

/** Minimal YAML subset: scalars, quoted strings, numbers, booleans, inline lists. */
export const parseYamlLite = (src: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  const lines = src.split(/\r?\n/)
  let lastKey = ''
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const listItem = /^\s*-\s+(.*)$/.exec(raw)
    if (listItem && lastKey) {
      const cur = out[lastKey]
      const val = coerceScalar(listItem[1])
      if (Array.isArray(cur)) cur.push(val)
      else out[lastKey] = [val]
      continue
    }
    const kv = /^([^:\n]+):\s*(.*)$/.exec(raw)
    if (!kv) continue
    const key = kv[1].trim()
    const rest = kv[2].trim()
    lastKey = key
    if (!rest) { out[key] = []; continue }
    out[key] = coerceScalar(rest)
  }
  // normalise empty arrays that were actually empty strings
  return out
}

export const coerceScalar = (v: string): unknown => {
  const s = v.trim()
  if (!s) return ''
  if (/^\[(.*)\]$/.test(s)) {
    const inner = s.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((x) => coerceScalar(x))
  }
  if (/^"(.*)"$/.test(s) || /^'(.*)'$/.test(s)) return s.slice(1, -1)
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (s === '[]') return []
  return s
}

export const yamlValue = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return `[${v.map((x) => yamlValue(x)).join(', ')}]`
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  const s = String(v)
  if (!s) return '""'
  if (/[:#,\[\]{}"'&*!|>%@`]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s)
  return s
}

export const stringifyFrontmatter = (data: Record<string, unknown>, body: string): string => {
  const keys = Object.keys(data)
  if (!keys.length) return body
  const lines = keys.map((k) => (Array.isArray(data[k]) && !(data[k] as unknown[]).length
    ? `${k}: []`
    : `${k}: ${yamlValue(data[k])}`))
  return `---\n${lines.join('\n')}\n---\n${body.replace(/^\n+/, '')}`
}

/* --------------------------------------------------------------------- tags */
export const TAG_RE = /(?<![\w&#/])#([\w\u4e00-\u9fa5-]+(?:\/[\w\u4e00-\u9fa5-]+)*)/g

export const extractTags = (content: string): string[] => {
  const masked = maskCode(content || '')
  const set = new Set<string>()
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(masked))) {
    const t = m[1].replace(/[-/]+$/, '')
    if (t && !/^\d+$/.test(t)) set.add(t)
  }
  return Array.from(set)
}

/* ----------------------------------------------------------------- headings */
export const extractHeadings = (content: string): Heading[] => {
  const masked = maskCode(content || '')
  const out: Heading[] = []
  const re = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm
  let m: RegExpExecArray | null
  // first pass: collect raw matches
  const raw: { level: number; text: string; offset: number }[] = []
  while ((m = re.exec(masked))) {
    raw.push({ level: m[1].length, text: m[2].trim(), offset: m.index })
  }
  // end offset = start of next heading of same-or-higher level, else EOF
  for (let i = 0; i < raw.length; i++) {
    let end = (content || '').length
    for (let j = i + 1; j < raw.length; j++) {
      if (raw[j].level <= raw[i].level) { end = raw[j].offset; break }
    }
    out.push({
      level: raw[i].level,
      text: raw[i].text,
      offset: raw[i].offset,
      endOffset: end,
      line: lineOf(content || '', raw[i].offset)
    })
  }
  return out
}

/* -------------------------------------------------------------------- links */
const WIKI_RE = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g
const MD_RE = /(!?)\[([^\]\n]*)\]\(([^)\n\s]+)(?:\s+"[^"]*")?\)/g

export const extractLinks = (content: string): DocLink[] => {
  const masked = maskCode(content || '')
  const out: DocLink[] = []
  let m: RegExpExecArray | null
  WIKI_RE.lastIndex = 0
  while ((m = WIKI_RE.exec(masked))) {
    const target = m[1].trim()
    out.push({
      kind: 'wiki',
      target,
      href: target,
      alias: m[2]?.trim(),
      raw: m[0],
      offset: m.index,
      external: /^https?:/i.test(target)
    })
  }
  MD_RE.lastIndex = 0
  while ((m = MD_RE.exec(masked))) {
    const href = m[3].trim()
    if (m[1] === '!') continue // images are not links
    out.push({
      kind: 'md',
      target: href,
      href,
      alias: m[2] || undefined,
      raw: m[0],
      offset: m.index,
      external: /^(https?:)?\/\//i.test(href) || /^mailto:/i.test(href) || href.startsWith('#')
    })
  }
  return out.sort((a, b) => a.offset - b.offset)
}

/** `[[target]]` → the stem used for matching. Strips anchors and folders. */
export const linkStem = (target: string): string => {
  let t = target.split('#')[0].split('|')[0].trim()
  t = t.replace(/^\/+/, '')
  const b = t.split('/').pop() || t
  return b.replace(/\.(md|mdx|txt)$/i, '')
}

/* ------------------------------------------------------------------ footnotes */
export const extractFootnotes = (content: string) => {
  const text = content || ''
  const masked = maskCode(text)
  const refs: FootnoteRef[] = []
  const defs: FootnoteDef[] = []
  const refRe = /\[\^([^\]\n]+)\]/g
  let m: RegExpExecArray | null
  while ((m = refRe.exec(masked))) {
    // definition: starts at line begin followed by ':'
    const after = masked.slice(m.index + m[0].length)
    const isDef = /^\s*:/.test(after) && (m.index === 0 || masked[m.index - 1] === '\n')
    if (isDef) continue
    refs.push({ id: m[1], offset: m.index, line: lineOf(text, m.index) })
  }
  const defRe = /^\[\^([^\]\n]+)\]:[ \t]?([^\n]*)(\n(?:[ \t]{2,}[^\n]*\n?)*)?/gm
  while ((m = defRe.exec(masked))) {
    defs.push({
      id: m[1],
      text: (m[2] || '') + (m[3] || ''),
      offset: m.index,
      line: lineOf(text, m.index),
      endOffset: m.index + m[0].length
    })
  }
  return { refs, defs }
}

/* ------------------------------------------------------------------- misc */
export const fmtDate = (d: Date | string | number = new Date()) => {
  const dt = d instanceof Date ? d : new Date(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

export const todayISO = () => fmtDate(new Date())

export const fmtTime = (d: Date | string | number) => {
  const dt = d instanceof Date ? d : new Date(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${fmtDate(dt)} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}

export const relativeTime = (v: string | number | undefined) => {
  if (!v) return ''
  const t = typeof v === 'number' ? v : new Date(v).getTime()
  if (!t || Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return fmtDate(t)
}

export const truncate = (s: string, n = 60) => {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Case/space insensitive fuzzy score, 0 = no match. */
export const fuzzy = (text: string, query: string): number => {
  if (!query) return 1
  const t = (text || '').toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return 1
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - t.length
  const idx = t.indexOf(q)
  if (idx >= 0) return 600 - idx * 2 - t.length * 0.1
  let ti = 0
  let score = 0
  for (let i = 0; i < q.length; i++) {
    const k = t.indexOf(q[i], ti)
    if (k < 0) return 0
    score += 12 - Math.min(10, k - ti)
    ti = k + 1
  }
  return Math.max(1, score)
}

export const uid = (prefix = '') =>
  prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3)

export const downloadText = (filename: string, text: string, mime = 'text/plain;charset=utf-8') => {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota — ignore */ }
}

/** Concatenate a list with a stable separator. */
export const lines = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join('\n')

/** Very small debounce used by scan-heavy panels. */
export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms = 220) => {
  let t: number | undefined
  const wrapped = (...a: A) => {
    if (t) window.clearTimeout(t)
    t = window.setTimeout(() => fn(...a), ms)
  }
  wrapped.cancel = () => { if (t) window.clearTimeout(t) }
  return wrapped
}
