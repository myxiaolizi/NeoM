/**
 * Module 2 — 用户与权限
 * Multi-dimensional user search, CRUD, ban/reset, role assignment, detail drawer.
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  BarList, DataTable, Drawer, Field, KV, Note, PageHeader, Progress, Section,
  Tabs, Tag, Toolbar, callApi, cx, downloadCsv, fmtBytes, fmtDate, fmtDateTime, fmtInt,
  fmtTimeAgo, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList, pickOne, rndInt, seq } from '../data'
import { useAdmin } from '../AdminApp'

/* ------------------------------------------------------------------ types */
export type Role = 'user' | 'developer' | 'admin'
export type UserStatus = 'active' | 'banned'

export interface AdminUser {
  id: number
  username: string
  nickname: string
  email: string | null
  avatar?: string | null
  role: Role
  points: number
  status: UserStatus
  storage_quota_mb: number
  storage_used_bytes: number
  rpm_limit: number
  tpm_limit: number
  created_at: string
  last_login_at: string | null
  docs?: number
  shares?: number
}

interface LedgerRow { id: number; kind: string; points: number; balance_after: number; note?: string; created_at: string }
interface AiRow { id: number; model: string; scene: string; tokens_in: number; tokens_cached: number; tokens_out: number; points: number; latency_ms: number; created_at: string; status: string }
interface BackupRow { id: number; size: number; created_at: string; note?: string }
interface ShareRow { id: string; doc_name: string; mode: string; views: number; created_at: string; status: string }
interface DeviceRow { id: string; device: string; ip: string; ua: string; last_seen: string; current?: boolean }
interface UserDetail {
  user: AdminUser
  ledger: LedgerRow[]
  ai: AiRow[]
  backups: BackupRow[]
  shares: ShareRow[]
  devices: DeviceRow[]
}

/* --------------------------------------------------------------- demo data */
const ROLES: Role[] = ['user', 'user', 'user', 'developer', 'admin']
const NAMES = ['zhengl', 'lixiaoming', 'wangfang', 'chenyu', 'zhaolei', 'sunqi', 'zhoujie', 'wuhao', 'xuting', 'hanmei',
  'guoyang', 'linfan', 'hezhe', 'maxin', 'qiuyue', 'duyong', 'shenlu', 'fangbo', 'luojing', 'tangwei',
  'yaochen', 'panhao', 'caiwen', 'dongyu', 'yuanqing', 'xiaobo', 'weimin', 'jiangli', 'huangrui', 'shaoqi']
const NICK = ['郑磊', '李晓明', '王芳', '陈宇', '赵磊', '孙琦', '周杰', '吴昊', '徐婷', '韩梅',
  '郭洋', '林凡', '何哲', '马欣', '邱月', '杜勇', '申璐', '方博', '罗静', '唐伟',
  '姚晨', '潘浩', '蔡雯', '董宇', '袁清', '肖波', '魏敏', '江丽', '黄瑞', '邵琪']

const demoUsers = (): AdminUser[] =>
  seq(58, (i) => {
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? String(Math.floor(i / NAMES.length) + 1) : '')
    const role = i === 0 ? 'admin' : ROLES[rndInt(i + 7, 0, 4)]
    const banned = i % 13 === 5
    const daysAgo = rndInt(i + 3, 0, 400)
    return {
      id: 1000 + i,
      username: name,
      nickname: NICK[i % NICK.length],
      email: i % 11 === 3 ? null : `${name}@${pickOne(['qq.com', '163.com', 'gmail.com', 'outlook.com'], i)}`,
      role,
      points: rndInt(i + 11, 0, 48000),
      status: banned ? 'banned' : 'active',
      storage_quota_mb: pickOne([1024, 5120, 10240, 51200], i),
      storage_used_bytes: rndInt(i + 17, 0, 48) * 1024 * 1024 * 1024,
      rpm_limit: pickOne([20, 60, 120, 300], i),
      tpm_limit: pickOne([100_000, 400_000, 1_000_000], i),
      created_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
      last_login_at: i % 9 === 4 ? null : new Date(Date.now() - rndInt(i + 23, 0, 40) * 86400_000).toISOString(),
      docs: rndInt(i + 29, 0, 2400),
      shares: rndInt(i + 31, 0, 180)
    }
  })

const demoDetail = (u: AdminUser): UserDetail => ({
  user: u,
  ledger: seq(14, (i) => ({
    id: 9000 + i,
    kind: pickOne(['ai', 'recharge', 'admin-adjust', 'signin', 'register-gift', 'redeem'], i),
    points: i % 4 === 0 ? rndInt(i + 41, 100, 3000) : -rndInt(i + 43, 1, 620),
    balance_after: Math.max(0, u.points - i * 37),
    note: i % 4 === 0 ? '充值 / 后台调整' : pickOne(['AI 对话扣费', '文档命名', '语音转写', 'TTS 合成'], i),
    created_at: new Date(Date.now() - i * 6 * 3600_000).toISOString()
  })),
  ai: seq(12, (i) => ({
    id: 7000 + i,
    model: pickOne(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-asr-1', 'mimo-tts-1'], i),
    scene: pickOne(['chat', 'naming', 'asr', 'tts'], i),
    tokens_in: rndInt(i + 51, 120, 42000),
    tokens_cached: rndInt(i + 53, 0, 28000),
    tokens_out: rndInt(i + 57, 40, 9800),
    points: rndInt(i + 59, 0, 260),
    latency_ms: rndInt(i + 61, 220, 8400),
    created_at: new Date(Date.now() - i * 5 * 3600_000).toISOString(),
    status: i === 4 ? 'error' : 'ok'
  })),
  backups: seq(5, (i) => ({
    id: 5000 + i,
    size: rndInt(i + 71, 20, 480) * 1024 * 1024,
    created_at: new Date(Date.now() - (i + 1) * 3 * 86400_000).toISOString(),
    note: pickOne(['自动备份', '手动备份', '升级前快照'], i)
  })),
  shares: seq(6, (i) => ({
    id: 'sh' + (6000 + i),
    doc_name: pickOne(['产品需求文档 v3', '2026 年度规划', 'API 接入说明', '会议纪要', '读书笔记'], i) + '.md',
    mode: pickOne(['read', 'comment', 'edit'], i),
    views: rndInt(i + 81, 0, 4600),
    created_at: new Date(Date.now() - (i + 2) * 2 * 86400_000).toISOString(),
    status: i === 3 ? 'blocked' : 'active'
  })),
  devices: seq(4, (i) => ({
    id: 'dv' + (4000 + i),
    device: pickOne(['Windows 11 · NeoM Desktop', 'macOS 15 · NeoM Desktop', 'Android 15 · NeoM Mobile', 'Chrome 131 · Web'], i),
    ip: `116.${rndInt(i + 91, 1, 250)}.${rndInt(i + 93, 1, 250)}.${rndInt(i + 97, 1, 250)}`,
    ua: pickOne(['NeoM/1.0 (Windows NT 10.0)', 'NeoM/1.0 (Macintosh; arm64)', 'Mozilla/5.0 (Linux; Android 15)'], i),
    last_seen: new Date(Date.now() - i * 9 * 3600_000).toISOString(),
    current: i === 0
  }))
})

const ROLE_META: Record<Role, { label: string; tone: 'accent' | 'purple' | 'danger' | 'default' }> = {
  user: { label: '普通用户', tone: 'default' },
  developer: { label: '插件开发者', tone: 'accent' },
  admin: { label: '管理员', tone: 'purple' }
}

/* --------------------------------------------------------------- module */
export default function Users() {
  const { demo: sessionDemo } = useAdmin()
  const toast = useToast()
  const { ask, node: confirmNode } = useConfirm()

  const state = useApiData<AdminUser[]>(
    async () => {
      const raw = await api.get<unknown>('/api/admin/users?page=1&pageSize=500')
      const list = asList<AdminUser>(raw)
      if (!list.length) throw new Error('空用户列表')
      return list
    },
    demoUsers()
  )
  const users = state.data

  /* filters */
  const [kw, setKw] = useState('')
  const [role, setRole] = useState<'all' | Role>('all')
  const [status, setStatus] = useState<'all' | UserStatus>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pMin, setPMin] = useState('')
  const [pMax, setPMax] = useState('')

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase()
    return users.filter((u) => {
      if (k && !(u.username.toLowerCase().includes(k) || (u.email || '').toLowerCase().includes(k) || u.nickname.toLowerCase().includes(k) || String(u.id) === k)) return false
      if (role !== 'all' && u.role !== role) return false
      if (status !== 'all' && u.status !== status) return false
      if (from && new Date(u.created_at) < new Date(from)) return false
      if (to && new Date(u.created_at) > new Date(to + 'T23:59:59')) return false
      if (pMin !== '' && u.points < Number(pMin)) return false
      if (pMax !== '' && u.points > Number(pMax)) return false
      return true
    })
  }, [users, kw, role, status, from, to, pMin, pMax])

  /* selection + drawer */
  const [selected, setSelected] = useState<string[]>([])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [detailTab, setDetailTab] = useState('basic')
  const [detailLoading, setDetailLoading] = useState(false)

  /* create / edit modal */
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)
  const [form, setForm] = useState({ username: '', nickname: '', email: '', password: '', role: 'user' as Role, points: '0', quota: '1024' })
  const [saving, setSaving] = useState(false)

  const openCreate = () => {
    setForm({ username: '', nickname: '', email: '', password: '', role: 'user', points: '0', quota: '1024' })
    setEditing('new')
  }
  const openEdit = (u: AdminUser) => {
    setForm({
      username: u.username, nickname: u.nickname, email: u.email || '', password: '',
      role: u.role, points: String(u.points), quota: String(u.storage_quota_mb)
    })
    setEditing(u)
  }

  const saveUser = async () => {
    if (editing === 'new' && (!form.username.trim() || !form.password)) {
      toast({ kind: 'warn', text: '用户名与初始密码必填' })
      return
    }
    setSaving(true)
    const payload = {
      username: form.username.trim(), nickname: form.nickname.trim() || form.username.trim(),
      email: form.email.trim() || null, password: form.password || undefined,
      role: form.role, points: Number(form.points) || 0, storage_quota_mb: Number(form.quota) || 1024
    }
    const r = editing === 'new'
      ? await callApi(() => api.post('/api/admin/users', payload), '用户已创建')
      : await callApi(() => api.put(`/api/admin/users/${(editing as AdminUser).id}`, payload), '用户信息已保存')
    setSaving(false)
    if (r.ok) {
      setEditing(null)
      state.reload()
    }
  }

  const setRoleOf = async (u: AdminUser, next: Role) => {
    if (u.role === next) return
    const ok = await ask({
      title: '变更角色',
      message: <>将 <b>{u.username}</b> 的角色从 <Tag tone={ROLE_META[u.role].tone}>{ROLE_META[u.role].label}</Tag> 变更为 <Tag tone={ROLE_META[next].tone}>{ROLE_META[next].label}</Tag>？<br />角色变更会立即影响该用户可访问的接口范围。</>,
      confirmText: '确认变更'
    })
    if (!ok) return
    const r = await callApi(() => api.put(`/api/admin/users/${u.id}`, { role: next }), '角色已更新')
    if (r.ok) state.setData((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: next } : x)))
  }

  const toggleBan = async (u: AdminUser) => {
    const ban = u.status !== 'banned'
    const ok = await ask({
      title: ban ? '封禁用户' : '解封用户',
      danger: ban,
      message: ban
        ? <>封禁后 <b>{u.username}</b> 将无法登录、无法调用 AI、其分享链接会立即失效。此操作写入审计日志。</>
        : <>解封后 <b>{u.username}</b> 可以立即恢复登录与全部功能。</>,
      confirmText: ban ? '封禁' : '解封'
    })
    if (!ok) return
    const r = await callApi(
      () => api.post(`/api/admin/users/${u.id}/ban`, { banned: ban }),
      ban ? '已封禁该用户' : '已解封该用户'
    )
    if (r.ok) state.setData((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: ban ? 'banned' : 'active' } : x)))
  }

  const resetPwd = async (u: AdminUser) => {
    const ok = await ask({
      title: '重置密码',
      danger: true,
      message: <>将为 <b>{u.username}</b> 生成一个新的随机密码，旧密码立即失效，该用户需要重新登录所有设备。</>,
      confirmText: '重置密码'
    })
    if (!ok) return
    try {
      const res = await api.post<{ password?: string }>(`/api/admin/users/${u.id}/reset`, {})
      toast({ kind: 'ok', text: `新密码：${res?.password || '已生成，请通知用户查收'}`, timeout: 12000 })
    } catch {
      const fake = 'NeoM@' + Math.random().toString(36).slice(2, 8)
      toast({ kind: 'ok', text: `演示模式 — 新密码：${fake}`, timeout: 12000 })
    }
  }

  const openDetail = async (u: AdminUser) => {
    setDetailId(u.id)
    setDetailTab('basic')
    setDetail(u ? demoDetail(u) : null)
    setDetailLoading(true)
    try {
      const raw = await api.get<unknown>(`/api/admin/user/${u.id}`)
      const d = raw as Partial<UserDetail>
      setDetail({
        user: { ...u, ...(d?.user || {}) },
        ledger: asList<LedgerRow>(d?.ledger).length ? asList<LedgerRow>(d?.ledger) : demoDetail(u).ledger,
        ai: asList<AiRow>(d?.ai).length ? asList<AiRow>(d?.ai) : demoDetail(u).ai,
        backups: asList<BackupRow>(d?.backups).length ? asList<BackupRow>(d?.backups) : demoDetail(u).backups,
        shares: asList<ShareRow>(d?.shares).length ? asList<ShareRow>(d?.shares) : demoDetail(u).shares,
        devices: asList<DeviceRow>(d?.devices).length ? asList<DeviceRow>(d?.devices) : demoDetail(u).devices
      })
    } catch {
      /* keep demo detail */
    } finally {
      setDetailLoading(false)
    }
  }

  /* points adjust */
  const [adjAmount, setAdjAmount] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjBusy, setAdjBusy] = useState(false)
  const doAdjust = async () => {
    const amt = Number(adjAmount)
    if (!detail) return
    if (!Number.isFinite(amt) || amt === 0) { toast({ kind: 'warn', text: '请输入非零的积分变动值（负数为扣减）' }); return }
    if (!adjReason.trim()) { toast({ kind: 'warn', text: '必须填写调整原因，将写入审计日志' }); return }
    setAdjBusy(true)
    const r = await callApi(
      () => api.post('/api/admin/points/adjust', { userId: detail.user.id, amount: amt, reason: adjReason.trim() }),
      `积分已${amt > 0 ? '增加' : '扣减'} ${Math.abs(amt)}`
    )
    setAdjBusy(false)
    if (r.ok) {
      setDetail((d) => d && ({ ...d, user: { ...d.user, points: d.user.points + amt } }))
      state.setData((prev) => prev.map((x) => (x.id === detail.user.id ? { ...x, points: x.points + amt } : x)))
      setAdjAmount(''); setAdjReason('')
    }
  }

  /* quota / limits */
  const [quotaMb, setQuotaMb] = useState('')
  const [rpm, setRpm] = useState('')
  const [tpm, setTpm] = useState('')
  React.useEffect(() => {
    if (detail) {
      setQuotaMb(String(detail.user.storage_quota_mb))
      setRpm(String(detail.user.rpm_limit))
      setTpm(String(detail.user.tpm_limit))
    }
  }, [detail?.user.id])

  const saveLimits = async () => {
    if (!detail) return
    const r = await callApi(
      () => api.put(`/api/admin/users/${detail.user.id}`, {
        storage_quota_mb: Number(quotaMb) || 1024,
        rpm_limit: Number(rpm) || 60,
        tpm_limit: Number(tpm) || 100_000
      }),
      '配额与限流已保存'
    )
    if (r.ok) {
      setDetail((d) => d && ({
        ...d,
        user: { ...d.user, storage_quota_mb: Number(quotaMb) || 1024, rpm_limit: Number(rpm) || 60, tpm_limit: Number(tpm) || 100_000 }
      }))
      state.reload()
    }
  }

  /* bulk */
  const bulk = async (action: 'ban' | 'unban' | 'role' | 'export') => {
    if (!selected.length) return
    if (action === 'export') {
      const rows = users.filter((u) => selected.includes(String(u.id)))
      downloadCsv('neom-users.csv', [
        ['ID', '用户名', '昵称', '邮箱', '角色', '积分', '状态', '配额MB', '注册时间', '最后登录'],
        ...rows.map((u) => [u.id, u.username, u.nickname, u.email || '', u.role, u.points, u.status, u.storage_quota_mb, fmtDate(u.created_at), fmtDate(u.last_login_at)])
      ])
      toast({ kind: 'ok', text: `已导出 ${rows.length} 位用户` })
      return
    }
    const label = action === 'ban' ? '封禁' : '解封'
    const ok = await ask({
      title: `批量${label}`,
      danger: action === 'ban',
      message: <>将对选中的 <b>{selected.length}</b> 位用户执行「{label}」操作。此操作会写入审计日志。</>,
      confirmText: `批量${label}`
    })
    if (!ok) return
    for (const id of selected) {
      try { await api.post(`/api/admin/users/${id}/ban`, { banned: action === 'ban' }) } catch { /* tolerate */ }
    }
    state.setData((prev) => prev.map((u) => (selected.includes(String(u.id)) ? { ...u, status: action === 'ban' ? 'banned' : 'active' } : u)))
    toast({ kind: 'ok', text: `已${label} ${selected.length} 位用户` })
    setSelected([])
  }

  const columns: Column<AdminUser>[] = [
    {
      key: 'username', title: '用户', sortable: true, value: (u) => u.username,
      render: (u) => (
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="adm-avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
            {u.avatar ? <img src={u.avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : (u.nickname || u.username).slice(0, 1)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }} className="ellipsis">{u.nickname || u.username}</div>
            <div className="tiny dim ellipsis">@{u.username} · #{u.id}</div>
          </div>
        </div>
      )
    },
    { key: 'email', title: '邮箱', sortable: true, render: (u) => u.email ? <span className="small">{u.email}</span> : <span className="dim small">未绑定</span> },
    {
      key: 'role', title: '角色', width: 118, sortable: true,
      render: (u) => (
        <select
          className="select"
          style={{ width: 112, height: 24, fontSize: 'var(--fs-xs)', padding: '0 20px 0 7px' }}
          value={u.role}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRoleOf(u, e.target.value as Role)}
        >
          <option value="user">普通用户</option>
          <option value="developer">插件开发者</option>
          <option value="admin">管理员</option>
        </select>
      )
    },
    { key: 'points', title: '积分', align: 'right', sortable: true, render: (u) => <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtInt(u.points)}</b> },
    {
      key: 'status', title: '状态', width: 84, align: 'center',
      render: (u) => u.status === 'banned' ? <Tag tone="danger" dot>已封禁</Tag> : <Tag tone="ok" dot>正常</Tag>
    },
    { key: 'created_at', title: '注册时间', sortable: true, render: (u) => <span className="small muted">{fmtDate(u.created_at)}</span> },
    { key: 'last_login_at', title: '最后登录', sortable: true, render: (u) => <span className="small muted">{u.last_login_at ? fmtTimeAgo(u.last_login_at) : '从未登录'}</span> },
    {
      key: 'actions', title: '操作', align: 'right', width: 168,
      render: (u) => (
        <div className="row" style={{ gap: 3, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-sm btn-ghost" onClick={() => openDetail(u)} title="详情"><Icon name="eye" size={13} /></button>
          <button className="btn btn-sm btn-ghost" onClick={() => openEdit(u)} title="编辑"><Icon name="edit" size={13} /></button>
          <button className="btn btn-sm btn-ghost" onClick={() => resetPwd(u)} title="重置密码"><Icon name="key" size={13} /></button>
          <button
            className={cx('btn btn-sm', u.status === 'banned' ? 'btn-ghost' : 'btn-ghost')}
            onClick={() => toggleBan(u)}
            title={u.status === 'banned' ? '解封' : '封禁'}
            style={{ color: u.status === 'banned' ? 'var(--ok)' : 'var(--danger)' }}
          >
            <Icon name={u.status === 'banned' ? 'unlock' : 'lock'} size={13} />
          </button>
        </div>
      )
    }
  ]

  const stats = useMemo(() => {
    const total = users.length
    const active = users.filter((u) => u.status === 'active').length
    const admins = users.filter((u) => u.role === 'admin').length
    const devs = users.filter((u) => u.role === 'developer').length
    return { total, active, admins, devs, banned: total - active }
  }, [users])

  const roleBars = useMemo(() => ([
    { label: '普通用户', value: users.filter((u) => u.role === 'user').length },
    { label: '插件开发者', value: stats.devs },
    { label: '管理员', value: stats.admins },
    { label: '已封禁', value: stats.banned }
  ]), [users, stats])

  return (
    <>
      <PageHeader
        icon="users"
        title="用户与权限"
        desc="多维检索用户、调整角色与积分、配置存储配额与 AI 频次限制。所有写操作均记录管理员审计。"
        demo={state.demo || sessionDemo}
        reload={state.reload}
        loading={state.loading}
        actions={
          <>
            <button className="btn" onClick={() => bulk('export')} disabled={!selected.length}>
              <Icon name="download" size={14} /> 导出所选
            </button>
            <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" size={14} /> 新增用户</button>
          </>
        }
      />

      <div className="adm-stat-grid" style={{ marginBottom: 14 }}>
        <div className="adm-stat"><div className="adm-stat-top"><span className="adm-stat-ico"><Icon name="users" size={12} /></span>用户总数</div><div className="adm-stat-val">{fmtInt(stats.total)}</div></div>
        <div className="adm-stat"><div className="adm-stat-top"><span className="adm-stat-ico" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><Icon name="check" size={12} /></span>正常</div><div className="adm-stat-val">{fmtInt(stats.active)}</div></div>
        <div className="adm-stat"><div className="adm-stat-top"><span className="adm-stat-ico" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon name="lock" size={12} /></span>已封禁</div><div className="adm-stat-val">{fmtInt(stats.banned)}</div></div>
        <div className="adm-stat"><div className="adm-stat-top"><span className="adm-stat-ico"><Icon name="key" size={12} /></span>管理员 / 开发者</div><div className="adm-stat-val">{stats.admins} <span className="adm-stat-unit">/ {stats.devs}</span></div></div>
      </div>

      <Section flush>
        <Toolbar
          right={
            <>
              {selected.length > 0 && (
                <>
                  <span className="small muted">已选 {selected.length}</span>
                  <button className="btn btn-sm" onClick={() => bulk('unban')}>批量解封</button>
                  <button className="btn btn-sm btn-danger" onClick={() => bulk('ban')}>批量封禁</button>
                </>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => { setKw(''); setRole('all'); setStatus('all'); setFrom(''); setTo(''); setPMin(''); setPMax('') }}>
                <Icon name="refresh" size={13} /> 重置筛选
              </button>
            </>
          }
        >
          <div className="adm-search" style={{ width: 224 }}>
            <span className="adm-ts-icon"><Icon name="search" size={13} /></span>
            <input className="input" placeholder="用户名 / 邮箱 / ID / 昵称" value={kw} onChange={(e) => setKw(e.target.value)} />
          </div>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="all">全部角色</option>
            <option value="user">普通用户</option>
            <option value="developer">插件开发者</option>
            <option value="admin">管理员</option>
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">全部状态</option>
            <option value="active">正常</option>
            <option value="banned">已封禁</option>
          </select>
          <span className="row small muted" style={{ gap: 4 }}>
            注册
            <input className="input" type="date" style={{ width: 132, height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} />
            –
            <input className="input" type="date" style={{ width: 132, height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
          <span className="row small muted" style={{ gap: 4 }}>
            积分
            <input className="input" style={{ width: 78, height: 30 }} placeholder="min" value={pMin} onChange={(e) => setPMin(e.target.value)} />
            –
            <input className="input" style={{ width: 78, height: 30 }} placeholder="max" value={pMax} onChange={(e) => setPMax(e.target.value)} />
          </span>
        </Toolbar>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(u) => String(u.id)}
          loading={state.loading}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={openDetail}
          hideSearch
          pageSize={12}
          emptyText="没有符合条件的用户"
          emptyIcon="users"
          footerNote={`筛选结果 ${filtered.length} / 全部 ${users.length}`}
        />
      </Section>

      <div className="adm-split" style={{ marginTop: 14 }}>
        <Section title="角色分布" icon="chart">
          <BarList items={roleBars} />
        </Section>
        <Section title="说明" icon="info">
          <Note>
            积分变动必须填写原因并写入 <span className="mono">point_ledger</span> 与 <span className="mono">admin_audit</span>。
            封禁用户会立即吊销其所有会话。
          </Note>
        </Section>
      </div>

      {/* ------------------------------------------------ create / edit */}
      {editing && (
        <Drawer
          open
          title={editing === 'new' ? '新增用户' : `编辑用户 · ${(editing as AdminUser).username}`}
          icon={editing === 'new' ? 'user-plus' : 'edit'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <span className="spacer" />
              <button className="btn" onClick={() => setEditing(null)} disabled={saving}>取消</button>
              <button className="btn btn-primary" onClick={saveUser} disabled={saving}>
                {saving && <span className="spinner" style={{ width: 12, height: 12 }} />} 保存
              </button>
            </>
          }
        >
          <div className="adm-form-grid">
            <Field label="用户名" required hint="登录名，创建后不可修改">
              <input className="input" value={form.username} disabled={editing !== 'new'} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="昵称">
              <input className="input" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
            </Field>
            <Field label="邮箱">
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="角色">
              <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="user">普通用户</option>
                <option value="developer">插件开发者</option>
                <option value="admin">管理员</option>
              </select>
            </Field>
            <Field label={editing === 'new' ? '初始密码' : '重置密码（留空不改）'} required={editing === 'new'}>
              <input className="input" type="text" value={form.password} placeholder="至少 8 位" onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="初始积分">
              <input className="input" type="number" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} />
            </Field>
            <Field label="存储配额 (MB)">
              <input className="input" type="number" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} />
            </Field>
          </div>
          <Note>新增用户会写入审计日志。初始积分以「注册赠送」类型记入积分流水。</Note>
        </Drawer>
      )}

      {/* ------------------------------------------------ detail drawer */}
      <Drawer
        open={detailId !== null}
        wide
        icon="user"
        title={detail ? `${detail.user.nickname || detail.user.username}` : '用户详情'}
        sub={detail ? `#${detail.user.id} · @${detail.user.username}` : undefined}
        onClose={() => { setDetailId(null); setDetail(null) }}
        footer={
          detail && (
            <>
              <Tag tone={ROLE_META[detail.user.role].tone}>{ROLE_META[detail.user.role].label}</Tag>
              <Tag tone={detail.user.status === 'banned' ? 'danger' : 'ok'} dot>{detail.user.status === 'banned' ? '已封禁' : '正常'}</Tag>
              <span className="spacer" />
              <button className="btn" onClick={() => openEdit(detail.user)}><Icon name="edit" size={13} /> 编辑资料</button>
              <button className={cx('btn', detail.user.status === 'banned' ? '' : 'btn-danger')} onClick={() => toggleBan(detail.user)}>
                <Icon name={detail.user.status === 'banned' ? 'unlock' : 'lock'} size={13} />
                {detail.user.status === 'banned' ? '解封' : '封禁'}
              </button>
            </>
          )
        }
      >
        {detail && (
          <>
            <Tabs
              active={detailTab}
              onChange={setDetailTab}
              items={[
                { id: 'basic', label: '基本信息' },
                { id: 'points', label: '积分调整' },
                { id: 'limits', label: '配额与限流' },
                { id: 'ledger', label: '积分流水', count: detail.ledger.length },
                { id: 'ai', label: 'AI 消费', count: detail.ai.length },
                { id: 'shares', label: '分享', count: detail.shares.length },
                { id: 'backups', label: '备份', count: detail.backups.length },
                { id: 'devices', label: '登录设备', count: detail.devices.length }
              ]}
            />

            <div style={{ paddingTop: 14 }}>
              {detailTab === 'basic' && (
                <>
                  <div className="row" style={{ gap: 14, marginBottom: 14 }}>
                    <span className="adm-avatar" style={{ width: 48, height: 48, fontSize: 18 }}>{(detail.user.nickname || detail.user.username).slice(0, 1)}</span>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 700 }}>{detail.user.nickname || detail.user.username}</div>
                      <div className="small muted">@{detail.user.username} · {detail.user.email || '未绑定邮箱'}</div>
                    </div>
                  </div>
                  <KV
                    items={[
                      ['用户 ID', <span className="mono">{detail.user.id}</span>],
                      ['角色', <Tag tone={ROLE_META[detail.user.role].tone}>{ROLE_META[detail.user.role].label}</Tag>],
                      ['积分余额', <b>{fmtInt(detail.user.points)}</b>],
                      ['存储配额', <span>{fmtInt(detail.user.storage_quota_mb)} MB（已用 {fmtBytes(detail.user.storage_used_bytes)}）</span>],
                      ['AI 限制', <span className="mono">{detail.user.rpm_limit} RPM / {fmtInt(detail.user.tpm_limit)} TPM</span>],
                      ['文档 / 分享', <span>{fmtInt(detail.user.docs || 0)} 篇 / {fmtInt(detail.user.shares || 0)} 个</span>],
                      ['注册时间', fmtDateTime(detail.user.created_at)],
                      ['最后登录', detail.user.last_login_at ? fmtDateTime(detail.user.last_login_at) : '从未登录'],
                      ['状态', detail.user.status === 'banned' ? <Tag tone="danger" dot>已封禁</Tag> : <Tag tone="ok" dot>正常</Tag>]
                    ]}
                  />
                </>
              )}

              {detailTab === 'points' && (
                <>
                  <Note tone="warn">积分调整会立即影响用户余额，且必须填写原因并写入 <span className="mono">admin_audit</span> 审计日志，不可撤销（可通过反向调整抵消）。</Note>
                  <div className="adm-form-grid" style={{ marginTop: 14 }}>
                    <Field label="变动数量" required hint="正数为增加，负数为扣减">
                      <input className="input" type="number" placeholder="例如 500 或 -200" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
                    </Field>
                    <Field label="当前余额">
                      <input className="input" value={fmtInt(detail.user.points)} readOnly />
                    </Field>
                  </div>
                  <Field label="调整原因" required hint="会完整记录在审计日志中，请写明工单号或事由">
                    <textarea className="textarea" rows={3} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="例如：工单 #2026-1024 补偿 AI 调用失败积分" />
                  </Field>
                  <div className="row">
                    <button className="btn btn-primary" onClick={doAdjust} disabled={adjBusy}>
                      {adjBusy && <span className="spinner" style={{ width: 12, height: 12 }} />}
                      <Icon name="coins" size={14} /> 提交积分调整
                    </button>
                    <span className="small muted">调整后余额：{fmtInt(detail.user.points + (Number(adjAmount) || 0))}</span>
                  </div>
                </>
              )}

              {detailTab === 'limits' && (
                <>
                  <div className="adm-form-grid">
                    <Field label="存储配额上限 (MB)" hint="超出后禁止上传图片与备份">
                      <input className="input" type="number" value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} />
                    </Field>
                    <Field label="每日 AI 调用 RPM" hint="每分钟请求数上限">
                      <input className="input" type="number" value={rpm} onChange={(e) => setRpm(e.target.value)} />
                    </Field>
                    <Field label="每日 AI 调用 TPM" hint="每分钟 Token 数上限">
                      <input className="input" type="number" value={tpm} onChange={(e) => setTpm(e.target.value)} />
                    </Field>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <Progress
                      value={detail.user.storage_used_bytes}
                      max={detail.user.storage_quota_mb * 1024 * 1024}
                      label={
                        <>
                          <span className="muted">当前存储占用</span>
                          <span>{fmtBytes(detail.user.storage_used_bytes)} / {fmtInt(detail.user.storage_quota_mb)} MB</span>
                        </>
                      }
                    />
                  </div>
                  <button className="btn btn-primary" onClick={saveLimits}><Icon name="save" size={14} /> 保存配额与限流</button>
                </>
              )}

              {detailTab === 'ledger' && (
                <DataTable
                  columns={[
                    { key: 'created_at', title: '时间', sortable: true, render: (r: LedgerRow) => <span className="small muted">{fmtDateTime(r.created_at)}</span> },
                    { key: 'kind', title: '类型', render: (r: LedgerRow) => <Tag tone={r.points >= 0 ? 'ok' : 'default'}>{{ ai: 'AI 扣费', recharge: '充值', refund: '退款', 'admin-adjust': '后台调整', signin: '签到', 'register-gift': '注册赠送', redeem: '卡密兑换' }[r.kind] || r.kind}</Tag> },
                    { key: 'points', title: '变动', align: 'right', sortable: true, render: (r: LedgerRow) => <b style={{ color: r.points >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{r.points >= 0 ? '+' : ''}{fmtInt(r.points)}</b> },
                    { key: 'balance_after', title: '余额', align: 'right', render: (r: LedgerRow) => fmtInt(r.balance_after) },
                    { key: 'note', title: '备注', render: (r: LedgerRow) => <span className="small muted">{r.note || '—'}</span> }
                  ]}
                  rows={detail.ledger}
                  rowKey={(r) => String(r.id)}
                  pageSize={6}
                  hideSearch
                  noPager={detail.ledger.length <= 6}
                />
              )}

              {detailTab === 'ai' && (
                <DataTable
                  columns={[
                    { key: 'created_at', title: '时间', render: (r: AiRow) => <span className="small muted">{fmtDateTime(r.created_at)}</span> },
                    { key: 'model', title: '模型', render: (r: AiRow) => <span className="mono small">{r.model}</span> },
                    { key: 'scene', title: '场景', render: (r: AiRow) => <Tag>{r.scene}</Tag> },
                    { key: 'tokens_in', title: '输入', align: 'right', render: (r: AiRow) => fmtInt(r.tokens_in) },
                    { key: 'tokens_cached', title: '缓存', align: 'right', render: (r: AiRow) => fmtInt(r.tokens_cached) },
                    { key: 'tokens_out', title: '输出', align: 'right', render: (r: AiRow) => fmtInt(r.tokens_out) },
                    { key: 'points', title: '积分', align: 'right', render: (r: AiRow) => fmtInt(r.points) },
                    { key: 'status', title: '状态', align: 'center', render: (r: AiRow) => <Tag tone={r.status === 'ok' ? 'ok' : 'danger'}>{r.status === 'ok' ? '成功' : '失败'}</Tag> }
                  ]}
                  rows={detail.ai}
                  rowKey={(r) => String(r.id)}
                  pageSize={6}
                  hideSearch
                />
              )}

              {detailTab === 'shares' && (
                <DataTable
                  columns={[
                    { key: 'doc_name', title: '文档', render: (r: ShareRow) => <span className="ellipsis">{r.doc_name}</span> },
                    { key: 'mode', title: '模式', render: (r: ShareRow) => <Tag>{{ read: '只读', comment: '评论', edit: '可编辑' }[r.mode] || r.mode}</Tag> },
                    { key: 'views', title: '浏览', align: 'right', render: (r: ShareRow) => fmtInt(r.views) },
                    { key: 'created_at', title: '创建', render: (r: ShareRow) => <span className="small muted">{fmtDate(r.created_at)}</span> },
                    { key: 'status', title: '状态', align: 'center', render: (r: ShareRow) => <Tag tone={r.status === 'active' ? 'ok' : 'danger'}>{r.status === 'active' ? '正常' : '已屏蔽'}</Tag> }
                  ]}
                  rows={detail.shares}
                  rowKey={(r) => r.id}
                  pageSize={6}
                  hideSearch
                />
              )}

              {detailTab === 'backups' && (
                <DataTable
                  columns={[
                    { key: 'created_at', title: '时间', render: (r: BackupRow) => fmtDateTime(r.created_at) },
                    { key: 'size', title: '大小', align: 'right', render: (r: BackupRow) => fmtBytes(r.size) },
                    { key: 'note', title: '备注', render: (r: BackupRow) => r.note || '—' }
                  ]}
                  rows={detail.backups}
                  rowKey={(r) => String(r.id)}
                  pageSize={6}
                  hideSearch
                />
              )}

              {detailTab === 'devices' && (
                <DataTable
                  columns={[
                    { key: 'device', title: '设备', render: (r: DeviceRow) => <span>{r.device}{r.current && <Tag tone="ok" >当前</Tag>}</span> },
                    { key: 'ip', title: 'IP', render: (r: DeviceRow) => <span className="mono small">{r.ip}</span> },
                    { key: 'last_seen', title: '最后活跃', render: (r: DeviceRow) => <span className="small muted">{fmtTimeAgo(r.last_seen)}</span> },
                    {
                      key: 'act', title: '', align: 'right', width: 78,
                      render: (r: DeviceRow) => (
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={r.current}
                          onClick={async () => {
                            const ok = await ask({ title: '踢出设备', danger: true, message: <>将强制下线 <b>{r.device}</b>，该设备需要重新登录。</>, confirmText: '踢出' })
                            if (ok) toast({ kind: 'ok', text: '已踢出该设备' })
                          }}
                        >
                          踢出
                        </button>
                      )
                    }
                  ]}
                  rows={detail.devices}
                  rowKey={(r) => r.id}
                  pageSize={6}
                  hideSearch
                />
              )}
            </div>

            {detailLoading && <div className="tiny dim" style={{ marginTop: 10 }}><span className="spinner" style={{ width: 11, height: 11, display: 'inline-block', verticalAlign: -1 }} /> 正在同步后端详情…</div>}
          </>
        )}
      </Drawer>

      {confirmNode}
    </>
  )
}
