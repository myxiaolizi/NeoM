/**
 * MobileApp — Capacitor / narrow-viewport editor shell: top bar, drawer
 * sidebars, compact tab strip, EditorHost body and a bottom action bar.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { setWindowTitle } from '@/lib/platform'
import { initTheme } from '@/lib/theme'
import { installShortcutEngine } from '@/lib/commands'
import '@/styles/shell-layout.css'
import '@/styles/shell-panels.css'
import '@/styles/shell-editor.css'

import EditorHost from './EditorHost'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar'
import CommandPalette from './CommandPalette'
import Toolbar from './Toolbar'
import { registerShellCommands } from './commands'
import { openFile } from '@/features/editor/docRepo'
import { reloadFileTree, fileService, currentVault } from '@/features/files/fileService'
import { localRepo } from '@/features/files/localRepo'
import { setLocalRoot } from '@/lib/fs'
import { isDesktop, local } from '@/lib/platform'

const MobileApp: React.FC = () => {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const drawer = useStore((s) => s.mobileDrawer)
  const setDrawer = useStore((s) => s.setMobileDrawer)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const toggleRight = useStore((s) => s.toggleRight)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const leftPanel = useStore((s) => s.leftPanel)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)
  const setViewMode = useStore((s) => s.setViewMode)
  const viewMode = useStore((s) => s.viewMode)
  const setFiles = useStore((s) => s.setFiles)
  const setActiveVault = useStore((s) => s.setActiveVault)
  const setVaults = useStore((s) => s.setVaults)
  const setUser = useStore((s) => s.setUser)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const navigate = useNavigate()

  const [booting, setBooting] = useState(true)
  const activeTab = tabs.find((t) => t.id === activeTabId) || null

  useEffect(() => {
    initTheme()
    registerShellCommands()
    const off = installShortcutEngine()
    return off
  }, [])

  useEffect(() => {
    setWindowTitle(activeTab?.name || '')
  }, [activeTab?.name])

  /* drawers drive the shared left/right visibility flags */
  useEffect(() => {
    toggleLeft(drawer === 'left')
    toggleRight(drawer === 'right')
  }, [drawer, toggleLeft, toggleRight])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (isDesktop && local) {
          const bridge = (window as unknown as { neom?: { vaultPath?: string } }).neom
          if (bridge?.vaultPath) setLocalRoot('desktop-local', bridge.vaultPath)
        }
        let signedIn = false
        try {
          const { api } = await import('@/lib/api')
          const me = await api.get<{ user: unknown }>('/api/auth/me')
          if (me?.user) {
            setUser(me.user as never)
            signedIn = true
          }
        } catch {
          signedIn = false
        }
        if (!signedIn) {
          setVaults([{ id: 'local-web', name: '本地仓库（未登录）', kind: 'local' }])
          setActiveVault('local-web')
          await localRepo.seed()
          setFiles(await localRepo.list())
        } else {
          setActiveVault('cloud')
          await reloadFileTree(true)
        }
      } catch {
        toast({ kind: 'warn', text: '已进入离线模式' })
      } finally {
        if (alive) setBooting(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [setActiveVault, setFiles, setUser, setVaults, toast])

  const newDoc = async () => {
    const res = await fileService.create(currentVault())
    await reloadFileTree(true)
    openFile(res.path, { preview: false })
    setDrawer(null)
  }

  const cycleView = () => {
    const order = ['wysiwyg', 'source', 'split', 'preview'] as const
    setViewMode(order[(order.indexOf(viewMode) + 1) % order.length])
  }

  if (booting) {
    return (
      <div className="mobile-shell" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="center col" style={{ gap: 12 }}>
          <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <div className="dim small">正在打开…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-shell">
      <div className="mobile-topbar">
        <button className="btn-icon" title="文件" onClick={() => setDrawer(drawer === 'left' ? null : 'left')}>
          <Icon name="list" size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
            {activeTab?.name || '未打开文档'}
          </div>
          <div className="tiny dim ellipsis">{activeTab?.path || ''}</div>
        </div>
        <button className="btn-icon" title="命令面板" onClick={() => setPaletteOpen(true)}>
          <Icon name="command" size={18} />
        </button>
        <button className="btn-icon" title="AI 助手" onClick={() => setDrawer(drawer === 'right' ? null : 'right')}>
          <Icon name="sparkles" size={18} />
        </button>
      </div>

      {tabs.length > 1 && (
        <div className="mobile-tabstrip">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={'tab' + (t.id === activeTabId ? ' active' : '')}
              style={{ height: 32, margin: '4px 0', borderRight: 'none', borderRadius: 6 }}
              onClick={() => useStore.getState().setActiveTab(t.id)}
            >
              <span className="tab-name ellipsis">{t.name}</span>
              {t.dirty && <span className="tab-dot" />}
            </button>
          ))}
        </div>
      )}

      <div className="mobile-body">
        {activeTab ? (
          <EditorHost key={activeTab.id} tabId={activeTab.id} path={activeTab.path} group="main" />
        ) : (
          <div className="editor-welcome" style={{ gap: 14 }}>
            <Icon name="file-text" size={30} />
            <div className="small">还没有打开文档</div>
            <button className="btn btn-primary" onClick={() => void newDoc()}>
              <Icon name="file-plus" size={15} /> 新建文档
            </button>
            <button className="btn" onClick={() => setDrawer('left')}>浏览文件</button>
          </div>
        )}

        {drawer && <div className="pane-scrim" onClick={() => setDrawer(null)} />}

        <div className={'mobile-drawer left' + (drawer === 'left' ? ' open' : '')}>
          <div className="sb-head">
            <span className="sb-title">文件</span>
            <button className="btn-icon" onClick={() => setDrawer(null)}><Icon name="x" size={14} /></button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <LeftSidebar />
          </div>
        </div>

        <div className={'mobile-drawer right' + (drawer === 'right' ? ' open' : '')}>
          <RightSidebar />
        </div>
      </div>

      {settings.showToolbar && <Toolbar />}

      <div className="statusbar">
        <span className="sb-item ellipsis" style={{ maxWidth: '52%' }}>{activeTab?.path || '—'}</span>
        <div style={{ flex: 1 }} />
        <button className="sb-item" onClick={() => { setLeftPanel(leftPanel === 'search' ? null : 'search'); setDrawer('left') }}>
          <Icon name="search" size={12} />
        </button>
        <button className="sb-item" onClick={() => { setLeftPanel('history'); setDrawer('left') }}>
          <Icon name="history" size={12} />
        </button>
        <button className="sb-item" onClick={cycleView}>
          <Icon name="eye" size={12} />
          {viewMode === 'preview' ? '阅读' : viewMode === 'source' ? '源码' : viewMode === 'split' ? '对照' : '编辑'}
        </button>
        <button className="sb-item" onClick={() => navigate('/account/profile')}>
          <Icon name="user" size={12} />
        </button>
      </div>

      <div className="mobile-bottom">
        <button className="btn-icon" onClick={() => void newDoc()} title="新建">
          <Icon name="file-plus" size={19} />
        </button>
        <button className="btn-icon" onClick={() => setPaletteOpen(true)} title="命令">
          <Icon name="command" size={19} />
        </button>
        <button className="btn-icon" onClick={() => void import('@/features/editor/docRepo').then((m) => m.saveActiveTab(true))} title="保存">
          <Icon name="save" size={19} />
        </button>
        <button className="btn-icon" onClick={() => setDrawer(drawer === 'right' ? null : 'right')} title="AI">
          <Icon name="sparkles" size={19} />
        </button>
      </div>

      <CommandPalette />
    </div>
  )
}

export default MobileApp
