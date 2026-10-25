/**
 * backlinks — every note that references the active document, with context
 * snippets. Also lists "unlinked mentions" (plain title occurrences).
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Row, Spinner, useActiveDoc, useVaultDocs, docTitle } from '../ui'
import { backlinkDocs } from '../vault'
import { truncate } from '../utils'

const BacklinksPanel: React.FC<PanelProps> = ({ context }) => {
  const { path } = useActiveDoc(context)
  const { docs, loading, refresh } = useVaultDocs(context)
  const [showMentions, setShowMentions] = useState(false)

  const hits = useMemo(() => (path ? backlinkDocs(docs, path) : []), [docs, path])

  const mentions = useMemo(() => {
    if (!path) return []
    const stem = (path.split('/').pop() || '').replace(/\.(md|mdx|txt)$/i, '')
    if (!stem) return []
    return docs.filter((d) => d.path !== path && d.content.includes(stem) && !d.links.some((l) => l.kind === 'wiki' && l.target.includes(stem)))
  }, [docs, path])

  const total = hits.reduce((n, h) => n + h.contexts.length, 0)

  return (
    <Panel>
      <Head
        icon="link"
        title="反向链接"
        sub={path ? `${path.split('/').pop()} · ${hits.length} 篇引用` : '未打开文档'}
        actions={<Btn icon="refresh" title="刷新" onClick={() => refresh(true)} />}
      />
      <div className="plg-scroll">
        {loading && <Spinner text="扫描全库…" />}
        {!path && <Empty icon="file" text="请先打开一篇文档" />}
        {path && !loading && !hits.length && <Empty icon="link" text="还没有笔记引用当前文档" />}
        {hits.map(({ doc, contexts }) => (
          <div key={doc.path} className="plg-backlink-group">
            <Row
              icon="file-text"
              title={docTitle(doc)}
              sub={doc.path}
              meta={contexts.length}
              onClick={() => context.openFile(doc.path)}
            />
            {contexts.map((c, i) => (
              <div
                key={i}
                className="plg-context"
                onClick={() => {
                  context.openFile(doc.path)
                  setTimeout(() => window.dispatchEvent(new CustomEvent('neom:outline-jump', { detail: { offset: 0, line: c.line } })), 220)
                }}
                title={c.text}
              >
                <span className="plg-context-line">L{c.line}</span>
                <span className="plg-context-text ellipsis">{truncate(c.text, 120)}</span>
              </div>
            ))}
          </div>
        ))}
        {!!hits.length && (
          <div className="plg-total"><Icon name="info" size={11} /> 共 {total} 处引用，来自 {hits.length} 篇笔记</div>
        )}
        <div className="plg-divider" />
        <Row
          icon={showMentions ? 'chevron-down' : 'chevron-right'}
          title="未链接的提及"
          meta={mentions.length}
          onClick={() => setShowMentions((v) => !v)}
        />
        {showMentions &&
          (mentions.length ? (
            mentions.slice(0, 60).map((d) => (
              <Row key={d.path} icon="file" title={docTitle(d)} sub={d.path} onClick={() => context.openFile(d.path)} />
            ))
          ) : (
            <div className="plg-dim plg-pad">没有找到纯文本提及</div>
          ))}
      </div>
    </Panel>
  )
}

export default BacklinksPanel
