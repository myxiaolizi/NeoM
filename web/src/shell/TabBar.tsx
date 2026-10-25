/**
 * TabBar — 50px tall tab strip with sidebar toggle, drag reorder,
 * double-click / middle-click close and a full context menu.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, type Tab } from '@/store'
import { Icon } from '@/components/Icon'
import { iconForPath } from '@/features/files/iconFor'

const TabBar: React.FC = () => {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const leftVisible = useStore((s) => s.leftVisible)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const toggleRight = useStore((s) => s.toggleRight)
  const rightVisible = useStore((s) => s.rightVisible)
  const reorderTabs = useStore((s) => s.reorderTabs)
  const openContextMenu = useStore((s) => s.openContextMenu)
  const closeAllTabs = useStore((s) => s.closeAllTabs)
  const closeOtherTabs = useStore((s) => s.closeOtherTabs)
  const setViewMode = useStore((s) => s.setViewMode)
  const setSplitMode = useStore((s) => s.setSplitMode)
  const splitMode = useStore((s) => s.splitMode)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [dropSide, setDropSide] = useState<'left' | 'right'>('left')
  const scrollRef = useRef<HTMLDivElement>(null)

  /** close through the dirty-saving path so no edit is ever silently dropped */
  const closeOne = useCallback((id: string) => {
    void (async () => {
      const { closeTabSafely } = await import('@/features/editor/tabMenu')
      closeTabSafely(id)
    })()
  }, [])

  /* keep the active tab visible */
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('.tab.active')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  const openTabMenu = useCallback(
    async (e: React.MouseEvent, tab: Tab) => {
      e.preventDefault()
      e.stopPropagation()
      const { tabMenuItems } = await import('@/features/editor/tabMenu')
      openContextMenu({ x: e.clientX, y: e.clientY, title: tab.name, items: tabMenuItems(tab) })
    },
    [openContextMenu]
  )

  const moreMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      openContextMenu({
        x: Math.max(8, e.clientX - 210),
        y: e.clientY + 8,
        items: [
          {
            id: 'new',
            label: '新建文档',
            icon: 'file-plus',
            run: async () => {
              const mod = await import('@/shell/commands')
              await mod.cmdNewFile()
            }
          },
          { id: 'open', label: '打开文件…', icon: 'folder-open', run: () => setPaletteOpen(true) },
          { id: 'd1', divider: true },
          {
            id: 'vw',
            label: '视图模式',
            icon: 'eye',
            submenu: [
              { id: 'v1', label: '所见即所得', icon: 'edit', run: () => setViewMode('wysiwyg') },
              { id: 'v2', label: '源码模式', icon: 'code', run: () => setViewMode('source') },
              { id: 'v3', label: '对照模式', icon: 'columns', run: () => setViewMode('split') },
              { id: 'v4', label: '阅读视图', icon: 'eye', run: () => setViewMode('preview') }
            ]
          },
          {
            id: 'split',
            label: '分屏',
            icon: 'columns',
            submenu: [
              { id: 's0', label: '取消分屏', run: () => setSplitMode('none') },
              { id: 's1', label: '左右分屏', run: () => setSplitMode('vertical') },
              { id: 's2', label: '上下分屏', run: () => setSplitMode('horizontal') }
            ]
          },
          { id: 'd2', divider: true },
          {
            id: 'closeOthers',
            label: '关闭其他标签',
            icon: 'x',
            disabled: !activeTabId,
            run: () => activeTabId && closeOtherTabs(activeTabId)
          },
          { id: 'closeAll', label: '关闭全部标签', icon: 'x', disabled: !tabs.length, run: () => closeAllTabs() },
          { id: 'd3', divider: true },
          {
            id: 'settings',
            label: '编辑器设置…',
            icon: 'settings',
            run: async () => {
              const mod = await import('@/shell/SettingsDialog')
              mod.openSettings()
            }
          },
          { id: 'detach', label: '在新窗口中打开', icon: 'external', run: () => window.open('/app', '_blank', 'noopener') }
        ]
      })
    },
    [activeTabId, closeAllTabs, closeOtherTabs, openContextMenu, setPaletteOpen, setSplitMode, setViewMode, tabs.length]
  )

  return (
    <div className="tabbar">
      <div className="tabbar-lead">
        <button
          className={'btn-icon' + (leftVisible ? ' active' : '')}
          title={leftVisible ? '收起左侧边栏 (Ctrl+Shift+L)' : '展开左侧边栏 (Ctrl+Shift+L)'}
          onClick={() => toggleLeft()}
        >
          <Icon name="sidebar" size={15} />
        </button>
        <button className="btn-icon" title="命令面板 (Ctrl+P)" onClick={() => setPaletteOpen(true)}>
          <Icon name="command" size={15} />
        </button>
      </div>

      <div className="tabbar-scroll" ref={scrollRef}>
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={
                'tab' +
                (isActive ? ' active' : '') +
                (tab.dirty ? ' dirty' : '') +
                (tab.preview ? ' preview-tab' : '') +
                (dragIndex === i ? ' dragging' : '') +
                (dropIndex === i && dragIndex !== null && dragIndex !== i
                  ? dropSide === 'left'
                    ? ' drop-left'
                    : ' drop-right'
                  : '')
              }
              role="tab"
              aria-selected={isActive}
              draggable
              title={tab.path}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={(e) => {
                e.preventDefault()
                closeOne(tab.id)
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  closeOne(tab.id)
                }
              }}
              onContextMenu={(e) => void openTabMenu(e, tab)}
              onDragStart={(e) => {
                setDragIndex(i)
                e.dataTransfer.effectAllowed = 'move'
                try {
                  e.dataTransfer.setData('text/plain', String(i))
                } catch {
                  /* ignore */
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setDropSide(e.clientX < rect.left + rect.width / 2 ? 'left' : 'right')
                setDropIndex(i)
              }}
              onDragLeave={() => setDropIndex((cur) => (cur === i ? null : cur))}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'))
                if (Number.isInteger(from) && from !== i) {
                  const target = dropSide === 'left' ? i : i + 1
                  reorderTabs(from, from < target ? target - 1 : target)
                }
                setDragIndex(null)
                setDropIndex(null)
              }}
              onDragEnd={() => {
                setDragIndex(null)
                setDropIndex(null)
              }}
            >
              <Icon name={iconForPath(tab.path)} size={13} className="tab-icon" />
              <span className="tab-name">{tab.name}</span>
              {tab.viewMode === 'preview' && <Icon name="lock" size={11} className="tab-lock" />}
              {tab.dirty ? (
                <span className="tab-dot" title="未保存的更改" />
              ) : (
                <button
                  className="tab-close btn-icon"
                  title="关闭 (Ctrl+W)"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeOne(tab.id)
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          )
        })}
        {!tabs.length && (
          <div className="tab" style={{ opacity: 0.55, pointerEvents: 'none' }}>
            <Icon name="file-text" size={13} className="tab-icon" />
            <span className="tab-name">无打开的文档</span>
          </div>
        )}
      </div>

      <div className="tabbar-tail">
        <button
          className={'btn-icon' + (splitMode !== 'none' ? ' active' : '')}
          title="左右分屏"
          onClick={() => setSplitMode(splitMode === 'vertical' ? 'none' : 'vertical')}
        >
          <Icon name="columns" size={15} />
        </button>
        <button
          className={'btn-icon' + (rightVisible ? ' active' : '')}
          title="AI 助手 (Ctrl+Shift+A)"
          onClick={() => toggleRight()}
        >
          <Icon name="sparkles" size={15} />
        </button>
        <button className="btn-icon" title="更多" onClick={moreMenu}>
          <Icon name="more" size={15} />
        </button>
      </div>
    </div>
  )
}

export default TabBar
