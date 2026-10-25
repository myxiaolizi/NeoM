/**
 * Module 8 — 公共 OSS 对象存储与全站备份管理
 */
import React, { useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  BarList, DataTable, Field, KV, Note, PageHeader, Progress, Section, StatCard, Tag,
  callApi, copyText, cx, fmtBytes, fmtDateTime, fmtInt, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList } from '../data'

export interface OssFile {
  key: string
  name: string
  size: number
  mtime: string | null
  url: string
}

export interface OssDir {
  dir: string
  count: number
  size: number
}

export interface UsageRow {
  username: string
  size: number
}

interface OssData {
  prefix: string
  files: OssFile[]
  dirs: OssDir[]
  usage: UsageRow[]
  stats: any
  truncated?: boolean
  error?: string
}

const DEMO: OssData = {
  prefix: 'md/',
  dirs: [
    { dir: 'mdadmin', count: 24, size: 486 * 1024 * 1024 },
    { dir: 'user', count: 312, size: 1_268 * 1024 * 1024 }
  ],
  files: [
    { key: 'md/mdadmin/NeoM-1.0.0-win-x64-setup.exe', name: 'NeoM-1.0.0-win-x64-setup.exe', size: 96_321_536, mtime: new Date().toISOString(), url: 'https://mdadmin.zhengl.vip/md/mdadmin/NeoM-1.0.0-win-x64-setup.exe' },
    { key: 'md/mdadmin/NeoM-1.0.0-win-x64-green.zip', name: 'NeoM-1.0.0-win-x64-green.zip', size: 101_187_584, mtime: new Date().toISOString(), url: 'https://mdadmin.zhengl.vip/md/mdadmin/NeoM-1.0.0-win-x64-green.zip' }
  ],
  usage: [
    { username: 'alice', size: 482 * 1024 * 1024 },
    { username: 'bob', size: 296 * 1024 * 1024 },
    { username: 'carol', size: 121 * 1024 * 1024 }
  ],
  stats: { ok: true, bucket: 'zhengle', endpoint: 'oss-cn-guangzhou.aliyuncs.com', domain: 'https://mdadmin.zhengl.vip' }
}

const Oss: React.FC = () => {
  const confirm = useConfirm()
  const toast = useToast()
  const [prefix, setPrefix] = useState('md/')
  const [cleanup, setCleanup] = useState<{ open: boolean; dryRun: boolean; orphans: string[]; removed: number }>({
    open: false, dryRun: true, orphans: [], removed: 0
  })

  const ossApi = useApiData<OssData>(
    async () => {
      const raw: any = await api.get(`/api/admin/oss?prefix=${encodeURIComponent(prefix)}`)
      if (!raw || (!asList(raw.files).length && !asList(raw.dirs).length)) throw new Error('empty')
      return {
        prefix: raw.prefix || prefix,
        files: asList<OssFile>(raw.files),
        dirs: asList<OssDir>(raw.dirs),
        usage: asList<UsageRow>(raw.usage),
        stats: raw.stats, truncated: raw.truncated, error: raw.error
      }
    },
    DEMO,
    [prefix]
  )

  const runCleanup = async (dryRun: boolean) => {
    const r = await callApi(
      () => api.post('/api/admin/oss/cleanup', { dryRun: dryRun ? 1 : 0 }),
      dryRun ? '孤立文件扫描完成' : '孤立文件已清理',
      '清理失败'
    )
    if (r.ok) {
      const d: any = r.data
      setCleanup({ open: true, dryRun, orphans: asList<string>(d.orphans), removed: Number(d.removed ?? 0) })
    }
  }

  const breadcrumb = prefix.split('/').filter(Boolean)

  return (
    <>
      <PageHeader
        icon="cloud"
        title="公共 OSS 存储"
        desc="阿里云 OSS 目录浏览、用户占用统计与孤立文件清理"
        demo={ossApi.demo}
        reload={ossApi.reload}
        loading={ossApi.loading}
        actions={
          <>
            <button className="btn btn-sm" onClick={() => runCleanup(true)}>
              <Icon name="search" size={13} /> 扫描孤立文件
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => runCleanup(false)}>
              <Icon name="trash" size={13} /> 清理
            </button>
          </>
        }
      />

      <div className="adm-stat-grid">
        <StatCard label="Bucket" value={ossApi.data.stats?.bucket || 'zhengle'} icon="database" />
        <StatCard label="Endpoint" value={<span className="small">{ossApi.data.stats?.endpoint || 'oss-cn-guangzhou'}</span>} icon="server" />
        <StatCard label="目录数" value={ossApi.data.dirs.length} icon="folder" />
        <StatCard label="对象总数（当前目录）" value={fmtInt(ossApi.data.dirs.reduce((s, d) => s + d.count, 0) + ossApi.data.files.length)} icon="layers" />
      </div>

      <Section title="OSS 配置" icon="server">
        <div className="adm-grid-3">
          <Field label="Bucket 名称"><input className="input mono" defaultValue="zhengle" readOnly /></Field>
          <Field label="Endpoint"><input className="input mono" defaultValue="oss-cn-guangzhou.aliyuncs.com" readOnly /></Field>
          <Field label="自定义访问域名"><input className="input mono" defaultValue="https://mdadmin.zhengl.vip" readOnly /></Field>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Tag tone="ok" dot>连通正常</Tag>
          <Note tone="info" style={{ flex: 1 }}>
            桶为<b>私有读写</b>：客户端访问一律走后端签名 URL；AccessKey 仅存于服务器 .env 与数据库加密列。
          </Note>
        </div>
      </Section>

      <Section
        title="目录浏览"
        icon="folder-open"
        sub={
          <span className="mono tiny">
            <a href="#" onClick={(e) => { e.preventDefault(); setPrefix('md/') }}>md</a>
            {breadcrumb.map((b, i) => (
              <span key={i}>
                {' / '}
                <a href="#" onClick={(e) => { e.preventDefault(); setPrefix('md/' + breadcrumb.slice(0, i + 1).join('/') + '/') }}>{b}</a>
              </span>
            ))}
          </span>
        }
        flush
        actions={
          <select className="select" style={{ width: 220, height: 28 }} value={prefix}
            onChange={(e) => setPrefix(e.target.value)}>
            <option value="md/">md/（全部）</option>
            <option value="md/mdadmin/">md/mdadmin（公共管理）</option>
            <option value="md/user/">md/user（用户数据）</option>
          </select>
        }
      >
        {ossApi.data.dirs.length > 0 && (
          <div className="adm-oss-dirs">
            {ossApi.data.dirs.map((d) => (
              <button key={d.dir} className="adm-oss-dir" onClick={() => setPrefix(`${prefix}${d.dir}/`)}>
                <Icon name="folder" size={15} />
                <span className="grow ellipsis">{d.dir}</span>
                <span className="dim tiny">{d.count} 项 · {fmtBytes(d.size)}</span>
              </button>
            ))}
          </div>
        )}
        <DataTable
          columns={[
            { key: 'name', title: '文件', width: 320, render: (f) => <span className="mono tiny ellipsis">{f.name}</span> },
            { key: 'size', title: '大小', align: 'right', width: 100, render: (f) => fmtBytes(f.size) },
            { key: 'mtime', title: '修改时间', width: 160, render: (f) => <span className="tiny dim">{f.mtime ? fmtDateTime(f.mtime) : '—'}</span> },
            {
              key: 'act', title: '操作', width: 160,
              render: (f) => (
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { await copyText(f.url); toast({ kind: 'ok', text: '链接已复制' }) }}>
                    <Icon name="copy" size={12} /> 链接
                  </button>
                  <a className="btn btn-ghost btn-sm" href={f.url} target="_blank" rel="noreferrer"><Icon name="external" size={12} /></a>
                </div>
              )
            }
          ] as Column<OssFile>[]}
          rows={ossApi.data.files}
          rowKey={(f) => f.key}
          loading={ossApi.loading}
          emptyText="该目录下没有文件"
        />
        {ossApi.data.truncated && <Note tone="warn" style={{ margin: 12 }}>结果已截断（超过 1000 项），请进入子目录查看。</Note>}
      </Section>

      <Section title="用户存储占用 Top 20" icon="chart" sub="图片 / 备份 / 其他附件合计">
        {ossApi.data.usage.length ? (
          <BarList
            items={ossApi.data.usage.map((u) => ({ label: u.username, value: u.size, display: fmtBytes(u.size) }))}
          />
        ) : (
          <div className="empty">暂无用户存储数据</div>
        )}
      </Section>

      {cleanup.open && (
        <Section title={cleanup.dryRun ? '孤立文件扫描结果' : '清理结果'} icon="trash" style={{ marginTop: 14 }}>
          <KV items={[
            ['模式', cleanup.dryRun ? '仅扫描（未删除）' : '已执行删除'],
            ['发现孤立文件', fmtInt(cleanup.orphans.length)],
            ['实际删除', fmtInt(cleanup.removed)]
          ]} />
          {cleanup.orphans.length > 0 && (
            <div className="adm-orphan-list">
              {cleanup.orphans.slice(0, 50).map((k) => <div key={k} className="mono tiny ellipsis">{k}</div>)}
            </div>
          )}
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setCleanup({ ...cleanup, open: false })}>关闭</button>
        </Section>
      )}

      {confirm.node}
    </>
  )
}

export default Oss
