/**
 * Global overlays: custom context menu (with long-press on touch), modal host,
 * toasts. Rendered once at the app root.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useStore, type ContextMenuItem } from '@/store'
import { Icon } from './Icon'

/* ------------------------------------------------------------------ menu */
const MenuList: React.FC<{ items: ContextMenuItem[]; onDone: () => void; depth?: number }> = ({ items, onDone, depth = 0 }) => {
  const [openSub, setOpenSub] = useState<string | null>(null)
  return (
    <>
      {items.map((it, i) => {
        if (it.divider) return <div className="menu-divider" key={'d' + i} />
        const hasSub = !!it.submenu?.length
        const content = (
          <>
            {it.icon ? <Icon name={it.icon} size={14} /> : <span style={{ width: 14 }} />}
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            {hasSub && <Icon name="chevron-right" size={13} className="menu-arrow" />}
          </>
        )
        if (hasSub) {
          return (
            <div className="menu-sub" key={it.id} onMouseEnter={() => setOpenSub(it.id)} onMouseLeave={() => setOpenSub(null)}>
              <button className={'menu-item' + (it.disabled ? ' disabled' : '')} type="button">
                {content}
              </button>
              {openSub === it.id && (
                <div className="menu" style={{ position: 'absolute', left: '100%', top: -5 }}>
                  <MenuList items={it.submenu!} onDone={onDone} depth={depth + 1} />
                </div>
              )}
            </div>
          )
        }
        return (
          <button
            key={it.id}
            type="button"
            className={'menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '')}
            onClick={async () => {
              onDone()
              try { await it.run?.() } catch (e) { console.error(e) }
            }}
          >
            {content}
          </button>
        )
      })}
    </>
  )
}

export const ContextMenuHost: React.FC = () => {
  const cm = useStore((s) => s.contextMenu)
  const close = useStore((s) => s.closeContextMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!cm) return
    const el = ref.current
    const pad = 8
    const w = el?.offsetWidth || 220
    const h = el?.offsetHeight || 300
    const x = Math.min(cm.x, window.innerWidth - w - pad)
    const y = Math.min(cm.y, window.innerHeight - h - pad)
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) })
  }, [cm])

  useEffect(() => {
    if (!cm) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onScroll = () => close()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [cm, close])

  if (!cm) return null
  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {cm.title && <div className="menu-title">{cm.title}</div>}
      <MenuList items={cm.items} onDone={close} />
    </div>
  )
}

/* --------------------------------------------------------------- modals */
type ModalRenderer = React.ComponentType<{ props?: Record<string, unknown>; onClose: () => void }>
const modalRegistry = new Map<string, ModalRenderer>()
export const registerModal = (id: string, Comp: ModalRenderer) => { modalRegistry.set(id, Comp) }

export const ModalHost: React.FC = () => {
  const modal = useStore((s) => s.modal)
  const close = useStore((s) => s.closeModal)
  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, close])
  if (!modal) return null
  const Comp = modalRegistry.get(modal.id)
  if (!Comp) return null
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <Comp props={modal.props} onClose={close} />
    </div>
  )
}

/** Floating (non-blocking) dialog wrapper for feature-level dialogs */
export const Dialog: React.FC<{
  title?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
  width?: number | string
  className?: string
  icon?: string
}> = ({ title, children, footer, onClose, width, className = '', icon }) => (
  <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className={'modal ' + className} style={{ maxWidth: width }}>
      {title && (
        <div className="modal-header">
          {icon && <Icon name={icon} size={17} />}
          <h3 className="grow ellipsis">{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="关闭"><Icon name="x" size={15} /></button>
        </div>
      )}
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>
)

/* --------------------------------------------------------------- toasts */
export const ToastHost: React.FC = () => {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  if (!toasts.length) return null
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          <Icon
            name={t.kind === 'ok' ? 'check' : t.kind === 'error' ? 'alert' : t.kind === 'warn' ? 'alert' : 'info'}
            size={15}
          />
          <span className="grow">{t.text}</span>
          {t.action && (
            <button className="btn btn-sm btn-ghost" onClick={() => { t.action!.run(); dismiss(t.id) }}>
              {t.action.label}
            </button>
          )}
          <button className="btn-icon" style={{ width: 20, height: 20 }} onClick={() => dismiss(t.id)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------- global long-press */
/**
 * Converts touch long-press into a synthetic contextmenu event so that every
 * desktop context menu works identically on Android/iOS.
 */
export const useGlobalLongPress = () => {
  useEffect(() => {
    let timer: number | undefined
    let startX = 0
    let startY = 0
    let target: HTMLElement | null = null
    const clear = () => { if (timer) window.clearTimeout(timer); timer = undefined }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      startX = t.clientX; startY = t.clientY
      target = e.target as HTMLElement
      clear()
      timer = window.setTimeout(() => {
        if (!target) return
        const ev = new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: startX, clientY: startY
        })
        target.dispatchEvent(ev)
        navigator.vibrate?.(12)
      }, 520)
    }
    const onMove = (e: TouchEvent) => {
      if (!timer) return
      const t = e.touches[0]
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) clear()
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', clear)
    document.addEventListener('touchcancel', clear)
    return () => {
      clear()
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', clear)
      document.removeEventListener('touchcancel', clear)
    }
  }, [])
}

export const GlobalOverlays: React.FC = () => {
  useGlobalLongPress()
  // block the browser's native menu everywhere; feature components supply their own
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      // allow native menu inside inputs unless a component already prevented it
      if (el.closest('[data-native-menu]')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])
  return (
    <>
      <ContextMenuHost />
      <ModalHost />
      <ToastHost />
    </>
  )
}
