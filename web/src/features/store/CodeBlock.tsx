/**
 * Syntax-highlighted code block for docs pages.
 * highlight.js is loaded on demand so docs stay lightweight.
 * The <code> node is populated imperatively only (React children would wipe it).
 */
import React, { useEffect, useRef } from 'react'
import { Icon } from '@/components/Icon'
import { useStore } from '@/store'
import { copyText } from '@/features/marketing/portalKit'

let hljsPromise: Promise<any> | null = null
const loadHljs = () => {
  if (!hljsPromise) {
    hljsPromise = import('highlight.js')
      .then((m: any) => m.default || m)
      .catch(() => null)
  }
  return hljsPromise
}

export const CodeBlock: React.FC<{
  code: string
  lang?: string
  title?: string
}> = ({ code, lang = 'javascript', title }) => {
  const toast = useStore((s) => s.toast)
  const ref = useRef<HTMLElement>(null)
  const src = code.replace(/^\n/, '').replace(/\s+$/, '')

  useEffect(() => {
    let alive = true
    const el = ref.current
    if (!el) return
    el.textContent = src
    loadHljs().then((hljs) => {
      if (!alive || !el) return
      if (!hljs) return
      try {
        const out = hljs.getLanguage(lang)
          ? hljs.highlight(src, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(src).value
        el.innerHTML = out
        el.classList.add('hljs')
      } catch {
        /* plain text stays */
      }
    })
    return () => {
      alive = false
    }
  }, [src, lang])

  return (
    <div className="guide-code">
      <div className="guide-code-head">
        <span className="lang">{lang}</span>
        <span>{title || ''}</span>
        <button
          type="button"
          className="btn-icon"
          style={{ width: 22, height: 22, marginLeft: 'auto' }}
          title="复制代码"
          onClick={async () => {
            const ok = await copyText(src)
            toast({ kind: ok ? 'ok' : 'warn', text: ok ? '代码已复制' : '复制失败' })
          }}
        >
          <Icon name="copy" size={12} />
        </button>
      </div>
      <pre>
        <code ref={ref} />
      </pre>
    </div>
  )
}

export default CodeBlock
