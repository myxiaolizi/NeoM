/**
 * tag-list — scans the whole vault for `#tag`, aggregates by `/` hierarchy,
 * shows counts, and filters documents. Cached + debounced through `vault.ts`.
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Row, Search, Spinner, useVaultDocs, docTitle } from '../ui'
import { buildTagTree, type ScanDoc, type TagNode } from '../vault'
import { fmtDate, truncate } from '../utils'

const TagRow: React.FC<{
  node: TagNode
  depth: number
  expanded: Record<string, boolean>
  onToggle: (full: string) => void
  onPick: (full: string) => void
  active: string | null
}> = ({ node, depth, expanded, onToggle, onPick, active }) => {
  const open = expanded[node.full.toLowerCase()] ?? depth === 0
  return (
    <>
      <div
        className={'plg-tag-row' + (active === node.full ? ' on' : '')}
        style={{ paddingLeft: 6 + depth * 13 }}
        onClick={() => onPick(node.full)}
        title={node.full}
      >
        <span
          className="plg-outline-caret"
          onClick={(e) => { e.stopPropagation(); if (node.children.length) onToggle(node.full.toLowerCase()) }}
        >
          {!!node.children.length && <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />}
        </span>
        <Icon name="tag" size={12} />
        <span className="grow ellipsis">{node.name}</span>
        <span className="plg-count">{node.count}</span>
      </div>
      {open && node.children.map((c) => (
        <TagRow key={c.full} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onPick={onPick} active={active} />
      ))}
    </>
  )
}

const DocList: React.FC<{ docs: ScanDoc[]; ctx: PluginContext; tag: string }> = ({ docs, ctx, tag }) => (
  <>
    {docs.map((d) => (
      <Row
        key={d.path}
        icon="file-text"
        title={docTitle(d)}
        sub={d.path}
        meta={fmtDate(d.mtime || Date.now())}
        onClick={() => ctx.openFile(d.path)}
        title2={truncate(d.content, 120)}
      />
    ))}
    {!docs.length && <Empty icon="tag" text={`没有笔记使用 #${tag}`} />}
  </>
)

const TagListPanel: React.FC<PanelProps> = ({ context, full }) => {
  const { docs, loading, error, progress, refresh } = useVaultDocs(context)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [active, setActive] = useState<string | null>(null)
  const [untagged, setUntagged] = useState(false)

  const tree = useMemo(() => buildTagTree(docs), [docs])
  const totalTags = useMemo(() => new Set(docs.flatMap((d) => d.tags)).size, [docs])

  const filteredTree = useMemo(() => {
    if (!query.trim()) return tree
    const q = query.toLowerCase()
    const prune = (nodes: TagNode[]): TagNode[] =>
      nodes
        .map((n) => ({ ...n, children: prune(n.children) }))
        .filter((n) => n.full.toLowerCase().includes(q) || n.children.length)
    return prune(tree)
  }, [tree, query])

  const activeDocs = useMemo(() => {
    if (untagged) return docs.filter((d) => !d.tags.length)
    if (!active) return []
    const a = active.toLowerCase()
    return docs.filter((d) => d.tags.some((t) => t.toLowerCase() === a || t.toLowerCase().startsWith(a + '/')))
  }, [docs, active, untagged])

  const pick = (full: string) => {
    setUntagged(false)
    setActive((cur) => (cur === full ? null : full))
  }

  return (
    <Panel>
      <Head
        icon="tag"
        title="标签"
        sub={`${totalTags} 个标签 · ${docs.length} 篇笔记`}
        actions={<Btn icon="refresh" title="重新扫描全库" onClick={() => refresh(true)} />}
      />
      <div className="plg-pad-x"><Search value={query} onChange={setQuery} placeholder="筛选标签…" /></div>
      {(loading || error) && (
        <div className="plg-pad-x">
          {error ? <div className="plg-error">{error}</div> : <Spinner text={progress ? `扫描中 ${progress.done}/${progress.total}` : '扫描全库…'} />}
        </div>
      )}
      <div className="plg-scroll">
        <Row
          icon="file-text"
          title="全部笔记"
          meta={docs.length}
          onClick={() => { setActive(null); setUntagged(false) }}
          active={!active && !untagged}
        />
        <Row
          icon="alert"
          title="未打标签"
          meta={docs.filter((d) => !d.tags.length).length}
          onClick={() => { setActive(null); setUntagged(true) }}
          active={untagged}
        />
        <div className="plg-divider" />
        {filteredTree.map((n) => (
          <TagRow
            key={n.full}
            node={n}
            depth={0}
            expanded={expanded}
            onToggle={(k) => setExpanded((e) => ({ ...e, [k]: !(e[k] ?? true) }))}
            onPick={pick}
            active={active}
          />
        ))}
        {!filteredTree.length && !loading && <Empty icon="tag" text="全库还没有任何 #标签" />}
        {(active || untagged) && (
          <>
            <div className="plg-divider" />
            <div className="plg-sub-title">{untagged ? '未打标签的笔记' : `#${active}`} · {activeDocs.length}</div>
            <DocList docs={activeDocs} ctx={context} tag={active || ''} />
          </>
        )}
      </div>
      <div className="plg-foot">
        <Icon name="hash" size={11} />
        <span>支持 #项目/子标签 层级聚合</span>
      </div>
    </Panel>
  )
}

export default TagListPanel
