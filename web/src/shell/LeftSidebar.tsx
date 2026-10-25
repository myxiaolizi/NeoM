/**
 * LeftSidebar — 272px rail: view switcher, action row, panels
 * (files / outline / search / history / tags) and the account footer.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import type { LeftViewMode, PageWidth, SortKey } from '@/lib/contracts'
import FileTree from '@/features/files/FileTree'
import { fileService, currentVault, reloadFileTree } from '@/features/files/fileService'
import { openFile, saveActiveTab, useDoc } from '@/features/editor/docRepo'
import { applySort, blankContextMenu } from '@/features/files/fileMenus'
import { OutlineTree } from '@/features/outline/OutlineTree'
import SearchPanel from '@/features/search/SearchPanel'
import HistoryPanel from '@/features/history/HistoryPanel'

const VIEWS: { id: LeftViewMode; label: string; icon: string }[] = [
  { id: 'files', label: '文件列表', icon: 'folder' },
  { id: 'outline', label: '大纲', icon: 'list' },
  { id: 'outline-files', label: '大纲 + 文件列表', icon: 'rows' }
]

const LeftSidebar: React.FC = () => {
  const leftVisible = useStore((s) => s.leftVisible)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const leftView = useStore((s) => s.leftView)
  const setLeftView = useStore((s) => s.setLeftView)
  const updateSettings = useStore((s) => s.updateSettings)
  const leftPanel = useStore((s) => s.leftPanel)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const setMobileDrawer = useStore((s) => s.setMobileDrawer)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)
  const pageWidth = useStore((s) => s.pageWidth)
  const setPageWidth = useStore((s) => s.setPageWidth)
  const settings = useStore((s) => s.settings)
  const user = useStore((s) => s.user)
  const toast = useStore((s) => s.toast)
  const openContextMenu = useStore((s) => s.openContextMenu)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const navigate = useNavigate()

  const activeTab = tabs.find((t) => t.id === activeTabId) || null
  const doc = useDoc(activeTab?.path)

  /* Debounce markdown so typing does not re-parse the outline on every keystroke */
  const rawMarkdown = doc?.content || ''
  const [markdown, setMarkdown] = useState(rawMarkdown)
  useEffect(() => {
    if (leftView !== 'outline' && leftView !== 'outline-files') {
      setMarkdown(rawMarkdown)
      return
    }
    const t = window.setTimeout(() => setMarkdown(rawMarkdown), 320)
    return () => window.clearTimeout(t)
  }, [rawMarkdown, leftView])

  const switchView = useCallback(
    (v: LeftViewMode) => {
      setLeftView(v)
      updateSettings({ leftViewMode: v })
      setLeftPanel(null)
    },
    [setLeftPanel, setLeftView, updateSettings]
  )

  const newDocument = useCallback(async () => {
    try {
      const res = await fileService.create(currentVault())
      await reloadFileTree(true)
      openFile(res.path, { preview: false })
    } catch (e) {
      toast({ kind: 'error', text: '新建失败：' + ((e as Error)?.message || '') })
    }
  }, [toast])

  const saveNow = useCallback(async () => {
    const ok = await saveActiveTab(true)
    toast({ kind: ok ? 'ok' : 'warn', text: ok ? '已保存' : '没有可保存的内容' })
  }, [toast])

  const syncNow = useCallback(async () => {
    try {
      const res = await fileService.sync(currentVault())
      await reloadFileTree(true)
      toast({ kind: 'ok', text: `同步完成：拉取 ${res?.pulled ?? 0}，推送 ${res?.pushed ?? 0}` })
    } catch {
      toast({ kind: 'warn', text: '当前离线，稍后再试' })
    }
  }, [toast])

  const cyclePageWidth = useCallback(() => {
    const order: PageWidth[] = ['standard', 'wide', 'full']
    const next = order[(order.indexOf(pageWidth) + 1) % order.length]
    setPageWidth(next)
  }, [pageWidth, setPageWidth])

  const sortMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const item = (key: SortKey, label: string, icon: string) => ({
      id: key,
      label: (settings.sortKey === key ? '✓ ' : '　') + label,
      icon,
      submenu: [
        { id: key + '-asc', label: (settings.sortDir === 'asc' && settings.sortKey === key ? '✓ ' : '　') + '升序', run: () => applySort(key, 'asc') },
        { id: key + '-desc', label: (settings.sortDir === 'desc' && settings.sortKey === key ? '✓ ' : '　') + '降序', run: () => applySort(key, 'desc') }
      ]
    })
    openContextMenu({
      x: rect.left,
      y: rect.bottom + 4,
      title: '排序方式',
      items: [
        item('mtime', '按修改时间', 'clock'),
        item('ctime', '按创建时间', 'calendar'),
        item('name', '按文件名', 'sort')
      ]
    })
  }

  const panelTitle = useMemo(() => {
    switch (leftPanel) {
      case 'search':
        return '搜索'
      case 'history':
        return '历史版本'
      case 'outline':
        return '大纲'
      case 'tags':
        return '标签'
      default:
        return '文件'
    }
  }, [leftPanel])

  if (!leftVisible) return null

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <span className="sb-title">{panelTitle}</span>
        <div className="viewswitch">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={'btn-icon' + (leftView === v.id && !leftPanel ? ' active' : '')}
              title={v.label}
              data-tip={v.label}
              onClick={() => switchView(v.id)}
            >
              <Icon name={v.icon} size={13} />
            </button>
          ))}
        </div>
        <button className="btn-icon" title="收起侧栏" onClick={() => { toggleLeft(false); setMobileDrawer(null) }}>
          <Icon name="chevron-left" size={13} />
        </button>
      </div>

      <div className="sb-actions">
        <button className="btn-icon" title="新建文档 (Ctrl+N)" data-tip="新建文档" onClick={() => void newDocument()}>
          <Icon name="file-plus" size={15} />
        </button>
        <button
          className="btn-icon"
          title="打开文件 (Ctrl+P)"
          data-tip="打开文件"
          onClick={() => setPaletteOpen(true)}
        >
          <Icon name="folder-open" size={15} />
        </button>
        <button className="btn-icon" title="保存 (Ctrl+S)" data-tip="保存" onClick={() => void saveNow()}>
          <Icon name="save" size={15} />
        </button>
        <button className="btn-icon" title="同步" data-tip="同步" onClick={() => void syncNow()}>
          <Icon name="sync" size={15} />
        </button>
        <span className="sb-sep" />
        <button
          className="btn-icon"
          title={'页宽：' + (pageWidth === 'standard' ? '标准' : pageWidth === 'wide' ? '宽' : '铺满')}
          data-tip="页宽"
          onClick={cyclePageWidth}
        >
          <Icon name="maximize" size={15} />
        </button>
        <button
          className={'btn-icon' + (leftPanel === 'search' ? ' active' : '')}
          title="搜索 (Ctrl+Shift+F)"
          data-tip="搜索"
          onClick={() => setLeftPanel(leftPanel === 'search' ? null : 'search')}
        >
          <Icon name="search" size={15} />
        </button>
        <button
          className="btn-icon"
          title="命令面板 (Ctrl+P)"
          data-tip="命令面板"
          onClick={() => setPaletteOpen(true)}
        >
          <Icon name="command" size={15} />
        </button>
        <button
          className={'btn-icon' + (leftPanel === 'history' ? ' active' : '')}
          title="历史版本"
          data-tip="历史版本"
          onClick={() => setLeftPanel(leftPanel === 'history' ? null : 'history')}
        >
          <Icon name="history" size={15} />
        </button>
        <button className="btn-icon" title="排序" data-tip="排序" onClick={sortMenu}>
          <Icon name="sort" size={15} />
        </button>
      </div>

      <div className="sb-scroll" style={{ display: 'flex', flexDirection: 'column' }}>
        {leftPanel === 'search' && <SearchPanel />}
        {leftPanel === 'history' && <HistoryPanel />}
        {leftPanel === 'tags' && <TagsPanel />}

        {!leftPanel && leftView === 'files' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <FileTree />
          </div>
        )}

        {!leftPanel && leftView === 'outline' && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {activeTab ? (
              <OutlineTree markdown={markdown} path={activeTab.path} />
            ) : (
              <div className="tree-empty">请先打开一篇文档</div>
            )}
          </div>
        )}

        {!leftPanel && leftView === 'outline-files' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ flex: '0 0 40%', minHeight: 0, overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
              <div className="sb-section">
                <Icon name="list" size={11} /> 大纲
              </div>
              {activeTab ? (
                <OutlineTree markdown={markdown} path={activeTab.path} />
              ) : (
                <div className="tree-empty">请先打开一篇文档</div>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <FileTree compact />
            </div>
          </div>
        )}
      </div>

      <div className="sb-foot">
        {user ? (
          <button className="sb-user" onClick={() => navigate('/account/profile')} title="打开个人中心">
            <span className="avatar">
              {user.avatar ? <img src={user.avatar} alt="" /> : (user.nickname || user.username || '?').slice(0, 1).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="small ellipsis" style={{ fontWeight: 600 }}>{user.nickname || user.username}</div>
              <div className="tiny dim ellipsis">{user.points?.toLocaleString?.() ?? 0} 积分</div>
            </div>
            <Icon name="chevron-right" size={13} />
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={() => navigate('/login?redirect=/app')}>
            <Icon name="login" size={14} />
            登录 / 注册
          </button>
        )}
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------- tags panel */
const TagsPanel: React.FC = () => {
  const files = useStore((s) => s.files)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const tags = useMemo(() => {
    const counter = new Map<string, number>()
    for (const f of files) {
      for (const t of f.tags || []) counter.set(t, (counter.get(t) || 0) + 1)
    }
    return Array.from(counter.entries()).sort((a, b) => b[1] - a[1])
  }, [files])

  return (
    <div className="sb-panel">
      <div className="sb-panel-head">
        <span className="sp-title">标签</span>
        <button className="btn-icon" onClick={() => setLeftPanel(null)}><Icon name="x" size={13} /></button>
      </div>
      <div className="side-panel-body">
        {tags.length ? (
          tags.map(([tag, n]) => (
            <div key={tag} className="hover-row">
              <Icon name="tag" size={13} />
              <span className="ellipsis" style={{ flex: 1 }}>#{tag}</span>
              <span className="tiny dim">{n}</span>
            </div>
          ))
        ) : (
          <div className="tree-empty">还没有标签</div>
        )}
      </div>
    </div>
  )
}

export default LeftSidebar
