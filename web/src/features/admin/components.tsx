/**
 * Admin console UI kit — shared, reusable building blocks.
 * Everything here is presentational + a tiny data hook. No business logic.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { useStore } from '@/store'
import { api } from '@/lib/api'

/* ------------------------------------------------------------------ util */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

export const fmtInt = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}
export const fmtMoney = (n: number | null | undefined, digits = 2): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return '¥' + n.toFixed(digits)
}
export const fmtPct = (n: number | null | undefined, digits = 1): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toFixed(digits) + '%'
}
export const fmtBytes = (b: number | null | undefined): string => {
  if (b === null || b === undefined || Number.isNaN(b) || b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}
export const fmtNum = (n: number | null | undefined, digits = 2): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toFixed(digits)
}
const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n)
export const fmtDate = (v: string | null | undefined): string => {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export const fmtDateTime = (v: string | null | undefined): string => {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${fmtDate(v)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export const fmtTimeAgo = (v: string | null | undefined): string => {
  if (!v) return '—'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return String(v)
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前'
  return fmtDate(v)
}
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString()
export const isoDay = (offsetDays: number) => {
  const d = new Date(Date.now() - offsetDays * 86400_000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
/** Mask a secret so only the tail survives: sk-abc…9f2c */
export const maskSecret = (v: string | null | undefined, tail = 4): string => {
  if (!v) return '—'
  const s = String(v)
  if (s.length <= tail) return '•'.repeat(s.length)
  return s.slice(0, Math.min(3, s.length - tail)) + '…' + s.slice(-tail)
}

export const downloadCsv = (filename: string, rows: (string | number | null | undefined)[][]) => {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/* -------------------------------------------------------------- toast hook */
export const useToast = () => useStore((s) => s.toast)

/* ------------------------------------------------------------ data loading */
export interface ApiState<T> {
  data: T
  loading: boolean
  /** true when the backend call failed and `data` is built-in demo data */
  demo: boolean
  error: string | null
  reload: () => void
  setData: React.Dispatch<React.SetStateAction<T>>
}

/**
 * Calls `loader()` once on mount. On ANY failure (backend missing, 500, 401 …)
 * it falls back to `fallback` and flags `demo=true` — the console must never
 * white-screen because a parallel route is not deployed yet.
 */
export function useApiData<T>(loader: () => Promise<T>, fallback: T, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T>(fallback)
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const alive = useRef(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback

  useEffect(() => {
    alive.current = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await loaderRef.current()
        if (!alive.current) return
        if (res === undefined || res === null) throw new Error('空响应')
        setData(res)
        setDemo(false)
        setError(null)
      } catch (e) {
        if (!alive.current) return
        setData(fallbackRef.current)
        setDemo(true)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive.current) setLoading(false)
      }
    })()
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, demo, error, reload, setData }
}

/** POST/PUT/DELETE helper that reports success/failure through toast. */
export async function callApi<T = unknown>(
  fn: () => Promise<T>,
  okText: string,
  failText = '操作失败'
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const data = await fn()
    useStore.getState().toast({ kind: 'ok', text: okText })
    return { ok: true, data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useStore.getState().toast({ kind: 'error', text: `${failText}：${msg}` })
    return { ok: false, error: msg }
  }
}

/* ------------------------------------------------------------ demo badge */
export const DemoBadge: React.FC<{ show?: boolean; title?: string }> = ({ show = true, title }) => {
  if (!show) return null
  return (
    <span className="adm-demo" title={title || '后端 /api/admin 接口暂不可用，当前展示内置演示数据'}>
      <Icon name="info" size={10} /> 演示数据
    </span>
  )
}

/* --------------------------------------------------------------- page head */
export const PageHeader: React.FC<{
  title: React.ReactNode
  desc?: React.ReactNode
  icon?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  demo?: boolean
  reload?: () => void
  loading?: boolean
}> = ({ title, desc, icon, badge, actions, demo, reload, loading }) => (
  <div className="adm-page-head">
    <div style={{ minWidth: 0 }}>
      <h1 className="adm-page-title">
        {icon && <Icon name={icon} size={19} />}
        {title}
        {badge}
        {demo !== undefined && <DemoBadge show={demo} />}
      </h1>
      {desc && <p className="adm-page-desc">{desc}</p>}
    </div>
    <div className="adm-page-actions">
      {reload && (
        <button className="btn btn-ghost" onClick={reload} title="重新加载" disabled={loading}>
          {loading ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Icon name="refresh" size={14} />}
          刷新
        </button>
      )}
      {actions}
    </div>
  </div>
)

/* ---------------------------------------------------------------- section */
export const Section: React.FC<{
  title?: React.ReactNode
  sub?: React.ReactNode
  icon?: string
  actions?: React.ReactNode
  children: React.ReactNode
  flush?: boolean
  className?: string
  style?: React.CSSProperties
}> = ({ title, sub, icon, actions, children, flush, className, style }) => (
  <section className={cx('card adm-section', className)} style={style}>
    {(title || actions) && (
      <div className="adm-card-head">
        {title && (
          <h3>
            {icon && <Icon name={icon} size={15} />}
            {title}
          </h3>
        )}
        {sub && <span className="adm-sub">{sub}</span>}
        {actions && <div className="adm-page-actions" style={{ marginLeft: 'auto' }}>{actions}</div>}
      </div>
    )}
    <div className={cx('adm-card-body', flush && 'flush')}>{children}</div>
  </section>
)

/* --------------------------------------------------------------- stat card */
export const StatCard: React.FC<{
  label: string
  value: React.ReactNode
  unit?: string
  icon?: string
  delta?: number | null
  deltaSuffix?: string
  foot?: React.ReactNode
  tone?: 'accent' | 'ok' | 'warn' | 'danger'
  onClick?: () => void
}> = ({ label, value, unit, icon, delta, deltaSuffix = '较昨日', foot, tone = 'accent', onClick }) => {
  const dir = delta === null || delta === undefined ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const toneBg: Record<string, string> = {
    accent: 'var(--accent-soft)',
    ok: 'var(--ok-soft)',
    warn: 'var(--warn-soft)',
    danger: 'var(--danger-soft)'
  }
  const toneFg: Record<string, string> = {
    accent: 'var(--accent)',
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    danger: 'var(--danger)'
  }
  return (
    <div className="adm-stat" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="adm-stat-top">
        {icon && (
          <span className="adm-stat-ico" style={{ background: toneBg[tone], color: toneFg[tone] }}>
            <Icon name={icon} size={12} />
          </span>
        )}
        <span className="ellipsis">{label}</span>
      </div>
      <div className="adm-stat-val">
        {value}
        {unit && <span className="adm-stat-unit">{unit}</span>}
      </div>
      <div className="adm-stat-foot">
        {delta !== undefined && delta !== null && (
          <span className={cx('adm-delta', dir)}>
            {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {delta !== undefined && delta !== null && <span>{deltaSuffix}</span>}
        {foot}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- tag */
export type TagTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger' | 'purple'
export const Tag: React.FC<{ tone?: TagTone; dot?: boolean; children: React.ReactNode; title?: string }> = ({
  tone = 'default',
  dot,
  children,
  title
}) => (
  <span className={cx('adm-tag', tone !== 'default' && tone)} title={title}>
    {dot && <i className="adm-tag-dot" />}
    {children}
  </span>
)

/* -------------------------------------------------------------- switches */
export const Switch: React.FC<{ on: boolean; onChange?: (v: boolean) => void; title?: string; disabled?: boolean }> = ({
  on,
  onChange,
  title,
  disabled
}) => (
  <button
    type="button"
    className={cx('switch', on && 'on')}
    title={title}
    disabled={disabled}
    style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    onClick={(e) => { e.stopPropagation(); onChange?.(!on) }}
    aria-pressed={on}
  />
)

/* ----------------------------------------------------------------- search */
export const SearchInput: React.FC<{
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
}> = ({ value, onChange, placeholder = '搜索…', width }) => (
  <div className="adm-search" style={{ width }}>
    <span className="adm-ts-icon"><Icon name="search" size={13} /></span>
    <input
      className="input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
    {value && (
      <button
        className="btn-icon"
        style={{ position: 'absolute', right: 3, top: 4, width: 22, height: 22 }}
        onClick={() => onChange('')}
        aria-label="清除"
      >
        <Icon name="x" size={12} />
      </button>
    )}
  </div>
)

/* ---------------------------------------------------------------- toolbar */
export const Toolbar: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div className="adm-toolbar">
    {children}
    {right && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{right}</div>}
  </div>
)

/* ------------------------------------------------------------------ tabs */
export const Tabs: React.FC<{
  items: { id: string; label: React.ReactNode; count?: number }[]
  active: string
  onChange: (id: string) => void
}> = ({ items, active, onChange }) => (
  <div className="adm-tabs" role="tablist">
    {items.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={t.id === active}
        className={cx('adm-tab', t.id === active && 'active')}
        onClick={() => onChange(t.id)}
      >
        {t.label}
        {t.count !== undefined && <span className="adm-tab-count">{t.count}</span>}
      </button>
    ))}
  </div>
)

/* -------------------------------------------------------------- dataTable */
export interface Column<T> {
  key: string
  title: React.ReactNode
  width?: number | string
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  /** value used for sorting/searching; defaults to (row as any)[key] */
  value?: (row: T) => string | number
  render?: (row: T, index: number) => React.ReactNode
  defaultHidden?: boolean
  nowrap?: boolean
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  loading?: boolean
  emptyText?: React.ReactNode
  emptyIcon?: string
  selectable?: boolean
  selected?: string[]
  onSelectedChange?: (keys: string[]) => void
  onRowClick?: (row: T) => void
  pageSize?: number
  pageSizeOptions?: number[]
  toolbar?: React.ReactNode
  toolbarRight?: React.ReactNode
  footerNote?: React.ReactNode
  /** hide the internal search box (parent renders its own filters) */
  hideSearch?: boolean
  searchPlaceholder?: string
  /** extra text used by the built-in search box */
  searchKeys?: (row: T) => string
  columnConfig?: boolean
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  dense?: boolean
  noPager?: boolean
  rowClassName?: (row: T) => string | undefined
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns, rows, rowKey, loading, emptyText = '暂无数据', emptyIcon = 'database',
    selectable, selected, onSelectedChange, onRowClick,
    pageSize: initPageSize = 10, pageSizeOptions = [10, 20, 50, 100],
    toolbar, toolbarRight, footerNote, hideSearch, searchPlaceholder = '筛选当前列表…',
    searchKeys, columnConfig = true, initialSort, dense, noPager, rowClassName
  } = props

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initPageSize)
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort?.dir ?? 'desc')
  const [q, setQ] = useState('')
  const [hidden, setHidden] = useState<string[]>(() => columns.filter((c) => c.defaultHidden).map((c) => c.key))
  const [cfgOpen, setCfgOpen] = useState(false)

  const valueOf = useCallback(
    (row: T, c: Column<T>): string | number => {
      if (c.value) return c.value(row)
      const v = (row as Record<string, unknown>)[c.key]
      if (typeof v === 'number') return v
      if (v === null || v === undefined) return ''
      return String(v)
    },
    []
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) => {
      if (searchKeys) return searchKeys(r).toLowerCase().includes(needle)
      return columns.some((c) => String(valueOf(r, c)).toLowerCase().includes(needle))
    })
  }, [rows, q, columns, searchKeys, valueOf])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return filtered
    const out = [...filtered]
    out.sort((a, b) => {
      const av = valueOf(a, col)
      const bv = valueOf(b, col)
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      const sa = String(av), sb = String(bv)
      return sortDir === 'asc' ? sa.localeCompare(sb, 'zh-CN') : sb.localeCompare(sa, 'zh-CN')
    })
    return out
  }, [filtered, sortKey, sortDir, columns, valueOf])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const curPage = Math.min(page, pageCount)
  const view = useMemo(() => {
    if (noPager) return sorted
    const start = (curPage - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, curPage, pageSize, noPager])

  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const visibleCols = columns.filter((c) => !hidden.includes(c.key))
  const pageKeys = view.map((r, i) => rowKey(r, i))
  const sel = selected || []
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => sel.includes(k))

  const toggleAll = () => {
    if (!onSelectedChange) return
    if (allOnPage) onSelectedChange(sel.filter((k) => !pageKeys.includes(k)))
    else onSelectedChange(Array.from(new Set([...sel, ...pageKeys])))
  }
  const toggleOne = (k: string) => {
    if (!onSelectedChange) return
    onSelectedChange(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k])
  }

  const clickSort = (c: Column<T>) => {
    if (!c.sortable) return
    if (sortKey === c.key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(c.key); setSortDir('desc') }
  }

  const pageBtns = useMemo(() => {
    const out: (number | '…')[] = []
    const push = (n: number | '…') => out.push(n)
    if (pageCount <= 7) { for (let i = 1; i <= pageCount; i++) push(i); return out }
    push(1)
    if (curPage > 3) push('…')
    for (let i = Math.max(2, curPage - 1); i <= Math.min(pageCount - 1, curPage + 1); i++) push(i)
    if (curPage < pageCount - 2) push('…')
    push(pageCount)
    return out
  }, [pageCount, curPage])

  const colSpan = visibleCols.length + (selectable ? 1 : 0)

  return (
    <div>
      {(toolbar || toolbarRight || !hideSearch || columnConfig) && (
        <div className="adm-toolbar">
          {toolbar}
          {!hideSearch && (
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder={searchPlaceholder} width={218} />
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {toolbarRight}
            {columnConfig && (
              <div style={{ position: 'relative' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setCfgOpen((v) => !v)} title="列配置">
                  <Icon name="columns" size={13} /> 列
                </button>
                {cfgOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setCfgOpen(false)} />
                    <div className="adm-pop" style={{ right: 0, top: 32, width: 208 }}>
                      <div className="menu-title">显示列</div>
                      {columns.map((c) => (
                        <label key={c.key} className="adm-pop-item" style={{ cursor: 'pointer', alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            className="adm-check"
                            checked={!hidden.includes(c.key)}
                            onChange={() =>
                              setHidden((h) => (h.includes(c.key) ? h.filter((x) => x !== c.key) : [...h, c.key]))
                            }
                          />
                          <span className="grow ellipsis">{typeof c.title === 'string' ? c.title : c.key}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 34 }}>
                  <input type="checkbox" className="adm-check" checked={allOnPage} onChange={toggleAll} aria-label="全选" />
                </th>
              )}
              {visibleCols.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align }}
                  className={cx(c.sortable && 'sortable')}
                  onClick={() => clickSort(c)}
                >
                  <span className="adm-th-in">
                    {c.title}
                    {c.sortable && (
                      <Icon
                        name={sortKey === c.key ? (sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : 'sort'}
                        size={11}
                        style={{ opacity: sortKey === c.key ? 1 : 0.4 }}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, r) => (
                <tr key={'sk' + r}>
                  {selectable && <td><div className="skeleton adm-skel" style={{ width: 14 }} /></td>}
                  {visibleCols.map((c, i) => (
                    <td key={c.key}>
                      <div className="skeleton adm-skel" style={{ width: `${45 + ((r * 7 + i * 13) % 50)}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : view.length === 0 ? (
              <tr className="adm-empty-row">
                <td colSpan={colSpan}>
                  <div className="empty">
                    <Icon name={emptyIcon} size={26} />
                    <div>{emptyText}</div>
                  </div>
                </td>
              </tr>
            ) : (
              view.map((row, i) => {
                const k = pageKeys[i]
                const on = sel.includes(k)
                return (
                  <tr
                    key={k}
                    className={cx(on && 'selected', onRowClick && 'clickable', rowClassName?.(row))}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={dense ? { height: 34 } : undefined}
                  >
                    {selectable && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="adm-check" checked={on} onChange={() => toggleOne(k)} aria-label="选择行" />
                      </td>
                    )}
                    {visibleCols.map((c) => (
                      <td
                        key={c.key}
                        style={{ textAlign: c.align, whiteSpace: c.nowrap ? 'nowrap' : undefined }}
                        className={cx(c.align === 'right' && 'num', c.align === 'center' && 'center')}
                      >
                        {c.render ? c.render(row, i) : String(valueOf(row, c) ?? '')}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {!noPager && (
        <div className="adm-pager">
          <span>
            共 <b>{fmtInt(total)}</b> 条
            {selectable && sel.length > 0 && <span className="muted"> · 已选 {sel.length}</span>}
          </span>
          {footerNote && <span className="muted">{footerNote}</span>}
          <select
            className="select"
            style={{ width: 82, height: 25, marginLeft: 4 }}
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
          >
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n} / 页</option>)}
          </select>
          <div className="adm-pages">
            <button className="adm-page-btn" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>
              <Icon name="chevron-left" size={12} />
            </button>
            {pageBtns.map((n, i) =>
              n === '…' ? (
                <span key={'e' + i} className="dim small">…</span>
              ) : (
                <button key={n} className={cx('adm-page-btn', n === curPage && 'active')} onClick={() => setPage(n)}>
                  {n}
                </button>
              )
            )}
            <button className="adm-page-btn" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>
              <Icon name="chevron-right" size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- drawer */
export const Drawer: React.FC<{
  open: boolean
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
  icon?: string
  sub?: React.ReactNode
}> = ({ open, title, onClose, children, footer, wide, icon, sub }) => {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="adm-drawer-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={cx('adm-drawer', wide && 'wide')}>
        <div className="adm-drawer-head">
          {icon && <Icon name={icon} size={16} />}
          <h3 className="ellipsis">{title}</h3>
          {sub && <span className="muted small">{sub}</span>}
          <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="关闭">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="adm-drawer-body">{children}</div>
        {footer && <div className="adm-drawer-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/* --------------------------------------------------------- confirm dialog */
export const ConfirmDialog: React.FC<{
  open: boolean
  title?: string
  message: React.ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
  /** when set, the user must type this exact text to enable confirm */
  requireText?: string
  onConfirm: () => void
  onCancel: () => void
}> = ({ open, title = '确认操作', message, confirmText = '确认', cancelText = '取消', danger, busy, requireText, onConfirm, onCancel }) => {
  const [typed, setTyped] = useState('')
  useEffect(() => { if (open) setTyped('') }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])
  if (!open) return null
  const blocked = !!requireText && typed.trim() !== requireText
  return createPortal(
    <div className="modal-mask" style={{ zIndex: 1150 }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div className="modal narrow">
        <div className="modal-header">
          {danger ? <Icon name="alert" size={17} style={{ color: 'var(--danger)' }} /> : <Icon name="help" size={17} />}
          <h3 className="grow">{title}</h3>
          <button className="btn-icon" onClick={onCancel} disabled={busy} aria-label="关闭"><Icon name="x" size={15} /></button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 'var(--fs-md)', lineHeight: 1.7, color: 'var(--text-2)' }}>{message}</div>
          {requireText && (
            <div className="adm-field" style={{ marginTop: 14, marginBottom: 0 }}>
              <label>请输入 <b className="mono">{requireText}</b> 以继续</label>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel} disabled={busy}>{cancelText}</button>
          <button
            className={cx('btn', danger ? 'btn-danger' : 'btn-primary')}
            onClick={onConfirm}
            disabled={busy || blocked}
          >
            {busy && <span className="spinner" style={{ width: 12, height: 12 }} />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Promise-based confirm: `const ok = await confirmAsync({...})` is not possible without a host,
 *  so modules keep a small <ConfirmDialog> + state pair. This helper builds the state object. */
export const useConfirm = () => {
  const [state, setState] = useState<{ open: boolean; cfg: Omit<React.ComponentProps<typeof ConfirmDialog>, 'open' | 'onCancel' | 'onConfirm'>; resolve?: (v: boolean) => void }>({
    open: false,
    cfg: { message: '' }
  })
  const ask = useCallback((cfg: Omit<React.ComponentProps<typeof ConfirmDialog>, 'open' | 'onCancel' | 'onConfirm'>) => {
    return new Promise<boolean>((resolve) => setState({ open: true, cfg, resolve }))
  }, [])
  const node = (
    <ConfirmDialog
      {...state.cfg}
      open={state.open}
      onCancel={() => { state.resolve?.(false); setState((s) => ({ ...s, open: false })) }}
      onConfirm={() => { state.resolve?.(true); setState((s) => ({ ...s, open: false })) }}
    />
  )
  return { ask, node }
}

/* ----------------------------------------------------------- charts (SVG) */
export interface Series { name: string; color: string; data: number[] }

const svgPolyline = (vals: number[], w: number, h: number, min: number, max: number, pad: number) => {
  const n = vals.length
  if (!n) return ''
  const span = max - min || 1
  return vals
    .map((v, i) => {
      const x = pad + (n === 1 ? 0 : (i * (w - pad * 2)) / (n - 1))
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** Multi-series line chart with grid, hover tooltip and optional area fill. */
export const LineChart: React.FC<{
  series: Series[]
  labels: string[]
  height?: number
  area?: boolean
  valueFmt?: (v: number) => string
  yTicks?: number
  demo?: boolean
}> = ({ series, labels, height = 200, area, valueFmt = fmtInt, yTicks = 4 }) => {
  const W = 760
  const H = height
  const pad = 34
  const [hover, setHover] = useState<number | null>(null)
  const all = series.flatMap((s) => s.data)
  const rawMax = all.length ? Math.max(...all) : 1
  const rawMin = all.length ? Math.min(...all) : 0
  const max = rawMax === rawMin ? rawMax + 1 : rawMax
  const min = Math.min(rawMin, 0) === rawMin && rawMin > 0 ? 0 : rawMin
  const n = labels.length
  const xAt = (i: number) => pad + (n <= 1 ? 0 : (i * (W - pad * 2)) / (n - 1))

  return (
    <div className="adm-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="adm-chart" style={{ height }} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const rel = ((e.clientX - box.left) / box.width) * W
          const i = Math.round(((rel - pad) / (W - pad * 2)) * (n - 1))
          setHover(Math.max(0, Math.min(n - 1, i)))
        }}
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`admGrad${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
            </linearGradient>
          ))}
        </defs>
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const y = pad + (i * (H - pad * 2)) / yTicks
          const v = max - (i * (max - min)) / yTicks
          return (
            <g key={i}>
              <line x1={pad} x2={W - pad} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={pad - 6} y={y + 3.5} textAnchor="end" fontSize="9" fill="var(--text-3)">
                {valueFmt(Math.round(v * 100) / 100)}
              </text>
            </g>
          )
        })}
        {series.map((s, si) => (
          <g key={si}>
            {area && (
              <polygon
                fill={`url(#admGrad${si})`}
                points={`${pad},${H - pad} ${svgPolyline(s.data, W, H, min, max, pad)} ${W - pad},${H - pad}`}
              />
            )}
            <polyline
              points={svgPolyline(s.data, W, H, min, max, pad)}
              fill="none"
              stroke={s.color}
              strokeWidth="1.9"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad} y2={H - pad} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" />
            {series.map((s, si) => {
              const y = H - pad - ((s.data[hover] - min) / (max - min || 1)) * (H - pad * 2)
              return <circle key={si} cx={xAt(hover)} cy={y} r="3" fill={s.color} stroke="var(--surface-solid)" strokeWidth="1.5" />
            })}
          </g>
        )}
        {labels.map((l, i) =>
          n <= 8 || i % Math.ceil(n / 7) === 0 ? (
            <text key={i} x={xAt(i)} y={H - pad + 14} textAnchor="middle" fontSize="9" fill="var(--text-3)">
              {l}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: 4,
            left: `${Math.min(78, Math.max(2, (hover / Math.max(1, n - 1)) * 100))}%`,
            padding: '6px 9px',
            fontSize: 'var(--fs-xs)',
            pointerEvents: 'none',
            zIndex: 3,
            minWidth: 110
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i className="adm-legend-sw dot" style={{ background: s.color }} />
              <span className="muted grow">{s.name}</span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{valueFmt(s.data[hover] ?? 0)}</b>
            </div>
          ))}
        </div>
      )}
      <div className="adm-legend" style={{ marginTop: 4, justifyContent: 'center' }}>
        {series.map((s) => (
          <span key={s.name} className="adm-legend-i">
            <i className="adm-legend-sw" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Horizontal / vertical bar chart. */
export const BarChart: React.FC<{
  items: { label: string; value: number; color?: string }[]
  height?: number
  valueFmt?: (v: number) => string
}> = ({ items, height = 180, valueFmt = fmtInt }) => {
  const W = 760
  const H = height
  const pad = 30
  const max = Math.max(1, ...items.map((i) => i.value))
  const bw = (W - pad * 2) / Math.max(1, items.length * 1.6)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="adm-chart" style={{ height }} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={pad + t * (H - pad * 2)} y2={pad + t * (H - pad * 2)} stroke="var(--border)" />
        ))}
        {items.map((it, i) => {
          const x = pad + (i + 0.5) * ((W - pad * 2) / Math.max(1, items.length)) - bw / 2
          const hgt = (it.value / max) * (H - pad * 2)
          return (
            <g key={it.label + i}>
              <rect x={x} y={H - pad - hgt} width={bw} height={Math.max(1, hgt)} rx="2.5"
                fill={it.color || 'var(--accent)'} opacity="0.85" />
              <text x={x + bw / 2} y={H - pad + 13} textAnchor="middle" fontSize="9" fill="var(--text-3)">
                {it.label.length > 7 ? it.label.slice(0, 7) + '…' : it.label}
              </text>
              <text x={x + bw / 2} y={H - pad - hgt - 4} textAnchor="middle" fontSize="9" fill="var(--text-2)">
                {valueFmt(it.value)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Donut / ring chart with centered label. */
export const DonutChart: React.FC<{
  value: number
  max?: number
  size?: number
  thickness?: number
  label?: React.ReactNode
  sublabel?: React.ReactNode
  color?: string
  segments?: { value: number; color: string; name: string }[]
}> = ({ value, max = 100, size = 132, thickness = 12, label, sublabel, color = 'var(--accent)', segments }) => {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  let acc = 0
  const segs = segments && segments.length ? segments : null
  const totalSeg = segs ? segs.reduce((a, b) => a + b.value, 0) || 1 : 1
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        {segs ? (
          segs.map((s, i) => {
            const len = (s.value / totalSeg) * c
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-acc}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                strokeLinecap="butt"
              />
            )
            acc += len
            return el
          })
        ) : (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
            strokeDasharray={`${pct * c} ${c}`} strokeDashoffset={0}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="round"
          />
        )}
        <text x={size / 2} y={size / 2 - 1} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--text)">
          {label ?? fmtPct(pct * 100)}
        </text>
        {sublabel && (
          <text x={size / 2} y={size / 2 + 15} textAnchor="middle" fontSize="9" fill="var(--text-3)">
            {sublabel}
          </text>
        )}
      </svg>
      {segs && (
        <div className="adm-legend" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          {segs.map((s) => (
            <span key={s.name} className="adm-legend-i">
              <i className="adm-legend-sw dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Simple horizontal bar list used by storage / plugin ranking blocks. */
export const BarList: React.FC<{
  items: { label: string; value: number; hint?: React.ReactNode; color?: string }[]
  fmt?: (v: number) => string
  max?: number
}> = ({ items, fmt = fmtInt, max }) => {
  const top = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="adm-bars">
      {items.length === 0 && <div className="dim small">暂无数据</div>}
      {items.map((it, i) => (
        <div className="adm-bar-row" key={it.label + i}>
          <span className="ellipsis" title={it.label}>{it.label}</span>
          <div className="adm-bar-track">
            <div className="adm-bar-fill" style={{ width: `${Math.max(2, (it.value / top) * 100)}%`, background: it.color }} />
          </div>
          <span className="adm-bar-val">{it.hint ?? fmt(it.value)}</span>
        </div>
      ))}
    </div>
  )
}

export const Progress: React.FC<{ value: number; max?: number; tone?: 'ok' | 'warn' | 'danger'; label?: React.ReactNode }> = ({
  value,
  max = 100,
  tone,
  label
}) => {
  const pct = Math.min(100, Math.max(0, (value / (max || 1)) * 100))
  const auto = pct > 88 ? 'danger' : pct > 70 ? 'warn' : 'ok'
  return (
    <div>
      {label && <div className="adm-row-between" style={{ marginBottom: 4, fontSize: 'var(--fs-xs)' }}>{label}</div>}
      <div className="adm-progress"><i className={tone || auto} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

/* ------------------------------------------------------------ misc bits */
export const KV: React.FC<{ items: [string, React.ReactNode][] }> = ({ items }) => (
  <dl className="adm-kv">
    {items.map(([k, v], i) => (
      <React.Fragment key={k + i}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </React.Fragment>
    ))}
  </dl>
)

export const Empty: React.FC<{ icon?: string; text?: React.ReactNode; action?: React.ReactNode }> = ({
  icon = 'database',
  text = '暂无数据',
  action
}) => (
  <div className="empty">
    <Icon name={icon} size={28} />
    <div>{text}</div>
    {action}
  </div>
)

export const Field: React.FC<{
  label: React.ReactNode
  hint?: React.ReactNode
  required?: boolean
  children: React.ReactNode
  style?: React.CSSProperties
}> = ({ label, hint, required, children, style }) => (
  <div className="adm-field" style={style}>
    <label>
      {label}
      {required && <span className="adm-req">*</span>}
    </label>
    {children}
    {hint && <div className="adm-hint">{hint}</div>}
  </div>
)

export const Note: React.FC<{ tone?: 'info' | 'warn' | 'danger'; children: React.ReactNode; style?: React.CSSProperties }> = ({
  tone = 'info',
  children,
  style
}) => <div className={cx('adm-note', tone !== 'info' && tone)} style={style}>{children}</div>

/** Re-export so module files need a single import. */
export { api }
