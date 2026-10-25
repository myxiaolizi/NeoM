/**
 * bookmarks — favourites for files, folders, search queries and headings.
 * Stored per plugin (localStorage) so the panel works offline.
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useStore } from '@/store'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Row, Search, Segmented } from '../ui'
import { fmtTime, readJson, uid, writeJson } from '../utils'

type Kind = 'file' | 'folder' | 'search' | 'heading'

interface Bookmark {
  id: string
  kind: Kind
  title: string
  target: string
  /** heading offset when kind = heading */
  offset?: number
  created_at: string
  note?: string
}

const LS_KEY = 'neom.bookmarks'

export const loadBookmarks = (): Bookmark[] => readJson<Bookmark[]>(LS_KEY, [])
const saveBookmarks = (rows: Bookmark[]) => writeJson(LS_KEY, rows)

export const addBookmark = (ctx: PluginContext, bm: Omit<Bookmark, 'id' | 'created_at'>) => {
  const rows = loadBookmarks()
  if (rows.some((r) => r.kind === bm.kind && r.target === bm.target)) {
    ctx.toast('该位置已在书签中', 'info')
    return
  }
  saveBookmarks([{ ...bm, id: uid('bm-'), created_at: new Date().toISOString() }, ...rows])
  ctx.toast(`已收藏：${bm.title}`, 'ok')
}

/** `plugin.bookmarks.add` — bookmark the current doc or its selection heading. */
export const addCurrent = (ctx: PluginContext) => {
  const s = useStore.getState()
  const path = ctx.getActivePath?.() || s.tabs.find((t) => t.id === s.activeTabId)?.path
  if (!path) { ctx.toast('没有打开的文档', 'warn'); return }
  const content = ctx.getActiveContent() || ''
  const heading = content.split('\n').find((l) => /^#{1,6}\s+/.test(l))
  addBookmark(ctx, {
    kind: 'file',
    title: (path.split('/').pop() || path).replace(/\.\w+$/, ''),
    target: path,
    note: heading ? heading.replace(/^#{1,6}\s+/, '') : undefined
  })
}

const ICONS: Record<Kind, string> = { file: 'file-text', folder: 'folder', search: 'search', heading: 'headings' }
const LABELS: Record<Kind, string> = { file: '文件', folder: '文件夹', search: '搜索', heading: '标题' }

const BookmarksPanel: React.FC<PanelProps> = ({ context }) => {
  const [rows, setRows] = useState<Bookmark[]>(loadBookmarks)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Kind>('all')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ kind: Kind; title: string; target: string }>({ kind: 'search', title: '', target: '' })
  const recent = useStore((s) => s.recent)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => (filter === 'all' || r.kind === filter) && (!q || r.title.toLowerCase().includes(q) || r.target.toLowerCase().includes(q)))
  }, [rows, query, filter])

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id)
    setRows(next)
    saveBookmarks(next)
  }

  const open = (bm: Bookmark) => {
    if (bm.kind === 'search') {
      useStore.getState().setSearchQuery(bm.target)
      context.toast(`已填入搜索词：${bm.target}`, 'info')
      return
    }
    if (bm.kind === 'folder') {
      useStore.getState().toggleExpanded(bm.target)
      context.toast(`已定位到文件夹 ${bm.target}`, 'info')
      return
    }
    context.openFile(bm.target)
    if (bm.offset !== undefined) {
      setTimeout(() => window.dispatchEvent(new CustomEvent('neom:outline-jump', { detail: { offset: bm.offset } })), 240)
    }
  }

  const submit = () => {
    if (!form.title.trim() || !form.target.trim()) { context.toast('标题和路径都要填', 'warn'); return }
    addBookmark(context, { kind: form.kind, title: form.title.trim(), target: form.target.trim() })
    setRows(loadBookmarks())
    setForm({ kind: 'search', title: '', target: '' })
    setAdding(false)
  }

  return (
    <Panel>
      <Head
        icon="bookmark"
        title="书签"
        sub={`${rows.length} 个收藏`}
        actions={<Btn icon="plus" title="手动添加" onClick={() => setAdding((v) => !v)} />}
      />
      <div className="plg-pad-x col" style={{ gap: 6 }}>
        <Search value={query} onChange={setQuery} placeholder="筛选书签…" />
        <Segmented
          value={filter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'file', label: '文件' },
            { value: 'search', label: '搜索' },
            { value: 'heading', label: '标题' },
            { value: 'folder', label: '文件夹' }
          ]}
          onChange={(v) => setFilter(v as 'all' | Kind)}
        />
      </div>
      {adding && (
        <div className="plg-pad col">
          <div className="row">
            <select className="select" style={{ width: 96 }} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as Kind }))}>
              {(['file', 'folder', 'search', 'heading'] as Kind[]).map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
            </select>
            <input className="input" placeholder="标题" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="row">
            <input className="input" placeholder={form.kind === 'search' ? '搜索关键词' : '路径（如 日记/2024-01-01.md）'} value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} />
            <Btn icon="check" primary onClick={submit}>添加</Btn>
          </div>
        </div>
      )}
      <div className="plg-scroll">
        {!visible.length && <Empty icon="bookmark" text={rows.length ? '没有匹配的书签' : '还没有书签。打开文档后用命令「收藏当前位置」'} />}
        {visible.map((bm) => (
          <div key={bm.id} className="plg-bm-row">
            <Icon name={ICONS[bm.kind]} size={13} />
            <div className="grow" onClick={() => open(bm)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(bm) }}>
              <div className="plg-row-title ellipsis">{bm.title}</div>
              <div className="plg-row-sub ellipsis">
                <span className="badge neutral" style={{ height: 15, marginRight: 5 }}>{LABELS[bm.kind]}</span>
                {bm.target}{bm.note ? ` · ${bm.note}` : ''}
              </div>
            </div>
            <span className="plg-cell-dim tiny">{fmtTime(bm.created_at).slice(5, 16)}</span>
            <button type="button" className="plg-icon-btn" title="打开" onClick={() => open(bm)}><Icon name="external" size={12} /></button>
            <button type="button" className="plg-icon-btn" title="删除" onClick={() => remove(bm.id)}><Icon name="trash" size={12} /></button>
          </div>
        ))}
        {!!recent.length && !rows.length && (
          <div className="plg-suggest">
            <div className="plg-sub-title">建议收藏（最近打开）</div>
            {recent.slice(0, 6).map((p) => (
              <Row
                key={p}
                icon="file-text"
                title={p.split('/').pop() || p}
                sub={p}
                meta={<Icon name="plus" size={12} />}
                onClick={() => { addBookmark(context, { kind: 'file', title: (p.split('/').pop() || p).replace(/\.\w+$/, ''), target: p }); setRows(loadBookmarks()) }}
              />
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

export default BookmarksPanel
