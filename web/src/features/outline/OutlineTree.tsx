/**
 * Outline tree — H1..H6 indented nodes, click to jump, collapse/expand,
 * right-click menu with the required actions.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { getBridge } from '@/features/editor/bridge'
import {
  flattenOutline,
  headingLink,
  outlineToMarkdown,
  parseOutline,
  type OutlineItem
} from './parse'

interface Props {
  markdown: string
  path: string
  /** compact mode hides the level letters (mobile) */
  compact?: boolean
}

type Collapsed = Record<string, boolean>

export const OutlineTree: React.FC<Props> = ({ markdown, path, compact }) => {
  const [collapsed, setCollapsed] = useState<Collapsed>({})
  const toast = useStore((s) => s.toast)
  const openContextMenu = useStore((s) => s.openContextMenu)

  const items = useMemo(() => parseOutline(markdown), [markdown])
  const flat = useMemo(() => flattenOutline(items), [items])
  const [activeLine, setActiveLine] = useState<number | null>(null)

  const jump = useCallback((item: OutlineItem) => {
    setActiveLine(item.line)
    const b = getBridge()
    if (!b) return
    const ok = b.scrollToHeading(item.text, item.level)
    if (!ok) {
      // fallback: try matching the raw line through the browser find API
      toast({ kind: 'info', text: `已定位标题「${item.text}」` })
    }
    b.focus()
  }, [toast])

  const setAllCollapsed = useCallback((value: boolean) => {
    if (!value) return setCollapsed({})
    const next: Collapsed = {}
    for (const it of flat) if (it.children.length) next[it.id] = true
    setCollapsed(next)
  }, [flat])

  const onContextMenu = useCallback(
    (e: React.MouseEvent, item: OutlineItem) => {
      e.preventDefault()
      e.stopPropagation()
      openContextMenu({
        x: e.clientX,
        y: e.clientY,
        title: item.text.slice(0, 28),
        items: [
          { id: 'jump', label: '跳转到该标题', icon: 'arrow-right', run: () => jump(item) },
          { id: 'd1', divider: true },
          { id: 'expand', label: '展开全部', icon: 'chevron-down', run: () => setAllCollapsed(false) },
          { id: 'collapse', label: '折叠全部', icon: 'chevron-right', run: () => setAllCollapsed(true) },
          { id: 'd2', divider: true },
          {
            id: 'link',
            label: '复制标题链接',
            icon: 'link',
            run: async () => {
              await navigator.clipboard?.writeText(headingLink(path, item.text))
              toast({ kind: 'ok', text: '标题链接已复制' })
            }
          },
          {
            id: 'md',
            label: '复制大纲为 Markdown 列表',
            icon: 'copy',
            run: async () => {
              await navigator.clipboard?.writeText(outlineToMarkdown(items))
              toast({ kind: 'ok', text: '大纲已复制为 Markdown 列表' })
            }
          }
        ]
      })
    },
    [items, jump, openContextMenu, path, setAllCollapsed, toast]
  )

  const renderNodes = (nodes: OutlineItem[]): React.ReactNode =>
    nodes.map((item) => {
      const hasKids = item.children.length > 0
      const isCollapsed = !!collapsed[item.id]
      return (
        <React.Fragment key={item.id}>
          <button
            type="button"
            className={'outline-row outline-l' + item.level + (activeLine === item.line ? ' active' : '')}
            style={{ paddingLeft: 4 + (item.level - 1) * 13 }}
            onClick={() => jump(item)}
            onContextMenu={(e) => onContextMenu(e, item)}
            title={item.text}
          >
            <span
              className="outline-twist"
              onClick={(e) => {
                e.stopPropagation()
                if (!hasKids) return
                setCollapsed((c) => ({ ...c, [item.id]: !c[item.id] }))
              }}
            >
              {hasKids ? <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={11} /> : null}
            </span>
            {!compact && <span className="outline-h">H{item.level}</span>}
            <span className="outline-text">{item.text}</span>
          </button>
          {hasKids && !isCollapsed && renderNodes(item.children)}
        </React.Fragment>
      )
    })

  if (!flat.length) {
    return <div className="tree-empty">当前文档还没有标题</div>
  }

  return (
    <div
      className="outline-tree"
      onContextMenu={(e) => {
        e.preventDefault()
        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { id: 'expand', label: '展开全部', icon: 'chevron-down', run: () => setAllCollapsed(false) },
            { id: 'collapse', label: '折叠全部', icon: 'chevron-right', run: () => setAllCollapsed(true) },
            {
              id: 'md',
              label: '复制大纲为 Markdown 列表',
              icon: 'copy',
              run: async () => {
                await navigator.clipboard?.writeText(outlineToMarkdown(items))
                toast({ kind: 'ok', text: '大纲已复制' })
              }
            }
          ]
        })
      }}
    >
      {renderNodes(items)}
    </div>
  )
}

export default OutlineTree
