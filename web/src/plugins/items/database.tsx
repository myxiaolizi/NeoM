/**
 * database — Notion-like table/kanban over notes selected by folder or tag.
 * Columns come from frontmatter keys; kanban groups by one field and dragging
 * a card writes the new value back into that note's frontmatter.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Segmented, Spinner, docTitle, useVaultDocs } from '../ui'
import { docsInFolder, docsWithTag, type ScanDoc } from '../vault'
import { parseFrontmatter, stringifyFrontmatter } from '../utils'

type View = 'table' | 'kanban'
type Source = { kind: 'folder'; value: string } | { kind: 'tag'; value: string } | { kind: 'all' }

interface Col {
  key: string
  width: number
}

const LS_KEY = 'neom.database.config'

interface DbConfig {
  source: Source
  groupBy: string
  visible: string[]
  sortKey: string
  sortAsc: boolean
}

const loadConfig = (): DbConfig => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { sortKey: 'name', sortAsc: true, ...JSON.parse(raw) } as DbConfig
  } catch { /* ignore */ }
  return { source: { kind: 'all' }, groupBy: 'status', visible: [], sortKey: 'name', sortAsc: true }
}

const saveConfig = (c: DbConfig) => { try { localStorage.setItem(LS_KEY, JSON.stringify(c)) } catch { /* quota */ } }

const updateNoteField = async (ctx: any, doc: ScanDoc, key: string, value: unknown) => {
  const fm = parseFrontmatter(doc.content)
  const data = { ...fm.data, [key]: value }
  const next = stringifyFrontmatter(data, fm.body)
  await ctx.vault.write(doc.path, next)
}

const DatabasePanel: React.FC<PanelProps> = ({ context }) => {
  const { docs, loading, refresh } = useVaultDocs(context)
  const [cfg, setCfg] = useState<DbConfig>(loadConfig)
  const [view, setView] = useState<View>('table')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [filters, setFilters] = useState<string[]>([])

  const persist = useCallback((next: DbConfig) => { setCfg(next); saveConfig(next) }, [])

  const folders = useMemo(() => {
    const set = new Set<string>()
    docs.forEach((d) => { if (d.dir) set.add(d.dir) })
    return Array.from(set).sort()
  }, [docs])

  const tags = useMemo(() => {
    const set = new Set<string>()
    docs.forEach((d) => d.tags.forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [docs])

  const sourceDocs = useMemo(() => {
    if (cfg.source.kind === 'folder') return docsInFolder(docs, cfg.source.value)
    if (cfg.source.kind === 'tag') return docsWithTag(docs, cfg.source.value)
    return docs
  }, [docs, cfg.source])

  const columns = useMemo<Col[]>(() => {
    const keys = new Set<string>()
    sourceDocs.forEach((d) => Object.keys(d.frontmatter).forEach((k) => keys.add(k)))
    const list = Array.from(keys).slice(0, 14)
    const visible = cfg.visible.length ? cfg.visible.filter((k) => keys.has(k)) : list
    return visible.map((key) => ({ key, width: 130 }))
  }, [sourceDocs, cfg.visible])

  const allKeys = useMemo(() => {
    const keys = new Set<string>()
    sourceDocs.forEach((d) => Object.keys(d.frontmatter).forEach((k) => keys.add(k)))
    return Array.from(keys).sort()
  }, [sourceDocs])

  const groupValues = useMemo(() => {
    const set = new Set<string>()
    sourceDocs.forEach((d) => {
      const v = d.frontmatter[cfg.groupBy]
      if (v !== undefined && v !== null && String(v).trim()) set.add(String(v))
      else set.add('（未设置）')
    })
    return Array.from(set).sort()
  }, [sourceDocs, cfg.groupBy])

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    let list = sourceDocs.filter((d) => {
      if (q && !d.path.toLowerCase().includes(q) && !docTitle(d).toLowerCase().includes(q)) return false
      for (const f of filters) {
        const [k, v] = f.split(':')
        if (v && String(d.frontmatter[k] ?? '') !== v) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      const dir = cfg.sortAsc ? 1 : -1
      if (cfg.sortKey === 'name') return a.stem.localeCompare(b.stem) * dir
      if (cfg.sortKey === 'mtime') return (a.mtime || '').localeCompare(b.mtime || '') * dir
      const av = a.frontmatter[cfg.sortKey]
      const bv = b.frontmatter[cfg.sortKey]
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir
    })
    return list
  }, [sourceDocs, filter, filters, cfg.sortKey, cfg.sortAsc])

  const moveCard = async (doc: ScanDoc, group: string) => {
    setBusy(true)
    try {
      const value = group === '（未设置）' ? '' : group
      await updateNoteField(context, doc, cfg.groupBy, value)
      context.toast(`${doc.stem} → ${group}`, 'ok')
      await refresh(true)
    } catch (e: any) {
      context.toast(e?.message || '写回失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const cellValue = (doc: ScanDoc, key: string) => {
    const v = doc.frontmatter[key]
    if (v === undefined || v === null || v === '') return ''
    if (Array.isArray(v)) return v.join(', ')
    if (typeof v === 'boolean') return v ? '✓' : '✗'
    return String(v)
  }

  return (
    <Panel>
      <Head
        icon="database"
        title="数据库"
        sub={`${rows.length} / ${sourceDocs.length} 条记录`}
        actions={
          <>
            <Segmented value={view} options={[{ value: 'table', label: '表格', icon: 'table' }, { value: 'kanban', label: '看板', icon: 'columns' }]} onChange={(v) => setView(v as View)} />
            <Btn icon="refresh" onClick={() => refresh(true)} title="刷新" />
          </>
        }
      />
      <div className="plg-pad-x col" style={{ gap: 6 }}>
        <div className="row">
          <select
            className="select"
            style={{ width: 110 }}
            value={cfg.source.kind}
            onChange={(e) => {
              const kind = e.target.value as Source['kind']
              persist({ ...cfg, source: kind === 'all' ? { kind: 'all' } : kind === 'folder' ? { kind, value: folders[0] || '' } : { kind, value: tags[0] || '' } })
            }}
          >
            <option value="all">全部笔记</option>
            <option value="folder">按文件夹</option>
            <option value="tag">按标签</option>
          </select>
          {cfg.source.kind === 'folder' && (
            <select className="select" value={cfg.source.value} onChange={(e) => persist({ ...cfg, source: { kind: 'folder', value: e.target.value } })}>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
              {!folders.length && <option value="">（无文件夹）</option>}
            </select>
          )}
          {cfg.source.kind === 'tag' && (
            <select className="select" value={cfg.source.value} onChange={(e) => persist({ ...cfg, source: { kind: 'tag', value: e.target.value } })}>
              {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
              {!tags.length && <option value="">（无标签）</option>}
            </select>
          )}
          <input className="input" placeholder="搜索记录…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="row">
          <span className="dim tiny">分组字段</span>
          <select className="select" style={{ width: 130, height: 26 }} value={cfg.groupBy} onChange={(e) => persist({ ...cfg, groupBy: e.target.value })}>
            {allKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            {!allKeys.length && <option value="status">status</option>}
          </select>
          <span className="grow" />
          {!!filters.length && <Btn icon="x" onClick={() => setFilters([])}>清除筛选</Btn>}
        </div>
        {!!allKeys.length && (
          <div className="plg-col-picker">
            {allKeys.slice(0, 12).map((k) => {
              const on = !cfg.visible.length || cfg.visible.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  className={'chip' + (on ? ' active' : '')}
                  onClick={() => {
                    const cur = cfg.visible.length ? cfg.visible : allKeys
                    persist({ ...cfg, visible: on ? cur.filter((x) => x !== k) : [...cur, k] })
                  }}
                >
                  {on ? '✓ ' : ''}{k}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {busy && <Spinner text="写回 frontmatter…" />}
      <div className="plg-scroll">
        {loading && <Spinner text="扫描全库…" />}
        {!loading && !sourceDocs.length && <Empty icon="database" text="该数据源下没有笔记" />}
        {view === 'table' && !!sourceDocs.length && (
          <div className="plg-db-table-wrap">
            <div className="plg-db-table">
              <div className="plg-db-tr head">
                <div className="plg-db-td name" onClick={() => persist({ ...cfg, sortKey: 'name', sortAsc: cfg.sortKey === 'name' ? !cfg.sortAsc : true })}>
                  名称 {cfg.sortKey === 'name' && <Icon name={cfg.sortAsc ? 'sort-asc' : 'sort-desc'} size={10} />}
                </div>
                {columns.map((c) => (
                  <div key={c.key} className="plg-db-td" style={{ width: c.width }} onClick={() => persist({ ...cfg, sortKey: c.key, sortAsc: cfg.sortKey === c.key ? !cfg.sortAsc : true })}>
                    {c.key} {cfg.sortKey === c.key && <Icon name={cfg.sortAsc ? 'sort-asc' : 'sort-desc'} size={10} />}
                  </div>
                ))}
              </div>
              {rows.map((d) => (
                <div key={d.path} className="plg-db-tr" onDoubleClick={() => context.openFile(d.path)}>
                  <div className="plg-db-td name clickable" onClick={() => context.openFile(d.path)}>
                    <Icon name="file-text" size={11} /> <span className="ellipsis">{docTitle(d)}</span>
                  </div>
                  {columns.map((c) => (
                    <div key={c.key} className="plg-db-td ellipsis" style={{ width: c.width }} title={cellValue(d, c.key)}>
                      {cellValue(d, c.key) || <span className="dim">—</span>}
                    </div>
                  ))}
                </div>
              ))}
              {!rows.length && <div className="plg-db-empty">没有匹配的记录</div>}
            </div>
          </div>
        )}
        {view === 'kanban' && !!sourceDocs.length && (
          <div className="plg-kanban">
            {groupValues.map((group) => {
              const cards = rows.filter((d) => {
                const v = d.frontmatter[cfg.groupBy]
                const g = v !== undefined && v !== null && String(v).trim() ? String(v) : '（未设置）'
                return g === group
              })
              return (
                <div
                  key={group}
                  className="plg-kanban-col"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over') }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                  onDrop={(e) => {
                    e.currentTarget.classList.remove('over')
                    const path = e.dataTransfer.getData('text/plain')
                    const doc = docs.find((d) => d.path === path)
                    if (doc) void moveCard(doc, group)
                  }}
                >
                  <div className="plg-kanban-head">
                    <span className="grow ellipsis">{group}</span>
                    <span className="plg-count">{cards.length}</span>
                  </div>
                  <div className="plg-kanban-cards">
                    {cards.map((d) => (
                      <div
                        key={d.path}
                        className="plg-kanban-card"
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', d.path)}
                        onClick={() => context.openFile(d.path)}
                      >
                        <div className="plg-row-title ellipsis">{docTitle(d)}</div>
                        <div className="plg-row-sub ellipsis">{d.path}</div>
                        {!!d.tags.length && (
                          <div className="plg-kanban-tags">
                            {d.tags.slice(0, 3).map((t) => <span key={t} className="chip">#{t}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                    {!cards.length && <div className="plg-kanban-empty">拖到这里</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="plg-foot">
        <Icon name="info" size={11} />
        <span>表格双击打开 · 看板拖拽改「{cfg.groupBy}」并写回 frontmatter</span>
      </div>
    </Panel>
  )
}

export default DatabasePanel
