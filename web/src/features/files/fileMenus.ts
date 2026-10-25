/**
 * File / folder / blank-area context menus for the left sidebar tree.
 */
import { useStore, type ContextMenuItem } from '@/store'
import { currentVault, fileService, reloadFileTree } from './fileService'
import { parentOf, nameOf, sortNodes } from './fileUtils'
import type { FileNode, SortDir, SortKey } from '@/lib/contracts'
import { openFile } from '@/features/editor/docRepo'
import { promptFileName, promptFolderName, promptText } from '@/features/editor/dialogs'
import { copyName } from '@/lib/fs'
import { revealAnyPath } from './pathActions'
import { isDesktop } from '@/lib/platform'

const toast = (text: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'ok') =>
  useStore.getState().toast({ kind, text })

async function doRename(node: FileNode) {
  const next = await promptFileName(node.name, { title: node.is_dir ? '重命名文件夹' : '重命名文件' })
  if (!next || next === node.name) return
  try {
    const dir = parentOf(node.path)
    await fileService.rename(currentVault(), node.path, dir ? `${dir}/${next}` : next)
    const { rebindPath } = await import('@/features/editor/docRepo')
    if (!node.is_dir) rebindPath(node.path, dir ? `${dir}/${next}` : next)
    await reloadFileTree(true)
    toast('已重命名')
  } catch (e) {
    toast('重命名失败：' + ((e as Error)?.message || ''), 'error')
  }
}

async function doCopy(node: FileNode) {
  try {
    await fileService.copy(currentVault(), node.path, copyName(node.path))
    await reloadFileTree(true)
    toast('已创建副本')
  } catch (e) {
    toast('创建副本失败：' + ((e as Error)?.message || ''), 'error')
  }
}

async function doDelete(node: FileNode) {
  const st = useStore.getState()
  const { confirmAction } = await import('@/features/editor/dialogs')
  const ok = await confirmAction({
    title: node.is_dir ? '删除文件夹' : '删除文件',
    text: node.is_dir
      ? `确定删除文件夹「${node.name}」及其中的全部文件吗？此操作不可撤销。`
      : `确定删除「${node.name}」吗？云端仓库会移入回收站以保留一份快照。`,
    danger: true,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await fileService.remove(currentVault(), node.path)
    st.removeFile(node.path)
    for (const t of st.tabs.filter((x) => x.path === node.path || x.path.startsWith(node.path + '/'))) {
      st.closeTab(t.id)
    }
    await reloadFileTree(true)
    toast('已删除')
  } catch (e) {
    toast('删除失败：' + ((e as Error)?.message || ''), 'error')
  }
}

async function doMove(node: FileNode) {
  const st = useStore.getState()
  const dirs = st.files.filter((f) => f.is_dir && !node.path.startsWith(f.path))
  const target = await promptText({
    title: '移动文件至…',
    label: '目标文件夹（留空表示仓库根目录）',
    placeholder: '例如：笔记/工作',
    icon: 'folder',
    confirmText: '移动',
    value: '',
    hint: dirs.length ? '已有文件夹：' + dirs.slice(0, 8).map((d) => d.path).join('、') : '仓库内还没有子文件夹'
  })
  if (target === null) return
  try {
    const dest = target.trim()
    const name = nameOf(node.path)
    await fileService.move(currentVault(), node.path, dest ? `${dest}/${name}` : name)
    const { rebindPath } = await import('@/features/editor/docRepo')
    if (!node.is_dir) rebindPath(node.path, dest ? `${dest}/${name}` : name)
    await reloadFileTree(true)
    toast('已移动')
  } catch (e) {
    toast('移动失败：' + ((e as Error)?.message || ''), 'error')
  }
}

function sortTokens(key: SortKey, dir: SortDir) {
  return { key, dir }
}

export function fileContextMenu(node: FileNode, x: number, y: number) {
  const st = useStore.getState()
  const vault = currentVault()
  const isDir = node.is_dir

  const openInSplit = () => {
    st.setSplitMode('vertical')
    const id = openFile(node.path, { group: 'side' })
    if (id) st.setSplitTab(id)
  }

  const openInNewTab = () => openFile(node.path, { preview: false })

  const exportAs = (format: 'docx' | 'pdf' | 'html' | 'md') => async () => {
    try {
      const { API } = await import('@/lib/contracts')
      const { downloadFile } = await import('@/lib/api')
      await downloadFile(API.filesExport, { path: node.path, format, vault }, node.name.replace(/\.md$/, '') + '.' + format)
      toast('已开始导出')
    } catch (e) {
      if (format === 'html' || format === 'md') {
        const { renderStandaloneHtml } = await import('@/features/editor/mdRenderer')
        const doc = await fileService.read(vault, node.path)
        const html = format === 'md' ? doc.content : renderStandaloneHtml(node.name, doc.content)
        const blob = new Blob([html], { type: format === 'md' ? 'text/markdown' : 'text/html' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = node.name.replace(/\.md$/, '') + '.' + format
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
        toast('已在本地导出')
      } else {
        toast('导出失败：' + ((e as Error)?.message || ''), 'error')
      }
    }
  }

  const items: ContextMenuItem[] = isDir
    ? [
        { id: 'newDoc', label: '新建 Markdown 文档', icon: 'file-plus', run: async () => {
          const res = await fileService.create(currentVault(), node.path)
          await reloadFileTree(true)
          st.toggleExpanded(node.path)
          openFile(res.path, { preview: false })
        } },
        { id: 'newFolder', label: '新建子文件夹', icon: 'folder-plus', run: async () => {
          const name = await promptFolderName()
          if (!name) return
          await fileService.mkdir(currentVault(), node.path, name)
          st.toggleExpanded(node.path)
          await reloadFileTree(true)
        } },
        { id: 'newCanvas', label: '新建白板', icon: 'canvas', run: async () => {
          const res = await fileService.create(currentVault(), node.path, '白板')
          await fileService.write(currentVault(), res.path.replace(/\.md$/, '.canvas'), '{"nodes":[],"edges":[]}')
          await fileService.remove(currentVault(), res.path)
          await reloadFileTree(true)
          st.toast({ kind: 'info', text: '白板由插件提供渲染，文件已创建' })
        } },
        { id: 'd1', divider: true },
        { id: 'rename', label: '重命名文件夹', icon: 'edit', run: () => void doRename(node) },
        {
          id: 'sort',
          label: '排序',
          icon: 'sort',
          submenu: [
            { id: 'mtime', label: '按修改时间', icon: 'clock', run: () => applySort('mtime', st.settings.sortDir) },
            { id: 'ctime', label: '按创建时间', icon: 'calendar', run: () => applySort('ctime', st.settings.sortDir) },
            { id: 'name', label: '按文件名', icon: 'sort', run: () => applySort('name', 'asc') },
            { id: 'd2', divider: true },
            { id: 'asc', label: '升序', run: () => applySort(st.settings.sortKey, 'asc') },
            { id: 'desc', label: '降序', run: () => applySort(st.settings.sortKey, 'desc') }
          ]
        },
        { id: 'reveal', label: '打开所在文件夹', icon: 'folder-open', disabled: !isDesktop, run: () => void revealAnyPath(node.path) },
        { id: 'sync', label: '同步当前目录', icon: 'sync', run: async () => {
          try {
            const r = await fileService.sync(currentVault())
            await reloadFileTree(true)
            toast(`同步完成：拉取 ${r?.pulled ?? 0}，推送 ${r?.pushed ?? 0}`)
          } catch {
            toast('当前离线，无法同步', 'warn')
          }
        } },
        { id: 'd3', divider: true },
        { id: 'delete', label: '删除文件夹', icon: 'trash', danger: true, run: () => void doDelete(node) }
      ]
    : [
        { id: 'open', label: '打开', icon: 'file-text', run: () => openFile(node.path) },
        { id: 'openNew', label: '在新标签页打开', icon: 'external', run: openInNewTab },
        { id: 'openSplit', label: '在右侧分屏打开', icon: 'columns', run: openInSplit },
        { id: 'd1', divider: true },
        { id: 'rename', label: '重命名', icon: 'edit', run: () => void doRename(node) },
        { id: 'copy', label: '创建副本', icon: 'copy', run: () => void doCopy(node) },
        { id: 'move', label: '移动文件至…', icon: 'folder', run: () => void doMove(node) },
        {
          id: 'copyPath',
          label: '复制文件路径',
          icon: 'link',
          run: async () => {
            await navigator.clipboard?.writeText(node.path)
            toast('路径已复制')
          }
        },
        { id: 'reveal', label: '打开文件所在文件夹', icon: 'folder-open', disabled: !isDesktop, run: () => void revealAnyPath(node.path) },
        { id: 'd2', divider: true },
        {
          id: 'history',
          label: '查看历史版本',
          icon: 'history',
          run: () => {
            st.toggleLeft(true)
            st.setLeftView('files')
            st.setLeftPanel('history')
            st.setSelectedPath(node.path)
            openFile(node.path)
          }
        },
        { id: 'share', label: '分享/发布文档', icon: 'share', run: async () => {
          const { openShareDialog } = await import('./ShareDialog')
          openShareDialog(node.path)
        } },
        {
          id: 'export',
          label: '导出为',
          icon: 'download',
          submenu: [
            { id: 'docx', label: 'Word (.docx)', run: exportAs('docx') },
            { id: 'pdf', label: 'PDF', run: exportAs('pdf') },
            { id: 'html', label: 'HTML', run: exportAs('html') },
            { id: 'md', label: 'Markdown (.md)', run: exportAs('md') }
          ]
        },
        { id: 'd3', divider: true },
        { id: 'delete', label: '删除文件', icon: 'trash', danger: true, run: () => void doDelete(node) }
      ]

  st.openContextMenu({ x, y, title: node.name, items })
}

export function blankContextMenu(x: number, y: number, scopeDir = '') {
  const st = useStore.getState()
  st.openContextMenu({
    x,
    y,
    title: scopeDir || '仓库根目录',
    items: [
      { id: 'newDoc', label: '新建 Markdown 文档', icon: 'file-plus', run: async () => {
        const res = await fileService.create(currentVault(), scopeDir)
        await reloadFileTree(true)
        openFile(res.path, { preview: false })
      } },
      { id: 'newFolder', label: '新建子文件夹', icon: 'folder-plus', run: async () => {
        const name = await promptFolderName()
        if (!name) return
        await fileService.mkdir(currentVault(), scopeDir, name)
        await reloadFileTree(true)
      } },
      { id: 'newCanvas', label: '新建白板', icon: 'canvas', run: () => {
        st.toast({ kind: 'info', text: '白板视图由插件提供，请先在插件中心启用「白板」' })
      } },
      { id: 'd1', divider: true },
      { id: 'sortM', label: '按修改时间排序', icon: 'clock', run: () => applySort('mtime', st.settings.sortDir) },
      { id: 'sortC', label: '按创建时间排序', icon: 'calendar', run: () => applySort('ctime', st.settings.sortDir) },
      { id: 'sortN', label: '按文件名排序', icon: 'sort', run: () => applySort('name', 'asc') },
      { id: 'd2', divider: true },
      { id: 'reveal', label: '打开所在文件夹', icon: 'folder-open', disabled: !isDesktop, run: () => void revealAnyPath(scopeDir) },
      { id: 'sync', label: '同步当前目录', icon: 'sync', run: async () => {
        try {
          const r = await fileService.sync(currentVault())
          await reloadFileTree(true)
          toast(`同步完成：拉取 ${r?.pulled ?? 0}，推送 ${r?.pushed ?? 0}`)
        } catch {
          toast('当前离线，无法同步', 'warn')
        }
      } }
    ]
  })
}

/** Apply + persist the sort setting for the tree. */
export function applySort(key: SortKey, dir: SortDir) {
  const st = useStore.getState()
  st.updateSettings({ sortKey: key, sortDir: dir })
  const sorted = sortNodes(st.files, key, dir)
  st.setFiles(sorted)
  void sortTokens(key, dir)
}

export default fileContextMenu
