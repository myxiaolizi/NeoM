/**
 * FileTree — vault switcher, recent section and the sortable folder tree.
 * Recent files never repeat in the list below.
 */
import React, { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import type { FileNode } from '@/lib/contracts'
import { buildTree, sortNodes, ancestorsOf, type TreeNode } from './fileUtils'
import { iconForPath } from './iconFor'
import { fileContextMenu, blankContextMenu } from './fileMenus'
import { currentVault, fileService, reloadFileTree } from './fileService'
import { openFile } from '@/features/editor/docRepo'

interface Props {
  /** hide the recent block (the outline-files split view uses compact mode) */
  compact?: boolean
}

const FileTree: React.FC<Props> = ({ compact }) => {
  const files = useStore((s) => s.files)
  const expanded = useStore((s) => s.expanded)
  const toggleExpanded = useStore((s) => s.toggleExpanded)
  const selectedPath = useStore((s) => s.selectedPath)
  const setSelectedPath = useStore((s) => s.setSelectedPath)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const vaults = useStore((s) => s.vaults)
  const activeVault = useStore((s) => s.activeVault)
  const setActiveVault = useStore((s) => s.setActiveVault)
  const recent = useStore((s) => s.recent)
  const tabs = useStore((s) => s.tabs)
  const toast = useStore((s) => s.toast)
  const openContextMenu = useStore((s) => s.openContextMenu)

  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const dirtyPaths = useMemo(() => new Set(tabs.filter((t) => t.dirty).map((t) => t.path)), [tabs])
  const fileByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])

  /* recent files that still exist */
  const recentNodes = useMemo<FileNode[]>(() => {
    if (!settings.recentEnabled || compact) return []
    const out: FileNode[] = []
    for (const p of recent) {
      const node = fileByPath.get(p)
      if (node && !node.is_dir) out.push(node)
      if (out.length >= Math.max(1, settings.recentCount)) break
    }
    return out
  }, [recent, fileByPath, settings.recentEnabled, settings.recentCount, compact])

  const recentSet = useMemo(() => new Set(recentNodes.map((n) => n.path)), [recentNodes])

  /* tree excludes the recent entries so nothing is listed twice */
  const tree = useMemo(() => {
    const pool = files.filter((f) => !recentSet.has(f.path))
    return buildTree(sortNodes(pool, settings.sortKey, settings.sortDir))
  }, [files, recentSet, settings.sortKey, settings.sortDir])

  const openNode = (node: FileNode, opts: { preview?: boolean } = {}) => {
    if (node.is_dir) {
      toggleExpanded(node.path)
      return
    }
    setSelectedPath(node.path)
    openFile(node.path, { preview: opts.preview })
  }

  const onDragStart = (e: React.DragEvent, node: FileNode) => {
    setDragPath(node.path)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', node.path)
    } catch {
      /* ignore */
    }
  }

  const moveInto = async (from: string, targetDir: string) => {
    if (from === targetDir || targetDir.startsWith(from + '/')) return
    const src = fileByPath.get(from)
    if (!src) return
    try {
      const name = from.split('/').pop() || from
      const to = targetDir ? `${targetDir}/${name}` : name
      if (to === from) return
      await fileService.move(currentVault(), from, to)
      const { rebindPath } = await import('@/features/editor/docRepo')
      if (!src.is_dir) rebindPath(from, to)
      toggleExpanded(targetDir)
      await reloadFileTree(true)
      toast({ kind: 'ok', text: '已移动到 ' + (targetDir || '根目录') })
    } catch (e) {
      toast({ kind: 'error', text: '移动失败：' + ((e as Error)?.message || '') })
    }
  }

  const reorderFolder = async (from: string, to: string, before: boolean) => {
    const siblings = files.filter((f) => f.is_dir && f.parent === (fileByPath.get(to)?.parent ?? ''))
    const order = siblings.map((f, i) => ({ path: f.path, order: i }))
    const fromIdx = order.findIndex((o) => o.path === from)
    const toIdx = order.findIndex((o) => o.path === to)
    if (fromIdx < 0 || toIdx < 0) return
    const [moved] = order.splice(fromIdx, 1)
    order.splice(before ? toIdx : toIdx + 1, 0, moved)
    try {
      await fileService.persistSort(currentVault(), order)
      const orderMap = new Map(order.map((o) => [o.path, o.order]))
      useStore.getState().setFiles(files.map((f) => (orderMap.has(f.path) ? { ...f, order: orderMap.get(f.path) } : f)))
    } catch {
      toast({ kind: 'warn', text: '排序未能保存到云端，仅本地生效' })
    }
  }

  const renderRow = (item: TreeNode): React.ReactNode => {
    const node = item.node
    const isOpen = !!expanded[node.path]
    const isSelected = selectedPath === node.path
    const isDrop = dropTarget === node.path && dragPath !== node.path
    return (
      <React.Fragment key={node.path}>
        <div
          className={'tree-node' + (isSelected ? ' selected' : '') + (isDrop ? ' drag-over' : '') + (dirtyPaths.has(node.path) ? ' dirty' : '')}
          style={{ paddingLeft: 2 + item.depth * 13 }}
          draggable
          title={node.path}
          onClick={() => openNode(node)}
          onDoubleClick={() => !node.is_dir && openFile(node.path, { preview: false })}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSelectedPath(node.path)
            fileContextMenu(node, e.clientX, e.clientY)
          }}
          onDragStart={(e) => onDragStart(e, node)}
          onDragEnd={() => { setDragPath(null); setDropTarget(null) }}
          onDragOver={(e) => {
            if (!dragPath) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(node.path)
          }}
          onDragLeave={() => setDropTarget((cur) => (cur === node.path ? null : cur))}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const from = dragPath || e.dataTransfer.getData('text/plain')
            setDragPath(null)
            setDropTarget(null)
            if (!from || from === node.path) return
            if (node.is_dir) void moveInto(from, node.path)
            else if (from !== node.path) {
              const sameParent = (fileByPath.get(from)?.parent || '') === (node.parent || '')
              if (sameParent) void reorderFolder(from, node.path, true)
              else void moveInto(from, node.parent || '')
            }
          }}
        >
          <span
            className="twisty"
            onClick={(e) => {
              e.stopPropagation()
              if (node.is_dir) toggleExpanded(node.path)
            }}
          >
            {node.is_dir ? <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} /> : null}
          </span>
          <Icon name={node.is_dir ? (isOpen ? 'folder-open' : 'folder') : iconForPath(node.path)} size={14} />
          <span className="node-name">{node.name}</span>
          {dirtyPaths.has(node.path) && <span className="tab-dot" />}
        </div>
        {node.is_dir && isOpen && item.children.map(renderRow)}
      </React.Fragment>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {!compact && (
        <div style={{ padding: '0 6px 4px' }}>
          <button
            className="vault-select"
            title="切换仓库"
            onClick={(e) => {
              e.preventDefault()
              openContextMenu({
                x: e.clientX,
                y: e.clientY,
                title: '仓库',
                items: vaults.map((v) => ({
                  id: String(v.id),
                  label: (activeVault === String(v.id) ? '✓ ' : '　') + v.name,
                  icon: v.kind === 'cloud' ? 'cloud' : 'hard-drive',
                  run: () => {
                    setActiveVault(String(v.id))
                    void reloadFileTree(true)
                  }
                }))
              })
            }}
          >
            <Icon
              name={vaults.find((v) => String(v.id) === activeVault)?.kind === 'cloud' ? 'cloud' : 'hard-drive'}
              size={13}
            />
            <span className="grow ellipsis" style={{ flex: 1, textAlign: 'left' }}>
              {vaults.find((v) => String(v.id) === activeVault)?.name || '云端仓库'}
            </span>
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
      )}

      {recentNodes.length > 0 && (
        <>
          <div className="sb-section">
            <Icon name="clock" size={11} />
            最近打开
          </div>
          {recentNodes.map((n) => (
            <div
              key={'recent-' + n.path}
              className={'tree-node' + (selectedPath === n.path ? ' selected' : '')}
              style={{ paddingLeft: 2 }}
              title={n.path}
              onClick={() => openNode(n)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                fileContextMenu(n, e.clientX, e.clientY)
              }}
            >
              <span className="twisty" />
              <Icon name={iconForPath(n.path)} size={14} />
              <span className="node-name">{n.name}</span>
              {dirtyPaths.has(n.path) && <span className="tab-dot" />}
            </div>
          ))}
          <div className="sb-section">
            <Icon name="folder" size={11} />
            全部文件
          </div>
        </>
      )}

      <div
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.tree-node')) return
          e.preventDefault()
          blankContextMenu(e.clientX, e.clientY)
        }}
        onDragOver={(e) => {
          if (dragPath) e.preventDefault()
        }}
        onDrop={(e) => {
          const from = dragPath || e.dataTransfer.getData('text/plain')
          setDragPath(null)
          setDropTarget(null)
          if (from) void moveInto(from, '')
        }}
      >
        {tree.length ? (
          tree.map(renderRow)
        ) : (
          <div className="tree-empty">
            还没有文件
            <div style={{ marginTop: 8 }}>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const res = await fileService.create(currentVault())
                  await reloadFileTree(true)
                  openFile(res.path, { preview: false })
                }}
              >
                新建第一篇笔记
              </button>
            </div>
          </div>
        )}
      </div>

      {compact && (
        <button
          className="btn btn-sm btn-ghost"
          style={{ margin: '4px 6px' }}
          onClick={() => {
            const st = useStore.getState()
            for (const p of ancestorsOf(st.selectedPath || '')) st.toggleExpanded(p)
            updateSettings({ recentEnabled: st.settings.recentEnabled })
          }}
        >
          <Icon name="chevron-down" size={13} />
          全部展开
        </button>
      )}
    </div>
  )
}

export default FileTree
