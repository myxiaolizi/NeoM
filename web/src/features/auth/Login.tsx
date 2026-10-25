/**
 * `/login` — standalone sign-in page. Also registers the landing login dialog
 * into the global modal registry (module side effect, runs once).
 */
import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { registerModal } from '@/components/Overlays'
import { AuthFrame } from '@/features/marketing/PortalChrome'
import LoginModal from './LoginModal'
import { loadRemembered, useLogin } from './useAuth'
import '@/styles/portal-base.css'
import '@/styles/portal-auth.css'

/* the landing page calls openModal('login') — the dialog must be registered */
registerModal('login', LoginModal)

const Login: React.FC = () => {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect') || '/app'
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const toast = useStore((s) => s.toast)
  const remembered = loadRemembered()

  const [account, setAccount] = useState(remembered.account)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(remembered.remember)
  const [reveal, setReveal] = useState(false)
  const { busy, error, signIn } = useLogin()

  useEffect(() => {
    if (authReady && user) navigate(redirect, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await signIn(account, password, remember)
    if (res.ok) navigate(redirect, { replace: true })
  }

  return (
    <AuthFrame
      title="登录你的账号"
      subtitle={redirect !== '/app' ? `登录后将继续前往 ${redirect}` : '云仓库、积分与插件配置会自动同步到你当前设备'}
      footer={
        <span>
          还没有账号？
          <Link to="/register"> 立即免费注册 </Link>
          · 注册即赠体验积分
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
          <label htmlFor="login-account">账号</label>
          <input
            id="login-account"
            className="input"
            autoFocus
            autoComplete="username"
            placeholder="用户名或邮箱"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="login-password">密码</label>
          <div className="pwd-wrap">
            <input
              id="login-password"
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
                text: '忘记密码请联系管理员重置；自助找回（邮箱验证码）正在开发中'
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
            <>
              <Icon name="login" size={16} /> 登录
            </>
          )}
        </button>
      </form>

      <Link className="admin-tip" to="/admin">
        <Icon name="shield" size={14} />
        <span className="grow">使用管理员账号进入后台管理</span>
        <Icon name="chevron-right" size={13} />
      </Link>

      <p className="tip-note">
        <Icon name="info" size={13} />
        连续登录失败会被临时限流。若账号被误封，请联系站点管理员申诉。
      </p>
    </AuthFrame>
  )
}

export default Login
