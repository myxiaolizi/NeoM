/**
 * security — 安全中心（登录日志 / 当前会话 / 两步验证占位）
 */
import React, { useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API } from '@/lib/contracts'
import { useStore } from '@/store'
import { fmtDate, pick, safeArr, useRemote } from '@/features/marketing/portalKit'
import { EmptyBox, ErrorBox, Loading, Section, Toggle } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

interface LogRow {
  id: string | number
  kind: string
  ok: boolean
  ip: string
  device: string
  user_agent: string
  msg: string
  created_at: string
}

const KIND_META: Record<string, { label: string; icon: string; cls: string }> = {
  login: { label: '登录', icon: 'login', cls: 'ok' },
  register: { label: '注册', icon: 'user', cls: '' },
  logout: { label: '退出', icon: 'logout', cls: 'neutral' },
  fail: { label: '登录失败', icon: 'alert', cls: 'danger' },
  password: { label: '修改密码', icon: 'lock', cls: 'warn' }
}

const normalizeLog = (raw: any): LogRow => ({
  id: pick(raw, ['id'], Math.random().toString(36).slice(2)),
  kind: String(pick(raw, ['kind', 'type', 'action'], 'login')),
  ok: pick(raw, ['ok', 'success'], true) !== false,
  ip: String(pick(raw, ['ip'], '—')),
  device: String(pick(raw, ['device', 'platform'], '未知设备')),
  user_agent: String(pick(raw, ['user_agent', 'ua'], '')),
  msg: String(pick(raw, ['msg', 'note', 'message'], '')),
  created_at: String(pick(raw, ['created_at', 'createdAt', 'time'], ''))
})

const LOGS_URL = '/api/auth/logs'

const SecurityPanel: React.FC<PanelProps> = ({ user }) => {
  const toast = useStore((s) => s.toast)
  const logs = useRemote<any>(LOGS_URL, [], (raw) => safeArr<any>(raw).map(normalizeLog))
  const sessions = useRemote<any>(API.authSessions, [], (raw) => safeArr<any>(raw))
  const [twoFA, setTwoFA] = useState(false)
  const [busy, setBusy] = useState(false)

  const enable2FA = async () => {
    if (!twoFA) {
      toast({
        kind: 'info',
        text: '两步验证正在开发中：上线后将支持 TOTP（Google Authenticator）与邮箱动态码'
      })
      return
    }
    setBusy(true)
    try {
      await api.post('/api/auth/2fa', { enabled: false })
      setTwoFA(false)
      toast({ kind: 'ok', text: '已关闭两步验证' })
    } catch {
      setTwoFA(false)
    } finally {
      setBusy(false)
    }
  }

  const riskScore =
    (user?.email ? 20 : 0) +
    (user?.phone ? 20 : 0) +
    (sessions.data.length <= 2 ? 30 : 10) +
    30 /* 密码强度无法在前端获知，默认给满分占位 */

  return (
    <>
      <Section
        icon="shield"
        title="账号安全概览"
        desc="完善绑定信息并定期检查登录设备，可显著降低账号被盗风险。"
      >
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background: `conic-gradient(var(--ok) ${riskScore}%, var(--surface-3) 0)`,
              flex: 'none'
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'var(--surface-solid)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 18,
                fontWeight: 750
              }}
            >
              {riskScore}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="small" style={{ fontWeight: 650 }}>
              安全评分 {riskScore}/100
            </div>
            <div className="tiny muted" style={{ lineHeight: 1.7, marginTop: 4 }}>
              {riskScore >= 80
                ? '当前账号安全状况良好，建议开启两步验证以进一步提升安全性。'
                : '账号仍有可完善的安全项：绑定邮箱/手机、减少常驻登录设备。'}
            </div>
          </div>
        </div>

        <div>
          {[
            { icon: 'user', t: '账号状态', v: user?.status === 'banned' ? '已封禁' : '正常', ok: user?.status !== 'banned', act: null as null | (() => void) },
            {
              icon: 'send',
              t: '邮箱绑定',
              v: user?.email ? `已绑定 ${user.email}` : '未绑定，无法接收异常登录提醒',
              ok: !!user?.email,
              act: () => (window.location.hash = '#'),
              to: '/account/profile'
            },
            {
              icon: 'smartphone',
              t: '手机绑定',
              v: user?.phone ? `已绑定 ${user.phone}` : '未绑定，无法使用短信验证',
              ok: !!user?.phone,
              to: '/account/profile'
            },
            {
              icon: 'monitor',
              t: '登录设备',
              v: `${sessions.data.length} 台设备处于登录状态`,
              ok: sessions.data.length <= 3,
              to: '/account/profile'
            }
          ].map((row) => (
            <div className="ac-sec-item" key={row.t}>
              <span className="p-tile" style={{ width: 30, height: 30, borderRadius: 9 }}>
                <Icon name={row.icon} size={14} />
              </span>
              <div className="grow">
                <div className="t">{row.t}</div>
                <div className="d">{row.v}</div>
              </div>
              <span className={'badge ' + (row.ok ? 'ok' : 'warn')}>{row.ok ? '正常' : '待完善'}</span>
              {row.to && (
                <a className="btn btn-sm" href={row.to}>
                  去设置
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section icon="key" title="两步验证" desc="登录时额外验证一次，即使密码泄露也无法直接登录。">
        <div className="ac-sec-item">
          <span className="p-tile" style={{ width: 32, height: 32, borderRadius: 9 }}>
            <Icon name="shield" size={15} />
          </span>
          <div className="grow">
            <div className="t">
              动态验证码（TOTP）
              <span className="badge neutral" style={{ marginLeft: 8 }}>
                开发中
              </span>
            </div>
            <div className="d">
              支持 Google Authenticator、Microsoft Authenticator 等标准 TOTP 应用。开启后每次登录需输入 6 位动态码。
            </div>
          </div>
          <Toggle on={twoFA} onChange={enable2FA} disabled={busy} />
        </div>

        <div className="ac-sec-item">
          <span className="p-tile" style={{ width: 32, height: 32, borderRadius: 9 }}>
            <Icon name="login" size={15} />
          </span>
          <div className="grow">
            <div className="t">
              异地登录提醒
              <span className="badge ok" style={{ marginLeft: 8 }}>
                已启用
              </span>
            </div>
            <div className="d">检测到陌生 IP 或设备登录时，通过已绑定的邮箱发送提醒。</div>
          </div>
        </div>
      </Section>

      <Section
        icon="history"
        title="登录日志"
        desc="最近的安全相关操作记录，异常 IP 请及时修改密码。"
        actions={
          <button className="btn btn-sm" onClick={logs.reload} disabled={logs.loading}>
            {logs.loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
          </button>
        }
      >
        {logs.loading ? (
          <Loading text="正在加载登录日志…" />
        ) : logs.data.length === 0 ? (
          <EmptyBox
            icon="history"
            title="暂无登录日志"
            desc="后端登录日志接口（/api/auth/logs）接入后，会在此展示登录、失败、改密等记录。"
          />
        ) : (
          <div>
            {logs.data.map((row) => {
              const meta = KIND_META[row.kind] || { label: row.kind, icon: 'info', cls: 'neutral' }
              const ok = row.ok && row.kind !== 'fail'
              return (
                <div className="ac-log" key={String(row.id)}>
                  <span className="time">{row.created_at ? fmtDate(row.created_at, true) : '—'}</span>
                  <span className={'badge ' + (ok ? meta.cls : 'danger')}>
                    <Icon name={ok ? meta.icon : 'alert'} size={10} /> {meta.label}
                  </span>
                  <span className="grow ellipsis" title={row.user_agent}>
                    {row.ip} · {row.device}
                    {row.msg ? ` · ${row.msg}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section icon="alert" title="发现异常登录怎么办？" desc="三步处理。">
        <div className="ac-grid3">
          {[
            { icon: 'lock', t: '① 立即改密', d: '在「个人资料」修改密码，其他设备会话会自动失效。' },
            { icon: 'logout', t: '② 踢掉设备', d: '在「登录设备」中把不认识的设备逐个下线。' },
            { icon: 'send', t: '③ 联系管理员', d: '如积分或内容被异常操作，请带日志时间点联系管理员核查。' }
          ].map((x) => (
            <div key={x.t} className="p-card" style={{ padding: 14, boxShadow: 'none' }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Icon name={x.icon} size={14} />
                <b className="small">{x.t}</b>
              </div>
              <div className="tiny muted" style={{ lineHeight: 1.65 }}>
                {x.d}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

export default SecurityPanel
