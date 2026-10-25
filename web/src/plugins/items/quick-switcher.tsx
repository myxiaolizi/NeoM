/**
 * quick-switcher — its own modal (does not depend on the shell palette).
 * Fuzzy matches file name, path and first heading; ↑↓ + Enter navigation.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps, PluginContext } from '../types'
import { Empty, Spinner, docTitle, useVaultDocs } from '../ui'
import { fuzzy, relativeTime } from '../utils'
import { openPluginWindow } from '../fullscreen'

const QuickSwitcher: React.FC<PanelProps> = ({ context, onClose }) => {
  const { docs, loading } = useVaultDocs(context)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const scored = docs
      .map((d) => {
        const nameScore = fuzzy(d.stem, query) * 1.6
        const titleScore = fuzzy(docTitle(d), query) * 1.2
        const pathScore = fuzzy(d.path, query)
        const headingScore = d.headings.length ? Math.max(...d.headings.map((h) => fuzzy(h.text, query))) * 0.9 : 0
        return { doc: d, score: Math.max(nameScore, titleScore, pathScore, headingScore) }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, 80).map((s) => s.doc)
  }, [docs, query])

  useEffect(() => { setCursor(0) }, [query])

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const open = (path: string) => {
    context.openFile(path)
    try { (context as unknown as { pushRecent?: (p: string) => void }).pushRecent?.(path) } catch { /* noop */ }
    onClose?.()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[cursor]
      if (hit) open(hit.path)
      else if (query.trim()) {
        context.createFile(`${query.trim()}.md`, `# ${query.trim()}\n\n`).then((p) => { context.openFile(p); onClose?.() })
      }
    }
  }

  return (
    <div className="plg-switcher">
      <div className="plg-switcher-input">
        <Icon name="search" size={15} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="按文件名 / 标题 / 路径搜索…"
          spellCheck={false}
        />
        <span className="kbd">↑↓</span>
      </div>
      <div className="plg-switcher-list" ref={listRef}>
        {loading && <Spinner text="索引仓库…" />}
        {!loading && !results.length && (
          <Empty
            icon="search"
            text={query.trim() ? `没有匹配「${query}」，回车新建同名笔记` : '输入关键字开始搜索'}
          />
        )}
        {results.map((d, i) => (
          <div
            key={d.path}
            className={'plg-switcher-row' + (i === cursor ? ' on' : '')}
            onMouseEnter={() => setCursor(i)}
            onClick={() => open(d.path)}
          >
            <Icon name="file-text" size={13} />
            <div className="grow">
              <div className="plg-switcher-title ellipsis">{docTitle(d)}</div>
              <div className="plg-switcher-path ellipsis">{d.path}</div>
            </div>
            <span className="plg-switcher-time dim tiny">{relativeTime(d.mtime)}</span>
          </div>
        ))}
      </div>
      <div className="plg-switcher-foot">
        <span><span className="kbd">Enter</span> 打开</span>
        <span><span className="kbd">Esc</span> 关闭</span>
        <span className="dim">{docs.length} 篇笔记</span>
      </div>
    </div>
  )
}

/** Command entry — opens the switcher in its own window. */
export const openSwitcher = (ctx: PluginContext) => openPluginWindow('quick-switcher', ctx)

export default QuickSwitcher
