/**
 * file-recovery — local rotating snapshots (last 30 per file, localStorage
 * ring buffer, written before each save) + a recycle bin for deleted docs.
 *
 * The snapshot hook subscribes to the global `neom:doc-saved` event and keeps
 * a copy of the *previous* content so an accidental overwrite is recoverable.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { EVT } from '@/lib/contracts'
import { useStore } from '@/store'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Search, Spinner, useActiveDoc } from '../ui'
import { fmtTime, truncate } from '../utils'

const SNAP_PREFIX = 'neom.snapshots.'
const MAX_PER_FILE = 30
const TRASH_KEY = 'neom.trash'

export interface Snapshot {
  at: number
  content: string
  size: number
}

export interface TrashItem {
  id: string
  path: string
  content: string
  deleted_at: number
  size: number
}

/* ------------------------------------------------------------ storage API */
export const readSnapshots = (path: string): Snapshot[] => {
  if (!path) return []
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + path)
    const list = raw ? (JSON.parse(raw) as Snapshot[]) : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

const writeSnapshots = (path: string, list: Snapshot[]) => {
  try { localStorage.setItem(SNAP_PREFIX + path, JSON.stringify(list)) } catch {
    // quota: drop the oldest half and retry once
    try { localStorage.setItem(SNAP_PREFIX + path, JSON.stringify(list.slice(0, Math.max(1, Math.floor(list.length / 2))))) } catch { /* give up */ }
  }
}

export const takeSnapshot = (path: string, content: string) => {
  if (!path || !content) return
  const list = readSnapshots(path)
  if (list[0] && list[0].content === content) return
  const next = [{ at: Date.now(), content, size: content.length }, ...list].slice(0, MAX_PER_FILE)
  writeSnapshots(path, next)
}

export const readTrash = (): TrashItem[] => {
  try {
    const raw = localStorage.getItem(TRASH_KEY)
    return raw ? (JSON.parse(raw) as TrashItem[]) : []
  } catch { return [] }
}

const writeTrash = (rows: TrashItem[]) => {
  try { localStorage.setItem(TRASH_KEY, JSON.stringify(rows.slice(0, 120))) } catch { /* quota */ }
}

export const pushTrash = (path: string, content: string) => {
  const rows = readTrash().filter((r) => r.path !== path)
  writeTrash([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, path, content, deleted_at: Date.now(), size: content.length }, ...rows])
}

/* --------------------------------------------------------- auto snapshot */
let timer: number | undefined
let seen = new Map<string, string>()
let listenerOff: (() => void) | null = null

const tickSnapshot = async (ctx: PluginContext) => {
  let path: string | null = null
  try { path = ctx.getActivePath?.() ?? null } catch { path = null }
  if (!path) return
  let content = ''
  try {
    const raw = await ctx.vault.read(path)
    content = typeof raw === 'string' ? raw : raw?.content || ''
  } catch { return }
  const prev = seen.get(path)
  if (prev !== undefined && prev !== content) takeSnapshot(path, prev)
  seen.set(path, content)
}

/**
 * Poll the active document; whenever its content changes, snapshot the
 * previous version. Also fires on `neom:doc-saved`.
 */
export const installAutoSnapshot = (ctx: PluginContext) => {
  uninstallAutoSnapshot()
  void tickSnapshot(ctx)
  timer = window.setInterval(() => { void tickSnapshot(ctx) }, 8000)
  const onSave = () => { void tickSnapshot(ctx) }
  window.addEventListener(EVT.docSaved, onSave)
  listenerOff = () => window.removeEventListener(EVT.docSaved, onSave)
}

export const uninstallAutoSnapshot = () => {
  if (timer) window.clearInterval(timer)
  timer = undefined
  listenerOff?.()
  listenerOff = null
  seen = new Map()
}

/** `plugin.fileRecovery.snapshot` — snapshot the current doc immediately. */
export const snapshotCurrent = async (ctx: PluginContext) => {
  const path = ctx.getActivePath?.()
  if (!path) { ctx.toast('没有打开的文档', 'warn'); return }
  try {
    const raw = await ctx.vault.read(path)
    const content = typeof raw === 'string' ? raw : raw?.content || ''
    takeSnapshot(path, content)
    ctx.toast(`已为 ${path.split('/').pop()} 创建快照`, 'ok')
  } catch (e: any) {
    ctx.toast(e?.message || '快照失败', 'error')
  }
}

/* ------------------------------------------------------------------ panel */
const FileRecoveryPanel: React.FC<PanelProps> = ({ context }) => {
  const { path } = useActiveDoc(context)
  const [tab, setTab] = useState<'snapshots' | 'trash'>('snapshots')
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [trash, setTrash] = useState<TrashItem[]>(readTrash())
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<{ title: string; content: string; restore: () => void } | null>(null)
  const [busy, setBusy] = useState(false)
  const manualPath = useRef('')

  const refresh = useCallback(() => {
    setSnaps(readSnapshots(path || manualPath.current))
    setTrash(readTrash())
  }, [path])

  useEffect(() => { refresh() }, [refresh])

  const restore = async (snap: Snapshot) => {
    if (!path) { context.toast('没有打开的文档', 'warn'); return }
    if (!window.confirm('用该快照覆盖当前文档内容？当前内容会先被存成新快照。')) return
    setBusy(true)
    try {
      const raw = await context.vault.read(path)
      const cur = typeof raw === 'string' ? raw : raw?.content || ''
      takeSnapshot(path, cur)
      await context.vault.write(path, snap.content)
      context.toast('已恢复到选定快照', 'ok')
      refresh()
    } catch (e: any) {
      context.toast(e?.message || '恢复失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const restoreTrash = async (item: TrashItem) => {
    setBusy(true)
    try {
      await context.vault.write(item.path, item.content)
      const next = readTrash().filter((r) => r.id !== item.id)
      writeTrash(next)
      setTrash(next)
      context.toast(`已恢复到 ${item.path}`, 'ok')
      context.refreshTree()
      context.openFile(item.path)
    } catch (e: any) {
      context.toast(e?.message || '恢复失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const filteredTrash = trash.filter((t) => !query.trim() || t.path.toLowerCase().includes(query.toLowerCase()))
  const totalSnaps = (() => {
    let n = 0
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(SNAP_PREFIX)) {
          const arr = JSON.parse(localStorage.getItem(k) || '[]')
          n += Array.isArray(arr) ? arr.length : 0
        }
      }
    } catch { /* ignore */ }
    return n
  })()

  return (
    <Panel>
      <Head
        icon="history"
        title="文件恢复"
        sub={`${snaps.length} 个快照（本文档）· 回收站 ${trash.length}`}
        actions={
          <>
            <Btn icon="camera" title="立即快照" onClick={() => void snapshotCurrent(context)} />
            <Btn icon="refresh" title="刷新" onClick={refresh} />
          </>
        }
      />
      <div className="plg-tabs">
        <button type="button" className={tab === 'snapshots' ? 'on' : ''} onClick={() => setTab('snapshots')}>
          <Icon name="history" size={12} /> 本地快照 <span className="plg-count">{snaps.length}</span>
        </button>
        <button type="button" className={tab === 'trash' ? 'on' : ''} onClick={() => setTab('trash')}>
          <Icon name="trash" size={12} /> 回收站 <span className="plg-count">{trash.length}</span>
        </button>
      </div>
      <div className="plg-pad-x">
        {!path && tab === 'snapshots' && <div className="plg-hint-line"><Icon name="info" size={11} /> 打开一篇文档查看它的快照</div>}
        {path && tab === 'snapshots' && <div className="plg-hint-line"><Icon name="file" size={11} /> {path} · 全库共 {totalSnaps} 个快照</div>}
        {tab === 'trash' && <Search value={query} onChange={setQuery} placeholder="搜索回收站路径…" />}
      </div>
      <div className="plg-scroll">
        {busy && <Spinner text="处理中…" />}
        {tab === 'snapshots' && (
          <>
            {!snaps.length && <Empty icon="history" text={<>还没有快照。<br />启用后每次保存前会自动保留旧内容（每文件最近 {MAX_PER_FILE} 次）。</>} />}
            {snaps.map((s, i) => (
              <div key={s.at + '-' + i} className="plg-snap-row">
                <Icon name={i === 0 ? 'clock' : 'history'} size={13} />
                <div className="grow">
                  <div className="plg-row-title">{fmtTime(s.at)}</div>
                  <div className="plg-row-sub">{(s.size / 1024).toFixed(1)} KB · {truncate(s.content, 70)}</div>
                </div>
                <span className="badge neutral">{i === 0 ? '最近' : `#${i + 1}`}</span>
                <Btn icon="eye" onClick={() => setPreview({ title: fmtTime(s.at), content: s.content, restore: () => void restore(s) })}>预览</Btn>
                <Btn icon="undo" primary onClick={() => void restore(s)}>恢复</Btn>
              </div>
            ))}
          </>
        )}
        {tab === 'trash' && (
          <>
            {!filteredTrash.length && <Empty icon="trash" text="回收站是空的（删除文档时若服务端不可用会保存在这里）" />}
            {filteredTrash.map((t) => (
              <div key={t.id} className="plg-snap-row">
                <Icon name="file" size={13} />
                <div className="grow">
                  <div className="plg-row-title ellipsis">{t.path}</div>
                  <div className="plg-row-sub">{fmtTime(t.deleted_at)} · {(t.size / 1024).toFixed(1)} KB</div>
                </div>
                <Btn icon="eye" onClick={() => setPreview({ title: t.path, content: t.content, restore: () => void restoreTrash(t) })}>预览</Btn>
                <Btn icon="undo" primary onClick={() => void restoreTrash(t)}>恢复</Btn>
                <button type="button" className="plg-icon-btn" title="彻底删除" onClick={() => {
                  const next = readTrash().filter((r) => r.id !== t.id)
                  writeTrash(next)
                  setTrash(next)
                }}><Icon name="x" size={12} /></button>
              </div>
            ))}
          </>
        )}
      </div>
      {preview && (
        <div className="plg-snap-preview">
          <div className="plg-snap-preview-head">
            <Icon name="eye" size={13} />
            <span className="grow ellipsis">预览 · {preview.title}</span>
            <Btn icon="undo" primary onClick={preview.restore}>恢复此版本</Btn>
            <button type="button" className="plg-icon-btn" onClick={() => setPreview(null)}><Icon name="x" size={13} /></button>
          </div>
          <pre className="plg-snap-preview-body">{preview.content}</pre>
        </div>
      )}
      <div className="plg-foot"><Icon name="info" size={11} /><span>快照存于浏览器本地（每文件最近 {MAX_PER_FILE} 次）</span></div>
    </Panel>
  )
}

export default FileRecoveryPanel
