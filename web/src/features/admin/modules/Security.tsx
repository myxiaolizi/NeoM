/**
 * Module 10 — 系统安全、操作审计与运维监控
 */
import React, { useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  DataTable, Field, KV, Note, PageHeader, Section, StatCard, Tabs, Tag,
  callApi, cx, downloadCsv, fmtBytes, fmtDateTime, fmtInt, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList, seq } from '../data'

export interface AuditRow {
  id: number
  username: string
  action: string
  entity_type: string | null
  entity_id: string | null
  ip: string | null
  created_at: string
}

export interface LoginRow {
  id: number
  account: string
  kind: string
  ok: number
  ip: string
  device: string | null
  msg: string | null
  created_at: string
}

export interface WordRow {
  id: number
  word: string
  enabled: number
}

export interface SecurityData {
  audits: AuditRow[]
  logins: LoginRow[]
  sensitiveWords: WordRow[]
  rateLimits: any
}

const DEMO: SecurityData = {
  audits: seq(20, (i) => ({
    id: 500 + i,
    username: 'admin',
    action: ['admin.login', 'admin.user.update', 'admin.pricing.update', 'admin.release.create', 'admin.site.update'][i % 5],
    entity_type: ['user', 'ai_model', 'release', 'site_config'][i % 4],
    entity_id: String(1 + (i % 9)),
    ip: `203.0.113.${10 + i}`,
    created_at: new Date(Date.now() - i * 1_800_000).toISOString()
  })),
  logins: seq(24, (i) => ({
    id: 600 + i,
    account: ['admin', 'alice', 'bob'][i % 3],
    kind: 'password',
    ok: i % 6 === 0 ? 0 : 1,
    ip: `203.0.113.${20 + i}`,
    device: ['Chrome / Windows', 'Safari / macOS', 'NeoM Desktop'][i % 3],
    msg: i % 6 === 0 ? '密码错误' : null,
    created_at: new Date(Date.now() - i * 2_400_000).toISOString()
  })),
  sensitiveWords: [
    { id: 1, word: 'spam-word', enabled: 1 },
    { id: 2, word: '违规内容', enabled: 1 },
    { id: 3, word: 'ad-link', enabled: 1 }
  ],
  rateLimits: { global: { rpm: 60, tpm: 200000 }, loginFailLimit: 5, loginLockMinutes: 15 }
}

const Security: React.FC = () => {
  const confirm = useConfirm()
  const toast = useToast()
  const [tab, setTab] = useState<'audit' | 'login' | 'words' | 'limit' | 'backup'>('audit')
  const [wordInput, setWordInput] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [lastBackup, setLastBackup] = useState<any>(null)
  const [limits, setLimits] = useState({ globalRpm: 60, globalTpm: 200000, loginFailLimit: 5, loginLockMinutes: 15 })

  const apiState = useApiData<SecurityData>(
    async () => {
      const raw: any = await api.get('/api/admin/security')
      if (!raw || (!raw.audits && !raw.logins)) throw new Error('empty')
      return {
        audits: asList<AuditRow>(raw.audits),
        logins: asList<LoginRow>(raw.logins),
        sensitiveWords: asList<WordRow>(raw.sensitiveWords),
        rateLimits: raw.rateLimits
      }
    },
    DEMO,
    []
  )

  const backupApi = useApiData<any[]>(
    async () => {
      const list = asList<any>(await api.get('/api/admin/backup'))
      return list
    },
    [],
    []
  )

  const addWords = async () => {
    const words = wordInput.split(/[\s,，]+/).filter(Boolean)
    if (!words.length) return
    const r = await callApi(
      () => api.post('/api/admin/security/words', { words }),
      `已添加 ${words.length} 个敏感词`,
      '添加失败'
    )
    if (r.ok) {
      setWordInput('')
      apiState.setData((d) => ({
        ...d,
        sensitiveWords: [...d.sensitiveWords, ...words.map((w, i) => ({ id: Date.now() + i, word: w, enabled: 1 }))]
      }))
    }
  }

  const delWord = async (w: WordRow) => {
    const r = await callApi(() => api.del(`/api/admin/security/words/${w.id}`), '已删除', '删除失败')
    if (r.ok) apiState.setData((d) => ({ ...d, sensitiveWords: d.sensitiveWords.filter((x) => x.id !== w.id) }))
  }

  const saveLimits = async () => {
    await callApi(
      () => api.post('/api/admin/security/ratelimit', {
        scope: 'global', rpm: limits.globalRpm, tpm: limits.globalTpm
      }),
      '限流配置已保存',
      '保存失败'
    )
  }

  const runBackup = async () => {
    setBackupBusy(true)
    const r = await callApi(
      () => api.post('/api/admin/backup', {}),
      '数据库备份完成并已上传 OSS',
      '备份失败'
    )
    setBackupBusy(false)
    if (r.ok) {
      setLastBackup(r.data)
      backupApi.reload()
    }
  }

  const failedLogins = apiState.data.logins.filter((l) => !l.ok).length

  return (
    <>
      <PageHeader
        icon="shield"
        title="系统安全与运维"
        desc="管理员审计、登录安全、API 限流、敏感词库、数据库备份与错误日志"
        demo={apiState.demo}
        reload={() => { apiState.reload(); backupApi.reload() }}
        loading={apiState.loading}
      />

      <div className="adm-stat-grid">
        <StatCard label="审计事件" value={fmtInt(apiState.data.audits.length)} icon="shield" />
        <StatCard label="登录失败" value={fmtInt(failedLogins)} icon="alert" />
        <StatCard label="敏感词" value={fmtInt(apiState.data.sensitiveWords.length)} icon="filter" />
        <StatCard label="备份记录" value={fmtInt(backupApi.data.length)} icon="database" />
      </div>

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { id: 'audit', label: '操作审计', count: apiState.data.audits.length },
          { id: 'login', label: '登录日志', count: apiState.data.logins.length },
          { id: 'words', label: '敏感词库', count: apiState.data.sensitiveWords.length },
          { id: 'limit', label: '限流配置' },
          { id: 'backup', label: '备份与运维' }
        ]}
      />

      {tab === 'audit' && (
        <Section title="管理员操作审计" icon="shield" flush actions={
          <button className="btn btn-ghost btn-sm" onClick={() =>
            downloadCsv('audit.csv', [['时间', '操作人', '动作', '对象类型', '对象ID', 'IP'],
              ...apiState.data.audits.map((a) => [a.created_at, a.username, a.action, a.entity_type || '', a.entity_id || '', a.ip || ''])])}>
            <Icon name="download" size={12} /> 导出
          </button>
        }>
          <DataTable
            columns={[
              { key: 'created_at', title: '时间', width: 160, render: (a) => <span className="tiny dim">{fmtDateTime(a.created_at)}</span> },
              { key: 'username', title: '操作人', width: 110 },
              { key: 'action', title: '动作', width: 220, render: (a) => <span className="mono tiny">{a.action}</span> },
              { key: 'entity_type', title: '对象', width: 120, render: (a) => <span className="dim tiny">{a.entity_type || '—'}{a.entity_id ? ` #${a.entity_id}` : ''}</span> },
              { key: 'ip', title: 'IP', width: 130, render: (a) => <span className="mono tiny dim">{a.ip || '—'}</span> }
            ] as Column<AuditRow>[]}
            rows={apiState.data.audits}
            rowKey={(a) => String(a.id)}
            loading={apiState.loading}
          />
        </Section>
      )}

      {tab === 'login' && (
        <Section title="登录安全日志" icon="key" flush>
          <DataTable
            columns={[
              { key: 'created_at', title: '时间', width: 160, render: (l) => <span className="tiny dim">{fmtDateTime(l.created_at)}</span> },
              { key: 'account', title: '账号', width: 130 },
              {
                key: 'ok', title: '结果', width: 90,
                render: (l) => <Tag tone={l.ok ? 'ok' : 'danger'} dot>{l.ok ? '成功' : '失败'}</Tag>
              },
              { key: 'ip', title: 'IP', width: 130, render: (l) => <span className="mono tiny dim">{l.ip}</span> },
              { key: 'device', title: '设备 / UA', width: 200, render: (l) => <span className="tiny dim ellipsis">{l.device || '—'}</span> },
              { key: 'msg', title: '说明', width: 160, render: (l) => <span className="tiny dim">{l.msg || '—'}</span> }
            ] as Column<LoginRow>[]}
            rows={apiState.data.logins}
            rowKey={(l) => String(l.id)}
            loading={apiState.loading}
          />
        </Section>
      )}

      {tab === 'words' && (
        <>
          <Section title="添加敏感词" icon="filter">
            <Field label="敏感词" hint="支持空格、逗号或换行分隔，一次可批量添加">
              <textarea className="textarea" rows={3} value={wordInput} onChange={(e) => setWordInput(e.target.value)}
                placeholder="违规词1 违规词2" />
            </Field>
            <button className="btn btn-primary btn-sm" onClick={addWords}>
              <Icon name="plus" size={12} /> 批量添加
            </button>
            <Note tone="info" style={{ marginTop: 10 }}>
              命中策略由服务端配置：可「拦截」（拒绝提交）或「替换」。免登录评论会先经过敏感词过滤。
            </Note>
          </Section>
          <Section title="敏感词列表" icon="filter" flush>
            <DataTable
              columns={[
                { key: 'word', title: '敏感词', render: (w) => <span className="mono">{w.word}</span> },
                { key: 'enabled', title: '状态', width: 100, render: (w) => <Tag tone={w.enabled ? 'ok' : 'default'} dot>{w.enabled ? '启用' : '停用'}</Tag> },
                {
                  key: 'act', title: '操作', width: 90,
                  render: (w) => (
                    <button className="btn btn-danger btn-sm" onClick={() => delWord(w)}>
                      <Icon name="trash" size={12} />
                    </button>
                  )
                }
              ] as Column<WordRow>[]}
              rows={apiState.data.sensitiveWords}
              rowKey={(w) => String(w.id)}
            />
          </Section>
        </>
      )}

      {tab === 'limit' && (
        <Section title="API 防刷与限流" icon="sliders">
          <div className="adm-grid-2">
            <Field label="全局 RPM（每分钟请求数）">
              <input className="input num" type="number" value={limits.globalRpm}
                onChange={(e) => setLimits({ ...limits, globalRpm: Number(e.target.value) })} />
            </Field>
            <Field label="全局 TPM（每分钟 Tokens）">
              <input className="input num" type="number" value={limits.globalTpm}
                onChange={(e) => setLimits({ ...limits, globalTpm: Number(e.target.value) })} />
            </Field>
            <Field label="登录失败次数上限">
              <input className="input num" type="number" value={limits.loginFailLimit}
                onChange={(e) => setLimits({ ...limits, loginFailLimit: Number(e.target.value) })} />
            </Field>
            <Field label="锁定时长（分钟）">
              <input className="input num" type="number" value={limits.loginLockMinutes}
                onChange={(e) => setLimits({ ...limits, loginLockMinutes: Number(e.target.value) })} />
            </Field>
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveLimits}>
            <Icon name="save" size={12} /> 保存限流配置
          </button>
          <Note tone="warn" style={{ marginTop: 10 }}>
            当前限流为单机内存 + 数据库固定窗口，fail-open（DB 异常时不阻断）。多实例部署需改造为 Redis 共享计数。
          </Note>
        </Section>
      )}

      {tab === 'backup' && (
        <>
          <Section title="数据库备份" icon="database">
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-primary" onClick={runBackup} disabled={backupBusy}>
                {backupBusy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Icon name="download" size={13} />}
                立即备份并上传 OSS
              </button>
              <span className="dim small">备份文件保存到 md/mdadmin/bk/，可直接下载</span>
            </div>
            {lastBackup && (
              <Note tone="info" style={{ marginTop: 12 }}>
                最近一次备份：<b>{lastBackup.filename}</b>（{fmtBytes(lastBackup.size)}）
                {lastBackup.url && <a href={lastBackup.url} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>下载 <Icon name="external" size={11} /></a>}
              </Note>
            )}
          </Section>

          <Section title="备份历史" icon="layers" flush>
            <DataTable
              columns={[
                { key: 'filename', title: '文件名', width: 300, render: (r) => <span className="mono tiny">{r.filename}</span> },
                { key: 'size', title: '大小', align: 'right', width: 100, render: (r) => fmtBytes(r.size) },
                { key: 'kind', title: '类型', width: 100, render: (r) => <Tag tone="accent">{r.kind || 'database'}</Tag> },
                { key: 'created_at', title: '时间', width: 160, render: (r) => <span className="tiny dim">{fmtDateTime(r.created_at)}</span> },
                {
                  key: 'act', title: '操作', width: 90,
                  render: (r) => r.url ? <a className="btn btn-ghost btn-sm" href={r.url} target="_blank" rel="noreferrer"><Icon name="download" size={12} /></a> : <span className="dim">—</span>
                }
              ] as Column<any>[]}
              rows={backupApi.data}
              rowKey={(r) => String(r.id)}
              emptyText="尚未创建备份"
            />
          </Section>

          <Section title="系统错误日志" icon="alert" style={{ marginTop: 14 }}>
            <Note tone="info">
              服务端错误日志位于面板：
              <span className="mono"> /www/wwwlogs/nodejs/neom.log </span>
              与 <span className="mono"> /www/wwwlogs/neom.error.log </span>。
              运行时未捕获异常会在进程日志中输出完整堆栈。
            </Note>
          </Section>
        </>
      )}

      {confirm.node}
    </>
  )
}

export default Security
