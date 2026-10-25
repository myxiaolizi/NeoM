/**
 * graph — relation graph with a hand-rolled force simulation.
 * No d3: repulsion (Barnes-Hut-free O(n²) with a node cap), spring edges,
 * centering gravity, velocity damping, all rendered on a 2D canvas.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Segmented, Spinner, useActiveDoc, useVaultDocs, docTitle } from '../ui'

interface SimNode {
  id: string
  label: string
  path: string
  deg: number
  x: number
  y: number
  vx: number
  vy: number
  r: number
  fixed?: boolean
}

interface SimEdge { a: number; b: number }

const MAX_NODES = 240
const MAX_LOCAL = 120

const GraphPanel: React.FC<PanelProps> = ({ context, full, onClose }) => {
  const { docs, loading } = useVaultDocs(context)
  const { path: activePath } = useActiveDoc(context)
  const [mode, setMode] = useState<'global' | 'local'>('global')
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<SimEdge[]>([])
  const viewRef = useRef({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ node?: SimNode; sx: number; sy: number; moved: boolean; pan?: boolean }>({ sx: 0, sy: 0, moved: false })
  const hoverRef = useRef<string | null>(null)
  const rafRef = useRef(0)
  const alphaRef = useRef(1)

  /* ---------------------------------------------------------- graph data */
  const graphData = useMemo(() => {
    if (!docs.length) return { nodes: [] as SimNode[], edges: [] as SimEdge[], truncated: 0 }
    const byStem = new Map<string, number>()
    docs.forEach((d) => byStem.set(d.stem.toLowerCase(), docs.indexOf(d)))
    let pool = docs
    let truncated = 0
    if (mode === 'local') {
      const center = docs.findIndex((d) => d.path === activePath)
      if (center < 0) return { nodes: [], edges: [], truncated: 0 }
      const hop = new Map<number, number>([[center, 0]])
      for (let depth = 0; depth < 2; depth++) {
        const frontier = Array.from(hop.entries()).filter(([, v]) => v === depth).map(([k]) => k)
        for (const idx of frontier) {
          for (const l of docs[idx].links) {
            if (l.kind !== 'wiki') continue
            const t = byStem.get(l.target.split('/').pop()!.replace(/\.(md|mdx|txt)$/i, '').toLowerCase())
            if (t !== undefined && !hop.has(t)) hop.set(t, depth + 1)
          }
          docs.forEach((d, i) => {
            if (hop.has(i)) return
            if (d.links.some((l) => l.kind === 'wiki' && l.target.toLowerCase().includes(docs[idx].stem.toLowerCase()))) hop.set(i, depth + 1)
          })
        }
      }
      pool = Array.from(hop.keys()).map((i) => docs[i]).slice(0, MAX_LOCAL)
      pool = pool.length ? pool : [docs[center]]
    }
    const kept = pool.slice(0, mode === 'local' ? MAX_LOCAL : MAX_NODES)
    truncated = pool.length - kept.length
    const index = new Map<string, number>()
    kept.forEach((d, i) => index.set(d.path, i))
    const nodes: SimNode[] = kept.map((d, i) => ({
      id: d.path,
      label: docTitle(d),
      path: d.path,
      deg: 0,
      x: Math.cos((i / kept.length) * Math.PI * 2) * 220 + (Math.random() - 0.5) * 60,
      y: Math.sin((i / kept.length) * Math.PI * 2) * 220 + (Math.random() - 0.5) * 60,
      vx: 0,
      vy: 0,
      r: 4
    }))
    const edgeSet = new Set<string>()
    const edges: SimEdge[] = []
    kept.forEach((d, ai) => {
      for (const l of d.links) {
        if (l.kind !== 'wiki') continue
        const stem = l.target.split('#')[0].split('/').pop()!.replace(/\.(md|mdx|txt)$/i, '').toLowerCase()
        const bi = byStem.get(stem)
        if (bi === undefined) continue
        const bPath = docs[bi].path
        const bNode = index.get(bPath)
        if (bNode === undefined || bNode === ai) continue
        const key = ai < bNode ? `${ai}-${bNode}` : `${bNode}-${ai}`
        if (edgeSet.has(key)) continue
        edgeSet.add(key)
        edges.push({ a: ai, b: bNode })
        nodes[ai].deg++
        nodes[bNode].deg++
      }
    })
    nodes.forEach((n) => { n.r = 3.4 + Math.min(8, Math.sqrt(n.deg) * 2.1) })
    return { nodes, edges, truncated }
  }, [docs, mode, activePath])

  useEffect(() => {
    nodesRef.current = graphData.nodes
    edgesRef.current = graphData.edges
    alphaRef.current = 1
    if (wrapRef.current) {
      const el = wrapRef.current
      viewRef.current = { x: el.clientWidth / 2, y: el.clientHeight / 2, k: 1 }
    }
  }, [graphData])

  /* ------------------------------------------------------------ renderer */
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, wrap.clientWidth * dpr)
      canvas.height = Math.max(1, wrap.clientHeight * dpr)
      canvas.style.width = wrap.clientWidth + 'px'
      canvas.style.height = wrap.clientHeight + 'px'
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const tick = () => {
      const nodes = nodesRef.current
      const edges = edgesRef.current
      const alpha = Math.max(0.02, alphaRef.current)
      if (nodes.length) {
        // pairwise repulsion
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i]
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j]
            let dx = a.x - b.x
            let dy = a.y - b.y
            let d2 = dx * dx + dy * dy
            if (d2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = 1 }
            if (d2 > 360000) continue
            const f = 2600 / d2
            const d = Math.sqrt(d2)
            const fx = (dx / d) * f
            const fy = (dy / d) * f
            a.vx += fx; a.vy += fy
            b.vx -= fx; b.vy -= fy
          }
        }
        // spring edges
        for (const e of edges) {
          const a = nodes[e.a]
          const b = nodes[e.b]
          if (!a || !b) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
          const target = 96
          const f = (d - target) * 0.012 * alpha
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          if (!a.fixed) { a.vx += fx; a.vy += fy }
          if (!b.fixed) { b.vx -= fx; b.vy -= fy }
        }
        // gravity + integrate
        for (const n of nodes) {
          if (n.fixed) { n.vx = 0; n.vy = 0; continue }
          n.vx -= n.x * 0.0012 * alpha
          n.vy -= n.y * 0.0012 * alpha
          n.vx *= 0.86
          n.vy *= 0.86
          const sp = Math.hypot(n.vx, n.vy)
          if (sp > 22) { n.vx = (n.vx / sp) * 22; n.vy = (n.vy / sp) * 22 }
          n.x += n.vx
          n.y += n.vy
        }
        alphaRef.current = alpha * 0.995
        if (alpha > 0.06) alphaRef.current = Math.max(alpha * 0.995, 0.06)
      }

      /* paint */
      const v = viewRef.current
      const W = wrap.clientWidth
      const H = wrap.clientHeight
      ctx2d.clearRect(0, 0, W, H)
      ctx2d.save()
      ctx2d.translate(v.x, v.y)
      ctx2d.scale(v.k, v.k)

      const hov = hoverRef.current
      const hoverNode = hov ? nodes.find((n) => n.id === hov) : null
      const neighbors = new Set<string>()
      if (hoverNode) {
        const hi = nodes.indexOf(hoverNode)
        neighbors.add(hoverNode.id)
        edges.forEach((e) => {
          if (e.a === hi) neighbors.add(nodes[e.b].id)
          if (e.b === hi) neighbors.add(nodes[e.a].id)
        })
      }

      const styles = getComputedStyle(document.documentElement)
      const accent = styles.getPropertyValue('--accent').trim() || '#2f6fed'
      const text3 = styles.getPropertyValue('--text-3').trim() || '#8a91a0'
      const border = styles.getPropertyValue('--border-strong').trim() || 'rgba(0,0,0,.15)'

      ctx2d.strokeStyle = border
      ctx2d.lineWidth = 1 / v.k
      for (const e of edges) {
        const a = nodes[e.a]
        const b = nodes[e.b]
        if (!a || !b) continue
        const active = !hoverNode || (neighbors.has(a.id) && neighbors.has(b.id))
        ctx2d.globalAlpha = active ? (hoverNode ? 0.85 : 0.42) : 0.08
        ctx2d.beginPath()
        ctx2d.moveTo(a.x, a.y)
        ctx2d.lineTo(b.x, b.y)
        ctx2d.stroke()
      }
      ctx2d.globalAlpha = 1
      ctx2d.font = `${11 / v.k}px var(--font-ui, sans-serif)`
      for (const n of nodes) {
        const dim = hoverNode && !neighbors.has(n.id)
        ctx2d.globalAlpha = dim ? 0.22 : 1
        ctx2d.beginPath()
        ctx2d.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx2d.fillStyle = n.path === activePath ? accent : selected === n.id ? accent : '#7d8aa6'
        ctx2d.fill()
        if (n.path === activePath) {
          ctx2d.strokeStyle = accent
          ctx2d.lineWidth = 2 / v.k
          ctx2d.stroke()
        }
        if (v.k > 0.75 || hoverNode?.id === n.id || n.deg > 4) {
          ctx2d.fillStyle = text3
          const label = n.label.length > 18 ? n.label.slice(0, 18) + '…' : n.label
          ctx2d.fillText(label, n.x + n.r + 4 / v.k, n.y + 3.5 / v.k)
        }
      }
      ctx2d.globalAlpha = 1
      ctx2d.restore()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [activePath, selected])

  /* ---------------------------------------------------------- interaction */
  const toWorld = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current!
    const rect = wrap.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k }
  }

  const nodeAt = (clientX: number, clientY: number) => {
    const p = toWorld(clientX, clientY)
    const nodes = nodesRef.current
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if ((n.x - p.x) ** 2 + (n.y - p.y) ** 2 <= (n.r + 5) ** 2) return n
    }
    return null
  }

  const onDown = (e: React.MouseEvent) => {
    const n = nodeAt(e.clientX, e.clientY)
    if (n) {
      n.fixed = true
      dragRef.current = { node: n, sx: e.clientX, sy: e.clientY, moved: false }
      setSelected(n.id)
      alphaRef.current = Math.max(alphaRef.current, 0.35)
    } else {
      dragRef.current = { sx: e.clientX, sy: e.clientY, moved: false, pan: true }
    }
  }

  const onMove = (e: React.MouseEvent) => {
    const drag = dragRef.current
    if (drag.node) {
      const p = toWorld(e.clientX, e.clientY)
      drag.node.x = p.x
      drag.node.y = p.y
      drag.moved = true
      return
    }
    if (drag.pan) {
      const v = viewRef.current
      v.x += e.clientX - drag.sx
      v.y += e.clientY - drag.sy
      drag.sx = e.clientX
      drag.sy = e.clientY
      drag.moved = true
      return
    }
    const n = nodeAt(e.clientX, e.clientY)
    const id = n?.id || null
    if (id !== hoverRef.current) {
      hoverRef.current = id
      setHover(id)
    }
  }

  const onUp = (e: React.MouseEvent) => {
    const drag = dragRef.current
    if (drag.node) {
      drag.node.fixed = false
      if (!drag.moved) context.openFile(drag.node.path)
      dragRef.current = { sx: 0, sy: 0, moved: false }
      return
    }
    dragRef.current = { sx: 0, sy: 0, moved: false }
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const v = viewRef.current
    const wrap = wrapRef.current!
    const rect = wrap.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 0.89
    const k = Math.max(0.2, Math.min(3.5, v.k * factor))
    v.x = mx - ((mx - v.x) / v.k) * k
    v.y = my - ((my - v.y) / v.k) * k
    v.k = k
  }

  const zoom = (dir: number) => {
    const v = viewRef.current
    v.k = Math.max(0.2, Math.min(3.5, v.k * (dir > 0 ? 1.2 : 0.83)))
  }

  const fit = () => {
    const nodes = nodesRef.current
    const wrap = wrapRef.current
    if (!nodes.length || !wrap) return
    const xs = nodes.map((n) => n.x)
    const ys = nodes.map((n) => n.y)
    const minX = Math.min(...xs); const maxX = Math.max(...xs)
    const minY = Math.min(...ys); const maxY = Math.max(...ys)
    const k = Math.min(2, Math.max(0.25, Math.min(wrap.clientWidth / (maxX - minX + 160), wrap.clientHeight / (maxY - minY + 160))))
    viewRef.current = {
      x: wrap.clientWidth / 2 - ((minX + maxX) / 2) * k,
      y: wrap.clientHeight / 2 - ((minY + maxY) / 2) * k,
      k
    }
  }

  const hoverNode = hover ? graphData.nodes.find((n) => n.id === hover) : null

  return (
    <Panel className="plg-graph">
      <Head
        icon="graph"
        title="关系图谱"
        sub={`${graphData.nodes.length} 节点 · ${graphData.edges.length} 条链接${graphData.truncated ? ` · 已省略 ${graphData.truncated} 个` : ''}`}
        actions={
          <>
            <Segmented
              value={mode}
              options={[{ value: 'global', label: '全库' }, { value: 'local', label: '局部 2 跳' }]}
              onChange={(v) => setMode(v as 'global' | 'local')}
            />
            <Btn icon="zoom-in" title="放大" onClick={() => zoom(1)} />
            <Btn icon="zoom-out" title="缩小" onClick={() => zoom(-1)} />
            <Btn icon="maximize" title="适应窗口" onClick={fit} />
            {full && onClose && <Btn icon="x" title="关闭" onClick={onClose} />}
          </>
        }
      />
      <div className="plg-graph-body" ref={wrapRef}>
        {loading && !graphData.nodes.length && <Spinner text="构建图谱…" />}
        {!loading && !graphData.nodes.length && <Empty icon="graph" text="还没有可绘制的笔记链接" />}
        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={() => { hoverRef.current = null; setHover(null); dragRef.current = { sx: 0, sy: 0, moved: false } }}
          onWheel={onWheel}
        />
        {hoverNode && (
          <div className="plg-graph-tip">
            <b>{hoverNode.label}</b>
            <span className="dim tiny">{hoverNode.path}</span>
            <span className="tiny">{hoverNode.deg} 个链接 · 点击打开</span>
          </div>
        )}
        <div className="plg-graph-hint">
          <Icon name="info" size={11} /> 拖拽节点/画布 · 滚轮缩放 · 点击打开笔记
        </div>
      </div>
    </Panel>
  )
}

/** `plugin.graph.local` command entry. */
export const openLocalGraph = (ctx: any) => {
  import('../fullscreen').then((m) => m.openPluginWindow('graph', ctx, { full: true }))
}

export default GraphPanel
