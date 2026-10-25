/**
 * workspace — save / restore named layout snapshots (tabs, sidebars, view mode,
 * split pane, left/right panels). Stored locally and mirrored to the server
 * when available.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useStore } from '@/store'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Modal, Panel } from '../ui'
import { fmtTime, readJson, uid, writeJson } from '../utils'

export interface WorkspaceSnapshot {
  id: string
  name: string
  created_at: string
  tabs: { path: string; name: string }[]
  activePath: string | null
  leftVisible: boolean
  rightVisible: boolean
  ribbonVisible: boolean
  leftPanel: string | null
  rightPanel: string
  viewMode: string
  pageWidth: string
  splitMode: string
  splitPath: string | null
}

const LS_KEY = 'neom.workspaces'

export const captureLayout = (name: string): WorkspaceSnapshot => {
  const s = useStore.getState()
  const main = s.tabs.filter((t) => t.group !== 'side')
  const active = s.tabs.find((t) => t.id === s.activeTabId)
  const split = s.tabs.find((t) => t.id === s.splitTabId)
  return {
    id: uid('ws-'),
    name: name || `工作区 ${new Date().toLocaleTimeString()}`,
    created_at: new Date().toISOString(),
    tabs: main.map((t) => ({ path: t.path, name: t.name })),
    activePath: active?.path || null,
    leftVisible: s.leftVisible,
    rightVisible: s.rightVisible,
    ribbonVisible: s.ribbonVisible,
    leftPanel: s.leftPanel,
    rightPanel: s.rightPanel,
    viewMode: s.viewMode,
    pageWidth: s.pageWidth,
    splitMode: s.splitMode,
    splitPath: split?.path || null
  }
}

export const applyLayout = async (ctx: PluginContext, snap: WorkspaceSnapshot) => {
  const s = useStore.getState()
  s.closeAllTabs()
  for (const t of snap.tabs) s.openTab(t.path, { name: t.name })
  if (snap.activePath) s.openTab(snap.activePath)
  s.toggleLeft(snap.leftVisible)
  s.toggleRight(snap.rightVisible)
  s.toggleRibbon(snap.ribbonVisible)
  s.setLeftPanel(snap.leftPanel)
  s.setRightPanel(snap.rightPanel)
  s.setViewMode(snap.viewMode as any)
  s.setPageWidth(snap.pageWidth as any)
  s.updateSettings({ leftViewMode: (snap.leftPanel === 'outline' ? 'outline' : 'files') as any })
  if (snap.splitMode !== 'none' && snap.splitPath) {
    s.setSplitMode(snap.splitMode as any)
    s.openTab(snap.splitPath, { group: 'side' })
    const sideTab = useStore.getState().tabs.find((t) => t.group === 'side' && t.path === snap.splitPath)
    if (sideTab) s.setSplitTab(sideTab.id)
  } else {
    s.setSplitMode('none')
    s.setSplitTab(null)
  }
  ctx.toast(`已恢复工作区「${snap.name}」`, 'ok')
}

const readLocal = (): WorkspaceSnapshot[] => readJson<WorkspaceSnapshot[]>(LS_KEY, [])

export const saveQuick = async (ctx: PluginContext) => {
  const name = window.prompt('工作区名称', `${new Date().toLocaleDateString()} 布局`)
  if (!name) return
  const snap = captureLayout(name)
  const list = [snap, ...readLocal()]
  writeJson(LS_KEY, list)
  try { await ctx.api.post('/api/workspace/save', snap) } catch { /* server optional */ }
  ctx.toast(`已保存工作区「${name}」`, 'ok')
}

const WorkspacePanel: React.FC<PanelProps> = ({ context }) => {
  const [list, setList] = useState<WorkspaceSnapshot[]>(readLocal)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<WorkspaceSnapshot | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const refresh = useCallback(async () => {
    let rows = readLocal()
    try {
      const remote = await context.api.get('/api/workspace/list')
      if (Array.isArray(remote) && remote.length) {
        const byId = new Map<string, WorkspaceSnapshot>()
        rows.forEach((r) => byId.set(r.id, r))
        remote.forEach((r: WorkspaceSnapshot) => { if (r?.id && !byId.has(r.id)) byId.set(r.id, r) })
        rows = Array.from(byId.values()).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        writeJson(LS_KEY, rows)
      }
    } catch { /* offline */ }
    setList(rows)
  }, [context])

  useEffect(() => { void refresh() }, [refresh])

  const save = async () => {
    const snap = captureLayout(name.trim() || `${new Date().toLocaleString()} 布局`)
    const next = [snap, ...list]
    setList(next)
    writeJson(LS_KEY, next)
    setName('')
    try { await context.api.post('/api/workspace/save', snap) } catch { /* optional */ }
    context.toast('工作区已保存', 'ok')
  }

  const remove = (id: string) => {
    const next = list.filter((w) => w.id !== id)
    setList(next)
    writeJson(LS_KEY, next)
    context.toast('已删除工作区', 'ok')
    void context.api.post('/api/workspace/delete', { id }).catch(() => {})
  }

  return (
    <Panel>
      <Head icon="layers" title="工作区" sub={`${list.length} 个布局快照`} actions={<Btn icon="refresh" onClick={refresh} />} />
      <div className="plg-pad col">
        <div className="row">
          <input className="input" placeholder="新工作区名称" value={name} onChange={(e) => setName(e.target.value)} />
          <Btn icon="save" primary onClick={save}>保存当前布局</Btn>
        </div>
        <div className="plg-hint-line">
          <Icon name="info" size={11} />
          保存内容：标签页、侧栏可见性、视图模式、页宽、分屏、左右面板
        </div>
      </div>
      <div className="plg-scroll">
        {!list.length && <Empty icon="layers" text="还没有保存过工作区" />}
        {list.map((w) => (
          <div key={w.id} className="plg-ws-row">
            <Icon name="layers" size={13} />
            <div className="grow">
              <div className="plg-row-title ellipsis">{w.name}</div>
              <div className="plg-row-sub">{w.tabs.length} 个标签 · {fmtTime(w.created_at)}{w.splitMode !== 'none' ? ' · 分屏' : ''}</div>
            </div>
            <Btn icon="play" onClick={() => void applyLayout(context, w)}>恢复</Btn>
            <button type="button" className="plg-icon-btn" title="重命名" onClick={() => { setRenaming(w); setRenameValue(w.name) }}>
              <Icon name="edit" size={12} />
            </button>
            <button type="button" className="plg-icon-btn" title="删除" onClick={() => remove(w.id)}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>
      {renaming && (
        <Modal
          title="重命名工作区"
          icon="edit"
          width={420}
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Btn onClick={() => setRenaming(null)}>取消</Btn>
              <Btn icon="check" primary onClick={() => {
                const next = list.map((w) => (w.id === renaming.id ? { ...w, name: renameValue.trim() || w.name } : w))
                setList(next)
                writeJson(LS_KEY, next)
                setRenaming(null)
                context.toast('已重命名', 'ok')
              }}>保存</Btn>
            </>
          }
        >
          <input className="input" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
        </Modal>
      )}
    </Panel>
  )
}

export default WorkspacePanel
