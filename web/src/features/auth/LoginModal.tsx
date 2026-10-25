/**
 * Login dialog for the landing page (`openModal('login')`).
 * Registers itself into the global modal registry on module load so the
 * marketing page never has to know about the auth implementation.
 */
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { registerModal } from '@/components/Overlays'
import { useStore } from '@/store'
import { BrandLock } from '@/features/marketing/Brand'
import { loadRemembered, useLogin } from './useAuth'
import '@/styles/portal-base.css'
import '@/styles/portal-auth.css'

export interface LoginModalProps {
  props?: Record<string, unknown>
  onClose: () => void
}

const LoginModal: React.FC<LoginModalProps> = ({ props, onClose }) => {
  const navigate = useNavigate()
  const toast = useStore((s) => s.toast)
  const remembered = loadRemembered()
  const [account, setAccount] = useState(remembered.account)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(remembered.remember)
  const [reveal, setReveal] = useState(false)
  const { busy, error, signIn } = useLogin()
  const redirect = typeof props?.redirect === 'string' && props.redirect ? (props.redirect as string) : '/app'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await signIn(account, password, remember)
    if (res.ok) {
      onClose()
      navigate(redirect, { replace: true })
    }
  }

  return (
    <div className="modal login-modal" role="dialog" aria-modal="true" aria-label="登录 NeoM">
      <div className="modal-body">
        <button
          type="button"
          className="btn-icon"
          style={{ position: 'absolute', right: 10, top: 10 }}
          aria-label="关闭"
          onClick={onClose}
        >
          <Icon name="x" size={15} />
        </button>

        <div className="login-modal-head">
          <span className="p-brand">
            <BrandLock size={30} />
          </span>
          <h3>登录 NeoM</h3>
          <p>登录后云仓库、积分与插件配置会自动同步</p>
        </div>

        {error && (
          <div className="p-inline-err" style={{ marginBottom: 14 }} role="alert">
            <Icon name="alert" size={14} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="lm-account">账号</label>
            <input
              id="lm-account"
              className="input"
              autoFocus
              autoComplete="username"
              placeholder="用户名或邮箱"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="lm-password">密码</label>
            <div className="pwd-wrap">
              <input
                id="lm-password"
                className="input"
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="eye"
                aria-label={reveal ? '隐藏密码' : '显示密码'}
                onClick={() => setReveal((v) => !v)}
              >
                <Icon name={reveal ? 'eye-off' : 'eye'} size={15} />
              </button>
            </div>
          </div>

          <div className="auth-row">
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              记住账号
            </label>
            <button
              type="button"
              className="auth-link"
              onClick={() =>
                toast({
                  kind: 'info',
                  text: '密码可通过管理员重置；注册邮箱验证与自助找回正在开发中'
                })
              }
            >
              忘记密码？
            </button>
          </div>

          <button className="p-btn p-btn-primary p-btn-block p-btn-lg" type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,.35)' }} /> 登录中…
              </>
            ) : (
              '登录'
            )}
          </button>
        </form>

        <div className="auth-foot">
          还没有账号？
          <Link to="/register" onClick={onClose}>
            {' '}
            免费注册
          </Link>
        </div>
      </div>
    </div>
  )
}

registerModal('login', LoginModal)

export default LoginModal
