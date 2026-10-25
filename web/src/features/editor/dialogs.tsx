/**
 * Promise-based prompt / confirm dialogs registered into the global modal host.
 * Used by every editor-side command that needs a text value or a confirmation.
 */
import React, { useEffect, useRef, useState } from 'react'
import { registerModal } from '@/components/Overlays'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'

export interface PromptOptions {
  title: string
  label?: string
  value?: string
  placeholder?: string
  hint?: string
  confirmText?: string
  cancelText?: string
  multiline?: boolean
  icon?: string
  /** return false / a string to keep the dialog open (shown as error) */
  validate?: (value: string) => boolean | string
}

type PromptProps = {
  props?: Record<string, unknown>
  onClose: () => void
}

const PromptModal: React.FC<PromptProps> = ({ props, onClose }) => {
  const opts = (props?.options || {}) as PromptOptions
  const resolve = props?.resolve as ((v: string | null) => void) | undefined
  const [value, setValue] = useState(opts.value ?? '')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      ref.current?.focus()
      if (ref.current instanceof HTMLInputElement) {
        const dot = ref.current.value.lastIndexOf('.')
        ref.current.setSelectionRange(0, dot > 0 ? dot : ref.current.value.length)
      }
    }, 30)
    return () => window.clearTimeout(t)
  }, [])

  const done = (v: string | null) => {
    resolve?.(v)
    onClose()
  }

  const submit = () => {
    const v = value.trim()
    if (!v) return setError('不能为空')
    const check = opts.validate?.(v)
    if (typeof check === 'string') return setError(check)
    if (check === false) return setError('输入无效')
    done(v)
  }

  return (
    <div className="modal narrow" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <Icon name={opts.icon || 'edit'} size={17} />
        <h3 className="grow ellipsis">{opts.title}</h3>
        <button className="btn-icon" onClick={() => done(null)} aria-label="关闭">
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="modal-body prompt-body">
        {opts.label && <label className="small muted">{opts.label}</label>}
        {opts.multiline ? (
          <textarea
            className="textarea"
            ref={(el) => { ref.current = el }}
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => { setValue(e.target.value); setError(null) }}
          />
        ) : (
          <input
            className="input"
            ref={(el) => { ref.current = el }}
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => { setValue(e.target.value); setError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit() }
              if (e.key === 'Escape') { e.preventDefault(); done(null) }
            }}
          />
        )}
        {error ? <div className="tip-line" style={{ color: 'var(--danger)' }}>{error}</div> : null}
        {opts.hint && !error ? <div className="prompt-hint">{opts.hint}</div> : null}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={() => done(null)}>{opts.cancelText || '取消'}</button>
        <button className="btn btn-primary" onClick={submit}>{opts.confirmText || '确定'}</button>
      </div>
    </div>
  )
}

export interface ConfirmOptions {
  title: string
  text?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  icon?: string
}

const ConfirmModal: React.FC<PromptProps> = ({ props, onClose }) => {
  const opts = (props?.options || {}) as ConfirmOptions
  const resolve = props?.resolve as ((v: boolean) => void) | undefined
  const done = (v: boolean) => {
    resolve?.(v)
    onClose()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') done(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="modal narrow" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <Icon name={opts.icon || (opts.danger ? 'alert' : 'help')} size={17} />
        <h3 className="grow ellipsis">{opts.title}</h3>
      </div>
      {opts.text && <div className="modal-body"><p style={{ margin: 0, lineHeight: 1.7 }}>{opts.text}</p></div>}
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={() => done(false)}>{opts.cancelText || '取消'}</button>
        <button className={'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary')} onClick={() => done(true)}>
          {opts.confirmText || '确定'}
        </button>
      </div>
    </div>
  )
}

let registered = false
const ensureRegistered = () => {
  if (registered) return
  registered = true
  registerModal('shell.prompt', PromptModal)
  registerModal('shell.confirm', ConfirmModal)
}

/** Ask for a single line of text. Resolves null when cancelled. */
export function promptText(options: PromptOptions): Promise<string | null> {
  ensureRegistered()
  return new Promise((resolve) => {
    useStore.getState().openModal('shell.prompt', { options, resolve })
  })
}

/** Yes/no confirmation. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  ensureRegistered()
  return new Promise((resolve) => {
    useStore.getState().openModal('shell.confirm', { options, resolve })
  })
}

/* ---------------------------------------------------------------- file name */
/** Rename prompt shared by the tree, tab bar and editor title. */
export function promptFileName(current: string, opts: { title?: string; dir?: string } = {}): Promise<string | null> {
  return promptText({
    title: opts.title || '重命名',
    label: '文件名',
    value: current,
    icon: 'edit',
    confirmText: '重命名',
    validate: (v) => (/[\\/:*?"<>|]/.test(v) ? '名称不能包含 \\ / : * ? " < > |' : true)
  })
}

/** Folder name prompt. */
export function promptFolderName(): Promise<string | null> {
  return promptText({
    title: '新建子文件夹',
    label: '文件夹名称',
    value: '新建文件夹',
    icon: 'folder-plus',
    confirmText: '创建',
    validate: (v) => (/[\\/:*?"<>|]/.test(v) ? '名称不能包含非法字符' : true)
  })
}
