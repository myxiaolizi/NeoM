/**
 * Module 7 — 客户端多平台版本发布与 OSS 下载管理
 */
import React, { useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  DataTable, Drawer, Field, KV, Note, PageHeader, Section, StatCard, Tag,
  callApi, copyText, cx, fmtBytes, fmtDate, fmtDateTime, fmtInt, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList, seq } from '../data'

export interface ReleaseRow {
  id: number
  platform: string
  version: string
  filename: string
  size: number
  url: string
  oss_key: string | null
  changelog: string | null
  forced: boolean
  channel: string
  published_at: string
  downloads: number
}

const PLATFORMS: { id: string; name: string; icon: string; ext: string }[] = [
  { id: 'win-x64', name: 'Windows 安装包', icon: 'windows', ext: '.exe' },
  { id: 'win-green', name: 'Windows 绿色版', icon: 'windows', ext: '.zip' },
  { id: 'mac-arm64', name: 'macOS (Apple Silicon)', icon: 'apple', ext: '.dmg' },
  { id: 'mac-x64', name: 'macOS (Intel)', icon: 'apple', ext: '.dmg' },
  { id: 'android', name: 'Android', icon: 'android', ext: '.apk' },
  { id: 'ios', name: 'iOS', icon: 'smartphone', ext: '.ipa' }
]

const DEMO: ReleaseRow[] = PLATFORMS.map((p, i) => ({
  id: i + 1,
  platform: p.id,
  version: '1.0.0',
  filename: `NeoM-1.0.0-${p.id}${p.ext}`,
  size: [92, 96, 105, 108, 38, 42][i] * 1024 * 1024,
  url: `https://mdadmin.zhengl.vip/md/mdadmin/NeoM-1.0.0-${p.id}${p.ext}`,
  oss_key: `md/mdadmin/NeoM-1.0.0-${p.id}${p.ext}`,
  changelog: '## NeoM 1.0.0\n- 全新 Markdown 所见即所得编辑器\n- AI 助手与 24 款内置插件\n- 云端仓库与多端同步',
  forced: false,
  channel: 'stable',
  published_at: new Date(Date.now() - i * 3_600_000).toISOString(),
  downloads: 120 - i * 7
}))

const Releases: React.FC = () => {
  const confirm = useConfirm()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<{ open: boolean; file: File | null; platform: string; version: string; changelog: string; forced: boolean; channel: string }>({
    open: false, file: null, platform: 'win-x64', version: '1.0.0', changelog: '', forced: false, channel: 'stable'
  })
  const [edit, setEdit] = useState<ReleaseRow | null>(null)
  const [busy, setBusy] = useState(false)

  const apiState = useApiData<ReleaseRow[]>(
    async () => {
      const list = asList<any>(await api.get('/api/admin/releases'))
      if (!list.length) throw new Error('empty')
      return list.map((r) => ({
        id: r.id, platform: r.platform, version: r.version, filename: r.filename,
        size: Number(r.size ?? 0), url: r.url, oss_key: r.oss_key,
        changelog: r.changelog, forced: !!r.forced, channel: r.channel || 'stable',
        published_at: r.published_at, downloads: Number(r.downloads ?? 0)
      }))
    },
    DEMO,
    []
  )

  const latestByPlatform = (pid: string) =>
    apiState.data
      .filter((r) => r.platform === pid)
      .sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at))[0] || null

  const doUpload = async () => {
    if (!upload.file) {
      toast({ kind: 'warn', text: '请先选择安装包文件' })
      return
    }
    setBusy(true)
    const fd = new FormData()
    fd.append('file', upload.file)
    fd.append('platform', upload.platform)
    fd.append('version', upload.version)
    fd.append('changelog', upload.changelog)
    fd.append('forced', upload.forced ? '1' : '0')
    fd.append('channel', upload.channel)
    const r = await callApi(
      () => api.upload('/api/admin/releases/upload', fd),
      '安装包已上传至 OSS 并登记版本',
      '上传失败'
    )
    setBusy(false)
    if (r.ok) {
      setUpload({ ...upload, open: false, file: null })
      apiState.reload()
    }
  }

  const saveEdit = async () => {
    if (!edit) return
    const r = await callApi(
      () => api.put(`/api/admin/releases/${edit.id}`, {
        version: edit.version, url: edit.url, size: edit.size,
        changelog: edit.changelog, forced: edit.forced, channel: edit.channel
      }),
      '版本信息已保存',
      '保存失败'
    )
    if (r.ok) {
      apiState.setData((list) => list.map((x) => (x.id === edit.id ? edit : x)))
      setEdit(null)
    }
  }

  const remove = async (row: ReleaseRow) => {
    const yes = await confirm.ask({
      title: '删除版本', danger: true, confirmText: '删除',
      message: `确定删除 ${row.platform} 的 ${row.version}（${row.filename}）？OSS 文件不会被删除。`
    })
    if (!yes) return
    const r = await callApi(() => api.del(`/api/admin/releases/${row.id}`), '版本记录已删除', '删除失败')
    if (r.ok) apiState.setData((list) => list.filter((x) => x.id !== row.id))
  }

  const totalDownloads = apiState.data.reduce((s, r) => s + r.downloads, 0)

  return (
    <>
      <PageHeader
        icon="download"
        title="客户端版本发布"
        desc="Windows / macOS / Android / iOS 安装包管理，直传公共 OSS（md/mdadmin）并生成高速下载链接"
        demo={apiState.demo}
        reload={apiState.reload}
        loading={apiState.loading}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setUpload({ ...upload, open: true })}>
            <Icon name="upload" size={13} /> 上传安装包
          </button>
        }
      />

      <div className="adm-stat-grid">
        <StatCard label="已发布平台" value={`${new Set(apiState.data.map((r) => r.platform)).size} / 6`} icon="monitor" />
        <StatCard label="版本记录" value={apiState.data.length} icon="layers" />
        <StatCard label="累计下载" value={fmtInt(totalDownloads)} icon="download" />
        <StatCard label="当前最新" value={apiState.data[0]?.version || '—'} icon="star" />
      </div>

      <Section title="平台最新版本" icon="monitor" sub="点击卡片可复制下载链接">
        <div className="adm-platform-grid">
          {PLATFORMS.map((p) => {
            const rel = latestByPlatform(p.id)
            return (
              <div className="adm-platform-card" key={p.id}>
                <div className="row" style={{ gap: 8 }}>
                  <Icon name={p.icon} size={18} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div className="dim tiny">{p.ext}</div>
                  </div>
                  {rel ? <Tag tone="ok" dot>v{rel.version}</Tag> : <Tag tone="warn">未发布</Tag>}
                </div>
                {rel ? (
                  <>
                    <div className="mono tiny ellipsis" style={{ marginTop: 8 }} title={rel.filename}>{rel.filename}</div>
                    <div className="dim tiny">{fmtBytes(rel.size)} · {fmtDate(rel.published_at)} · {fmtInt(rel.downloads)} 次下载</div>
                    <div className="row" style={{ gap: 6, marginTop: 8 }}>
                      <button className="btn btn-sm" onClick={async () => { await copyText(rel.url); toast({ kind: 'ok', text: '下载链接已复制' }) }}>
                        <Icon name="copy" size={12} /> 复制链接
                      </button>
                      <a className="btn btn-ghost btn-sm" href={rel.url} target="_blank" rel="noreferrer">
                        <Icon name="external" size={12} /> 测试
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="dim small" style={{ marginTop: 8 }}>尚未上传该平台安装包</div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="全部版本记录" icon="layers" flush>
        <DataTable
          columns={[
            { key: 'platform', title: '平台', width: 130, render: (r) => <Tag tone="accent">{r.platform}</Tag> },
            { key: 'version', title: '版本', width: 90, render: (r) => <span className="mono">{r.version}</span> },
            { key: 'filename', title: '文件名', width: 260, render: (r) => <span className="mono tiny ellipsis">{r.filename}</span> },
            { key: 'size', title: '大小', align: 'right', width: 96, render: (r) => fmtBytes(r.size) },
            {
              key: 'channel', title: '渠道', width: 84,
              render: (r) => <Tag tone={r.channel === 'beta' ? 'warn' : 'default'}>{r.channel}</Tag>
            },
            {
              key: 'forced', title: '强制更新', width: 90,
              render: (r) => (r.forced ? <Tag tone="danger" dot>强制</Tag> : <span className="dim tiny">否</span>)
            },
            { key: 'downloads', title: '下载', align: 'right', width: 80, render: (r) => fmtInt(r.downloads) },
            { key: 'published_at', title: '发布时间', width: 150, render: (r) => <span className="tiny dim">{fmtDateTime(r.published_at)}</span> },
            {
              key: 'act', title: '操作', width: 190,
              render: (r) => (
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...r })}><Icon name="edit" size={12} /> 编辑</button>
                  <a className="btn btn-ghost btn-sm" href={r.url} target="_blank" rel="noreferrer"><Icon name="external" size={12} /></a>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(r)}><Icon name="trash" size={12} /></button>
                </div>
              )
            }
          ] as Column<ReleaseRow>[]}
          rows={apiState.data}
          rowKey={(r) => String(r.id)}
          loading={apiState.loading}
        />
      </Section>

      <Section title="更新弹窗与公告文案" icon="bell" style={{ marginTop: 14 }}>
        <div className="adm-grid-2">
          <Field label="更新弹窗标题" hint="客户端检测到新版本时显示的标题">
            <input className="input" defaultValue="发现 NeoM 新版本" />
          </Field>
          <Field label="更新说明（Changelog）模板">
            <textarea className="textarea" rows={3} defaultValue="## 本次更新&#10;- 修复若干问题&#10;- 提升启动速度" />
          </Field>
        </div>
        <Note tone="info">
          强制更新开关按版本单独设置（见上表）。下拉包体积较大，全部存放于公共 OSS
          <span className="mono"> md/mdadmin </span>，通过自定义域名 https://mdadmin.zhengl.vip 加速下载。
        </Note>
      </Section>

      <Drawer
        open={upload.open}
        title="上传安装包"
        icon="upload"
        onClose={() => setUpload({ ...upload, open: false })}
        footer={
          <>
            <button className="btn" onClick={() => setUpload({ ...upload, open: false })}>取消</button>
            <button className="btn btn-primary" onClick={doUpload} disabled={busy || !upload.file}>
              {busy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Icon name="upload" size={13} />}
              上传并发布
            </button>
          </>
        }
      >
        <div className="adm-grid-2">
          <Field label="目标平台" required>
            <select className="input" value={upload.platform} onChange={(e) => setUpload({ ...upload, platform: e.target.value })}>
              {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="版本号" required>
            <input className="input" value={upload.version} onChange={(e) => setUpload({ ...upload, version: e.target.value })} />
          </Field>
          <Field label="发布渠道">
            <select className="input" value={upload.channel} onChange={(e) => setUpload({ ...upload, channel: e.target.value })}>
              <option value="stable">stable（正式）</option>
              <option value="beta">beta（测试）</option>
            </select>
          </Field>
          <Field label="强制更新">
            <button className={cx('btn', upload.forced ? 'btn-danger' : 'btn-ghost')} onClick={() => setUpload({ ...upload, forced: !upload.forced })}>
              {upload.forced ? '开启（强制）' : '关闭'}
            </button>
          </Field>
        </div>

        <Field label="安装包文件" required hint="上传至 OSS：md/mdadmin/<文件名>">
          <input ref={fileRef} type="file" style={{ display: 'none' }}
            onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="folder-open" size={13} /> {upload.file ? upload.file.name : '选择文件…'}
          </button>
          {upload.file && <div className="dim tiny" style={{ marginTop: 6 }}>{fmtBytes(upload.file.size)}</div>}
        </Field>

        <Field label="更新日志（Changelog）" hint="支持 Markdown">
          <textarea className="textarea" rows={5} value={upload.changelog}
            onChange={(e) => setUpload({ ...upload, changelog: e.target.value })} />
        </Field>
      </Drawer>

      <Drawer open={!!edit} title={`编辑 ${edit?.platform} ${edit?.version}`} icon="edit" onClose={() => setEdit(null)}
        footer={
          <>
            <button className="btn" onClick={() => setEdit(null)}>取消</button>
            <button className="btn btn-primary" onClick={saveEdit}><Icon name="save" size={13} /> 保存</button>
          </>
        }>
        {edit && (
          <>
            <Field label="版本号"><input className="input" value={edit.version} onChange={(e) => setEdit({ ...edit, version: e.target.value })} /></Field>
            <Field label="下载地址"><input className="input mono" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Field>
            <div className="adm-grid-2">
              <Field label="文件大小（字节）"><input className="input num" type="number" value={edit.size} onChange={(e) => setEdit({ ...edit, size: Number(e.target.value) })} /></Field>
              <Field label="渠道">
                <select className="input" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}>
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                </select>
              </Field>
            </div>
            <Field label="强制更新">
              <button className={cx('btn', edit.forced ? 'btn-danger' : 'btn-ghost')} onClick={() => setEdit({ ...edit, forced: !edit.forced })}>
                {edit.forced ? '开启（强制）' : '关闭'}
              </button>
            </Field>
            <Field label="更新日志">
              <textarea className="textarea" rows={6} value={edit.changelog || ''} onChange={(e) => setEdit({ ...edit, changelog: e.target.value })} />
            </Field>
          </>
        )}
      </Drawer>

      {confirm.node}
    </>
  )
}

export default Releases
