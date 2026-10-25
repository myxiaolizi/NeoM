/**
 * Tab context menu items (and helpers reused by the file tree menus).
 */
import { useStore, type ContextMenuItem, type Tab } from '@/store'
import { isDesktop } from '@/lib/platform'
import { currentVault, fileService } from '@/features/files/fileService'
import { reloadFileTree } from '@/features/files/fileService'
import { promptFileName } from '@/features/editor/dialogs'
import { rebindPath, saveDoc, closeFile } from '@/features/editor/docRepo'

export const findTab = (id: string | null) => useStore.getState().tabs.find((t) => t.id === id) || null

export function setTabView(tab: Tab, mode: Tab['viewMode'], lock = false) {
  const st = useStore.getState()
  st.updateTab(tab.id, { viewMode: mode })
  if (st.activeTabId === tab.id) st.setViewMode(mode)
  if (lock) st.toast({ kind: 'info', text: '已锁定为阅读视图' })
}

export async function renameTabFile(tab: Tab) {
  const next = await promptFileName(tab.name, { title: '重命名文件' })
  if (!next || next === tab.name) return
  const st = useStore.getState()
  try {
    const dir = tab.path.split('/').slice(0, -1).join('/')
    const to = dir ? `${dir}/${next}` : next
    await fileService.rename(currentVault(), tab.path, to)
    rebindPath(tab.path, to)
    await reloadFileTree(true)
    st.toast({ kind: 'ok', text: '已重命名' })
  } catch (e) {
    st.toast({ kind: 'error', text: '重命名失败：' + ((e as Error)?.message || '') })
  }
}

export function tabMenuItems(tab: Tab): ContextMenuItem[] {
  const st = useStore.getState()
  const closeMenu = () => st.closeContextMenu()
  const doSave = async () => { await saveDoc(tab.path, { naming: false }) }

  return [
    { id: 'save', label: '保存', icon: 'save', hint: 'Ctrl+S', run: doSave },
    { id: 'd0', divider: true },
    { id: 'close', label: '关闭当前', icon: 'x', hint: 'Ctrl+W', run: () => { closeTabSafely(tab.id) } },
    { id: 'closeOthers', label: '关闭其他', icon: 'x', run: () => {
      const dirty = st.tabs.filter((t) => t.id !== tab.id && t.dirty)
      if (dirty.length) st.toast({ kind: 'warn', text: `${dirty.length} 个标签有未保存内容，已自动保存` })
      void Promise.all(dirty.map((t) => saveDoc(t.path, { naming: false, silent: true })))
      st.closeOtherTabs(tab.id)
    } },
    { id: 'closeRight', label: '关闭右侧', icon: 'chevron-right', run: () => st.closeTabsToRight(tab.id) },
    { id: 'closeAll', label: '关闭全部', icon: 'x', run: () => {
      const dirty = st.tabs.filter((t) => t.dirty)
      void Promise.all(dirty.map((t) => saveDoc(t.path, { naming: false, silent: true })))
      st.closeAllTabs()
    } },
    { id: 'd1', divider: true },
    { id: 'lock', label: '锁定为阅读视图', icon: 'lock', run: () => setTabView(tab, 'preview') },
    { id: 'source', label: '源码模式', icon: 'code', run: () => setTabView(tab, 'source') },
    { id: 'd2', divider: true },
    {
      id: 'newWindow',
      label: '移动至新窗口',
      icon: 'external',
      run: () => {
        if (isDesktop) {
          const w = (window as unknown as { neom?: { openWindow?: (p: string) => void } }).neom
          if (w?.openWindow) w.openWindow(tab.path)
          else window.open(`/app`, '_blank')
        } else {
          window.open(`/app/${tab.path.split('/').map(encodeURIComponent).join('/')}`, '_blank', 'noopener')
        }
        closeMenu()
      }
    },
    {
      id: 'split',
      label: '分屏',
      icon: 'columns',
      submenu: [
        {
          id: 'splitH',
          label: '左右分屏',
          icon: 'columns',
          run: () => {
            st.setSplitMode('vertical')
            const other = st.tabs.find((t) => t.path !== tab.path)
            if (other) st.setSplitTab(other.id)
          }
        },
        {
          id: 'splitV',
          label: '上下分屏',
          icon: 'rows',
          run: () => {
            st.setSplitMode('horizontal')
            const other = st.tabs.find((t) => t.path !== tab.path)
            if (other) st.setSplitTab(other.id)
          }
        },
        { id: 'splitOff', label: '取消分屏', run: () => st.setSplitMode('none') }
      ]
    },
    { id: 'd3', divider: true },
    {
      id: 'find',
      label: '查找',
      icon: 'search',
      hint: 'Ctrl+F',
      run: () => window.dispatchEvent(new CustomEvent('neom:open-find', { detail: { path: tab.path, replace: false } }))
    },
    {
      id: 'replace',
      label: '替换',
      icon: 'edit',
      hint: 'Ctrl+H',
      run: () => window.dispatchEvent(new CustomEvent('neom:open-find', { detail: { path: tab.path, replace: true } }))
    },
    { id: 'rename', label: '重命名', icon: 'edit', run: () => renameTabFile(tab) },
    {
      id: 'copyPath',
      label: '复制路径',
      icon: 'copy',
      run: async () => {
        await navigator.clipboard?.writeText(tab.path)
        st.toast({ kind: 'ok', text: '路径已复制' })
      }
    }
  ]
}

export function closeTabSafely(id: string) {
  const st = useStore.getState()
  const tab = st.tabs.find((t) => t.id === id)
  if (!tab) return
  if (tab.dirty) void saveDoc(tab.path, { naming: false, silent: true })
  closeFile(tab.path)
  st.closeTab(id)
}
