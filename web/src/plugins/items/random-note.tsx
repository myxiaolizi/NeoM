/**
 * random-note — pick a random vault note and show a "回顾" (review) card with
 * its title, excerpt, tags, backlink count and one-click open / reroll.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Panel, Spinner, docTitle, useVaultDocs } from '../ui'
import { backlinkDocs } from '../vault'
import { fmtDate, relativeTime, truncate } from '../utils'

const pick = <T,>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)]

const ReviewCard: React.FC<{ ctx: PluginContext; onClose: () => void }> = ({ ctx, onClose }) => {
  const { docs, loading } = useVaultDocs(ctx)
  const [id, setId] = useState(0)

  const doc = useMemo(() => {
    if (!docs.length) return undefined
    if (!id) return pick(docs)
    return docs[Math.abs(id) % docs.length]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, id])

  const refs = useMemo(() => (doc ? backlinkDocs(docs, doc.path).length : 0), [docs, doc])
  const excerpt = useMemo(() => {
    if (!doc) return ''
    const body = doc.content.replace(/^---[\s\S]*?---/, '').replace(/^#{1,6}\s+.*$/gm, '').trim()
    return truncate(body, 260)
  }, [doc])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div className="plg-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="plg-random-card">
        {loading && !doc ? <Spinner text="随机抽取中…" /> : doc ? (
          <>
            <div className="plg-random-head">
              <Icon name="shuffle" size={16} />
              <span className="grow">漫游回顾</span>
              <button type="button" className="plg-icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
            </div>
            <div className="plg-random-body">
              <h2 className="plg-random-title">{docTitle(doc)}</h2>
              <div className="plg-random-meta">
                <span><Icon name="file" size={11} /> {doc.path}</span>
                <span><Icon name="clock" size={11} /> {relativeTime(doc.mtime) || fmtDate(Date.now())}</span>
                <span><Icon name="link" size={11} /> {refs} 处引用</span>
              </div>
              <p className="plg-random-excerpt">{excerpt || '（这篇笔记还很空）'}</p>
              {!!doc.tags.length && (
                <div className="plg-random-tags">
                  {doc.tags.slice(0, 8).map((t) => <span key={t} className="chip">#{t}</span>)}
                </div>
              )}
              {!!doc.headings.length && (
                <div className="plg-random-outline">
                  {doc.headings.slice(0, 6).map((h, i) => (
                    <div key={i} style={{ paddingLeft: (h.level - 1) * 10 }} className="dim small">H{h.level} {h.text}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="plg-random-foot">
              <Btn icon="shuffle" onClick={() => setId((n) => n + 1 + Math.floor(Math.random() * 5))}>换一篇</Btn>
              <span className="grow" />
              <Btn onClick={onClose}>关闭</Btn>
              <Btn icon="external" primary onClick={() => { ctx.openFile(doc.path); onClose() }}>打开笔记</Btn>
            </div>
          </>
        ) : (
          <Empty icon="shuffle" text="仓库里还没有笔记" />
        )}
      </div>
    </div>,
    document.body
  )
}

const RandomNotePanel: React.FC<PanelProps> = ({ context }) => {
  const { docs, loading, refresh } = useVaultDocs(context)
  const [current, setCurrent] = useState<string | null>(null)
  const [showCard, setShowCard] = useState(false)

  const roll = useCallback(() => {
    const d = pick(docs)
    if (!d) { context.toast('仓库里还没有笔记', 'warn'); return }
    setCurrent(d.path)
    setShowCard(true)
  }, [docs, context])

  const doc = current ? docs.find((d) => d.path === current) : undefined

  return (
    <Panel>
      <div className="plg-pad col">
        <div className="plg-random-hero">
          <Icon name="shuffle" size={26} />
          <div className="plg-head-title">漫游笔记</div>
          <div className="plg-head-sub">{loading ? '索引中…' : `${docs.length} 篇笔记里随机抽一篇`}</div>
          <Btn icon="shuffle" primary onClick={roll} disabled={loading || !docs.length}>开始漫游</Btn>
          <Btn icon="refresh" onClick={() => refresh(true)}>刷新索引</Btn>
        </div>
        {doc && (
          <div className="plg-random-mini card card-pad" onClick={() => context.openFile(doc.path)}>
            <div className="plg-row-title">{docTitle(doc)}</div>
            <div className="plg-row-sub">{doc.path}</div>
            <div className="dim tiny">{truncate(doc.content, 120)}</div>
          </div>
        )}
      </div>
      {showCard && <ReviewCard ctx={context} onClose={() => setShowCard(false)} />}
    </Panel>
  )
}

/** `plugin.randomNote.open` — draw immediately and show the review card. */
export const openRandom = async (ctx: PluginContext) => {
  const host = document.createElement('div')
  host.className = 'plg-random-host'
  document.body.appendChild(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const close = () => { root.unmount(); host.remove() }
  root.render(<ReviewCard ctx={ctx} onClose={close} />)
}

export default RandomNotePanel
