/**
 * EditorApp — the Obsidian-like workspace shell.
 *
 * Grid: [ribbon] [left sidebar] [main pane] [right sidebar]
 * No product name anywhere inside the workspace; the window/tab title is the
 * active file name.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { setWindowTitle, isDesktop, local } from '@/lib/platform'
import { initTheme } from '@/lib/theme'
import { installShortcutEngine } from '@/lib/commands'
import { DEFAULT_SETTINGS } from '@/lib/contracts'
import '@/styles/shell-layout.css'
import '@/styles/shell-panels.css'
import '@/styles/shell-editor.css'

import TabBar from './TabBar'
import Ribbon from './Ribbon'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar'
import Toolbar from './Toolbar'
import StatusBar from './StatusBar'
import CommandPalette from './CommandPalette'
import EditorHost from './EditorHost'
import MobileApp from './MobileApp'
import { registerShellCommands, installBrowserReservedHint } from './commands'
import { openFile, useDoc } from '@/features/editor/docRepo'
import { fileService, reloadFileTree, currentVault } from '@/features/files/fileService'
import { localRepo } from '@/features/files/localRepo'
import { registerConflictDialog } from '@/features/editor/ConflictDialog'
import { registerModal } from '@/components/Overlays'
import { confirmAction, promptText } from '@/features/editor/dialogs'
import { setLocalRoot } from '@/lib/fs'

const RIBBON_W = 46
const LEFT_W = 272
const RIGHT_W = 336

/* ------------------------------------------------------------------ welcome */
const Welcome: React.FC = () => {
  const tabs = useStore((s) => s.tabs)
  const recent = useStore((s) => s.recent)
  const files = useStore((s) => s.files)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)
  const openContextMenu = useStore((s) => s.openContextMenu)

  const recentFiles = useMemo(() => {
    const map = new Map(files.map((f) => [f.path, f]))
    return recent.map((p) => map.get(p)).filter(Boolean).slice(0, 6)
  }, [recent, files])

  const newDoc = async () => {
    const res = await fileService.create(currentVault())
    await reloadFileTree(true)
    openFile(res.path, { preview: false })
  }

  const cards = [
    { icon: 'file-plus', title: '新建文档', desc: 'Ctrl+N 创建一篇空白笔记', run: () => void newDoc() },
    { icon: 'command', title: '命令面板', desc: 'Ctrl+P 搜索全部命令', run: () => setPaletteOpen(true) },
    {
      icon: 'search',
      title: '全文搜索',
      desc: 'Ctrl+Shift+F 搜索所有文档',
      run: () => {
        useStore.getState().toggleLeft(true)
        useStore.getState().setLeftPanel('search')
      }
    },
    {
      icon: 'sparkles',
      title: 'AI 写作',
      desc: '续写、润色、总结与翻译',
      run: () => {
        useStore.getState().toggleRight(true)
        useStore.getState().setRightPanel('ai')
      }
    }
  ]

  return (
    <div
      className="editor-welcome"
      onContextMenu={(e) => {
        e.preventDefault()
        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { id: 'new', label: '新建文档', icon: 'file-plus', run: () => void newDoc() },
            { id: 'palette', label: '命令面板', icon: 'command', run: () => setPaletteOpen(true) },
            {
              id: 'settings',
              label: '编辑器设置',
              icon: 'settings',
              run: async () => (await import('./SettingsDialog')).openSettings()
            }
          ]
        })
      }}
    >
      <div className="welcome-cards">
        {cards.map((c) => (
          <button key={c.title} className="welcome-card" onClick={c.run}>
            <span className="wc-icon">
              <Icon name={c.icon} size={16} />
            </span>
            <div>
              <strong>{c.title}</strong>
              <div className="tiny">{c.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {recentFiles.length > 0 && (
        <div className="welcome-list">
          <div className="sb-section" style={{ paddingLeft: 0 }}>
            <Icon name="clock" size={11} /> 最近文件
          </div>
          {recentFiles.map((f) => f && (
            <button key={f.path} className="welcome-row" onClick={() => openFile(f.path, { preview: false })}>
              <Icon name="file-text" size={14} />
              <span className="grow ellipsis">{f.name}</span>
              <span className="tiny dim">{f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : ''}</span>
            </button>
          ))}
        </div>
      )}

      <div className="welcome-list">
        <div className="sb-section" style={{ paddingLeft: 0 }}>
          <Icon name="command" size={11} /> 快捷命令
        </div>
        {[
          ['新建文档', 'Ctrl+N', 'file.new'],
          ['保存', 'Ctrl+S', 'file.save'],
          ['切换视图', 'Ctrl+E', 'view.toggle'],
          ['命令面板', 'Ctrl+P', 'app.commandPalette']
        ].map(([label, key, id]) => (
          <button
            key={id}
            className="welcome-row"
            onClick={async () => {
              const { runCommand } = await import('@/lib/commands')
              void runCommand(id)
            }}
          >
            <Icon name="chevron-right" size={13} />
            <span className="grow">{label}</span>
            <span className="kbd">{key}</span>
          </button>
        ))}
      </div>
      {!tabs.length && (
        <div className="tiny dim" style={{ marginTop: 6 }}>
          提示：双击标签可关闭，右键标签或文件可查看更多操作
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ editor area */
const EditorArea: React.FC = () => {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const splitMode = useStore((s) => s.splitMode)
  const splitTabId = useStore((s) => s.splitTabId)

  const activeTab = tabs.find((t) => t.id === activeTabId) || null
  const splitTab = tabs.find((t) => t.id === splitTabId) || null

  /* global autosave */
  useEffect(() => {
    const { settings } = useStore.getState()
    const seconds = Math.max(3, settings.autoSaveSeconds || 20)
    const timer = window.setInterval(() => {
      void (async () => {
        const { saveAllDirty } = await import('@/features/editor/docRepo')
        await saveAllDirty(false)
      })()
    }, seconds * 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (!tabs.length) return <Welcome />

  return (
    <div className={'editor-area ' + (splitMode === 'horizontal' ? 'split-h' : splitMode === 'vertical' ? 'split-v' : '')}>
      {activeTab && (
        <div className="editor-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          <EditorHost key={activeTab.id} tabId={activeTab.id} path={activeTab.path} group="main" />
        </div>
      )}
      {splitMode !== 'none' && (
        <>
          <div className="split-divider" />
          <div className="editor-pane" style={{ display: 'flex', flexDirection: 'column' }}>
            {splitTab ? (
              <EditorHost key={splitTab.id} tabId={splitTab.id} path={splitTab.path} group="side" />
            ) : (
              <div className="editor-welcome">
                <Icon name="columns" size={24} />
                <div className="small">在分屏中打开一篇文档</div>
                <div className="tiny dim">在文件上右键 → 在右侧分屏打开</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ shell */
const EditorApp: React.FC = () => {
  const settings = useStore((s) => s.settings)
  const leftVisible = useStore((s) => s.leftVisible)
  const rightVisible = useStore((s) => s.rightVisible)
  const ribbonVisible = useStore((s) => s.ribbonVisible)
  const ribbonPosition = useStore((s) => s.settings.ribbonPosition)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const viewMode = useStore((s) => s.viewMode)
  const pageWidth = useStore((s) => s.pageWidth)
  const theme = useStore((s) => s.theme)
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const setUser = useStore((s) => s.setUser)
  const setVaults = useStore((s) => s.setVaults)
  const setActiveVault = useStore((s) => s.setActiveVault)
  const setViewMode = useStore((s) => s.setViewMode)
  const setFiles = useStore((s) => s.setFiles)
  const setPlugins = useStore((s) => s.setPlugins)
  const setPluginManifests = useStore((s) => s.setPluginManifests)
  const toast = useStore((s) => s.toast)
  const navigate = useNavigate()

  const [narrow, setNarrow] = useState(() => window.innerWidth < 1100)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [booting, setBooting] = useState(true)
  const [offline, setOffline] = useState(false)
  const bootRef = useRef(false)

  const activeTab = tabs.find((t) => t.id === activeTabId) || null
  const doc = useDoc(activeTab?.path)

  /* ---------------------------------------------------------- window width */
  useEffect(() => {
    const onResize = () => {
      setNarrow(window.innerWidth < 1100)
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* ---------------------------------------------------------- window title */
  useEffect(() => {
    setWindowTitle(activeTab?.name || '')
  }, [activeTab?.name])

  /* ---------------------------------------------------------- theme + vars */
  useEffect(() => {
    initTheme()
    document.documentElement.style.setProperty(
      '--page-width',
      pageWidth === 'standard' ? '760px' : pageWidth === 'wide' ? '1080px' : '100%'
    )
  }, [pageWidth])

  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', settings.editorFontSize + 'px')
    document.documentElement.style.setProperty('--editor-line-height', String(settings.editorLineHeight))
    document.documentElement.style.setProperty('--left-w', leftVisible ? LEFT_W + 'px' : '0px')
    document.documentElement.style.setProperty('--right-w', rightVisible ? RIGHT_W + 'px' : '0px')
    document.documentElement.style.setProperty('--sidebar-w', LEFT_W + 'px')
    document.documentElement.style.setProperty('--tabbar-h', settings.showToolbar === false ? '50px' : '50px')
  }, [settings.editorFontSize, settings.editorLineHeight, leftVisible, rightVisible])

  /* ---------------------------------------------------------- command registry */
  useEffect(() => {
    registerShellCommands()
    const offShortcuts = installShortcutEngine()
    const offReserved = installBrowserReservedHint()
    registerConflictDialog()
    return () => {
      offShortcuts()
      offReserved()
    }
  }, [])

  /* ---------------------------------------------------------- conflict → dialog */
  const conflict = useStore((s) => s.conflict)
  useEffect(() => {
    if (!conflict) return
    void (async () => {
      const mod = await import('@/features/editor/ConflictDialog')
      mod.openConflictDialog()
    })()
  }, [conflict])

  /* ---------------------------------------------------------- boot: auth + vault + files */
  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    void (async () => {
      try {
        // plugins (best effort, never blocks the editor)
        void (async () => {
          try {
            const { api } = await import('@/lib/api')
            const { API } = await import('@/lib/contracts')
            const installed = await api.get<{ id: string; version: string; enabled: boolean; source: string; installed_at: string }[]>(
              API.pluginsInstalled
            )
            if (Array.isArray(installed)) {
              setPlugins(
                installed.map((p) => ({
                  id: p.id,
                  version: p.version,
                  enabled: p.enabled,
                  source: (p.source as 'builtin') || 'builtin',
                  installed_at: p.installed_at
                }))
              )
            }
          } catch {
            /* offline */
          }
          try {
            const { api } = await import('@/lib/api')
            const { API } = await import('@/lib/contracts')
            const manifests = await api.get<Record<string, import('@/lib/contracts').PluginManifest>>(API.pluginsManifest)
            if (manifests) setPluginManifests(manifests)
          } catch {
            /* offline */
          }
        })()

        // desktop local vault registration
        if (isDesktop && local) {
          try {
            const bridge = (window as unknown as { neom?: { vaultPath?: string; local?: { recentVaults?: () => Promise<{ path: string; name: string }[]> } } }).neom
            const root = bridge?.vaultPath
            if (root) {
              setLocalRoot('desktop-local', root)
              setVaults([
                { id: 'cloud', name: '云端仓库', kind: 'cloud' },
                { id: 'desktop-local', name: root.split(/[\\/]/).pop() || '本地文件夹', kind: 'local', path: root }
              ])
            } else {
              const recents = await bridge?.local?.recentVaults?.().catch(() => [])
              if (recents?.length) {
                setVaults([
                  { id: 'cloud', name: '云端仓库', kind: 'cloud' },
                  ...recents.map((r, i) => ({
                    id: 'desktop-' + i,
                    name: r.name,
                    kind: 'local' as const,
                    path: r.path
                  }))
                ])
                setLocalRoot('desktop-0', recents[0].path)
              }
            }
          } catch {
            /* ignore */
          }
        }

        // logged-in check
        let signedIn = !!useStore.getState().user
        if (!signedIn) {
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
        }

        if (!signedIn) {
          // local-first mode
          setVaults([{ id: 'local-web', name: '本地仓库（未登录）', kind: 'local' }])
          setActiveVault('local-web')
          try {
            await localRepo.seed()
            const nodes = await localRepo.list()
            setFiles(nodes)
          } catch {
            setFiles([])
          }
          setOffline(true)
        } else {
          setActiveVault('cloud')
          await reloadFileTree(true)
        }

        // initial document from the URL (/app/some/path.md)
        const segs = window.location.pathname.replace(/^\/app\/?/, '')
        if (segs) {
          const path = decodeURIComponent(segs)
          if (path && path !== 'app') openFile(path, { preview: false })
        }
      } catch (e) {
        toast({ kind: 'warn', text: '初始化遇到问题，已进入离线模式' })
        void e
      } finally {
        setBooting(false)
      }
    })()
  }, [setActiveVault, setFiles, setPluginManifests, setPlugins, setUser, setVaults, toast])

  /* ---------------------------------------------------------- reload tree on vault change */
  useEffect(() => {
    void reloadFileTree(true)
  }, [])

  /* ---------------------------------------------------------- keyboard: browser guard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      // Ctrl+F / Ctrl+H / Ctrl+P are handled by the shortcut engine; nothing to do
      if (e.key === 'Tab') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---------------------------------------------------------- ribbon placement */
  const ribbonInline = ribbonPosition === 'status-left' || ribbonPosition === 'status-right'
  const ribbonSide = ribbonVisible && !ribbonInline ? (ribbonPosition === 'right' ? 'right' : 'left') : null
  const colClass = !ribbonSide
    ? 'p-no-ribbon'
    : ribbonPosition === 'right'
      ? 'p-ribbon-right'
      : 'p-ribbon-left'

  const gridVars = {
    ['--left-w' as string]: leftVisible ? LEFT_W + 'px' : '0px',
    ['--right-w' as string]: rightVisible && !narrow ? RIGHT_W + 'px' : '0px'
  }

  if (booting) {
    return (
      <div className="shell p-no-ribbon" style={{ placeItems: 'center', display: 'grid' }}>
        <div className="center col" style={{ gap: 12 }}>
          <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <div className="dim small">正在打开工作区…</div>
        </div>
      </div>
    )
  }

  /* Below 768px the phone layout takes over (live resize safe). */
  if (isMobile) return <MobileApp />

  return (
    <div className={'shell ' + colClass + (narrow ? ' narrow' : '')} style={gridVars}>
      {ribbonSide === 'left' && <Ribbon />}

      <LeftSidebar />

      <main className="main-pane">
        <TabBar />
        {settings.showToolbar && <Toolbar />}
        <EditorArea />
        <StatusBar />
        <CommandPalette />
      </main>

      {ribbonSide === 'right' && <Ribbon />}

      {rightVisible && narrow && (
        <div className="pane-scrim" onClick={() => useStore.getState().toggleRight(false)} />
      )}
      <RightSidebar variant={narrow ? 'overlay' : 'grid'} />

      {offline && !user && authReady && (
        <div
          className="tip-line"
          style={{
            position: 'fixed',
            left: leftVisible ? LEFT_W + 18 : 18,
            bottom: 38,
            zIndex: 40,
            padding: '5px 10px',
            borderRadius: 999,
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-strong)',
            boxShadow: 'var(--shadow-1)'
          }}
        >
          <Icon name="cloud" size={12} />
          离线模式 · 文档保存在本地
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/login?redirect=/app')}>
            登录同步
          </button>
        </div>
      )}
    </div>
  )
}

export default EditorApp
