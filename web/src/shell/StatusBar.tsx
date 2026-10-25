/**
 * StatusBar — 27px footer: full path chip, word count, history, view switch,
 * plus the ribbon when it is configured to live in the status bar.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { fmtPathForStatus, currentAbsPath, revealCurrentFile, copyCurrentPath } from '@/features/files/pathActions'
import Ribbon from './Ribbon'

const STATUS_ITEMS_META = [
  { key: 'wordcount', label: '字数统计' },
  { key: 'history', label: '历史版本' },
  { key: 'viewSwitch', label: '视图方式切换' }
] as const

const VIEW_LABEL: Record<string, string> = {
  wysiwyg: '所见即所得',
  source: '源码',
  split: '对照',
  preview: '阅读'
}

const StatusBar: React.FC = () => {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const stats = useStore((s) => s.stats)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const openContextMenu = useStore((s) => s.openContextMenu)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const setLeftView = useStore((s) => s.setLeftView)
  const ribbonVisible = useStore((s) => s.ribbonVisible)
  const ribbonPosition = useStore((s) => s.settings.ribbonPosition)
  const toast = useStore((s) => s.toast)
  const [absPath, setAbsPath] = useState<string | null>(null)

  const tab = tabs.find((t) => t.id === activeTabId) || null

  useEffect(() => {
    let alive = true
    void (async () => {
      const p = await currentAbsPath()
      if (alive) setAbsPath(p)
    })()
    return () => {
      alive = false
    }
  }, [tab?.path])

  const openHistory = useCallback(() => {
    if (!tab) return
    toggleLeft(true)
    setLeftView('files')
    setLeftPanel('history')
  }, [setLeftPanel, setLeftView, tab, toggleLeft])

  const onStatusContext = (e: React.MouseEvent) => {
    e.preventDefault()
    const si = settings.statusItems
    const too = (k: keyof typeof si) => () => updateSettings({ statusItems: { ...si, [k]: !si[k] } })
    openContextMenu({
      x: e.clientX,
      y: e.clientY - 8,
      items: [
        {
          id: 'reveal',
          label: '打开文件所在文件夹',
          icon: 'folder-open',
          disabled: !tab || !absPath,
          run: () => void revealCurrentFile()
        },
        {
          id: 'copyPath',
          label: '复制文件路径',
          icon: 'copy',
          disabled: !tab,
          run: () => void copyCurrentPath()
        },
        { id: 'd0', divider: true },
        {
          id: 'items',
          label: '状态栏显示项',
          icon: 'sliders',
          submenu: STATUS_ITEMS_META.map((it) => ({
            id: it.key,
            label: (si[it.key] ? '✓ ' : '　') + it.label,
            run: too(it.key)
          }))
        },
        { id: 'd1', divider: true },
        {
          id: 'sync',
          label: '立即同步',
          icon: 'sync',
          run: async () => {
            const { fileService, currentVault } = await import('@/features/files/fileService')
            try {
              const res = await fileService.sync(currentVault())
              toast({ kind: 'ok', text: `同步完成：拉取 ${res?.pulled ?? 0}，推送 ${res?.pushed ?? 0}` })
              const { reloadFileTree } = await import('@/features/files/fileService')
              await reloadFileTree(true)
            } catch {
              toast({ kind: 'warn', text: '当前处于离线模式，无法同步' })
            }
          }
        }
      ]
    })
  }

  return (
    <div className="statusbar" onContextMenu={onStatusContext}>
      {ribbonVisible && ribbonPosition === 'status-left' && <Ribbon inline />}

      {tab ? (
        <button
          className="sb-item sb-path"
          title={absPath || tab.path}
          onClick={() => void revealCurrentFile()}
        >
          {fmtPathForStatus(absPath, tab.path)}
        </button>
      ) : (
        <span className="sb-item dim">未打开文档</span>
      )}

      <div className="grow" style={{ flex: 1 }} />

      {settings.statusItems.wordcount && (
        <span className="sb-item" title={`${stats.paragraphs} 段 · ${stats.lines} 行 · 约 ${stats.readingMinutes} 分钟读完`}>
          <Icon name="file-text" size={12} />
          {stats.words.toLocaleString()} 字
        </span>
      )}

      {settings.statusItems.history && (
        <button className="sb-item" title="查看历史版本" onClick={openHistory} disabled={!tab}>
          <Icon name="history" size={12} />
          历史
        </button>
      )}

      {settings.statusItems.viewSwitch && (
        <button
          className="sb-item"
          title="切换视图模式 (Ctrl+E)"
          onClick={() => {
            const order = ['wysiwyg', 'source', 'split', 'preview'] as const
            const next = order[(order.indexOf(viewMode) + 1) % order.length]
            setViewMode(next)
          }}
        >
          <Icon name="eye" size={12} />
          {VIEW_LABEL[viewMode] || viewMode}
        </button>
      )}

      {ribbonVisible && ribbonPosition === 'status-right' && <Ribbon inline />}
    </div>
  )
}

export default StatusBar
