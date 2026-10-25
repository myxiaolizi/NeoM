/**
 * Ribbon — configurable activity strip. Vertical (left/right) or inline in the
 * status bar. Items come from settings.ribbonItems plus plugin contributions.
 */
import React, { useMemo } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { useNavigate } from 'react-router-dom'
import type { RibbonPosition } from '@/lib/contracts'
import { ALL_RIBBON_ITEMS, RIBBON_META } from './ribbonItems'

interface Props {
  /** rendered horizontally inside the status bar */
  inline?: boolean
}

const POSITIONS: { id: RibbonPosition; label: string }[] = [
  { id: 'left', label: '最左侧' },
  { id: 'right', label: '最右侧' },
  { id: 'status-left', label: '状态栏左侧' },
  { id: 'status-right', label: '状态栏右侧' }
]

export const Ribbon: React.FC<Props> = ({ inline }) => {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const toggleRibbon = useStore((s) => s.toggleRibbon)
  const leftPanel = useStore((s) => s.leftPanel)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const leftView = useStore((s) => s.leftView)
  const setLeftView = useStore((s) => s.setLeftView)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const leftVisible = useStore((s) => s.leftVisible)
  const rightPanel = useStore((s) => s.rightPanel)
  const setRightPanel = useStore((s) => s.setRightPanel)
  const rightVisible = useStore((s) => s.rightVisible)
  const toggleRight = useStore((s) => s.toggleRight)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)
  const plugins = useStore((s) => s.plugins)
  const manifests = useStore((s) => s.pluginManifests)
  const openContextMenu = useStore((s) => s.openContextMenu)
  const navigate = useNavigate()

  /* plugin-contributed ribbon buttons */
  const pluginItems = useMemo(() => {
    return plugins
      .filter((p) => p.enabled)
      .map((p) => {
        const m = p.manifest || manifests[p.id]
        if (!m?.contributes?.ribbon) return null
        return { id: 'plugin:' + p.id, label: m.name, icon: m.icon || 'puzzle', pluginId: p.id }
      })
      .filter(Boolean) as { id: string; label: string; icon: string; pluginId: string }[]
  }, [plugins, manifests])

  const visibleIds = settings.ribbonItems

  const handleItem = (id: string) => {
    if (id.startsWith('plugin:')) {
      const pid = id.slice('plugin:'.length)
      const m = manifests[pid]
      const cmd = m?.contributes?.commands?.[0]
      if (cmd?.id) {
        void (async () => {
          const { runCommand } = await import('@/lib/commands')
          void runCommand(cmd.id)
        })()
      } else {
        useStore.getState().toast({ kind: 'info', text: `插件「${m?.name || pid}」暂无绑定命令` })
      }
      return
    }
    switch (id) {
      case 'files':
        toggleLeft(true)
        setLeftPanel(null)
        setLeftView(leftView === 'files' ? 'files' : 'files')
        break
      case 'search':
        toggleLeft(true)
        setLeftPanel(leftPanel === 'search' ? null : 'search')
        break
      case 'outline':
        toggleLeft(true)
        setLeftPanel(leftPanel === 'outline' ? null : 'outline')
        break
      case 'history':
        toggleLeft(true)
        setLeftPanel(leftPanel === 'history' ? null : 'history')
        break
      case 'tags':
        toggleLeft(true)
        setLeftPanel(leftPanel === 'tags' ? null : 'tags')
        break
      case 'graph':
      case 'canvas':
      case 'calendar':
        useStore.getState().toast({ kind: 'info', text: '该视图由插件提供，请先在插件中心启用' })
        break
      case 'ai':
        toggleRight(rightVisible ? false : true)
        setRightPanel('ai')
        break
      case 'settings':
        void (async () => {
          const mod = await import('./SettingsDialog')
          mod.openSettings()
        })()
        break
      case 'account':
        navigate('/account/profile')
        break
      case 'plugins':
        navigate('/plugins')
        break
      case 'command':
        setPaletteOpen(true)
        break
      default:
        break
    }
  }

  const isActive = (id: string) => {
    if (id === 'files') return leftVisible && !leftPanel && leftView === 'files'
    if (id === 'search') return leftVisible && leftPanel === 'search'
    if (id === 'outline') return leftVisible && leftPanel === 'outline'
    if (id === 'history') return leftVisible && leftPanel === 'history'
    if (id === 'tags') return leftVisible && leftPanel === 'tags'
    if (id === 'ai') return rightVisible && rightPanel === 'ai'
    return false
  }

  const onRibbonContext = (e: React.MouseEvent) => {
    e.preventDefault()
    const si = settings.ribbonItems
    const toggleItem = (id: string) => {
      const next = si.includes(id) ? si.filter((x) => x !== id) : [...si, id]
      updateSettings({ ribbonItems: next })
    }
    const options = [
      ...ALL_RIBBON_ITEMS.map((it) => ({
        id: it.id,
        label: (si.includes(it.id) ? '✓ ' : '　') + it.label,
        icon: it.icon,
        run: () => toggleItem(it.id)
      })),
      ...pluginItems.map((it) => ({
        id: it.id,
        label: (si.includes(it.id) ? '✓ ' : '　') + it.label,
        icon: it.icon,
        run: () => toggleItem(it.id)
      }))
    ]
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: '功能区',
      items: [
        { id: 'items', label: '功能区按钮', icon: 'sliders', submenu: options },
        {
          id: 'pos',
          label: '显示位置',
          icon: 'layout-both',
          submenu: POSITIONS.map((p) => ({
            id: p.id,
            label: (settings.ribbonPosition === p.id ? '✓ ' : '　') + p.label,
            run: () => updateSettings({ ribbonPosition: p.id })
          }))
        },
        { id: 'd1', divider: true },
        { id: 'hide', label: '关闭功能区', icon: 'x', run: () => toggleRibbon(false) }
      ]
    })
  }
  const buttons = visibleIds
    .map((id) => {
      if (id.startsWith('plugin:')) return pluginItems.find((p) => p.id === id) || null
      const meta = RIBBON_META[id]
      return meta ? { id, label: meta.label, icon: meta.icon } : null
    })
    .filter(Boolean) as { id: string; label: string; icon: string }[]

  return (
    <div
      className={(inline ? 'ribbon-inline' : 'ribbon' + (settings.ribbonPosition === 'right' ? ' right' : ''))}
      onContextMenu={onRibbonContext}
      role="toolbar"
      aria-label="功能区"
    >
      {buttons.map((b, i) => (
        <React.Fragment key={b.id}>
          <button
            className={'ribbon-btn' + (isActive(b.id) ? ' active' : '')}
            title={b.label}
            data-tip={b.label}
            onClick={() => handleItem(b.id)}
          >
            <Icon name={b.icon} size={inline ? 13 : 17} />
          </button>
          {!inline && i === buttons.length - 3 && <div className="ribbon-sep" />}
        </React.Fragment>
      ))}
      {!buttons.length && !inline && (
        <button className="ribbon-btn" title="配置功能区" onClick={(e) => onRibbonContext(e)}>
          <Icon name="sliders" size={17} />
        </button>
      )}
    </div>
  )
}

export default Ribbon
