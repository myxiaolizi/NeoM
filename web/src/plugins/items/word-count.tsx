/**
 * word-count — detailed statistics panel.
 * Live numbers come from the active document; the status-bar item shows the
 * compact version.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { EVT } from '@/lib/contracts'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, useActiveDoc } from '../ui'
import { computeStats, fmtNumber, fmtReading } from '../stats'
import { extractHeadings, extractLinks, extractTags } from '../utils'

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; big?: boolean }> = ({ label, value, hint, big }) => (
  <div className={'plg-stat' + (big ? ' big' : '')}>
    <div className="plg-stat-value">{value}</div>
    <div className="plg-stat-label">{label}</div>
    {hint && <div className="plg-stat-hint">{hint}</div>}
  </div>
)

const WordCountPanel: React.FC<PanelProps> = ({ context }) => {
  const { path, content } = useActiveDoc(context)
  const [selection, setSelection] = useState('')

  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection()
      setSelection(sel ? sel.toString() : '')
    }
    document.addEventListener('selectionchange', onSelect)
    return () => document.removeEventListener('selectionchange', onSelect)
  }, [])

  const stats = useMemo(() => computeStats(content), [content])
  const selStats = useMemo(() => (selection.trim() ? computeStats(selection) : null), [selection])
  const tags = useMemo(() => extractTags(content), [content])
  const headings = useMemo(() => extractHeadings(content), [content])
  const links = useMemo(() => extractLinks(content), [content])

  const goal = context.settings.get<number>('dailyGoal', 1000)
  const todayDone = context.settings.get<number>('todayWords', 0)
  const pct = Math.min(100, Math.round((todayDone / Math.max(1, goal)) * 100))

  return (
    <Panel>
      <Head
        icon="chart"
        title="字数统计"
        sub={path ? path.split('/').pop() : '未打开文档'}
        actions={
          <Btn icon="refresh" onClick={() => window.dispatchEvent(new Event(EVT.docSaved))} title="刷新">刷新</Btn>
        }
      />
      <div className="plg-pad">
        {!path && !content ? <Empty icon="file" text="请先打开一篇文档" /> : (
          <>
            <div className="plg-stats-hero">
              <div className="plg-stat-hero-num">{fmtNumber(stats.words)}</div>
              <div className="plg-stat-hero-label">总字数（中文按字 / 英文按词）</div>
              <div className="plg-stat-hero-sub">
                预计阅读 {fmtReading(stats.readingMinutes)} · 中文 400 字/分、英文 200 词/分
              </div>
            </div>
            <div className="plg-stats-grid">
              <Stat label="字符数" value={fmtNumber(stats.chars)} />
              <Stat label="不含空格" value={fmtNumber(stats.charsNoSpace)} />
              <Stat label="行数" value={fmtNumber(stats.lines)} />
              <Stat label="段落数" value={fmtNumber(stats.paragraphs)} />
              <Stat label="中文字数" value={fmtNumber(stats.cjk)} />
              <Stat label="英文词数" value={fmtNumber(stats.latinWords)} />
            </div>
            <div className="plg-stats-sub">
              <span><Icon name="headings" size={11} /> 标题 {headings.length}</span>
              <span><Icon name="tag" size={11} /> 标签 {tags.length}</span>
              <span><Icon name="link" size={11} /> 链接 {links.length}</span>
            </div>
            {selStats && (
              <div className="plg-selection-stat">
                <Icon name="highlight" size={12} />
                选中：{fmtNumber(selStats.words)} 字 · {fmtNumber(selStats.chars)} 字符
              </div>
            )}
            <div className="plg-goal">
              <div className="row">
                <span className="grow small">今日写作目标</span>
                <input
                  className="input"
                  style={{ width: 90, height: 26 }}
                  type="number"
                  min={100}
                  step={100}
                  value={goal}
                  onChange={(e) => context.settings.set('dailyGoal', Math.max(100, Number(e.target.value) || 1000))}
                />
              </div>
              <div className="plg-goal-bar"><i style={{ width: pct + '%' }} /></div>
              <div className="dim tiny">{todayDone} / {goal} 字（{pct}%）</div>
            </div>
          </>
        )}
      </div>
      <div className="plg-foot"><Icon name="info" size={11} /><span>数字随文档实时更新</span></div>
    </Panel>
  )
}

export default WordCountPanel
