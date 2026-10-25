/**
 * SearchPanel — full-text search inside the left sidebar.
 * Debounced `/api/files/search` with an offline local fallback, grouped by
 * file name / body / tag hits and highlighted match terms.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { currentVault, fileService } from '@/features/files/fileService'
import { openFile } from '@/features/editor/docRepo'
import { iconForPath } from '@/features/files/iconFor'

interface Hit {
  path: string
  name: string
  matches: { line: number; text: string }[]
}

type Scope = 'all' | 'name' | 'content' | 'tag'

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query.trim()) return <>{text}</>
  const re = new RegExp('(' + escRe(query.trim()) + ')', 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        re.test(p) && p.toLowerCase() === query.trim().toLowerCase() ? (
          <mark key={i} className="hit">{p}</mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  )
}

const SearchPanel: React.FC = () => {
  const storeQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const setSelectedPath = useStore((s) => s.setSelectedPath)
  const toast = useStore((s) => s.toast)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  const [query, setQuery] = useState(storeQuery)
  const [scope, setScope] = useState<Scope>('all')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const seq = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const run = useCallback(
    async (q: string, sc: Scope) => {
      const my = ++seq.current
      if (!q.trim()) {
        setHits([])
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const res = await fileService.search(currentVault(), q.trim(), sc)
        if (seq.current !== my) return
        setHits(res?.hits || [])
        setOffline(false)
      } catch {
        if (seq.current !== my) return
        const { localSearch } = await import('@/features/files/fileService')
        const res = localSearch(q.trim(), sc)
        setHits(res.hits)
        setOffline(true)
      } finally {
        if (seq.current === my) setLoading(false)
      }
    },
    []
  )

  /* debounce */
  useEffect(() => {
    setSearchQuery(query)
    const t = window.setTimeout(() => void run(query, scope), 220)
    return () => window.clearTimeout(t)
  }, [query, scope, run, setSearchQuery])

  const activeDocPath = tabs.find((t) => t.id === activeTabId)?.path

  const openHit = (hit: Hit, line?: number) => {
    setSelectedPath(hit.path)
    openFile(hit.path)
    if (line && line > 1) {
      window.setTimeout(() => {
        const el = document.querySelector('.editor-host .vditor-reset, .editor-host .md-prose')
        if (!el) return
        const blocks = Array.from(el.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,pre'))
        blocks[Math.min(blocks.length - 1, line - 2)]?.scrollIntoView({ block: 'center' })
      }, 260)
    }
  }

  const grouped = useMemo(() => {
    const nameHits = hits.filter((h) => h.matches.some((m) => m.line === 0))
    const bodyHits = hits.filter((h) => h.matches.some((m) => m.line > 0))
    return { nameHits, bodyHits }
  }, [hits])

  return (
    <div className="sb-panel">
      <div className="sb-panel-head">
        <span className="sp-title">搜索</span>
        <button className="btn-icon" title="关闭面板" onClick={() => setLeftPanel(null)}>
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="search-input-wrap">
        <Icon name="search" size={14} className="si-icon" />
        <input
          ref={inputRef}
          className="input"
          placeholder="搜索文件名或正文…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setQuery(''); setLeftPanel(null) }
            if (e.key === 'Enter' && hits.length) openHit(hits[0], hits[0].matches.find((m) => m.line > 0)?.line)
          }}
        />
      </div>

      <div className="search-filters">
        {(
          [
            ['all', '全部'],
            ['name', '文件名'],
            ['content', '正文'],
            ['tag', '标签']
          ] as [Scope, string][]
        ).map(([id, label]) => (
          <button key={id} className={'chip' + (scope === id ? ' active' : '')} onClick={() => setScope(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="side-panel-body">
        {loading && <div className="empty"><span className="spinner" /> 搜索中…</div>}
        {!loading && !query.trim() && (
          <div className="empty" style={{ padding: 22 }}>
            <Icon name="search" size={22} />
            <span>输入关键词开始搜索</span>
          </div>
        )}
        {!loading && query.trim() && !hits.length && (
          <div className="empty" style={{ padding: 22 }}>
            没有匹配结果{offline ? '（离线搜索）' : ''}
          </div>
        )}
        {offline && hits.length > 0 && (
          <div className="tip-line" style={{ padding: '0 4px 6px' }}>
            <Icon name="info" size={12} />
            当前为离线本地搜索，仅覆盖本机缓存
          </div>
        )}

        {grouped.nameHits.length > 0 && (
          <>
            <div className="search-group-title">
              <Icon name="file-text" size={11} />文件名匹配（{grouped.nameHits.length}）
            </div>
            {grouped.nameHits.map((hit) => (
              <button key={'n-' + hit.path} className="search-hit" onClick={() => openHit(hit)}>
                <div className="sh-name">
                  <Icon name={iconForPath(hit.path)} size={13} />
                  <Highlight text={hit.name} query={query} />
                  {activeDocPath === hit.path && <span className="badge">当前</span>}
                </div>
                <div className="sh-path">{hit.path}</div>
              </button>
            ))}
          </>
        )}

        {grouped.bodyHits.length > 0 && (
          <>
            <div className="search-group-title">
              <Icon name="file-text" size={11} />正文匹配（{grouped.bodyHits.length}）
            </div>
            {grouped.bodyHits.map((hit) => (
              <div key={'b-' + hit.path} style={{ marginBottom: 4 }}>
                <button className="search-hit" onClick={() => openHit(hit, hit.matches.find((m) => m.line > 0)?.line)}>
                  <div className="sh-name">
                    <Icon name={iconForPath(hit.path)} size={13} />
                    {hit.name}
                  </div>
                  <div className="sh-path">{hit.path}</div>
                </button>
                {hit.matches
                  .filter((m) => m.line > 0)
                  .slice(0, 4)
                  .map((m, i) => (
                    <button
                      key={i}
                      className="search-hit"
                      style={{ paddingLeft: 22, paddingTop: 2, paddingBottom: 2 }}
                      onClick={() => openHit(hit, m.line)}
                    >
                      <div className="sh-line">
                        <span className="dim">{m.line}: </span>
                        <Highlight text={m.text.trim().slice(0, 160)} query={query} />
                      </div>
                    </button>
                  ))}
              </div>
            ))}
          </>
        )}
      </div>

      {hits.length > 0 && (
        <div className="tip-line" style={{ padding: '4px 2px', flex: 'none' }}>
          <Icon name="info" size={11} />
          共 {hits.length} 个文件匹配 · 点击结果跳转
          <button
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              void navigator.clipboard?.writeText(hits.map((h) => h.path).join('\n'))
              toast({ kind: 'ok', text: '匹配文件路径已复制' })
            }}
          >
            复制路径
          </button>
        </div>
      )}
    </div>
  )
}

export default SearchPanel
