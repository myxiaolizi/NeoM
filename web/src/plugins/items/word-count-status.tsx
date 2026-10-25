/**
 * word-count status item — compact live counter for the shell status bar.
 * Polls the active document through the plugin context (no shell coupling),
 * and refreshes immediately on save/open events.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { EVT } from '@/lib/contracts'
import type { PanelProps } from '../types'
import { computeStats, fmtNumber, fmtReading } from '../stats'
import { openPluginWindow } from '../fullscreen'

const WordCountStatus: React.FC<PanelProps> = ({ context }) => {
  const [content, setContent] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => {
      try {
        const txt = context.getActiveContent() || ''
        if (alive) setContent(txt)
      } catch { /* noop */ }
    }
    load()
    const timer = window.setInterval(load, 900)
    window.addEventListener(EVT.docSaved, load)
    window.addEventListener(EVT.docOpened, load)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(EVT.docSaved, load)
      window.removeEventListener(EVT.docOpened, load)
    }
  }, [context])

  const stats = useMemo(() => computeStats(content), [content])
  if (!content) return null

  return (
    <button
      type="button"
      className={'plg-status-item' + (open ? ' on' : '')}
      title={`${stats.words} 字 · ${stats.chars} 字符 · ${stats.lines} 行 · 预计 ${fmtReading(stats.readingMinutes)}\n点击查看详情`}
      onClick={() => {
        openPluginWindow('word-count', context)
        setOpen(true)
        setTimeout(() => setOpen(false), 600)
      }}
    >
      <Icon name="chart" size={12} />
      <span>{fmtNumber(stats.words)} 字</span>
      <span className="plg-status-sep">·</span>
      <span className="dim">{fmtReading(stats.readingMinutes)}</span>
    </button>
  )
}

export default WordCountStatus
