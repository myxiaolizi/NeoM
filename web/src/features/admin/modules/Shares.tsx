/**
 * Module 6 — 全站分享、协作与 HTML 发布监管
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  DataTable, Drawer, KV, Note, PageHeader, Section, StatCard, Tabs, Tag,
  callApi, copyText, cx, fmtDateTime, fmtInt, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList, seq } from '../data'

export interface ShareRow {
  id: number
  doc_name: string
  username: string
  mode: string
  views: number
  comments: number
  status: string
  created_at: string
  expires_at: string | null
  url: string
  kind: 'share' | 'publish'
}

export interface CommentRow {
  id: number
  share_id: number
  doc_name?: string
  author: string
  content: string
  ip: string
  status: string
  created_at: string
  flagged?: boolean
}

const DEMO_SHARES: ShareRow[] = seq(16, (i) => ({
  id: 100 + i,
  doc_name: ['产品需求文档.md', '读书笔记-深度工作.md', '周报-2026W43.md', 'API 设计草案.md'][i % 4],
  username: ['alice', 'bob', 'carol'][i % 3],
  mode: ['read', 'comment', 'edit'][i % 3],
  views: 12 + i * 37,
  comments: i % 4,
  status: i % 9 === 0 ? 'blocked' : 'active',
  created_at: new Date(Date.now() - i * 7_200_000).toISOString(),
  expires_at: i % 5 === 0 ? new Date(Date.now() + 86400_000 * 7).toISOString() : null,
  url: `https://m.zhengl.vip/s/${100 + i}`,
  kind: 'share'
}))

const DEMO_PUBLISH: ShareRow[] = seq(10, (i) => ({
  id: 200 + i,
  doc_name: ['公开笔记-Node 性能.md', '技术分享-前端工程化.md', '帮助文档.md'][i % 3],
  username: ['alice', 'bob'][i % 2],
  mode: 'publish',
  views: 42 + i * 61,
  comments: 0,
  status: i % 8 === 0 ? 'blocked' : 'active',
  created_at: new Date(Date.now() - i * 10_800_000).toISOString(),
  expires_at: null,
  url: `https://m.zhengl.vip/p/${200 + i}`,
  kind: 'publish'
}))

const DEMO_COMMENTS: CommentRow[] = seq(14, (i) => ({
  id: 300 + i,
  share_id: 100 + (i % 4),
  doc_name: ['产品需求文档.md', '读书笔记-深度工作.md'][i % 2],
  author: ['访客' + i, '匿名用户', 'reviewer'][i % 3],
  content: ['这里的数据口径建议再确认一下。', '第二章的结论和图表对不上。', '排版很棒，收藏了！'][i % 3],
  ip: `203.0.113.${10 + i}`,
  status: 'active',
  created_at: new Date(Date.now() - i * 3_600_000).toISOString(),
  flagged: i % 6 === 0
}))

const Shares: React.FC = () => {
  const confirm = useConfirm()
  const toast = useToast()
  const [tab, setTab] = useState<'share' | 'publish' | 'comments'>('share')
  const [detail, setDetail] = useState<ShareRow | null>(null)

  const shareApi = useApiData<{ shares: ShareRow[]; publishes: ShareRow[] }>(
    async () => {
      const raw: any = await api.get('/api/admin/shares?size=100')
      const shares = asList<any>(raw.shares ?? raw).map((s) => ({
        id: s.id, doc_name: s.doc_name || s.path || '—', username: s.username || '—',
        mode: s.mode || 'read', views: Number(s.views ?? 0), comments: Number(s.comments ?? 0),
        status: s.status || 'active', created_at: s.created_at, expires_at: s.expires_at,
        url: s.url || `https://m.zhengl.vip/s/${s.id}`, kind: 'share' as const
      }))
      const publishes = asList<any>(raw.publishes ?? []).map((p) => ({
        id: p.id, doc_name: p.doc_name || p.path || '—', username: p.username || '—',
        mode: 'publish', views: Number(p.views ?? 0), comments: 0,
        status: p.status || 'active', created_at: p.created_at, expires_at: null,
        url: p.url || `https://m.zhengl.vip/p/${p.id}`, kind: 'publish' as const
      }))
      if (!shares.length && !publishes.length) throw new Error('empty')
      return { shares: shares.length ? shares : DEMO_SHARES, publishes: publishes.length ? publishes : DEMO_PUBLISH }
    },
    { shares: DEMO_SHARES, publishes: DEMO_PUBLISH },
    []
  )

  const commentApi = useApiData<CommentRow[]>(
    async () => {
      const list = asList<any>(await api.get('/api/admin/comments?size=100'))
      if (!list.length) throw new Error('empty')
      return list.map((c) => ({
        id: c.id, share_id: c.share_id, doc_name: c.doc_name, author: c.author || '匿名',
        content: c.content || '', ip: c.ip || '—', status: c.status || 'active',
        created_at: c.created_at, flagged: !!c.flagged
      }))
    },
    DEMO_COMMENTS,
    []
  )

  const block = async (row: ShareRow, blocked: boolean) => {
    const r = await callApi(
      () => api.post(`/api/admin/shares/${row.id}/block`, { blocked: blocked ? 1 : 0, kind: row.kind }),
      blocked ? '已屏蔽' : '已解除屏蔽',
      '操作失败'
    )
    if (r.ok) {
      if (row.kind === 'share') {
        shareApi.setData((d) => ({ ...d, shares: d.shares.map((x) => (x.id === row.id ? { ...x, status: blocked ? 'blocked' : 'active' } : x)) }))
      } else {
        shareApi.setData((d) => ({ ...d, publishes: d.publishes.map((x) => (x.id === row.id ? { ...x, status: blocked ? 'blocked' : 'active' } : x)) }))
      }
    }
  }

  const remove = async (row: ShareRow) => {
    const yes = await confirm.ask({
      title: '删除链接',
      message: `确定删除「${row.doc_name}」的${row.kind === 'share' ? '协作分享' : '发布页面'}？此操作不可恢复。`,
      danger: true,
      confirmText: '删除'
    })
    if (!yes) return
    const r = await callApi(
      () => api.del(`/api/admin/shares/${row.id}?kind=${row.kind}`),
      '已删除',
      '删除失败'
    )
    if (r.ok) {
      shareApi.setData((d) => ({
        shares: d.shares.filter((x) => !(x.id === row.id && x.kind === 'share')),
        publishes: d.publishes.filter((x) => !(x.id === row.id && x.kind === 'publish'))
      }))
    }
  }

  const deleteComment = async (c: CommentRow) => {
    const yes = await confirm.ask({ title: '删除评论', message: '确定删除这条免登录评论？', danger: true, confirmText: '删除' })
    if (!yes) return
    const r = await callApi(() => api.del(`/api/admin/comments/${c.id}`), '已删除评论', '删除失败')
    if (r.ok) commentApi.setData((list) => list.filter((x) => x.id !== c.id))
  }

  const shareColumns: Column<ShareRow>[] = [
    {
      key: 'doc_name', title: '文档', width: 220,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.doc_name}</div>
          <div className="dim tiny mono">{r.kind === 'share' ? `/s/${r.id}` : `/p/${r.id}`}</div>
        </div>
      )
    },
    { key: 'username', title: '创建者', width: 100 },
    {
      key: 'mode', title: '模式', width: 100,
      render: (r) => (
        <Tag tone={r.mode === 'edit' ? 'warn' : r.mode === 'comment' ? 'accent' : 'default'}>
          {r.mode === 'edit' ? '可协同编辑' : r.mode === 'comment' ? '可评论标注' : r.mode === 'publish' ? 'HTML 发布' : '只读'}
        </Tag>
      )
    },
    { key: 'views', title: '浏览', align: 'right', width: 80, render: (r) => fmtInt(r.views) },
    { key: 'comments', title: '评论', align: 'right', width: 80, render: (r) => fmtInt(r.comments) },
    {
      key: 'status', title: '状态', width: 86,
      render: (r) => <Tag tone={r.status === 'active' ? 'ok' : 'danger'} dot>{r.status === 'active' ? '正常' : '已屏蔽'}</Tag>
    },
    { key: 'created_at', title: '创建时间', width: 150, render: (r) => <span className="tiny dim">{fmtDateTime(r.created_at)}</span> },
    {
      key: 'act', title: '操作', width: 210,
      render: (r) => (
        <div className="row" style={{ gap: 4 }}>
          <a className="btn btn-ghost btn-sm" href={r.url} target="_blank" rel="noreferrer" title="直接访问">
            <Icon name="external" size={12} /> 访问
          </a>
          <button className="btn btn-ghost btn-sm" title="复制链接"
            onClick={async () => { await copyText(r.url); toast({ kind: 'ok', text: '链接已复制' }) }}>
            <Icon name="copy" size={12} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => block(r, r.status === 'active')}>
            {r.status === 'active' ? '屏蔽' : '解封'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => remove(r)}><Icon name="trash" size={12} /></button>
        </div>
      )
    }
  ]

  const totalViews = shareApi.data.shares.reduce((s, x) => s + x.views, 0) + shareApi.data.publishes.reduce((s, x) => s + x.views, 0)

  return (
    <>
      <PageHeader
        icon="share"
        title="分享与发布监管"
        desc="全站协作分享链接、HTML 发布页、免登录评论与标注审核"
        demo={shareApi.demo}
        reload={() => { shareApi.reload(); commentApi.reload() }}
        loading={shareApi.loading}
      />

      <div className="adm-stat-grid">
        <StatCard label="协作分享" value={fmtInt(shareApi.data.shares.length)} icon="share" />
        <StatCard label="HTML 发布" value={fmtInt(shareApi.data.publishes.length)} icon="globe" />
        <StatCard label="总浏览量" value={fmtInt(totalViews)} icon="eye" />
        <StatCard label="敏感词命中评论" value={fmtInt(commentApi.data.filter((c) => c.flagged).length)} icon="alert" />
      </div>

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { id: 'share', label: '协作分享', count: shareApi.data.shares.length },
          { id: 'publish', label: 'HTML 发布', count: shareApi.data.publishes.length },
          { id: 'comments', label: '免登录评论', count: commentApi.data.length }
        ]}
      />

      {tab === 'share' && (
        <Section title="全站协作分享" icon="share" flush>
          <DataTable columns={shareColumns} rows={shareApi.data.shares} rowKey={(r) => 's' + r.id} loading={shareApi.loading} />
        </Section>
      )}

      {tab === 'publish' && (
        <Section title="HTML 发布页面" icon="globe" flush>
          <DataTable columns={shareColumns} rows={shareApi.data.publishes} rowKey={(r) => 'p' + r.id} loading={shareApi.loading} />
        </Section>
      )}

      {tab === 'comments' && (
        <Section title="免登录评论与标注" icon="bell" sub="命中敏感词的评论会高亮标记" flush>
          <DataTable
            columns={[
              { key: 'doc_name', title: '文档', width: 180, render: (c) => c.doc_name || `#${c.share_id}` },
              { key: 'author', title: '作者', width: 110 },
              {
                key: 'content', title: '内容', width: 360,
                render: (c) => (
                  <span className={c.flagged ? 'adm-flagged' : ''}>
                    {c.content} {c.flagged && <Tag tone="danger">敏感词</Tag>}
                  </span>
                )
              },
              { key: 'ip', title: 'IP', width: 120, render: (c) => <span className="mono tiny dim">{c.ip}</span> },
              { key: 'created_at', title: '时间', width: 150, render: (c) => <span className="tiny dim">{fmtDateTime(c.created_at)}</span> },
              {
                key: 'act', title: '操作', width: 90,
                render: (c) => (
                  <button className="btn btn-danger btn-sm" onClick={() => deleteComment(c)}>
                    <Icon name="trash" size={12} /> 删除
                  </button>
                )
              }
            ] as Column<CommentRow>[]}
            rows={commentApi.data}
            rowKey={(c) => String(c.id)}
            loading={commentApi.loading}
          />
        </Section>
      )}

      {confirm.node}
    </>
  )
}

export default Shares
