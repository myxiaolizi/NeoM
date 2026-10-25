/**
 * outline — H1..H6 tree of the active document.
 * Click jumps; drag-and-drop reorders whole sections (heading + its body)
 * and writes the reordered markdown back to the vault.
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Search, Spinner, useActiveDoc } from '../ui'
import { extractHeadings, type Heading } from '../utils'

interface Section extends Heading {
  key: string
  children: Section[]
}

const buildTree = (headings: Heading[]): Section[] => {
  const roots: Section[] = []
  const stack: Section[] = []
  headings.forEach((h, i) => {
    const node: Section = { ...h, key: `h${i}-${h.offset}`, children: [] }
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  })
  return roots
}

/** Move a heading block (including its sub-headings) before another heading. */
const moveBlock = (content: string, from: Heading, to: Heading): string => {
  if (to.offset >= from.offset && to.offset < from.endOffset) return content
  const block = content.slice(from.offset, from.endOffset)
  if (!block.trim()) return content
  const rest = content.slice(0, from.offset) + content.slice(from.endOffset)
  const pos = to.offset > from.endOffset ? to.offset - block.length : to.offset
  const glued = rest.slice(0, pos) + block + rest.slice(pos)
  return glued.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
}

const OutlineRow: React.FC<{
  node: Section
  collapsed: Record<string, boolean>
  onToggle: (k: string) => void
  onJump: (h: Section) => void
  onDragStart: (h: Section) => void
  onDrop: (h: Section) => void
  dragOver: string | null
  setDragOver: (k: string | null) => void
  active: string | null
  depth: number
}> = ({ node, collapsed, onToggle, onJump, onDragStart, onDrop, dragOver, setDragOver, active, depth }) => {
  const hasKids = node.children.length > 0
  const isCollapsed = collapsed[node.key]
  return (
    <>
      <div
        className={'plg-outline-row' + (dragOver === node.key ? ' drop' : '') + (active === node.key ? ' on' : '')}
        style={{ paddingLeft: 6 + (node.level - 1) * 13 }}
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.key); onDragStart(node) }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(node.key) }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(null); onDrop(node) }}
        onClick={() => onJump(node)}
        title={node.text}
      >
        <span
          className={'plg-outline-caret' + (hasKids ? '' : ' empty')}
          onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(node.key) }}
        >
          {hasKids && <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={11} />}
        </span>
        <span className={'plg-h' + node.level}>H{node.level}</span>
        <span className="plg-outline-text ellipsis">{node.text}</span>
        <span className="plg-outline-grip"><Icon name="grip" size={11} /></span>
      </div>
      {!isCollapsed &&
        node.children.map((c) => (
          <OutlineRow
            key={c.key}
            node={c}
            collapsed={collapsed}
            onToggle={onToggle}
            onJump={onJump}
            onDragStart={onDragStart}
            onDrop={onDrop}
            dragOver={dragOver}
            setDragOver={setDragOver}
            active={active}
            depth={depth + 1}
          />
        ))}
    </>
  )
}

const OutlinePanel: React.FC<PanelProps> = ({ context, full }) => {
  const { path, content, reload } = useActiveDoc(context)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragSource, setDragSource] = useState<Heading | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const headings = useMemo(() => extractHeadings(content), [content])
  const tree = useMemo(() => buildTree(headings), [headings])
  const filtered = useMemo(() => {
    if (!query.trim()) return tree
    const q = query.toLowerCase()
    const prune = (nodes: Section[]): Section[] =>
      nodes
        .map((n) => ({ ...n, children: prune(n.children) }))
        .filter((n) => n.text.toLowerCase().includes(q) || n.children.length)
    return prune(tree)
  }, [tree, query])

  const jump = (h: Section) => {
    setActive(h.key)
    window.dispatchEvent(new CustomEvent('neom:outline-jump', { detail: { offset: h.offset, heading: h.text } }))
    try { document.querySelectorAll('.vditor-reset h1,.vditor-reset h2,.vditor-reset h3,.vditor-reset h4,.vditor-reset h5,.vditor-reset h6').forEach((el) => {
      if ((el.textContent || '').trim() === h.text.trim()) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }) } catch { /* noop */ }
  }

  const handleDrop = async (target: Section) => {
    const from = dragSource
    setDragSource(null)
    if (!from || !path || busy) return
    if (from.offset === target.offset) return
    const next = moveBlock(content, from, target)
    if (next === content) return
    setBusy(true)
    try {
      await context.vault.write(path, next)
      context.toast('章节顺序已写回文档', 'ok')
      reload()
    } catch (e: any) {
      context.toast(e?.message || '写回失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <Head
        icon="headings"
        title="大纲"
        sub={path ? `${path.split('/').pop()} · ${headings.length} 个标题` : '未打开文档'}
        actions={
          <>
            <Btn icon="chevron-up" title="全部折叠" onClick={() => setCollapsed(Object.fromEntries(headings.map((x, i) => [`h${i}-${x.offset}`, true])))} />
            <Btn icon="chevron-down" title="全部展开" onClick={() => setCollapsed({})} />
          </>
        }
      />
      <div className="plg-pad-x"><Search value={query} onChange={setQuery} placeholder="筛选标题…" /></div>
      <div className="plg-scroll">
        {!path && <Empty icon="file" text="请先打开一篇文档" />}
        {path && !headings.length && <Empty icon="headings" text="文档中没有标题" />}
        {!!headings.length && filtered.length === 0 && <Empty icon="search" text="没有匹配的标题" />}
        {filtered.map((n) => (
          <OutlineRow
            key={n.key}
            node={n}
            collapsed={collapsed}
            onToggle={(k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))}
            onJump={jump}
            onDragStart={setDragSource}
            onDrop={handleDrop}
            dragOver={dragOver}
            setDragOver={setDragOver}
            active={active}
            depth={0}
          />
        ))}
        {busy && <Spinner text="写回中…" />}
      </div>
      <div className="plg-foot">
        <Icon name="info" size={11} />
        <span>拖拽标题可连同正文整段重排</span>
      </div>
    </Panel>
  )
}

export default OutlinePanel
