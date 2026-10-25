/**
 * page-preview — hovering a `[[wiki link]]` in the rendered editor pops a small
 * preview of the target note (first ~20 lines) in a Portal. The listener is
 * installed globally while the plugin is active; a toggle command switches it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import type { PluginContext, PanelProps } from '../types'
import { readDoc } from '../vault'
import { mdToPlain } from '../md'
import { lineOf, truncate } from '../utils'

interface HoverState {
  target: string
  x: number
  y: number
}

const POP_W = 380
const POP_H = 300

const cache = new Map<string, { title: string; lines: string[]; tags: string[]; at: number }>()
const CACHE_MS = 20_000

const PreviewPopover: React.FC<{ ctx: PluginContext; state: HoverState; onClose: () => void; onEnter: () => void; onLeave: () => void }> = ({ ctx, state, onEnter, onLeave }) => {
  const [data, setData] = useState<{ title: string; lines: string[]; tags: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolved, setResolved] = useState<string>('')
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const hit = cache.get(state.target)
    if (hit && Date.now() - hit.at < CACHE_MS) { setData(hit); setResolved(state.target); return }
    ;(async () => {
      try {
        const list = await ctx.vault.list()
        const stem = state.target.split('#')[0].split('|')[0].split('/').pop()!.replace(/\.(md|mdx|txt)$/i, '').toLowerCase()
        const found = (list || []).find((f: any) => {
          const p = String(f.path || f.id || '')
          if (!/\.(md|mdx|txt)$/i.test(p)) return false
          const b = (p.split('/').pop() || '').replace(/\.(md|mdx|txt)$/i, '').toLowerCase()
          return b === stem || p.toLowerCase().replace(/\.(md|mdx|txt)$/i, '') === stem
        })
        if (!found) { if (alive) setError(`未找到「${state.target}」`); return }
        const path = String(found.path || found.id)
        const { content } = await readDoc(ctx, path)
        const body = content.replace(/^---[\s\S]*?---\n?/, '')
        const all = body.split('\n')
        const lines = all.slice(0, 20)
        const title = (content.match(/^#\s+(.+)$/m)?.[1] || path.split('/').pop() || path).replace(/\.(md|mdx|txt)$/i, '')
        const tags = Array.from(new Set((content.match(/#([\w\u4e00-\u9fa5-]+)/g) || []).map((t) => t.slice(1)))).slice(0, 6)
        const payload = { title, lines, tags, at: Date.now() }
        cache.set(state.target, payload)
        if (alive) { setData(payload); setResolved(path) }
      } catch (e: any) {
        if (alive) setError(e?.message || '读取失败')
      }
    })()
    return () => { alive = false }
  }, [ctx, state.target])

  const left = Math.min(state.x, window.innerWidth - POP_W - 16)
  const top = state.y + POP_H > window.innerHeight ? Math.max(12, state.y - POP_H - 12) : state.y

  return createPortal(
    <div
      ref={hostRef}
      className="plg-preview-pop"
      style={{ left: Math.max(12, left), top, width: POP_W }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {error ? (
        <div className="plg-preview-empty"><Icon name="alert" size={13} /> {error}</div>
      ) : !data ? (
        <div className="plg-preview-empty"><span className="spinner" /> 读取中…</div>
      ) : (
        <>
          <div className="plg-preview-head">
            <Icon name="file-text" size={13} />
            <span className="grow ellipsis">{data.title}</span>
            <span className="dim tiny">前 {data.lines.length} 行</span>
          </div>
          <pre className="plg-preview-body">{data.lines.join('\n')}</pre>
          {!!data.tags.length && (
            <div className="plg-preview-tags">
              {data.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
            </div>
          )}
          <div className="plg-preview-foot">
            <span className="dim tiny ellipsis">{resolved}</span>
            <button type="button" className="plg-btn sm" onClick={() => { ctx.openFile(resolved); onLeave() }}>
              <Icon name="external" size={11} /> 打开
            </button>
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ wiring */
let off: (() => void) | null = null
let hostEl: HTMLDivElement | null = null
let rootRef: { unmount: () => void } | null = null

const WIKI_ONLY = /\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/

/** Find the `[[target]]` under the pointer by scanning the closest element text. */
const findWikiLink = (el: HTMLElement | null): { target: string; rect: DOMRect } | null => {
  const scope = el?.closest('.vditor-reset, .vditor-ir, .vditor-wysiwyg, .markdown-body, [data-preview-scope], article')
  if (!scope) return null
  let node: HTMLElement | null = el
  while (node && node !== scope.parentElement) {
    const text = node.textContent || ''
    const m = WIKI_ONLY.exec(text)
    if (m && text.length < 400) {
      return { target: m[1].trim(), rect: node.getBoundingClientRect() }
    }
    node = node.parentElement
  }
  return null
}

export const installPreview = (ctx: PluginContext) => {
  uninstallPreview()
  let timer = 0
  let hideTimer = 0
  let current: HoverState | null = null
  const enabled = () => ctx.settings.get<boolean>('enabled', true)

  const render = (state: HoverState | null) => {
    if (!hostEl) {
      hostEl = document.createElement('div')
      hostEl.className = 'plg-preview-host'
      document.body.appendChild(hostEl)
      import('react-dom/client').then(({ createRoot }) => {
        const root = createRoot(hostEl!)
        rootRef = root
        const renderState = (s: HoverState | null) => {
          const close = () => render(null)
          const keep = () => { window.clearTimeout(hideTimer) }
          const leave = () => { hideTimer = window.setTimeout(close, 220) }
          root.render(s ? <PreviewPopover ctx={ctx} state={s} onClose={close} onEnter={keep} onLeave={leave} /> : null)
        }
        ;(hostEl as any).__render = renderState
        renderState(state)
      })
      return
    }
    const fn = (hostEl as any).__render
    if (fn) fn(state)
    else setTimeout(() => render(state), 30)
  }

  const onOver = (e: MouseEvent) => {
    if (!enabled()) return
    const el = e.target as HTMLElement
    if (el.closest('.plg-preview-pop')) { window.clearTimeout(hideTimer); return }
    window.clearTimeout(timer)
    window.clearTimeout(hideTimer)
    timer = window.setTimeout(() => {
      const hit = findWikiLink(el)
      if (!hit) {
        if (current) { current = null; render(null) }
        return
      }
      if (current && current.target === hit.target) return
      current = { target: hit.target, x: hit.rect.left, y: hit.rect.bottom + 8 }
      render(current)
    }, 330)
  }

  const onOut = (e: MouseEvent) => {
    const el = e.target as HTMLElement
    if (el.closest('.plg-preview-pop')) return
    window.clearTimeout(timer)
    if (current) hideTimer = window.setTimeout(() => { current = null; render(null) }, 260)
  }

  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('mouseout', onOut, true)
  off = () => {
    window.clearTimeout(timer)
    window.clearTimeout(hideTimer)
    document.removeEventListener('mouseover', onOver, true)
    document.removeEventListener('mouseout', onOut, true)
    try { rootRef?.unmount() } catch { /* noop */ }
    rootRef = null
    hostEl?.remove()
    hostEl = null
    current = null
  }
}

export const uninstallPreview = () => {
  off?.()
  off = null
}

/** `plugin.pagePreview.toggle` — enable / disable hover previews. */
export const togglePreview = (ctx: PluginContext) => {
  const next = !ctx.settings.get<boolean>('enabled', true)
  ctx.settings.set('enabled', next)
  if (next) installPreview(ctx)
  else uninstallPreview()
  ctx.toast(next ? '已开启 Wiki 链接悬停预览' : '已关闭 Wiki 链接悬停预览', 'ok')
}

/**
 * Sidebar panel for the page-preview plugin.
 * `panels.ts` loads this module lazily and expects a `PanelComponent` default export
 * (props: `{ context, full?, onClose? }`).
 */
const PagePreviewPanel: React.FC<PanelProps> = ({ context: ctx }) => {
  const [enabled, setEnabled] = useState(() => ctx.settings.get<boolean>('enabled', true))

  useEffect(() => {
    if (ctx.settings.get<boolean>('enabled', true)) installPreview(ctx)
    return () => uninstallPreview()
  }, [ctx])

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    ctx.settings.set('enabled', next)
    if (next) installPreview(ctx)
    else uninstallPreview()
    ctx.toast(next ? '已开启页面预览' : '已关闭页面预览', 'ok')
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>悬停预览</span>
        <button className={'btn btn-sm' + (enabled ? ' btn-ok' : '')} onClick={toggle}>
          {enabled ? '已开启' : '已关闭'}
        </button>
      </div>
      <div style={{ color: 'var(--text-3)', lineHeight: 1.6 }}>
        在编辑器中将鼠标悬停在 [[内部链接]] 上，即可弹出目标笔记的前几行内容；点击弹窗标题可直接跳转。
        支持 [[笔记名]] 与 [[笔记名|别名]] 两种写法。
      </div>
    </div>
  )
}

export default PagePreviewPanel

