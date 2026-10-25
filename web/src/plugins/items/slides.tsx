/**
 * slides — render the active Markdown as slides split on `---`.
 * Present mode is keyboard driven (←/→/Space, Esc to exit), shows a progress
 * indicator, a presenter-notes drawer (`???` blocks) and the next-slide peek.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Spinner, useActiveDoc } from '../ui'
import { renderMarkdown, splitSlides, type Slide } from '../md'
import { openPluginWindow } from '../fullscreen'

/* ------------------------------------------------------------- presenter */
const Presenter: React.FC<{
  slides: Slide[]
  start: number
  onClose: () => void
  title: string
}> = ({ slides, start, onClose, title }) => {
  const [idx, setIdx] = useState(start)
  const [notesOpen, setNotesOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(Date.now())
  const slide = slides[idx]

  useEffect(() => {
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => window.clearInterval(t)
  }, [])

  const go = useCallback((next: number) => {
    setIdx(Math.max(0, Math.min(slides.length - 1, next)))
  }, [slides.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(idx + 1) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(idx - 1) }
      else if (e.key === 'Home') { e.preventDefault(); go(0) }
      else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1) }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); setNotesOpen((v) => !v) }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.().catch(() => {}) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [idx, go, onClose, slides.length])

  if (!slide) return null

  return createPortal(
    <div className="plg-present">
      <div className="plg-present-stage" onClick={() => go(idx + 1)}>
        <div className="plg-present-slide" dangerouslySetInnerHTML={{ __html: renderMarkdown(slide.body) }} />
      </div>
      {notesOpen && (
        <div className="plg-present-notes">
          <div className="plg-present-notes-head">演讲者备注 · 第 {idx + 1} 页</div>
          <div className="plg-present-notes-body">
            {slide.notes ? <div className="plg-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(slide.notes) }} /> : <span className="dim">本页没有备注（用 ? ? ? 分隔）</span>}
          </div>
        </div>
      )}
      <div className="plg-present-bar">
        <span className="plg-present-title ellipsis">{title}</span>
        <button type="button" className="plg-icon-btn" onClick={(e) => { e.stopPropagation(); go(idx - 1) }} title="上一页 (←)">
          <Icon name="chevron-left" size={15} />
        </button>
        <span className="plg-present-count">{idx + 1} / {slides.length}</span>
        <button type="button" className="plg-icon-btn" onClick={(e) => { e.stopPropagation(); go(idx + 1) }} title="下一页 (→)">
          <Icon name="chevron-right" size={15} />
        </button>
        <span className="vdivider" />
        <button type="button" className={'plg-icon-btn' + (notesOpen ? ' on' : '')} onClick={(e) => { e.stopPropagation(); setNotesOpen((v) => !v) }} title="演讲者备注 (N)">
          <Icon name="file-text" size={14} />
        </button>
        <span className="plg-present-time">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
        <button type="button" className="plg-icon-btn" onClick={(e) => { e.stopPropagation(); onClose() }} title="退出 (Esc)">
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="plg-present-progress">
        {slides.map((s, i) => (
          <span key={i} className={i === idx ? 'on' : i < idx ? 'done' : ''} onClick={(e) => { e.stopPropagation(); go(i) }} />
        ))}
      </div>
    </div>,
    document.body
  )
}

/* ---------------------------------------------------------------- panel */
const SlidesPanel: React.FC<PanelProps> = ({ context, full, onClose }) => {
  const { path, content } = useActiveDoc(context)
  const [start, setStart] = useState(0)
  const [custom, setCustom] = useState<string | null>(null)
  const [presenting, setPresenting] = useState(false)

  const slides = useMemo(() => splitSlides(custom ?? content), [custom, content])
  const title = path ? path.split('/').pop()?.replace(/\.\w+$/, '') || '幻灯片' : '幻灯片'
  const [preview, setPreview] = useState(0)

  const begin = (i: number) => { setStart(i); setPreview(i); setPresenting(true) }

  if (presenting) {
    return <Presenter slides={slides} start={start} onClose={() => setPresenting(false)} title={title} />
  }

  return (
    <Panel>
      <Head
        icon="slides"
        title="幻灯片"
        sub={`${slides.length} 页 · 用 --- 分页，??? 写备注`}
        actions={
          <>
            <Btn icon="play" primary disabled={!slides.length} onClick={() => begin(preview)}>放映</Btn>
            {full && onClose && <Btn icon="x" onClick={onClose} title="关闭" />}
          </>
        }
      />
      {!path && !custom && <Empty icon="slides" text="请先打开一篇 Markdown 文档" />}
      <div className="plg-slides-body">
        <div className="plg-slides-list">
          {!slides.length && <div className="plg-dim plg-pad">文档中没有可放映的内容</div>}
          {slides.map((s, i) => (
            <button
              key={s.index}
              type="button"
              className={'plg-slide-thumb' + (i === preview ? ' on' : '')}
              onClick={() => setPreview(i)}
              onDoubleClick={() => begin(i)}
              title={s.title}
            >
              <span className="plg-slide-no">{i + 1}</span>
              <span className="plg-slide-thumb-html" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body.slice(0, 320)) }} />
              {s.notes && <span className="plg-slide-notes-dot" title="有演讲者备注" />}
            </button>
          ))}
        </div>
        <div className="plg-slides-preview">
          {slides[preview] ? (
            <>
              <div className="plg-slide-stage" dangerouslySetInnerHTML={{ __html: renderMarkdown(slides[preview].body) }} />
              <div className="row plg-pad-x">
                <Btn icon="chevron-left" disabled={preview <= 0} onClick={() => setPreview((p) => Math.max(0, p - 1))}>上一页</Btn>
                <span className="dim tiny grow center">{preview + 1} / {slides.length}</span>
                <Btn icon="chevron-right" disabled={preview >= slides.length - 1} onClick={() => setPreview((p) => Math.min(slides.length - 1, p + 1))}>下一页</Btn>
                <Btn icon="play" primary onClick={() => begin(preview)}>从这里放映</Btn>
              </div>
              {slides[preview].notes && (
                <div className="plg-slide-notes">
                  <div className="plg-sub-title">演讲者备注</div>
                  <div className="plg-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(slides[preview].notes) }} />
                </div>
              )}
            </>
          ) : <Spinner text="准备中…" />}
        </div>
      </div>
      <div className="plg-foot">
        <Icon name="info" size={11} />
        <span>放映快捷键：← → 翻页 · N 备注 · F 全屏 · Esc 退出</span>
        {custom !== null && <Btn icon="x" onClick={() => setCustom(null)}>返回当前文档</Btn>}
      </div>
    </Panel>
  )
}

/** `plugin.slides.present` — read the active doc and start presenting at once. */
export const presentCurrent = async (ctx: PluginContext) => {
  let content = ''
  try { content = ctx.getActiveContent() || '' } catch { content = '' }
  const slides = splitSlides(content)
  if (!slides.length) { ctx.toast('当前文档没有可放映内容（用 --- 分页）', 'warn'); return }
  const host = document.createElement('div')
  host.className = 'plg-present-host'
  document.body.appendChild(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const close = () => { root.unmount(); host.remove() }
  root.render(<Presenter slides={slides} start={0} onClose={close} title="放映" />)
  void openPluginWindow
}

export default SlidesPanel
