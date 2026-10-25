/**
 * Inline find / replace bar overlaying the editor content.
 * Uses the CSS Custom Highlight API when available and falls back to counting
 * plus scroll-to-line jumps.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'

interface Props {
  replace?: boolean
  onClose: () => void
  getText: () => string
  onJump: (offset: number) => void
  onReplaceAll: (find: string, replaceWith: string) => number
  onReplaceOne: (find: string, replaceWith: string) => boolean
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const FindBar: React.FC<Props> = ({
  replace = false,
  onClose,
  getText,
  onJump,
  onReplaceAll,
  onReplaceOne
}) => {
  const [find, setFind] = useState('')
  const [rep, setRep] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const { count, offsets } = useMemo(() => {
    const text = getText()
    if (!find) return { count: 0, offsets: [] as number[] }
    const re = new RegExp(escapeRe(find), caseSensitive ? 'g' : 'gi')
    const list: number[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      list.push(m.index)
      if (list.length >= 2000) break
      if (m[0].length === 0) re.lastIndex++
    }
    return { count: list.length, offsets: list }
  }, [find, caseSensitive, getText])

  /* CSS highlight for all matches when supported */
  useEffect(() => {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    if (!registry) return
    if (!find || !offsets.length) {
      registry.delete('neom-find')
      return
    }
    try {
      const text = getText()
      const ranges: Range[] = []
      const root = document.querySelector('.editor-host .vditor-reset, .editor-host .md-prose, .editor-host .vditor-sv')
      if (!root) return
      // map char offsets to DOM ranges
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      while (walker.nextNode()) nodes.push(walker.currentNode as Text)
      let acc = ''
      const starts: number[] = []
      for (const n of nodes) {
        starts.push(acc.length)
        acc += n.data
      }
      const makeRange = (offset: number, len: number): Range | null => {
        let startNode: Text | null = null
        let startOff = 0
        let endNode: Text | null = null
        let endOff = 0
        for (let i = 0; i < nodes.length; i++) {
          const s = starts[i]
          const e = s + nodes[i].data.length
          if (!startNode && offset >= s && offset <= e) {
            startNode = nodes[i]
            startOff = offset - s
          }
          if (offset + len >= s && offset + len <= e) {
            endNode = nodes[i]
            endOff = offset + len - s
            break
          }
        }
        if (!startNode || !endNode) return null
        const r = document.createRange()
        try {
          r.setStart(startNode, Math.min(startOff, startNode.data.length))
          r.setEnd(endNode, Math.min(endOff, endNode.data.length))
        } catch {
          return null
        }
        return r
      }
      for (const off of offsets.slice(0, 400)) {
        const r = makeRange(off, find.length)
        if (r) ranges.push(r)
      }
      void text
      const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
      if (HighlightCtor && ranges.length) {
        registry.set('neom-find', new HighlightCtor(...ranges))
      }
    } catch {
      /* highlight is a progressive enhancement */
    }
    return () => {
      registry.delete('neom-find')
    }
  }, [find, offsets, getText])

  const goto = (index: number) => {
    if (!offsets.length) return
    const next = ((index % offsets.length) + offsets.length) % offsets.length
    setCursor(next)
    onJump(offsets[next])
  }

  const close = () => {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    registry?.delete('neom-find')
    onClose()
  }

  return (
    <div className="findbar" onKeyDown={(e) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (replace && e.shiftKey) {
          onReplaceOne(find, rep)
          goto(cursor)
        } else goto(e.shiftKey ? cursor - 1 : cursor + 1)
      }
    }}>
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        className="input"
        placeholder="查找"
        value={find}
        onChange={(e) => { setFind(e.target.value); setCursor(0) }}
      />
      <span className="fb-count">{find ? `${count ? cursor + 1 : 0}/${count}` : '—'}</span>
      <button
        className={'btn-icon' + (caseSensitive ? ' active' : '')}
        title="区分大小写"
        onClick={() => setCaseSensitive((v) => !v)}
      >
        <span style={{ fontSize: 11, fontWeight: 700 }}>Aa</span>
      </button>
      <button className="btn-icon" title="上一个 (Shift+Enter)" onClick={() => goto(cursor - 1)} disabled={!count}>
        <Icon name="chevron-up" size={14} />
      </button>
      <button className="btn-icon" title="下一个 (Enter)" onClick={() => goto(cursor + 1)} disabled={!count}>
        <Icon name="chevron-down" size={14} />
      </button>
      {replace && (
        <>
          <span className="vdivider" />
          <input
            className="input"
            placeholder="替换为"
            value={rep}
            onChange={(e) => setRep(e.target.value)}
          />
          <button className="btn btn-sm" disabled={!count} onClick={() => { onReplaceOne(find, rep); goto(cursor) }}>
            替换
          </button>
          <button className="btn btn-sm" disabled={!count} onClick={() => { onReplaceAll(find, rep); setCursor(0) }}>
            全部
          </button>
        </>
      )}
      <button className="btn-icon" title="关闭 (Esc)" onClick={close}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}

export default FindBar
