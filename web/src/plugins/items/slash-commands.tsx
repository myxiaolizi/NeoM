/**
 * slash-commands — type `/` at the start of a line (or run the command) to get
 * a keyboard-navigable insert menu: headings, table, code, formula, quote,
 * todo, AI prompts, date and templates.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import type { PanelProps, PluginContext } from '../types'
import { Empty, Panel } from '../ui'
import { todayISO } from '../utils'

interface SlashItem {
  id: string
  label: string
  hint?: string
  icon: string
  keywords: string
  /** replaces the typed `/query` text range */
  insert: string | (() => string)
  /** run instead of inserting (shell-level) */
  action?: (ctx: PluginContext) => void
}

const BLOCKS: SlashItem[] = [
  { id: 'h1', label: '标题 1', hint: '# 标题', icon: 'headings', keywords: 'h1 一级标题 heading', insert: '# ' },
  { id: 'h2', label: '标题 2', hint: '## 标题', icon: 'headings', keywords: 'h2 二级 heading', insert: '## ' },
  { id: 'h3', label: '标题 3', hint: '### 标题', icon: 'headings', keywords: 'h3 三级 heading', insert: '### ' },
  { id: 'table', label: '表格', hint: '3 列 3 行', icon: 'table', keywords: 'table 表格', insert: '\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\n' },
  { id: 'code', label: '代码块', hint: '```', icon: 'code-block', keywords: 'code 代码 block', insert: '\n```js\n\n```\n\n' },
  { id: 'formula', label: '公式', hint: '$$ … $$', icon: 'formula', keywords: 'math latex 公式 数学', insert: '\n$$\nE = mc^2\n$$\n\n' },
  { id: 'quote', label: '引用', hint: '>', icon: 'quote', keywords: 'quote 引用', insert: '> ' },
  { id: 'todo', label: '待办', hint: '- [ ]', icon: 'list-todo', keywords: 'todo task 待办 任务', insert: '- [ ] ' },
  { id: 'ul', label: '无序列表', hint: '-', icon: 'list', keywords: 'list bullet 列表', insert: '- ' },
  { id: 'ol', label: '有序列表', hint: '1.', icon: 'list-ordered', keywords: 'order list 有序 列表 编号', insert: '1. ' },
  { id: 'hr', label: '分隔线', hint: '---', icon: 'hr', keywords: 'hr divider 分隔线', insert: '\n---\n\n' },
  { id: 'callout', label: '提示块', hint: '> [!note]', icon: 'info', keywords: 'callout note 提示 警告', insert: '> [!note] 提示标题\n> 内容\n\n' },
  { id: 'date', label: '今天日期', hint: 'YYYY-MM-DD', icon: 'calendar', keywords: 'date today 日期 今天', insert: () => todayISO() },
  { id: 'time', label: '当前时间', hint: 'HH:mm', icon: 'clock', keywords: 'time 时间', insert: () => new Date().toTimeString().slice(0, 5) },
  { id: 'link', label: '内部链接', hint: '[[笔记]]', icon: 'link', keywords: 'wiki link 链接 双链', insert: '[[]]' },
  { id: 'footnote', label: '脚注', hint: '[^1]', icon: 'footnote', keywords: 'footnote 脚注', insert: '[^1]\n\n[^1]: ' },
  { id: 'frontmatter', label: '属性区块', hint: '---…---', icon: 'sliders', keywords: 'frontmatter yaml 属性 元数据', insert: '---\ntitle: \ndate: \ntags: []\n---\n\n' },
  { id: 'ai-continue', label: 'AI 续写', hint: 'AI', icon: 'ai', keywords: 'ai continue 续写 智能', insert: '', action: (ctx) => { void import('./ai').then((m) => m.polishContinue(ctx)) } },
  { id: 'ai-polish', label: 'AI 润色', hint: 'AI', icon: 'sparkles', keywords: 'ai polish 润色 改写', insert: '', action: (ctx) => { void import('./ai').then((m) => m.polishSelection(ctx)) } },
  { id: 'ai-summary', label: 'AI 总结', hint: 'AI', icon: 'ai', keywords: 'ai summary 总结 摘要', insert: '', action: (ctx) => { void import('./ai').then((m) => m.polishSummary(ctx)) } }
]

const templates = (ctx: PluginContext): SlashItem[] => {
  const raw = ctx.settings.get<{ name: string; body: string }[]>('templates', [])
  return (Array.isArray(raw) ? raw : []).filter((t) => t?.name).map((t) => ({
    id: `tpl-${t.name}`,
    label: `模板：${t.name}`,
    hint: 'template',
    icon: 'file-text',
    keywords: `template 模板 ${t.name}`,
    insert: `\n${t.body}\n`
  }))
}

const Menu: React.FC<{ ctx: PluginContext; x: number; y: number; onClose: () => void; initialQuery?: string }> = ({ ctx, x, y, onClose, initialQuery = '' }) => {
  const [query, setQuery] = useState(initialQuery)
  const [cursor, setCursor] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const all = [...BLOCKS, ...templates(ctx)]
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q) || i.id.includes(q))
  }, [query, ctx])

  useEffect(() => { inputRef.current?.focus(); setCursor(0) }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const hit = items[cursor]
        if (!hit) return
        run(hit)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, cursor, onClose])

  const run = (item: SlashItem) => {
    onClose()
    if (item.action) { item.action(ctx); return }
    const text = typeof item.insert === 'function' ? item.insert() : item.insert
    ctx.insertText(text)
    ctx.toast(`已插入「${item.label}」`, 'ok')
  }

  return createPortal(
    <div className="plg-slash-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="plg-slash" ref={ref} style={{ left: x, top: y }}>
        <div className="plg-slash-input">
          <Icon name="command" size={13} />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入命令，如 表格 / todo / ai…" spellCheck={false} />
          <span className="kbd">Esc</span>
        </div>
        <div className="plg-slash-list">
          {!items.length && <Empty icon="search" text="没有匹配的命令" />}
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={'plg-slash-item' + (i === cursor ? ' on' : '')}
              onMouseEnter={() => setCursor(i)}
              onClick={() => run(item)}
            >
              <Icon name={item.icon} size={14} />
              <span className="grow ellipsis">{item.label}</span>
              {item.hint && <span className="dim tiny mono ellipsis" style={{ maxWidth: 130 }}>{item.hint}</span>}
            </button>
          ))}
        </div>
        <div className="plg-slash-foot">
          <span><span className="kbd">↑↓</span> 选择</span>
          <span><span className="kbd">Enter</span> 插入</span>
          <span className="dim">{items.length} 项</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

const SlashPanel: React.FC<PanelProps> = ({ context }) => {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  return (
    <Panel>
      <div className="plg-pad col">
        <div className="plg-slash-hero">
          <Icon name="command" size={24} />
          <div className="plg-head-title">斜杠命令</div>
          <div className="plg-head-sub">在编辑器行首输入 <span className="kbd">/</span> 快速插入块，或点下方按钮</div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setPos({ x: Math.min(r.left, window.innerWidth - 420), y: Math.min(r.bottom + 8, window.innerHeight - 460) })
              setOpen(true)
            }}
          >
            打开命令菜单
          </button>
        </div>
        <div className="plg-slash-grid">
          {BLOCKS.slice(0, 12).map((b) => (
            <button key={b.id} type="button" className="plg-slash-card" onClick={() => {
              if (b.action) { b.action(context); return }
              context.insertText(typeof b.insert === 'function' ? b.insert() : b.insert)
              context.toast(`已插入「${b.label}」`, 'ok')
            }}>
              <Icon name={b.icon} size={15} />
              <span>{b.label}</span>
            </button>
          ))}
        </div>
      </div>
      {open && <Menu ctx={context} x={pos.x} y={pos.y} onClose={() => setOpen(false)} />}
    </Panel>
  )
}

/** `plugin.slashCommands.open` — open the menu centered in the viewport. */
export const openSlashMenu = (ctx: PluginContext) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  import('react-dom/client').then(({ createRoot }) => {
    const root = createRoot(host)
    const close = () => { root.unmount(); host.remove() }
    root.render(<Menu ctx={ctx} x={Math.max(24, window.innerWidth / 2 - 210)} y={Math.max(60, window.innerHeight / 3)} onClose={close} />)
  })
}

/* ------------------------------------------------------- `/` type watcher */
let watcherOff: (() => void) | null = null

/**
 * Detect a `/` typed at the start of a line inside the editor and surface the
 * menu. Text insertion is delegated to the shell so the trigger char can be
 * consumed safely.
 */
export const installSlashWatcher = (ctx: PluginContext) => {
  uninstallSlashWatcher()
  let menuHost: HTMLDivElement | null = null
  const openMenuAt = (x: number, y: number) => {
    if (menuHost) return
    menuHost = document.createElement('div')
    document.body.appendChild(menuHost)
    import('react-dom/client').then(({ createRoot }) => {
      const root = createRoot(menuHost!)
      const close = () => {
        menuHost = null
        try { root.unmount() } catch { /* noop */ }
      }
      root.render(<Menu ctx={ctx} x={Math.min(x, window.innerWidth - 430)} y={Math.min(y + 18, window.innerHeight - 440)} onClose={close} />)
    })
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (!target?.closest('.vditor-ir, .vditor-sv, .vditor-wysiwyg, [contenteditable="true"]')) return
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const node = sel.getRangeAt(0).startContainer
    const text = node.textContent || ''
    const caret = sel.getRangeAt(0).startOffset
    const before = text.slice(0, caret)
    const lineStart = before.lastIndexOf('\n') + 1
    const atLineStart = before.slice(lineStart).trim() === ''
    if (!atLineStart) return
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    openMenuAt(rect.left || 120, rect.top || 120)
  }
  // Only listen — the literal `/` stays in the text (harmless, user can delete)
  window.addEventListener('keyup', onKey)
  watcherOff = () => {
    window.removeEventListener('keyup', onKey)
    if (menuHost) { menuHost.remove(); menuHost = null }
  }
}

export const uninstallSlashWatcher = () => {
  watcherOff?.()
  watcherOff = null
}

export default SlashPanel
