/**
 * Shared plugin UI primitives (kept tiny — plugins are lazy loaded so each
 * kilobytes matters). All classes are namespaced `plg-` and styled by
 * `styles/plugins.css`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { EVT } from '@/lib/contracts'
import type { PanelProps, PluginContext } from './types'
import { scanVault, subscribeVault, getCachedVault, type ScanDoc } from './vault'
import { debounce } from './utils'

/* --------------------------------------------------------------- layout */
export const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={'plg-panel ' + className}>{children}</div>
)

export const Head: React.FC<{
  icon?: string
  title: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
}> = ({ icon, title, sub, actions }) => (
  <div className="plg-head">
    {icon && <Icon name={icon} size={14} />}
    <div className="grow">
      <div className="plg-head-title ellipsis">{title}</div>
      {sub && <div className="plg-head-sub ellipsis">{sub}</div>}
    </div>
    {actions}
  </div>
)

export const Toolbar: React.FC<{ children: React.ReactNode; wrap?: boolean }> = ({ children, wrap }) => (
  <div className={'plg-toolbar' + (wrap ? ' wrap' : '')}>{children}</div>
)

export const Btn: React.FC<{
  icon?: string
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  active?: boolean
  danger?: boolean
  title?: string
  disabled?: boolean
  primary?: boolean
  size?: 'sm' | 'md'
}> = ({ icon, children, onClick, active, danger, title, disabled, primary, size = 'sm' }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={[
      'plg-btn',
      size === 'sm' ? 'sm' : '',
      active ? 'on' : '',
      danger ? 'danger' : '',
      primary ? 'primary' : ''
    ].filter(Boolean).join(' ')}
  >
    {icon && <Icon name={icon} size={13} />}
    {children}
  </button>
)

export const IconBtn: React.FC<{ icon: string; title?: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; disabled?: boolean; size?: number }> = ({
  icon, title, onClick, active, disabled, size = 14
}) => (
  <button type="button" className={'plg-icon-btn' + (active ? ' on' : '')} title={title} onClick={onClick} disabled={disabled}>
    <Icon name={icon} size={size} />
  </button>
)

export const Search: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }> = ({
  value, onChange, placeholder = '搜索…', autoFocus
}) => (
  <div className="plg-search">
    <Icon name="search" size={13} />
    <input
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
    {value && <button type="button" className="plg-search-clear" onClick={() => onChange('')}><Icon name="x" size={11} /></button>}
  </div>
)

export const Row: React.FC<{
  icon?: string
  title: React.ReactNode
  sub?: React.ReactNode
  meta?: React.ReactNode
  onClick?: () => void
  active?: boolean
  indent?: number
  right?: React.ReactNode
  title2?: string
}> = ({ icon, title, sub, meta, onClick, active, indent = 0, right, title2 }) => (
  <div
    className={'plg-row' + (active ? ' on' : '') + (onClick ? ' clickable' : '')}
    style={indent ? { paddingLeft: 8 + indent * 13 } : undefined}
    onClick={onClick}
    title={title2}
  >
    {icon && <span className="plg-row-icon"><Icon name={icon} size={13} /></span>}
    <span className="plg-row-main">
      <span className="plg-row-title ellipsis">{title}</span>
      {sub && <span className="plg-row-sub ellipsis">{sub}</span>}
    </span>
    {meta !== undefined && <span className="plg-row-meta">{meta}</span>}
    {right}
  </div>
)

export const Empty: React.FC<{ icon?: string; text: React.ReactNode; action?: React.ReactNode }> = ({ icon = 'file', text, action }) => (
  <div className="plg-empty">
    <Icon name={icon} size={22} />
    <div>{text}</div>
    {action}
  </div>
)

export const Spinner: React.FC<{ text?: string }> = ({ text }) => (
  <div className="plg-loading"><span className="spinner" />{text && <span>{text}</span>}</div>
)

export const Segmented: React.FC<{
  value: string
  options: { value: string; label: React.ReactNode; icon?: string }[]
  onChange: (v: string) => void
}> = ({ value, options, onChange }) => (
  <div className="plg-seg">
    {options.map((o) => (
      <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
        {o.icon && <Icon name={o.icon} size={12} />}
        {o.label}
      </button>
    ))}
  </div>
)

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="plg-field">
    <span className="plg-field-label">{label}</span>
    {children}
    {hint && <span className="plg-field-hint">{hint}</span>}
  </label>
)

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string }> = ({ checked, onChange, label }) => (
  <button type="button" className="plg-toggle-row" onClick={() => onChange(!checked)}>
    {label && <span className="grow">{label}</span>}
    <span className={'switch' + (checked ? ' on' : '')} />
  </button>
)

/* ---------------------------------------------------------------- modal */
export const Modal: React.FC<{
  title?: React.ReactNode
  icon?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
  className?: string
}> = ({ title, icon, onClose, children, footer, width = 620, className = '' }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div className="plg-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'plg-modal ' + className} style={{ maxWidth: width }}>
        {title && (
          <div className="plg-modal-head">
            {icon && <Icon name={icon} size={15} />}
            <div className="grow ellipsis">{title}</div>
            <IconBtn icon="x" onClick={onClose} title="关闭" />
          </div>
        )}
        <div className="plg-modal-body">{children}</div>
        {footer && <div className="plg-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/* ----------------------------------------------------------------- hooks */
/** Active document (path + content) with polling so we never depend on shell events. */
export const useActiveDoc = (ctx: PluginContext, opts: { reloadOnSave?: boolean } = {}) => {
  const [path, setPath] = useState<string | null>(() => {
    try { return ctx.getActivePath?.() ?? null } catch { return null }
  })
  const [content, setContent] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => { setTick((t) => t + 1) }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      let p: string | null = null
      try { p = ctx.getActivePath?.() ?? null } catch { p = null }
      setPath((prev) => (prev === p ? prev : p))
    }, 600)
    return () => window.clearInterval(timer)
  }, [ctx])

  useEffect(() => {
    if (opts.reloadOnSave === false) return
    const onSave = debounce(() => setTick((t) => t + 1), 320)
    window.addEventListener(EVT.docSaved, onSave)
    window.addEventListener(EVT.docOpened, reload)
    return () => {
      window.removeEventListener(EVT.docSaved, onSave)
      window.removeEventListener(EVT.docOpened, reload)
      onSave.cancel()
    }
  }, [reload, opts.reloadOnSave])

  useEffect(() => {
    let alive = true
    const load = async () => {
      if (!path) {
        try { setContent(ctx.getActiveContent() || '') } catch { setContent('') }
        return
      }
      try {
        const raw = await ctx.vault.read(path)
        const c = typeof raw === 'string' ? raw : (raw?.content ?? '')
        if (alive) setContent(String(c || ''))
      } catch {
        if (alive) {
          try { setContent(ctx.getActiveContent() || '') } catch { setContent('') }
        }
      }
    }
    load()
    return () => { alive = false }
  }, [ctx, path, tick])

  return { path, content, reload, setContent }
}

/** Whole-vault scan with cache + auto refresh on invalidation. */
export const useVaultDocs = (ctx: PluginContext) => {
  const [docs, setDocs] = useState<ScanDoc[]>(() => getCachedVault())
  const [loading, setLoading] = useState(!getCachedVault().length)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const list = await scanVault(ctx, { force, onProgress: (done, total) => { if (alive.current) setProgress({ done, total }) } })
      if (alive.current) setDocs(list)
    } catch (e: any) {
      if (alive.current) setError(e?.message || '扫描失败')
    } finally {
      if (alive.current) { setLoading(false); setProgress(null) }
    }
  }, [ctx])

  useEffect(() => {
    alive.current = true
    refresh(getCachedVault().length === 0)
    const kick = debounce(() => { refresh(true) }, 700)
    const off = subscribeVault((next) => { if (!next) kick() })
    return () => { alive.current = false; off(); kick.cancel() }
  }, [refresh])

  return { docs, loading, error, progress, refresh }
}

/** localStorage-backed state routed through the plugin's settings namespace. */
export const usePluginSetting = <T,>(ctx: PluginContext, key: string, fallback: T) => {
  const [value, setValue] = useState<T>(() => ctx.settings.get<T>(key, fallback))
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      ctx.settings.set(key, v)
      return v
    })
  }, [ctx, key])
  return [value, set] as const
}

/** Document title list for quick switcher / random note. */
export const docTitle = (d: ScanDoc) => {
  const fmTitle = d.frontmatter?.title
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim()
  const h = d.headings.find((x) => x.level === 1) || d.headings[0]
  return h ? h.text : d.stem
}

/** Scroll helper used after jumping to a heading offset. */
export const scrollToOffset = (offset: number) => {
  window.dispatchEvent(new CustomEvent(EVT.commandRun, { detail: { command: 'editor.scrollTo', offset } }))
  const editor = document.querySelector('.vditor-ir, .vditor-sv, .vditor-wysiwyg, [data-editor]') as HTMLElement | null
  if (!editor) return
  const text = editor.innerText || ''
  if (!text) return
  const ratio = Math.max(0, Math.min(1, offset / Math.max(1, text.length)))
  editor.scrollTop = ratio * editor.scrollHeight
}

/** Small debounced value hook (search inputs). */
export const useDebounced = <T,>(value: T, ms = 180): T => {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

export const useMounted = () => {
  const ref = useRef(true)
  useEffect(() => () => { ref.current = false }, [])
  return ref
}

/** Count helper for toolbars. */
export const useCount = (n: number, label: string) => useMemo(() => (n ? `${n} ${label}` : ''), [n, label])

export type { PanelProps, PluginContext }
