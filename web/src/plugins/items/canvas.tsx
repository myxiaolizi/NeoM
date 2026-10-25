/**
 * canvas — infinite whiteboard with cards / notes / text nodes, bezier edges,
 * rubber-band selection, pan + zoom, mind-map auto layout, and persistence to
 * a `.canvas` JSON file inside the vault.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { EVT } from '@/lib/contracts'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Segmented } from '../ui'
import { uid } from '../utils'

type NodeKind = 'card' | 'note' | 'text'

interface CNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  w: number
  h: number
  text: string
  color?: string
}

interface CEdge { id: string; from: string; to: string }

interface Board {
  version: 1
  nodes: CNode[]
  edges: CEdge[]
}

const EMPTY: Board = { version: 1, nodes: [], edges: [] }

const NOTE_COLORS = ['#fdf3c8', '#ffe0e0', '#e0f2ff', '#e3fbe0', '#f0e6ff']

interface CanvasState { board: Board; path: string | null }
let latest: CanvasState = { board: EMPTY, path: null }

const mkNode = (kind: NodeKind, x: number, y: number, text = ''): CNode => {
  const w = kind === 'text' ? 200 : kind === 'note' ? 220 : 240
  const h = kind === 'text' ? 44 : kind === 'note' ? 150 : 130
  return {
    id: uid('n'),
    kind,
    x: Math.round(x),
    y: Math.round(y),
    w,
    h,
    text: text || (kind === 'card' ? '新卡片' : kind === 'note' ? '便签' : '文字'),
    color: kind === 'note' ? NOTE_COLORS[0] : undefined
  }
}

const parseBoard = (raw: string): Board => {
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.nodes)) return EMPTY
    return {
      version: 1,
      nodes: data.nodes.map((n: any, i: number) => ({
        id: String(n.id || uid('n')),
        kind: (n.kind || n.type || 'card') as NodeKind,
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        w: Number(n.w || n.width) || 240,
        h: Number(n.h || n.height) || 130,
        text: String(n.text ?? n.label ?? ''),
        color: n.color
      })),
      edges: Array.isArray(data.edges)
        ? data.edges.map((e: any) => ({
            id: String(e.id || uid('e')),
            from: String(e.from ?? e.fromNode ?? ''),
            to: String(e.to ?? e.toNode ?? '')
          })).filter((e: CEdge) => e.from && e.to)
        : []
    }
  } catch {
    return EMPTY
  }
}

const serialize = (board: Board) => JSON.stringify({ ...board, app: 'NeoM', type: 'canvas' }, null, 2)

/** mind-map layout: BFS from the most-connected node, columns by depth */
const mindMapLayout = (board: Board): Board => {
  if (!board.nodes.length) return board
  const deg = new Map<string, number>()
  board.nodes.forEach((n) => deg.set(n.id, 0))
  board.edges.forEach((e) => {
    deg.set(e.from, (deg.get(e.from) || 0) + 1)
    deg.set(e.to, (deg.get(e.to) || 0) + 1)
  })
  const root = [...board.nodes].sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0))[0]
  const depth = new Map<string, number>([[root.id, 0]])
  const queue = [root.id]
  const adj = new Map<string, string[]>()
  board.edges.forEach((e) => {
    if (!adj.has(e.from)) adj.set(e.from, [])
    if (!adj.has(e.to)) adj.set(e.to, [])
    adj.get(e.from)!.push(e.to)
    adj.get(e.to)!.push(e.from)
  })
  while (queue.length) {
    const cur = queue.shift()!
    for (const nx of adj.get(cur) || []) {
      if (depth.has(nx)) continue
      depth.set(nx, (depth.get(cur) || 0) + 1)
      queue.push(nx)
    }
  }
  let maxDepth = 0
  depth.forEach((v) => { maxDepth = Math.max(maxDepth, v) })
  const columns = new Map<number, CNode[]>()
  board.nodes.forEach((n) => {
    const d = depth.get(n.id) ?? maxDepth + 1
    if (!columns.has(d)) columns.set(d, [])
    columns.get(d)!.push(n)
  })
  const gapX = 320
  const gapY = 170
  columns.forEach((nodes, d) => {
    nodes.forEach((n, i) => {
      n.x = d * gapX
      n.y = (i - (nodes.length - 1) / 2) * gapY
      n.w = 240
      n.h = n.kind === 'text' ? 44 : 130
    })
  })
  return { ...board, nodes: [...board.nodes] }
}

/* ------------------------------------------------------------- commands */
export const saveBoard = async (ctx: PluginContext) => {
  const { board, path } = latest
  if (!board.nodes.length) { ctx.toast('画板还是空的', 'warn'); return }
  try {
    let target = path
    if (!target) {
      const name = `画板-${new Date().toISOString().slice(0, 10)}.canvas`
      target = await ctx.createFile(name, serialize(board), '画板')
      latest = { ...latest, path: target }
    } else {
      await ctx.vault.write(target, serialize(board))
    }
    ctx.toast(`已保存到 ${target}`, 'ok')
    ctx.refreshTree()
  } catch (e: any) {
    ctx.toast(e?.message || '保存失败', 'error')
  }
}

export const newBoard = (ctx: PluginContext) => {
  latest = { board: EMPTY, path: null }
  window.dispatchEvent(new CustomEvent('neom:canvas-new'))
  ctx.toast('已新建空白画板', 'ok')
}

/* ---------------------------------------------------------------- panel */
const CanvasPanel: React.FC<PanelProps> = ({ context, full, onClose }) => {
  const vpRef = useRef<HTMLDivElement | null>(null)
  const [board, setBoard] = useState<Board>(EMPTY)
  const [view, setView] = useState({ x: 80, y: 60, k: 1 })
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const [tool, setTool] = useState<'select' | 'pan'>('select')
  const drag = useRef<{ mode: 'none' | 'pan' | 'node' | 'rubber' | 'edge'; start: { x: number; y: number }; orig?: Record<string, { x: number; y: number }>; nodeId?: string }>({ mode: 'none', start: { x: 0, y: 0 } })
  const [rubber, setRubber] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  const commit = useCallback((next: Board) => {
    latest = { board: next, path }
    setBoard(next)
  }, [path])

  /* load current .canvas file if the active doc is a board */
  useEffect(() => {
    let alive = true
    const load = async () => {
      let active: string | null = null
      try { active = context.getActivePath?.() ?? null } catch { active = null }
      if (!active || !/\.canvas$/i.test(active)) return
      try {
        const raw = await context.vault.read(active)
        const text = typeof raw === 'string' ? raw : raw?.content || ''
        if (!alive) return
        const parsed = parseBoard(text)
        latest = { board: parsed, path: active }
        setBoard(parsed)
        setPath(active)
      } catch { /* not a board yet */ }
    }
    void load()
    const onNew = () => { setBoard(EMPTY); setPath(null); setSelected([]) }
    window.addEventListener('neom:canvas-new', onNew)
    window.addEventListener(EVT.docOpened, load)
    return () => {
      alive = false
      window.removeEventListener('neom:canvas-new', onNew)
      window.removeEventListener(EVT.docOpened, load)
    }
  }, [context])

  const world = (clientX: number, clientY: number) => {
    const rect = vpRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }
  }

  const addNode = (kind: NodeKind) => {
    const center = vpRef.current
      ? world(vpRef.current.getBoundingClientRect().left + vpRef.current.clientWidth / 2, vpRef.current.getBoundingClientRect().top + vpRef.current.clientHeight / 2)
      : { x: 200, y: 200 }
    const node = mkNode(kind, center.x - 120, center.y - 60)
    commit({ ...board, nodes: [...board.nodes, node] })
    setSelected([node.id])
  }

  const removeSelected = useCallback(() => {
    if (!selected.length) return
    const ids = new Set(selected)
    commit({
      ...board,
      nodes: board.nodes.filter((n) => !ids.has(n.id)),
      edges: board.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to))
    })
    setSelected([])
  }, [board, selected, commit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.closest('input,textarea,[contenteditable="true"]')) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected() }
      if (e.key === 'Escape') setSelected([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeSelected])

  /* -------------------------------------------------------- interactions */
  const onBgDown = (e: React.MouseEvent) => {
    if (e.button === 1 || tool === 'pan') {
      drag.current = { mode: 'pan', start: { x: e.clientX - view.x, y: e.clientY - view.y } }
      return
    }
    if (e.button !== 0) return
    const p = world(e.clientX, e.clientY)
    drag.current = { mode: 'rubber', start: p }
    setRubber({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  }

  const onNodeDown = (e: React.MouseEvent, node: CNode) => {
    e.stopPropagation()
    if (e.button === 1) { drag.current = { mode: 'pan', start: { x: e.clientX - view.x, y: e.clientY - view.y } }; return }
    if (e.shiftKey) {
      setSelected((s) => (s.includes(node.id) ? s.filter((x) => x !== node.id) : [...s, node.id]))
    } else if (!selected.includes(node.id)) {
      setSelected([node.id])
    }
    const orig: Record<string, { x: number; y: number }> = {}
    const ids = selected.includes(node.id) ? selected : [node.id]
    ids.forEach((id) => {
      const n = board.nodes.find((x) => x.id === id)
      if (n) orig[id] = { x: n.x, y: n.y }
    })
    drag.current = { mode: 'node', start: { x: e.clientX, y: e.clientY }, orig, nodeId: node.id }
  }

  const onMove = (e: React.MouseEvent) => {
    const p = world(e.clientX, e.clientY)
    setCursor(p)
    const d = drag.current
    if (d.mode === 'pan') {
      setView((v) => ({ ...v, x: e.clientX - d.start.x, y: e.clientY - d.start.y }))
    } else if (d.mode === 'node' && d.orig) {
      const dx = (e.clientX - d.start.x) / view.k
      const dy = (e.clientY - d.start.y) / view.k
      setBoard((b) => ({
        ...b,
        nodes: b.nodes.map((n) => (d.orig![n.id] ? { ...n, x: Math.round(d.orig![n.id].x + dx), y: Math.round(d.orig![n.id].y + dy) } : n))
      }))
    } else if (d.mode === 'rubber') {
      setRubber({ x1: d.start.x, y1: d.start.y, x2: p.x, y2: p.y })
    }
  }

  const onUp = (e: React.MouseEvent) => {
    const d = drag.current
    if (d.mode === 'node' && d.orig) {
      commit({ ...board, nodes: board.nodes })
    } else if (d.mode === 'rubber' && rubber) {
      const x1 = Math.min(rubber.x1, rubber.x2)
      const x2 = Math.max(rubber.x1, rubber.x2)
      const y1 = Math.min(rubber.y1, rubber.y2)
      const y2 = Math.max(rubber.y1, rubber.y2)
      if (Math.abs(x2 - x1) > 8 && Math.abs(y2 - y1) > 8) {
        const hit = board.nodes.filter((n) => n.x + n.w > x1 && n.x < x2 && n.y + n.h > y1 && n.y < y2)
        setSelected(hit.map((n) => n.id))
      } else {
        setSelected([])
      }
      setRubber(null)
    }
    drag.current = { mode: 'none', start: { x: 0, y: 0 } }
    void e
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const rect = vpRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const k = Math.max(0.25, Math.min(3, view.k * factor))
    setView({ x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k, k })
  }

  const startLink = (e: React.MouseEvent, from: string) => {
    e.stopPropagation()
    setLinkFrom(from)
  }

  const finishLink = (e: React.MouseEvent, to: string) => {
    e.stopPropagation()
    if (!linkFrom || linkFrom === to) { setLinkFrom(null); return }
    if (board.edges.some((x) => (x.from === linkFrom && x.to === to) || (x.from === to && x.to === linkFrom))) {
      setLinkFrom(null); return
    }
    commit({ ...board, edges: [...board.edges, { id: uid('e'), from: linkFrom, to }] })
    setLinkFrom(null)
  }

  const setText = (id: string, text: string) => {
    commit({ ...board, nodes: board.nodes.map((n) => (n.id === id ? { ...n, text } : n)) })
  }

  const nodeById = useMemo(() => new Map(board.nodes.map((n) => [n.id, n])), [board.nodes])

  const bezier = (a: CNode, b: CNode) => {
    const ax = a.x + a.w
    const ay = a.y + a.h / 2
    const bx = b.x
    const by = b.y + b.h / 2
    const dx = Math.max(40, Math.abs(bx - ax) * 0.45)
    return `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`
  }

  const zoomBy = (f: number) => setView((v) => ({ ...v, k: Math.max(0.25, Math.min(3, v.k * f)) }))
  const fit = () => {
    if (!board.nodes.length || !vpRef.current) return
    const minX = Math.min(...board.nodes.map((n) => n.x))
    const minY = Math.min(...board.nodes.map((n) => n.y))
    const maxX = Math.max(...board.nodes.map((n) => n.x + n.w))
    const maxY = Math.max(...board.nodes.map((n) => n.y + n.h))
    const vp = vpRef.current
    const k = Math.max(0.25, Math.min(1.6, Math.min((vp.clientWidth - 80) / (maxX - minX), (vp.clientHeight - 80) / (maxY - minY))))
    setView({ x: 40 - minX * k + (vp.clientWidth - 80 - (maxX - minX) * k) / 2, y: 40 - minY * k + (vp.clientHeight - 80 - (maxY - minY) * k) / 2, k })
  }

  const loadFromVault = async () => {
    try {
      const list = await context.vault.list()
      const boards = (list || []).filter((f: any) => /\.canvas$/i.test(f.path || f.id || ''))
      if (!boards.length) { context.toast('仓库里还没有 .canvas 文件', 'warn'); return }
      const pick = window.prompt(`打开画板（输入序号）：\n${boards.map((b: any, i: number) => `${i + 1}. ${b.path}`).join('\n')}`, '1')
      if (!pick) return
      const target = boards[Math.max(0, Number(pick) - 1)]
      if (!target) return
      const raw = await context.vault.read(target.path)
      const parsed = parseBoard(typeof raw === 'string' ? raw : raw?.content || '')
      latest = { board: parsed, path: target.path }
      setBoard(parsed)
      setPath(target.path)
      fit()
      context.toast(`已打开 ${target.path}`, 'ok')
    } catch (e: any) {
      context.toast(e?.message || '打开失败', 'error')
    }
  }

  return (
    <Panel className="plg-canvas">
      <Head
        icon="canvas"
        title="白板"
        sub={`${board.nodes.length} 节点 · ${board.edges.length} 连线${path ? ' · ' + path.split('/').pop() : ' · 未保存'}`}
        actions={
          <>
            <Btn icon="plus" title="卡片" onClick={() => addNode('card')}>卡片</Btn>
            <Btn icon="pin" title="便签" onClick={() => addNode('note')}>便签</Btn>
            <Btn icon="file-text" title="文字" onClick={() => addNode('text')}>文字</Btn>
            <Btn icon="layers" title="思维导图布局" onClick={() => commit(mindMapLayout(board))}>导图</Btn>
            <Btn icon="save" title="保存" primary onClick={() => void saveBoard(context)}>保存</Btn>
            <Btn icon="folder-open" title="打开画板" onClick={loadFromVault} />
            <Btn icon="zoom-out" title="缩小" onClick={() => zoomBy(0.85)} />
            <Btn icon="zoom-in" title="放大" onClick={() => zoomBy(1.15)} />
            <Btn icon="maximize" title="适应窗口" onClick={fit} />
            <Btn icon={tool === 'pan' ? 'grip' : 'edit'} active={tool === 'pan'} title="平移模式" onClick={() => setTool((t) => (t === 'pan' ? 'select' : 'pan'))} />
            {full && onClose && <Btn icon="x" onClick={onClose} title="关闭" />}
          </>
        }
      />
      <div
        className={'plg-cv-vp' + (tool === 'pan' ? ' pan' : '') + (linkFrom ? ' linking' : '')}
        ref={vpRef}
        onMouseDown={onBgDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return
          const p = world(e.clientX, e.clientY)
          const node = mkNode('card', p.x - 100, p.y - 40)
          commit({ ...board, nodes: [...board.nodes, node] })
          setEditing(node.id)
        }}
      >
        <div className="plg-cv-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="plg-cv-edges">
            {board.edges.map((e) => {
              const a = nodeById.get(e.from)
              const b = nodeById.get(e.to)
              if (!a || !b) return null
              const active = selected.includes(e.from) || selected.includes(e.to)
              return (
                <g key={e.id}>
                  <path d={bezier(a, b)} className={'plg-cv-edge' + (active ? ' on' : '')} />
                  <circle cx={(a.x + a.w + b.x) / 2} cy={(a.y + b.y) / 2 + 20} r={0} />
                </g>
              )
            })}
          </svg>
          {board.nodes.map((n) => (
            <div
              key={n.id}
              className={['plg-cv-node', 'kind-' + n.kind, selected.includes(n.id) ? 'on' : '', linkFrom === n.id ? 'linking' : ''].filter(Boolean).join(' ')}
              style={{ left: n.x, top: n.y, width: n.w, minHeight: n.h, background: n.color }}
              onMouseDown={(e) => onNodeDown(e, n)}
              onMouseUp={(e) => { if (linkFrom) finishLink(e, n.id) }}
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(n.id) }}
            >
              {editing === n.id ? (
                <textarea
                  autoFocus
                  className="plg-cv-input"
                  defaultValue={n.text}
                  onBlur={(e) => { setText(n.id, e.target.value); setEditing(null) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.currentTarget.blur() }
                    e.stopPropagation()
                  }}
                />
              ) : (
                <div className="plg-cv-text">{n.text}</div>
              )}
              <span className="plg-cv-handle" title="拖到另一个节点建立连线" onMouseDown={(e) => startLink(e, n.id)}>
                <Icon name="link" size={10} />
              </span>
              {n.kind === 'note' && (
                <span className="plg-cv-color" onClick={(e) => {
                  e.stopPropagation()
                  const idx = NOTE_COLORS.indexOf(n.color || NOTE_COLORS[0])
                  commit({ ...board, nodes: board.nodes.map((x) => (x.id === n.id ? { ...x, color: NOTE_COLORS[(idx + 1) % NOTE_COLORS.length] } : x)) })
                }} />
              )}
            </div>
          ))}
        </div>
        {rubber && (
          <div
            className="plg-cv-rubber"
            style={{
              left: Math.min(rubber.x1, rubber.x2) * view.k + view.x,
              top: Math.min(rubber.y1, rubber.y2) * view.k + view.y,
              width: Math.abs(rubber.x2 - rubber.x1) * view.k,
              height: Math.abs(rubber.y2 - rubber.y1) * view.k
            }}
          />
        )}
        {!board.nodes.length && (
          <div className="plg-cv-hint">
            <Empty icon="canvas" text={<>双击空白处新建卡片，或用工具栏添加卡片/便签/文字<br />拖拽节点右侧 ○ 手柄可连线</>} />
          </div>
        )}
        <div className="plg-cv-status">
          <span>x {Math.round(cursor.x)} · y {Math.round(cursor.y)}</span>
          <span>{Math.round(view.k * 100)}%</span>
          {selected.length > 0 && (
            <button type="button" className="plg-cv-del" onClick={removeSelected}>
              <Icon name="trash" size={11} /> 删除选中 {selected.length}
            </button>
          )}
        </div>
      </div>
    </Panel>
  )
}

export default CanvasPanel
