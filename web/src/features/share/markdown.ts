/**
 * Markdown rendering for public pages (share / published docs / site docs).
 * Heavy renderers (marked, dompurify, highlight.js, katex, mermaid) are loaded
 * on demand so portal first paint stays light.
 */
let hljsCache: any = null
let hljsTried = false

async function loadHljs() {
  if (hljsTried) return hljsCache
  hljsTried = true
  try {
    const mod: any = await import('highlight.js')
    hljsCache = mod.default || mod
  } catch {
    hljsCache = null
  }
  return hljsCache
}

/** Guard the placeholder used to protect KaTeX source from the markdown parser.
 *  Plain ASCII so sanitizers never strip it (NULL bytes would be removed). */
const mathToken = (i: number) => `NEOMKATEXPLACEHOLDER${i}END`

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Render markdown source to sanitized HTML.
 * - GFM tables / task lists / strikethrough
 * - ```mermaid blocks are left for `renderMermaidBlocks`
 * - $inline$ and $$block$$ formulas via KaTeX
 */
export async function renderMarkdown(src: string): Promise<string> {
  const text = String(src ?? '')
  if (!text.trim()) return ''

  const [{ marked }, dompurifyMod] = await Promise.all([import('marked'), import('dompurify')])
  const DOMPurify: any = (dompurifyMod as any).default || dompurifyMod

  // 1. extract math before parsing markdown
  const formulas: string[] = []
  let body = text
  if (text.includes('$')) {
    try {
      /* KaTeX markup is meaningless without its stylesheet — load it on demand */
      import('katex/dist/katex.min.css').catch(() => {})
      const katexMod: any = await import('katex')
      const katex = katexMod.default || katexMod
      const withMath = text.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (raw, block, inline) => {
        const tex = String(block ?? inline ?? '').trim()
        if (!tex) return raw
        try {
          const html = katex.renderToString(tex, {
            displayMode: !!block,
            throwOnError: false,
            strict: false
          })
          const idx = formulas.push(html) - 1
          return mathToken(idx)
        } catch {
          return raw
        }
      })
      body = withMath
    } catch {
      /* KaTeX unavailable — keep raw source */
    }
  }

  // 2. markdown → html
  let html = ''
  try {
    const out = (marked as any).parse(body, { gfm: true, breaks: false, headerIds: false, mangle: false })
    html = typeof out === 'string' ? out : await out
  } catch {
    html = `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`
  }

  // 3. sanitize untrusted content
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'class', 'align', 'colspan', 'rowspan', 'checked', 'disabled', 'type'],
    ADD_TAGS: ['input'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick']
  })

  // 4. highlight code + mark mermaid carriers, harden links
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  const hljs = await loadHljs()

  doc.querySelectorAll('pre > code').forEach((codeEl) => {
    const cls = codeEl.getAttribute('class') || ''
    const langMatch = /language-([\w+#-]+)/.exec(cls)
    const lang = (langMatch?.[1] || '').toLowerCase()
    const raw = codeEl.textContent || ''
    if (lang === 'mermaid') {
      const pre = codeEl.parentElement
      if (pre) {
        pre.setAttribute('class', 'p-mermaid-src')
        pre.setAttribute('data-mermaid', '1')
        pre.textContent = raw
      }
      return
    }
    if (!hljs) return
    try {
      let result: { value: string }
      if (lang && hljs.getLanguage(lang)) result = hljs.highlight(raw, { language: lang, ignoreIllegals: true })
      else result = hljs.highlightAuto(raw)
      codeEl.innerHTML = result.value
      codeEl.setAttribute('class', `hljs ${lang ? 'language-' + lang : ''}`)
    } catch {
      /* keep plain text on unknown grammar */
    }
  })

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || ''
    if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    }
  })
  doc.querySelectorAll('img').forEach((img) => {
    img.setAttribute('loading', 'lazy')
    img.setAttribute('decoding', 'async')
  })

  let out = doc.body.innerHTML
  // 5. restore KaTeX output (already trusted, escapes its own input)
  formulas.forEach((f, i) => {
    out = out.split(mathToken(i)).join(f)
  })
  return out
}

/** Render ```mermaid fences inside a mounted container (silently degrades to code). */
export async function renderMermaidBlocks(root: HTMLElement | null) {
  if (!root) return
  const blocks = Array.from(root.querySelectorAll<HTMLPreElement>('pre[data-mermaid="1"]'))
  if (!blocks.length) return
  try {
    const mod: any = await import('mermaid')
    const mermaid = mod.default || mod
    const dark = document.documentElement.dataset.theme === 'dark'
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'var(--font-ui)'
    })
    let n = 0
    for (const pre of blocks) {
      const code = pre.textContent || ''
      if (!code.trim()) continue
      try {
        const id = `neom-mermaid-${Date.now()}-${n++}`
        const { svg } = await mermaid.render(id, code)
        const wrap = document.createElement('div')
        wrap.className = 'p-mermaid'
        wrap.innerHTML = svg
        pre.replaceWith(wrap)
      } catch {
        /* leave the source block visible */
      }
    }
  } catch {
    /* mermaid not installed — keep code blocks */
  }
}

/** Plain-text preview used for meta descriptions / share cards. */
export function excerpt(src: string, max = 160): string {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}
