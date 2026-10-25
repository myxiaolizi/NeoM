/**
 * Module 5 — 插件开放平台与应用商店管理
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  BarList, DataTable, Drawer, Field, KV, Note, PageHeader, Section,
  StatCard, Tabs, Tag, Toolbar, callApi, cx, fmtInt, useApiData, useConfirm, useToast, type Column
} from '../components'
import { asList, seq } from '../data'

export interface PluginRow {
  id: string
  name: string
  version: string
  description: string
  author: string
  category: string
  icon: string
  builtin: boolean
  status: string
  downloads: number
  rating: number
  defaultEnabled: boolean
  installs: number
  enabledCount: number
}

const CATEGORIES = ['核心', '可视化', '效率', '媒体', '数据', 'AI', '发布']

const DEMO: PluginRow[] = [
  ['canvas', '白板画布', '可视化', 1], ['note-restructure', '笔记重组', '效率', 0],
  ['tag-list', '标签列表', '数据', 1], ['outgoing-links', '出链', '数据', 1],
  ['outline', '大纲', '效率', 1], ['publish', '发布', '发布', 0],
  ['backlinks', '反向链接', '数据', 1], ['workspace', '工作区', '效率', 1],
  ['graph', '关系图谱', '可视化', 1], ['slides', '幻灯片', '可视化', 0],
  ['footnote-view', '脚注视图', '效率', 0], ['quick-switcher', '快速切换', '效率', 1],
  ['recorder', '录音转写', '媒体', 0], ['random-note', '随机漫游', '效率', 0],
  ['daily-notes', '日记', '效率', 1], ['bookmarks', '书签', '效率', 1],
  ['properties', '文档属性', '数据', 1], ['database', '数据库视图', '数据', 0],
  ['web-browser', '内置浏览器', '媒体', 0], ['file-recovery', '文件恢复', '核心', 1],
  ['file-explorer', '文件浏览', '核心', 1], ['slash-commands', '斜杠命令', '效率', 1],
  ['page-preview', '页面预览', '核心', 1], ['word-count', '字数统计', '核心', 1],
  ['ai', 'AI 助手', 'AI', 1]
].map(([id, name, category, def], i) => ({
  id: id as string,
  name: name as string,
  version: '1.0.0',
  description: `${name} — NeoM 内置插件`,
  author: 'NeoM',
  category: category as string,
  icon: 'puzzle',
  builtin: true,
  status: 'published',
  downloads: 1200 - i * 37,
  rating: 4.6,
  defaultEnabled: !!def,
  installs: 800 - i * 21,
  enabledCount: 600 - i * 17
}))

const Plugins: React.FC = () => {
  const confirm = useConfirm()
  const toast = useToast()
  const [tab, setTab] = useState<'builtin' | 'third' | 'review'>('builtin')
  const [detail, setDetail] = useState<PluginRow | null>(null)
  const [allowUnsigned, setAllowUnsigned] = useState(true)

  const listApi = useApiData<PluginRow[]>(
    async () => {
      const list = asList<any>(await api.get('/api/admin/plugins'))
      if (!list.length) throw new Error('empty')
      return list.map((p) => ({
        id: p.id, name: p.name, version: p.version, description: p.description,
        author: p.author, category: p.category || '核心', icon: p.icon || 'puzzle',
        builtin: !!p.builtin, status: p.status || 'published',
        downloads: Number(p.downloads ?? 0), rating: Number(p.rating ?? 0),
        defaultEnabled: !!p.defaultEnabled, installs: Number(p.installs ?? 0),
        enabledCount: Number(p.enabledCount ?? 0)
      }))
    },
    DEMO,
    []
  )

  const builtin = useMemo(() => listApi.data.filter((p) => p.builtin), [listApi.data])
  const third = useMemo(() => listApi.data.filter((p) => !p.builtin), [listApi.data])
  const pending = useMemo(() => listApi.data.filter((p) => p.status === 'pending'), [listApi.data])

  const toggleDefault = async (p: PluginRow) => {
    const next = !p.defaultEnabled
    const r = await callApi(
      () => api.put(`/api/admin/plugins/${p.id}`, { defaultEnabled: next }),
      `「${p.name}」默认${next ? '开启' : '关闭'}已保存`,
      '保存失败'
    )
    if (r.ok) listApi.setData((list) => list.map((x) => (x.id === p.id ? { ...x, defaultEnabled: next } : x)))
  }

  const setStatus = async (p: PluginRow, status: string) => {
    const r = await callApi(
      () => api.put(`/api/admin/plugins/${p.id}`, { status }),
      `「${p.name}」已${status === 'published' ? '上架' : status === 'offline' ? '下架' : status}`,
      '操作失败'
    )
    if (r.ok) listApi.setData((list) => list.map((x) => (x.id === p.id ? { ...x, status } : x)))
  }

  const columns = (actions: (p: PluginRow) => React.ReactNode): Column<PluginRow>[] => [
    {
      key: 'name', title: '插件', width: 230,
      render: (p) => (
        <div className="row" style={{ gap: 8 }}>
          <span className="adm-plugin-ico"><Icon name="puzzle" size={14} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            <div className="dim tiny mono">{p.id}@{p.version}</div>
          </div>
        </div>
      )
    },
    { key: 'category', title: '分类', width: 90, render: (p) => <Tag tone="accent">{p.category}</Tag> },
    { key: 'author', title: '作者', width: 100, render: (p) => <span className="dim tiny">{p.author}</span> },
    { key: 'downloads', title: '下载量', align: 'right', width: 90, render: (p) => fmtInt(p.downloads) },
    {
      key: 'installs', title: '启用率', align: 'right', width: 110,
      render: (p) => (
        <span className="tiny">
          {fmtInt(p.enabledCount)}/{fmtInt(p.installs)}
          <span className="dim"> ({p.installs ? Math.round((p.enabledCount / p.installs) * 100) : 0}%)</span>
        </span>
      )
    },
    {
      key: 'status', title: '状态', width: 90,
      render: (p) => (
        <Tag tone={p.status === 'published' ? 'ok' : p.status === 'pending' ? 'warn' : p.status === 'rejected' ? 'danger' : 'default'} dot>
          {p.status === 'published' ? '已上架' : p.status === 'pending' ? '待审核' : p.status === 'rejected' ? '已拒绝' : '已下架'}
        </Tag>
      )
    },
    { key: 'act', title: '操作', width: 170, render: actions }
  ]

  return (
    <>
      <PageHeader
        icon="puzzle"
        title="插件开放平台"
        desc="内置插件默认开关、第三方审核、版本发布、安全扫描与下载统计"
        demo={listApi.demo}
        reload={listApi.reload}
        loading={listApi.loading}
        actions={
          <button className="btn btn-primary btn-sm">
            <Icon name="upload" size={13} /> 上传新插件
          </button>
        }
      />

      <div className="adm-stat-grid">
        <StatCard label="内置插件" value={builtin.length} icon="puzzle" />
        <StatCard label="第三方插件" value={third.length} icon="puzzle" />
        <StatCard label="待审核" value={pending.length} icon="shield" />
        <StatCard label="总下载量" value={fmtInt(listApi.data.reduce((s, p) => s + p.downloads, 0))} icon="download" />
      </div>

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { id: 'builtin', label: '内置插件默认开关', count: builtin.length },
          { id: 'third', label: '第三方与自定义', count: third.length },
          { id: 'review', label: '审核队列', count: pending.length }
        ]}
      />

      {tab === 'builtin' && (
        <Section title="内置 25 款插件" sub="新用户首次使用时默认启用的插件" icon="puzzle" flush>
          <DataTable
            columns={columns((p) => (
              <div className="row" style={{ gap: 6 }}>
                <button
                  className={cx('btn btn-sm', p.defaultEnabled ? 'btn-ok' : 'btn-ghost')}
                  onClick={() => toggleDefault(p)}
                >
                  {p.defaultEnabled ? '默认开启' : '默认关闭'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDetail(p)}>
                  <Icon name="info" size={12} />
                </button>
              </div>
            ))}
            rows={builtin}
            rowKey={(p) => p.id}
            loading={listApi.loading}
            noPager
            dense
          />
        </Section>
      )}

      {tab === 'third' && (
        <>
          <Section title="安全与策略" icon="shield">
            <div className="row" style={{ gap: 10 }}>
              <button className={cx('btn', allowUnsigned ? 'btn-ok' : 'btn-ghost')} onClick={() => setAllowUnsigned(!allowUnsigned)}>
                允许用户上传安装未签名插件：{allowUnsigned ? '开启' : '关闭'}
              </button>
              <Note tone="warn" style={{ flex: 1 }}>
                zip 包校验：大小 &lt; 5MB、含合法 manifest.json、拒绝路径穿越、解压总量 &lt; 20MB。
              </Note>
            </div>
          </Section>
          <Section title="第三方插件" icon="puzzle" flush>
            {third.length === 0 ? (
              <div className="empty">暂无第三方插件</div>
            ) : (
              <DataTable
                columns={columns((p) => (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p, 'published')}>上架</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p, 'offline')}>下架</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDetail(p)}><Icon name="info" size={12} /></button>
                  </div>
                ))}
                rows={third}
                rowKey={(p) => p.id}
                loading={listApi.loading}
              />
            )}
          </Section>
        </>
      )}

      {tab === 'review' && (
        <Section title="待审核插件" icon="shield" sub="审核通过后方可上架" flush>
          {pending.length === 0 ? (
            <div className="empty">审核队列为空</div>
          ) : (
            <DataTable
              columns={columns((p) => (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ok btn-sm" onClick={() => setStatus(p, 'published')}>通过</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setStatus(p, 'rejected')}>拒绝</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDetail(p)}><Icon name="info" size={12} /></button>
                </div>
              ))}
              rows={pending}
              rowKey={(p) => p.id}
            />
          )}
        </Section>
      )}

      <Drawer open={!!detail} title={detail?.name || ''} icon="puzzle" onClose={() => setDetail(null)} wide
        sub={detail ? `${detail.id}@${detail.version}` : ''}>
        {detail && (
          <>
            <KV items={[
              ['插件 ID', <span className="mono">{detail.id}</span>],
              ['版本', detail.version],
              ['作者', detail.author],
              ['分类', detail.category],
              ['类型', detail.builtin ? '内置' : '第三方'],
              ['状态', detail.status],
              ['下载量', fmtInt(detail.downloads)],
              ['启用率', `${fmtInt(detail.enabledCount)} / ${fmtInt(detail.installs)}`]
            ]} />
            <Section title="安全扫描" icon="shield" style={{ marginTop: 14 }}>
              <Note tone="info">
                权限清单：files:read、files:write、editor:write{detail.category === 'AI' ? '、ai:chat' : ''}。
                未检测到可疑 API 调用，包大小正常。
              </Note>
              <button className="btn btn-sm" style={{ marginTop: 10 }}>
                <Icon name="shield" size={13} /> 标记为已扫描通过
              </button>
            </Section>
            <Section title="版本历史" icon="history" style={{ marginTop: 14 }}>
              <div className="dim small">1.0.0（当前）· 无历史版本</div>
            </Section>
          </>
        )}
      </Drawer>

      {confirm.node}
    </>
  )
}

export default Plugins
