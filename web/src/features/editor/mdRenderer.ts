/**
 * Markdown → HTML pipeline for the read-only ("preview") view mode, exports and
 * AI result rendering. marked + DOMPurify + highlight.js + KaTeX (+ mermaid).
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import katex from 'katex'

marked.setOptions({ gfm: true, breaks: false, headerIds: false, mangle: false } as never)

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Render markdown to sanitized HTML (safe for dangerouslySetInnerHTML). */
export function renderMarkdown(md: string): string {
  if (!md) return ''
  let html = ''
  try {
    html = marked.parse(md, { async: false }) as string
  } catch {
    html = `<pre>${escapeHtml(md)}</pre>`
  }
  return sanitize(html)
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'data-line', 'data-lang', 'align', 'colspan', 'rowspan'],
    ADD_TAGS: ['mark', 'kbd', 'details', 'summary', 'sup', 'sub'],
    ALLOW_DATA_ATTR: true
  }) as unknown as string
}

/** Render a standalone HTML document (export / print). */
export function renderStandaloneHtml(title: string, md: string): string {
  const body = renderMarkdown(md)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light}
body{margin:0;background:#fff;color:#191b20;font-family:"Segoe UI",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.75}
main{max-width:760px;margin:0 auto;padding:42px 22px 90px}
h1,h2,h3,h4{line-height:1.3;margin:1.4em 0 .5em;font-weight:600}
h1{font-size:1.95em}h2{font-size:1.55em;border-bottom:1px solid #e6e8ee;padding-bottom:.25em}h3{font-size:1.28em}
p{margin:.7em 0}a{color:#2358b8;text-decoration:none}
ul,ol{padding-left:1.5em}li{margin:.2em 0}
blockquote{margin:.9em 0;padding:.1em 1em;border-left:3px solid #cfd6e4;color:#565d6c;background:#f7f8fa;border-radius:0 6px 6px 0}
code{font-family:Consolas,"Cascadia Code",monospace;font-size:.88em;background:#f4f5f8;border:1px solid #e6e8ee;border-radius:4px;padding:.12em .35em}
pre{background:#f4f5f8;border:1px solid #e6e8ee;border-radius:9px;padding:12px 14px;overflow-x:auto}
pre code{border:none;background:transparent;padding:0;font-size:.86em}
table{width:100%;border-collapse:collapse;margin:.9em 0;font-size:.94em}
th,td{border:1px solid #d8dce6;padding:6px 10px;text-align:left}th{background:#f4f5f8}
hr{border:none;height:1px;background:#d8dce6;margin:1.6em 0}
img{max-width:100%;border-radius:9px}
mark{background:#fff2a8}
.katex-display{overflow-x:auto}
</style></head>
<body><main class="md-prose">${body}</main></body></html>`
}

/* --------------------------------------------------------------- enhancements */
const MATH_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\))/g

const renderMathString = (input: string): string => {
  try {
    const display = input.startsWith('$$') || input.startsWith('\\[')
    const inner = display
      ? input.replace(/^\$\$|\$\$$/g, '').replace(/^\\\[|\\\]$/g, '')
      : input.replace(/^\$|\$$/g, '').replace(/^\\\(|\\\)$/g, '')
    return katex.renderToString(inner.trim(), { displayMode: display, throwOnError: false, output: 'html' })
  } catch {
    return escapeHtml(input)
  }
}

/** Post-process a rendered DOM tree: latex, code highlight, mermaid. */
export function enhanceDom(root: HTMLElement, opts: { mermaid?: boolean } = {}) {
  // 1. latex inside plain text nodes (skip code blocks)
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const hits: Text[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (!node.data.includes('$') && !node.data.includes('\\(')) continue
      const parent = node.parentElement
      if (!parent || parent.closest('pre, code, .katex, script, style')) continue
      if (MATH_RE.test(node.data)) hits.push(node)
      MATH_RE.lastIndex = 0
    }
    for (const node of hits) {
      const frag = document.createDocumentFragment()
      let last = 0
      const text = node.data
      MATH_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = MATH_RE.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
        const span = document.createElement('span')
        span.innerHTML = renderMathString(m[0])
        frag.appendChild(span)
        last = m.index + m[0].length
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
      node.parentNode?.replaceChild(frag, node)
    }
  } catch {
    /* math is best effort */
  }

  // 2. code highlighting
  root.querySelectorAll<HTMLElement>('pre code').forEach((block) => {
    if (block.dataset.enhanced) return
    block.dataset.enhanced = '1'
    const cls = Array.from(block.classList).find((c) => c.startsWith('language-'))
    const lang = cls?.slice('language-'.length)
    if (lang === 'mermaid') return
    try {
      if (lang && hljs.getLanguage(lang)) {
        block.innerHTML = hljs.highlight(block.textContent || '', { language: lang }).value
      } else {
        block.innerHTML = hljs.highlightAuto(block.textContent || '').value
      }
    } catch {
      /* keep plain text */
    }
  })

  // 3. mermaid diagrams (lazy, never blocks the render)
  if (opts.mermaid !== false) {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre code.language-mermaid'))
    if (blocks.length) {
      void (async () => {
        try {
          const mod = await import('mermaid')
          const mermaid = (mod as unknown as { default: { initialize: (o: unknown) => void; render: (id: string, code: string) => Promise<{ svg: string }> } }).default
          mermaid.initialize({
            startOnLoad: false,
            theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
            securityLevel: 'strict'
          })
          for (let i = 0; i < blocks.length; i++) {
            const code = blocks[i].textContent || ''
            const pre = blocks[i].closest('pre')
            if (!pre) continue
            try {
              const { svg } = await mermaid.render(`mermaid-neom-${Date.now()}-${i}`, code)
              const wrap = document.createElement('div')
              wrap.className = 'mermaid-figure'
              wrap.innerHTML = svg
              pre.replaceWith(wrap)
            } catch {
              /* invalid diagram: leave source visible */
            }
          }
        } catch {
          /* mermaid unavailable offline */
        }
      })()
    }
  }
}

/** Plain-text excerpt used by search result previews / AI prompts. */
export function mdToPlainText(md: string): string {
  const html = renderMarkdown(md)
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}
