/**
 * profile — 个人资料与账号安全
 */
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API } from '@/lib/contracts'
import { useStore } from '@/store'
import { fmtDate, useRemote, safeArr, pick } from '@/features/marketing/portalKit'
import { EmptyBox, ErrorBox, Field, FormFooter, Loading, Section } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

interface SessionRow {
  id: string | number
  device: string
  ip: string
  user_agent?: string
  created_at?: string
  last_seen_at?: string
  current?: boolean
}

const normalizeSession = (raw: any): SessionRow => ({
  id: pick(raw, ['id', 'session_id'], ''),
  device: String(pick(raw, ['device', 'device_name', 'platform'], '未知设备')),
  ip: String(pick(raw, ['ip', 'client_ip'], '—')),
  user_agent: String(pick(raw, ['user_agent', 'ua'], '')),
  created_at: pick(raw, ['created_at', 'createdAt'], ''),
  last_seen_at: pick(raw, ['last_seen_at', 'lastSeenAt', 'updated_at'], ''),
  current: !!pick(raw, ['current', 'is_current', 'this'], false)
})

const ProfilePanel: React.FC<PanelProps> = ({ user, refreshUser }) => {
  const toast = useStore((s) => s.toast)
  const setUser = useStore((s) => s.setUser)

  /* ---------------- basic profile ---------------- */
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileErr, setProfileErr] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /* ---------------- password ---------------- */
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)
  const [pwdErr, setPwdErr] = useState('')

  /* ---------------- bind code ---------------- */
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [bindBusy, setBindBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)

  /* ---------------- sessions ---------------- */
  const sessions = useRemote<any>(API.authSessions, [], (raw) => safeArr<any>(raw).map(normalizeSession))
  const [kicking, setKicking] = useState<string | null>(null)

  useEffect(() => {
    setNickname(user?.nickname || '')
    setAvatar(user?.avatar || '')
    setEmail(user?.email || '')
    setPhone(user?.phone || '')
  }, [user?.id, user?.nickname, user?.avatar, user?.email, user?.phone])

  useEffect(() => {
    if (countdown <= 0) return
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [countdown])

  /* ---------------------------------------------------------- actions */
  const saveProfile = async () => {
    setProfileErr('')
    if (!nickname.trim()) {
      setProfileErr('昵称不能为空')
      return
    }
    setSavingProfile(true)
    try {
      const res = await api.post<any>(API.authProfile, {
        nickname: nickname.trim(),
        avatar: avatar.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null
      })
      const next = (res as any)?.user || res
      if (next && typeof next === 'object' && (next as any).username) {
        setUser(next as any)
      } else {
        setUser({ ...(user as any), nickname: nickname.trim(), avatar: avatar.trim() || null, email: email.trim() || null, phone: phone.trim() || null })
      }
      toast({ kind: 'ok', text: '资料已保存' })
      refreshUser()
    } catch (e: any) {
      setProfileErr(e?.message || '保存失败，请稍后重试')
    } finally {
      setSavingProfile(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ kind: 'warn', text: '请选择图片文件' })
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      toast({ kind: 'warn', text: '头像不能超过 4 MB' })
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', 'tupian')
      const res = await api.upload<any>(API.storageUpload, form)
      const url = String(pick(res, ['url', 'src', 'href'], '') || '')
      if (!url) throw new Error('上传成功但未返回地址')
      setAvatar(url)
      toast({ kind: 'ok', text: '头像已上传，记得点击「保存资料」' })
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '头像上传失败（可在下方直接填写图片 URL）' })
    } finally {
      setUploading(false)
    }
  }

  const changePassword = async () => {
    setPwdErr('')
    if (newPwd.length < 8) {
      setPwdErr('新密码至少 8 位')
      return
    }
    if (newPwd !== confirmPwd) {
      setPwdErr('两次输入的新密码不一致')
      return
    }
    setSavingPwd(true)
    try {
      await api.post(API.authPassword, { old: oldPwd, new: newPwd })
      setOldPwd('')
      setNewPwd('')
      setConfirmPwd('')
      toast({ kind: 'ok', text: '密码已修改，其他设备需要重新登录' })
      sessions.reload()
    } catch (e: any) {
      setPwdErr(e?.message || '修改失败，请确认原密码是否正确')
    } finally {
      setSavingPwd(false)
    }
  }

  const sendCode = async () => {
    const target = email.trim() || phone.trim()
    if (!target) {
      toast({ kind: 'warn', text: '请先填写邮箱或手机号' })
      return
    }
    setSending(true)
    try {
      await api.post(API.authBind, { email: email.trim() || undefined, phone: phone.trim() || undefined, action: 'send' })
      setCountdown(60)
      toast({ kind: 'ok', text: `验证码已发送至 ${target}（如未收到请稍后重试）` })
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '验证码发送失败，请稍后重试' })
    } finally {
      setSending(false)
    }
  }

  const bindAccount = async () => {
    if (!code.trim()) {
      toast({ kind: 'warn', text: '请输入验证码' })
      return
    }
    setBindBusy(true)
    try {
      await api.post(API.authBind, { email: email.trim() || undefined, phone: phone.trim() || undefined, code: code.trim() })
      toast({ kind: 'ok', text: '绑定成功' })
      setCode('')
      refreshUser()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '验证码不正确或已过期' })
    } finally {
      setBindBusy(false)
    }
  }

  const kickSession = async (row: SessionRow) => {
    setKicking(String(row.id))
    try {
      await api.del(API.authSessions + '/' + encodeURIComponent(String(row.id)))
      toast({ kind: 'ok', text: `已下线设备「${row.device}」` })
      sessions.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '操作失败，请稍后重试' })
    } finally {
      setKicking(null)
    }
  }

  const initial = (nickname || user?.username || 'N').slice(0, 1).toUpperCase()

  return (
    <>
      {/* ------------------------------------------------ basic profile */}
      <Section
        icon="user"
        title="基本资料"
        desc="昵称与头像会展示在分享页与协作评论中。"
        actions={
          <span className="badge neutral">
            <Icon name="calendar" size={11} /> 注册于 {user?.created_at ? fmtDate(user.created_at) : '—'}
          </span>
        }
      >
        <div className="ac-profile-top">
          <span className="acct-avatar ac-profile-avatar">
            {avatar ? <img src={avatar} alt="头像预览" loading="lazy" /> : initial}
          </span>
          <div className="col" style={{ gap: 8, flex: 1, minWidth: 200 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <span className="spinner" /> : <Icon name="upload" size={13} />} 上传图片
              </button>
              {avatar && (
                <button className="btn btn-sm btn-ghost" onClick={() => setAvatar('')}>
                  <Icon name="trash" size={13} /> 移除头像
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadAvatar(f)
                  e.target.value = ''
                }}
              />
            </div>
            <input
              className="input"
              placeholder="或直接填写头像图片 URL（https://…）"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
            />
            <span className="hint">支持 PNG / JPG / WebP / SVG，建议 1:1，≤ 4 MB</span>
          </div>
        </div>

        <div className="ac-grid2">
          <Field label="昵称" required>
            <input
              className="input"
              value={nickname}
              maxLength={32}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="展示给他人的名字"
            />
          </Field>
          <Field label="用户名" hint="用户名注册后不可修改，用于登录">
            <input className="input" value={user?.username || ''} disabled />
          </Field>
          <Field label="邮箱" hint="用于找回密码与接收通知">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="手机号" hint="中国大陆手机号，用于安全验证">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="13800000000" maxLength={20} />
          </Field>
        </div>

        {profileErr && (
          <div className="p-inline-err" style={{ marginBottom: 12 }}>
            <Icon name="alert" size={14} />
            <span>{profileErr}</span>
          </div>
        )}

        <FormFooter note="修改邮箱或手机号后需要重新验证">
          <button className="btn" onClick={() => { setNickname(user?.nickname || ''); setAvatar(user?.avatar || ''); setEmail(user?.email || ''); setPhone(user?.phone || '') }}>
            重置
          </button>
          <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? <span className="spinner" /> : <Icon name="save" size={13} />} 保存资料
          </button>
        </FormFooter>
      </Section>

      {/* ------------------------------------------------ bind + verify */}
      <Section icon="key" title="账号绑定与验证" desc="绑定邮箱或手机后可接收安全提醒，也用于找回密码。">
        <div className="ac-grid2">
          <div>
            <div className="ac-kv">
              <span className="k">邮箱状态</span>
              <span className="v">
                {user?.email ? (
                  <span className="badge ok">
                    <Icon name="check" size={10} /> 已绑定 {user.email}
                  </span>
                ) : (
                  <span className="badge neutral">未绑定</span>
                )}
              </span>
            </div>
            <div className="ac-kv">
              <span className="k">手机状态</span>
              <span className="v">
                {user?.phone ? (
                  <span className="badge ok">
                    <Icon name="check" size={10} /> 已绑定 {user.phone}
                  </span>
                ) : (
                  <span className="badge neutral">未绑定</span>
                )}
              </span>
            </div>
          </div>
          <div>
            <Field label="验证码">
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input"
                  placeholder="6 位验证码"
                  value={code}
                  maxLength={8}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button className="btn" style={{ flex: 'none' }} onClick={sendCode} disabled={sending || countdown > 0}>
                  {sending ? <span className="spinner" /> : countdown > 0 ? `${countdown}s` : '发送验证码'}
                </button>
              </div>
            </Field>
            <div className="row">
              <span className="hint grow">验证码将发送到上方填写的邮箱或手机（需后端短信/邮件通道配置后生效）</span>
              <button className="btn btn-sm btn-primary" onClick={bindAccount} disabled={bindBusy || !code.trim()}>
                确认绑定
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------- password */}
      <Section icon="lock" title="修改密码" desc="修改后其他设备上的会话将被要求重新登录。">
        <div className="ac-grid3">
          <Field label="当前密码" required>
            <input className="input" type="password" autoComplete="current-password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
          </Field>
          <Field label="新密码" required hint="至少 8 位，建议字母 + 数字">
            <input className="input" type="password" autoComplete="new-password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </Field>
          <Field label="确认新密码" required>
            <input className="input" type="password" autoComplete="new-password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
          </Field>
        </div>
        {pwdErr && (
          <div className="p-inline-err" style={{ marginBottom: 12 }}>
            <Icon name="alert" size={14} />
            <span>{pwdErr}</span>
          </div>
        )}
        <FormFooter note="密码使用加盐哈希存储，服务端无法查看明文">
          <button className="btn btn-primary" onClick={changePassword} disabled={savingPwd || !oldPwd || !newPwd}>
            {savingPwd ? <span className="spinner" /> : <Icon name="lock" size={13} />} 修改密码
          </button>
        </FormFooter>
      </Section>

      {/* ---------------------------------------------------- sessions */}
      <Section
        icon="monitor"
        title="登录设备"
        desc="查看所有已登录设备，可把可疑设备踢下线。"
        actions={
          <button className="btn btn-sm" onClick={sessions.reload} disabled={sessions.loading}>
            {sessions.loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
          </button>
        }
      >
        {sessions.loading ? (
          <Loading />
        ) : sessions.error ? (
          <ErrorBox message={sessions.error} onRetry={sessions.reload} />
        ) : sessions.data.length === 0 ? (
          <EmptyBox icon="monitor" title="暂无登录记录" desc="当前会话信息会在后端接入后显示在这里" />
        ) : (
          <div>
            {sessions.data.map((row) => (
              <div className={'ac-session' + (row.current ? ' current' : '')} key={String(row.id)}>
                <span className="p-tile" style={{ width: 32, height: 32, borderRadius: 9 }}>
                  <Icon name={/iphone|android|mobile/i.test(row.device + (row.user_agent || '')) ? 'smartphone' : 'monitor'} size={15} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="dev">
                    {row.device}
                    {row.current && <span className="badge ok">当前设备</span>}
                  </div>
                  <div className="meta">
                    IP {row.ip}
                    {row.last_seen_at ? ` · 最近活跃 ${fmtDate(row.last_seen_at, true)}` : row.created_at ? ` · 登录于 ${fmtDate(row.created_at, true)}` : ''}
                  </div>
                </div>
                {!row.current && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => kickSession(row)}
                    disabled={kicking === String(row.id)}
                  >
                    {kicking === String(row.id) ? <span className="spinner" /> : <Icon name="logout" size={12} />} 下线
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

export default ProfilePanel
