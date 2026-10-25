/**
 * Markdown rendering shared by slides / preview / clip helpers.
 * Uses the already-bundled `marked` + `dompurify` (no new dependencies).
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

export const renderMarkdown = (md: string): string => {
  try {
    const html = marked.parse(md || '', { async: false }) as unknown as string
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] })
  } catch {
    return `<pre>${(md || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</pre>`
  }
}

export const mdInline = (md: string): string =>
  renderMarkdown(md).replace(/<\/?p>/g, '').trim()

/** Strip markdown syntax down to readable text (used for titles/excerpts). */
export const mdToPlain = (md: string): string =>
  (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a)
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Split a deck into slides on `---` rules, keeping `???` speaker notes. */
export interface Slide {
  index: number
  title: string
  body: string
  notes: string
}

export const splitSlides = (md: string): Slide[] => {
  const chunks = (md || '').split(/\n[-*_]{3,}\s*\n/)
  const out: Slide[] = []
  chunks.forEach((chunk, i) => {
    const [bodyPart, ...noteParts] = chunk.split(/\n\?\?\?\s*\n?/)
    const notes = noteParts.join('\n???\n').trim()
    const firstHeading = /^#{1,6}\s+(.+)$/m.exec(bodyPart)
    const title = firstHeading ? firstHeading[1].trim() : mdToPlain(bodyPart.split('\n')[0] || '').slice(0, 40) || `第 ${i + 1} 页`
    const body = bodyPart.replace(/^\s+|\s+$/g, '')
    if (!body && !notes) return
    out.push({ index: out.length, title, body, notes })
  })
  return out
}

export interface ClippedPage {
  title: string
  markdown: string
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')

/** Tiny dependency-free HTML → Markdown converter (clipper). */
export const htmlToMarkdown = (html: string, baseUrl = ''): string => {
  let s = String(html || '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, l, t) => `\n\n${'#'.repeat(Number(l))} ${inlineToMd(t, baseUrl)}\n\n`)
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, t) => `\n\n\`\`\`\n${decodeEntities(stripTags(t)).trim()}\n\`\`\`\n\n`)
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, t) => `\n\n${toMd(t, baseUrl).split('\n').map((l) => `> ${l}`).join('\n')}\n\n`)
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${inlineToMd(t, baseUrl).trim()}`)
  s = s.replace(/<\/(ul|ol)>/gi, '\n\n')
  s = s.replace(/<(ul|ol)[^>]*>/gi, '\n')
  s = s.replace(/<hr[^>]*>/gi, '\n\n---\n\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, t) => `**${stripTags(t).trim()}**`)
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, t) => `*${stripTags(t).trim()}*`)
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, t) => `\`${decodeEntities(stripTags(t))}\``)
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => {
    const url = absolutise(href, baseUrl)
    const label = inlineToMd(t, baseUrl).trim()
    return label ? `[${label}](${url})` : url
  })
  s = s.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, src) => `![图片](${absolutise(src, baseUrl)})`)
  s = s.replace(/<\/?(p|div|section|article|header|footer|main|aside|table|tr|tbody|thead|figure|figcaption)[^>]*>/gi, '\n\n')
  s = s.replace(/<\/?t[dh][^>]*>/gi, ' | ')
  s = stripTags(s)
  s = decodeEntities(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '')
  return s
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '')
const inlineToMd = (s: string, baseUrl: string) => toMd(s, baseUrl).replace(/\n+/g, ' ')
const toMd = (html: string, baseUrl: string) => htmlToMarkdown(html, baseUrl)

const absolutise = (url: string, base: string): string => {
  if (!url) return ''
  if (/^(https?:|mailto:|tel:|data:|#)/i.test(url)) return url
  if (!base) return url
  try { return new URL(url, base).toString() } catch { return url }
}

/** Extract `<title>` and derive a clip title from HTML. */
export const extractTitle = (html: string, fallback = '未命名剪藏'): string => {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '')
  if (t) return decodeEntities(stripTags(t[1])).trim().slice(0, 120) || fallback
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html || '')
  if (h1) return decodeEntities(stripTags(h1[1])).trim().slice(0, 120) || fallback
  return fallback
}
