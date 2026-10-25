/**
 * `/register` — account creation. On success the user is signed in
 * automatically and sent to the editor.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { AuthFrame, DocsDialog } from '@/features/marketing/PortalChrome'
import { useRegister } from './useAuth'
import '@/styles/portal-base.css'
import '@/styles/portal-auth.css'

interface FieldErrors {
  username?: string
  email?: string
  password?: string
  confirm?: string
  agree?: string
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const Register: React.FC = () => {
  const navigate = useNavigate()
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const toast = useStore((s) => s.toast)
  const { busy, error, signUp } = useRegister()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [policy, setPolicy] = useState<'terms' | 'privacy' | null>(null)

  useEffect(() => {
    if (authReady && user) navigate('/app', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user])

  const strength = useMemo(() => {
    const v = password
    let score = 0
    if (v.length >= 8) score++
    if (/[a-zA-Z]/.test(v) && /\d/.test(v)) score++
    if (v.length >= 12) score++
    if (/[^a-zA-Z0-9]/.test(v)) score++
    return Math.min(score, 4)
  }, [password])
  const strengthLabel = ['太短', '较弱', '一般', '较强', '很强'][strength]

  const validate = (): boolean => {
    const next: FieldErrors = {}
    if (!USERNAME_RE.test(username.trim())) next.username = '用户名需为 3–32 位字母、数字、下划线或短横线'
    if (email.trim() && !EMAIL_RE.test(email.trim())) next.email = '邮箱格式不正确（也可留空）'
    if (password.length < 8) next.password = '密码至少 8 位'
    if (confirm !== password) next.confirm = '两次输入的密码不一致'
    if (!agree) next.agree = '请先阅读并同意用户服务协议与隐私政策'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    const res = await signUp({
      username: username.trim(),
      password,
      email: email.trim() || undefined
    })
    if (res.ok) {
      toast({
        kind: 'ok',
        text:
          typeof res.points === 'number' && res.points > 0
            ? `注册成功，已赠送 ${res.points} 体验积分`
            : '注册成功，已自动登录，正在进入编辑器…'
      })
      navigate('/app', { replace: true })
    }
  }

  return (
    <AuthFrame
      title="创建 NeoM 账号"
      subtitle="免费注册，立即获得云端仓库、全部内置插件与体验积分"
      badge={
        <div className="gift-note">
          <Icon name="sparkles" size={14} />
          <span>新用户注册即赠送体验积分，可用于体验官方 AI 通道</span>
        </div>
      }
      footer={
        <span>
          已有账号？
          <Link to="/login"> 直接登录 </Link>
        </span>
      }
    >
      {error && (
        <div className="p-inline-err" style={{ marginBottom: 16 }} role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="reg-username">用户名 *</label>
          <input
            id="reg-username"
            className="input"
            autoFocus
            autoComplete="username"
            placeholder="3–32 位字母、数字、下划线"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          {errors.username ? (
            <span className="hint" style={{ color: 'var(--danger)' }}>
              {errors.username}
            </span>
          ) : (
            <span className="hint">登录时可用用户名或邮箱</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="reg-email">邮箱（可选）</label>
          <input
            id="reg-email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="用于找回密码与接收通知"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {errors.email && (
            <span className="hint" style={{ color: 'var(--danger)' }}>
              {errors.email}
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="reg-password">密码 *</label>
          <div className="pwd-wrap">
            <input
              id="reg-password"
              className="input"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="至少 8 位，建议字母 + 数字"
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
          {password ? (
            <span className="hint" style={{ color: strength >= 2 ? 'var(--ok)' : 'var(--text-3)' }}>
              密码强度：{strengthLabel}
            </span>
          ) : (
            errors.password && (
              <span className="hint" style={{ color: 'var(--danger)' }}>
                {errors.password}
              </span>
            )
          )}
        </div>

        <div className="field">
          <label htmlFor="reg-confirm">确认密码 *</label>
          <input
            id="reg-confirm"
            className="input"
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="再次输入密码"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {errors.confirm && (
            <span className="hint" style={{ color: 'var(--danger)' }}>
              {errors.confirm}
            </span>
          )}
        </div>

        <label className="check" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            我已阅读并同意
            <button type="button" className="auth-link" onClick={() => setPolicy('terms')}>
              《用户服务协议》
            </button>
            与
            <button type="button" className="auth-link" onClick={() => setPolicy('privacy')}>
              《隐私政策》
            </button>
          </span>
        </label>
        {errors.agree && (
          <div className="tiny" style={{ color: 'var(--danger)', marginTop: -8, marginBottom: 10 }}>
            {errors.agree}
          </div>
        )}

        <button className="p-btn p-btn-primary p-btn-block p-btn-lg" type="submit" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,.35)' }} /> 注册中…
            </>
          ) : (
            <>
              <Icon name="user" size={16} /> 免费注册
            </>
          )}
        </button>
      </form>

      <p className="tip-note">
        <Icon name="shield" size={13} />
        我们不收集与笔记无关的信息；你的内容默认仅自己可见，除非你主动分享。
      </p>

      {policy && <DocsDialog which={policy} onClose={() => setPolicy(null)} />}
    </AuthFrame>
  )
}

export default Register
