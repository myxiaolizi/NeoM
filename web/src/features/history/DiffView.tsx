/**
 * Side-by-side diff renderer with line numbers and +/- highlighting.
 */
import React, { useMemo } from 'react'
import { diffLines, diffStat, sideBySide } from './diff'

interface Props {
  left: string
  right: string
  leftLabel?: string
  rightLabel?: string
  className?: string
}

export const DiffView: React.FC<Props> = ({ left, right, leftLabel = '本地', rightLabel = '远端', className = '' }) => {
  const { cols, stat } = useMemo(() => {
    const ops = diffLines(left, right)
    return { cols: sideBySide(ops), stat: diffStat(ops) }
  }, [left, right])

  return (
    <div className={'diff-wrap ' + className} style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '6px 10px', gap: 10, borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <span className="small muted">{leftLabel} → {rightLabel}</span>
        <span className="badge ok">+{stat.added}</span>
        <span className="badge danger">-{stat.removed}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, minHeight: 0 }}>
        <div className="diff-pane">
          <div className="diff-pane-head">
            <span className="grow ellipsis">{leftLabel}</span>
          </div>
          {cols.left.map((cell, i) => (
            <div key={'l' + i} className={'diff-line ' + cell.kind}>
              <span className="dl-no">{cell.no ?? ''}</span>
              <span className="dl-text">{cell.text || '\u00a0'}</span>
            </div>
          ))}
        </div>
        <div className="diff-pane">
          <div className="diff-pane-head">
            <span className="grow ellipsis">{rightLabel}</span>
          </div>
          {cols.right.map((cell, i) => (
            <div key={'r' + i} className={'diff-line ' + cell.kind}>
              <span className="dl-no">{cell.no ?? ''}</span>
              <span className="dl-text">{cell.text || '\u00a0'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DiffView
