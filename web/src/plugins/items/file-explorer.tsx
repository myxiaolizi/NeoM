/**
 * file-explorer — enhanced file tree: multi-select, batch operations,
 * extension filter, sorting, collapse-all, multi-vault switching, recent list.
 * (The shell may render its own simple tree; this is the power-user version.)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useStore } from '@/store'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Row, Search, Segmented, Spinner } from '../ui'
import { extOf, isDoc, relativeTime, truncate } from '../utils'

interface Entry {
  path: string
  name: string
  dir: string
  isDir: boolean
  size: number
  mtime: string
}

const toEntries = (rows: any[]): Entry[] =>
  (rows || []).map((r) => {
    const path = r.path || r.id || ''
    return {
      path,
      name: r.name || path.split('/').pop() || path,
      dir: path.split('/').slice(0, -1).join('/'),
      isDir: !!(r.is_dir || r.isDir),
      size: Number(r.size) || 0,
      mtime: String(r.mtime || '')
    }
  })

type SortKey = 'name' | 'mtime' | 'size'

const FileExplorerPanel: React.FC<PanelProps> = ({ context }) => {
  const vaults = useStore((s) => s.vaults)
  const activeVault = useStore((s) => s.activeVault)
  const setActiveVault = useStore((s) => s.setActiveVault)
  const recent = useStore((s) => s.recent)
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [asc, setAsc] = useState(true)
  const [ext, setExt] = useState('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true })
  const [selected, setSelected] = useState<string[]>([])
  const [tab, setTab] = useState<'tree' | 'recent'>('tree')
  const anchor = useRef<number>(-1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(toEntries(await context.vault.list()))
    } catch (e: any) {
      context.toast(e?.message || '读取文件列表失败', 'error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [context])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const onTree = () => { void load() }
    window.addEventListener('neom:file-tree-changed', onTree)
    window.addEventListener('neom:doc-saved', onTree)
    return () => {
      window.removeEventListener('neom:file-tree-changed', onTree)
      window.removeEventListener('neom:doc-saved', onTree)
    }
  }, [load])

  const exts = useMemo(() => Array.from(new Set(rows.filter((r) => !r.isDir).map((r) => extOf(r.path)).filter(Boolean))).sort(), [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (r.isDir) return true
      if (ext !== 'all' && extOf(r.path) !== ext) return false
      if (q && !r.path.toLowerCase().includes(q)) return false
      return isDoc(r.path) || /\.(canvas|html?|json|png|jpe?g|gif|mp3|wav|mp4|pdf)$/i.test(r.path)
    })
  }, [rows, query, ext])

  const sortFn = (a: Entry, b: Entry) => {
    let r = 0
    if (sort === 'name') r = a.name.localeCompare(b.name, 'zh-Hans-CN')
    else if (sort === 'mtime') r = (a.mtime || '').localeCompare(b.mtime || '')
    else r = a.size - b.size
    return asc ? r : -r
  }

  const childrenOf = (dir: string) =>
    visible.filter((r) => r.dir === dir).sort((a, b) => (a.isDir === b.isDir ? sortFn(a, b) : a.isDir ? -1 : 1))

  const flat = useMemo(() => {
    const out: { entry: Entry; depth: number }[] = []
    const walk = (dir: string, depth: number) => {
      for (const e of childrenOf(dir)) {
        out.push({ entry: e, depth })
        if (e.isDir && expanded[e.path]) walk(e.path, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [visible, expanded, sort, asc])

  const toggle = (path: string) => setExpanded((s) => ({ ...s, [path]: !s[path] }))

  const select = (e: React.MouseEvent, idx: number, path: string) => {
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, idx), Math.max(anchor.current, idx)]
      setSelected(flat.slice(a, b + 1).map((x) => x.entry.path))
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((s) => (s.includes(path) ? s.filter((p) => p !== path) : [...s, path]))
      anchor.current = idx
    } else {
      setSelected([path])
      anchor.current = idx
    }
  }

  const removeSelected = async () => {
    if (!selected.length) return
    if (!window.confirm(`确定删除 ${selected.length} 项？删除后可在「文件恢复」插件中找回（若服务端启用了回收站）。`)) return
    const target = selected
    setSelected([])
    for (const p of target) {
      try {
        if (context.vault.remove) await context.vault.remove(p)
        else await context.api.post('/api/files/delete', { path: p })
      } catch (e: any) {
        context.toast(`删除 ${p} 失败：${e?.message || ''}`, 'error')
      }
    }
    context.toast(`已删除 ${target.length} 项`, 'ok')
    context.refreshTree()
    void load()
  }

  const batchOpen = () => {
    selected.filter((p) => isDoc(p)).slice(0, 12).forEach((p) => context.openFile(p))
    if (!selected.some((p) => isDoc(p))) context.toast('没有可打开的文档', 'warn')
  }

  const newNote = async () => {
    const dir = selected.find((p) => rows.find((r) => r.path === p && r.isDir)) || ''
    try {
      const p = await context.createFile(`未命名-${Date.now().toString().slice(-5)}.md`, '# 新笔记\n\n', dir)
      context.openFile(p)
      context.refreshTree()
      void load()
    } catch (e: any) {
      context.toast(e?.message || '创建失败', 'error')
    }
  }

  const collapseAll = () => setExpanded({ '': true })
  const expandAll = () => setExpanded(Object.fromEntries(rows.filter((r) => r.isDir).map((r) => [r.path, true])))

  return (
    <Panel>
      <Head
        icon="folder"
        title="文件列表"
        sub={`${rows.filter((r) => !r.isDir).length} 个文件 · ${selected.length ? `已选 ${selected.length}` : '未选择'}`}
        actions={
          <>
            <Btn icon="plus" title="新建笔记" onClick={newNote} />
            <Btn icon="refresh" title="刷新" onClick={load} />
          </>
        }
      />
      <div className="plg-pad-x col" style={{ gap: 6 }}>
        <Search value={query} onChange={setQuery} placeholder="按路径过滤…" />
        <div className="row">
          <Segmented value={tab} options={[{ value: 'tree', label: '树', icon: 'folder' }, { value: 'recent', label: '最近', icon: 'clock' }]} onChange={(v) => setTab(v as 'tree' | 'recent')} />
          <span className="grow" />
          <select className="select" style={{ width: 92, height: 26 }} value={ext} onChange={(e) => setExt(e.target.value)}>
            <option value="all">全部类型</option>
            {exts.map((x) => <option key={x} value={x}>.{x}</option>)}
          </select>
          <button type="button" className="plg-icon-btn" title="切换排序" onClick={() => {
            if (sort === 'name') setSort('mtime')
            else if (sort === 'mtime') setSort('size')
            else setSort('name')
          }}>
            <Icon name={asc ? 'sort-asc' : 'sort-desc'} size={13} />
          </button>
          <button type="button" className="plg-icon-btn" title="切换升降序" onClick={() => setAsc((v) => !v)}>
            <Icon name="sort" size={13} />
          </button>
        </div>
        {vaults.length > 1 && (
          <select className="select" style={{ height: 26 }} value={activeVault} onChange={(e) => { setActiveVault(e.target.value); setTimeout(load, 120) }}>
            {vaults.map((v) => <option key={v.id} value={v.id}>{v.name}（{v.kind === 'cloud' ? '云端' : '本地'}）</option>)}
          </select>
        )}
      </div>
      {!!selected.length && (
        <div className="plg-batchbar">
          <span className="small">已选 {selected.length}</span>
          <Btn icon="file-text" onClick={batchOpen}>打开</Btn>
          <Btn icon="trash" danger onClick={removeSelected}>删除</Btn>
          <Btn icon="x" onClick={() => setSelected([])}>取消</Btn>
        </div>
      )}
      <div className="plg-scroll" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected([]) }}>
        {loading && <Spinner text="读取仓库…" />}
        {!loading && tab === 'tree' && (
          <>
            <div className="plg-tree-actions">
              <Btn icon="chevron-down" onClick={expandAll}>展开全部</Btn>
              <Btn icon="chevron-up" onClick={collapseAll}>折叠全部</Btn>
            </div>
            {!flat.length && <Empty icon="folder" text={query ? '没有匹配的文件' : '仓库还是空的'} />}
            {flat.map(({ entry, depth }, idx) => (
              <div key={entry.path} className="plg-tree-row-wrap">
                <div
                  className={'plg-tree-row' + (selected.includes(entry.path) ? ' on' : '')}
                  style={{ paddingLeft: 4 + depth * 13 }}
                  onClick={(e) => select(e, idx, entry.path)}
                  onDoubleClick={() => (entry.isDir ? toggle(entry.path) : context.openFile(entry.path))}
                  title={entry.path}
                >
                  <span className="plg-outline-caret" onClick={(e) => { e.stopPropagation(); if (entry.isDir) toggle(entry.path) }}>
                    {entry.isDir && <Icon name={expanded[entry.path] ? 'chevron-down' : 'chevron-right'} size={11} />}
                  </span>
                  <Icon name={entry.isDir ? (expanded[entry.path] ? 'folder-open' : 'folder') : 'file-text'} size={13} />
                  <span className="grow ellipsis">{entry.name}</span>
                  {!entry.isDir && <span className="plg-cell-dim tiny">{relativeTime(entry.mtime)}</span>}
                </div>
              </div>
            ))}
          </>
        )}
        {!loading && tab === 'recent' && (
          <>
            {!recent.length && <Empty icon="clock" text="还没有最近打开的文档" />}
            {recent.map((p) => (
              <Row key={p} icon="clock" title={p.split('/').pop() || p} sub={truncate(p, 60)} onClick={() => context.openFile(p)} />
            ))}
          </>
        )}
      </div>
      <div className="plg-foot">
        <Icon name="info" size={11} />
        <span>Ctrl/⌘ 多选 · Shift 连选 · 双击打开</span>
      </div>
    </Panel>
  )
}

export default FileExplorerPanel
