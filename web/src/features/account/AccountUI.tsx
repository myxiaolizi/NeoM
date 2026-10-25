/**
 * Small shared UI kit for the account centre panels.
 */
import React from 'react'
import { Icon } from '@/components/Icon'

export const Section: React.FC<{
  icon?: string
  title: string
  desc?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}> = ({ icon, title, desc, actions, children, className }) => (
  <section className={'ac-card ' + (className || '')}>
    <header className="ac-card-head">
      {icon && (
        <span className="p-tile" style={{ width: 30, height: 30, borderRadius: 9 }}>
          <Icon name={icon} size={15} />
        </span>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="ac-card-actions">{actions}</div>}
    </header>
    {children != null && <div className="ac-card-body">{children}</div>}
  </section>
)

export const Loading: React.FC<{ text?: string; inline?: boolean }> = ({ text = '加载中…', inline }) =>
  inline ? (
    <span className="row small dim" style={{ gap: 7 }}>
      <span className="spinner" /> {text}
    </span>
  ) : (
    <div className="p-state">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  )

export const ErrorBox: React.FC<{ message?: string | null; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="p-state err">
    <Icon name="alert" size={20} />
    <strong>{message || '加载失败'}</strong>
    <span>{/网络|failed|fetch/i.test(message || '') ? '无法连接服务器，请检查网络后重试' : '可稍后重试，或联系管理员'}</span>
    {onRetry && (
      <button className="btn btn-sm" onClick={onRetry} style={{ marginTop: 4 }}>
        <Icon name="refresh" size={13} /> 重试
      </button>
    )}
  </div>
)

export const EmptyBox: React.FC<{
  icon?: string
  title: string
  desc?: string
  action?: React.ReactNode
}> = ({ icon = 'file-text', title, desc, action }) => (
  <div className="p-state">
    <Icon name={icon} size={22} />
    <strong>{title}</strong>
    {desc && <span style={{ maxWidth: 380 }}>{desc}</span>}
    {action}
  </div>
)

export const Field: React.FC<{
  label: string
  hint?: React.ReactNode
  required?: boolean
  children: React.ReactNode
  style?: React.CSSProperties
}> = ({ label, hint, required, children, style }) => (
  <div className="field" style={style}>
    <label>
      {label}
      {required && <span style={{ color: 'var(--danger)' }}> *</span>}
    </label>
    {children}
    {hint && <span className="hint">{hint}</span>}
  </div>
)

export const KV: React.FC<{ k: string; v: React.ReactNode; mono?: boolean }> = ({ k, v, mono }) => (
  <div className="ac-kv">
    <span className="k">{k}</span>
    <span className={'v' + (mono ? ' mono' : '')}>{v || '—'}</span>
  </div>
)

export const Toggle: React.FC<{ on: boolean; disabled?: boolean; onChange: (v: boolean) => void; title?: string }> = ({
  on,
  disabled,
  onChange,
  title
}) => (
  <button
    type="button"
    className={'switch' + (on ? ' on' : '')}
    disabled={disabled}
    title={title || (on ? '已启用' : '已停用')}
    aria-pressed={on}
    onClick={() => onChange(!on)}
  />
)

/** Right-aligned footer used by settings forms. */
export const FormFooter: React.FC<{ children: React.ReactNode; note?: React.ReactNode }> = ({ children, note }) => (
  <div className="ac-form-footer">
    {note && <span className="tiny dim grow">{note}</span>}
    <div className="row" style={{ gap: 8 }}>
      {children}
    </div>
  </div>
)

export const IMask = (key: string, last4?: string) =>
  last4 ? `${'•'.repeat(Math.max(6, Math.min(20, key.length - 4)))}${last4}` : '已保存（不显示明文）'
