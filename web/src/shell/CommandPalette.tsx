/**
 * CommandPalette (Ctrl+P) — fuzzy search over every registered command,
 * including plugin commands, with keyboard navigation and shortcut hints.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { fuzzyScore, getCommands, onCommandsChanged, runCommand, shortcutLabel, type Command } from '@/lib/commands'

const CATEGORY_ORDER = ['文件', '编辑', '视图', '格式', '标签页', 'AI', '应用', '插件']

export const CommandPalette: React.FC = () => {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [tick, setTick] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = onCommandsChanged(() => setTick((t) => t + 1))
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 20)
  }, [open])

  const commands = useMemo(() => {
    void tick
    return getCommands().filter((c) => !c.when || c.when())
  }, [tick, open])

  const results = useMemo(() => {
    const scored = commands
      .map((c) => {
        const hay = [c.title, c.subtitle || '', c.keywords || '', c.id].join(' ')
        const score = Math.max(fuzzyScore(c.title, query), fuzzyScore(hay, query) * 0.7)
        return { c, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title, 'zh-Hans-CN'))
      .map((x) => x.c)
    return scored.slice(0, 80)
  }, [commands, query])

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.palette-item.active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const run = (cmd: Command) => {
    setOpen(false)
    void runCommand(cmd.id)
  }

  const grouped: { cat: string; items: Command[] }[] = []
  for (const c of results) {
    const last = grouped[grouped.length - 1]
    if (last && last.cat === c.category) last.items.push(c)
    else grouped.push({ cat: c.category, items: [c] })
  }
  grouped.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a.cat)
    const ib = CATEGORY_ORDER.indexOf(b.cat)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  let flatIndex = -1

  return (
    <div
      className="palette-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="palette">
        <div className="palette-input">
          <Icon name="command" size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="输入命令名称或关键词…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => (results.length ? (i + 1) % results.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const cmd = results[index]
                if (cmd) run(cmd)
              }
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {!results.length && <div className="empty" style={{ padding: 24 }}>没有匹配的命令</div>}
          {grouped.map((g) => (
            <React.Fragment key={g.cat}>
              <div className="palette-group">{g.cat}</div>
              {g.items.map((c) => {
                flatIndex += 1
                const active = flatIndex === index
                return (
                  <div
                    key={c.id}
                    className={'palette-item' + (active ? ' active' : '')}
                    onMouseEnter={() => setIndex(flatIndex)}
                    onClick={() => run(c)}
                    role="option"
                    aria-selected={active}
                  >
                    <Icon name={c.icon || 'command'} size={15} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ellipsis">{c.title}</div>
                      {c.subtitle && <div className="p-cat ellipsis">{c.subtitle}</div>}
                    </div>
                    {c.shortcut && <span className="kbd p-key">{shortcutLabel(c.shortcut)}</span>}
                  </div>
                )
              })}
            </React.Fragment>
          ))}
        </div>
        <div className="palette-group" style={{ display: 'flex', gap: 12, borderTop: '1px solid var(--border)', padding: '7px 12px' }}>
          <span className="tiny dim">↑↓ 选择</span>
          <span className="tiny dim">Enter 执行</span>
          <span className="tiny dim">Esc 关闭</span>
          <div style={{ flex: 1 }} />
          <span className="tiny dim">{results.length} 个命令</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
