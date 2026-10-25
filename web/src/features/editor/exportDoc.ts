/**
 * Document export — backend `/api/files/export` when available, with local
 * HTML/Markdown fallbacks so the feature works offline.
 */
import { API } from '@/lib/contracts'
import { downloadFile } from '@/lib/api'
import { useStore } from '@/store'
import { currentVault, fileService } from '@/features/files/fileService'
import { getBridge } from './bridge'
import { renderStandaloneHtml } from './mdRenderer'

export type ExportFormat = 'docx' | 'pdf' | 'html' | 'md'

const MIME: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  html: 'text/html',
  md: 'text/markdown'
}

function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

function openPrintWindow(title: string, html: string) {
  const w = window.open('', '_blank', 'width=900,height=720')
  if (!w) {
    useStore.getState().toast({ kind: 'warn', text: '浏览器阻止了弹出窗口，请允许后重试' })
    return
  }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 350)
  void title
}

export async function exportDoc(path: string, format: ExportFormat, title?: string) {
  const st = useStore.getState()
  const vault = currentVault()
  const name = (title || path.split('/').pop() || '文档').replace(/\.(md|mdx|txt)$/i, '')
  const filename = name + '.' + format
  try {
    await downloadFile(API.filesExport, { path, format, vault }, filename)
    st.toast({ kind: 'ok', text: '已开始导出 ' + filename })
    return
  } catch {
    /* fall back to local rendering */
  }
  try {
    const doc = await fileService.read(vault, path)
    if (format === 'md') {
      saveBlob(new Blob([doc.content], { type: MIME.md }), filename)
      st.toast({ kind: 'ok', text: '已导出 Markdown' })
      return
    }
    const html = renderStandaloneHtml(name, doc.content)
    if (format === 'html') {
      saveBlob(new Blob([html], { type: MIME.html }), filename)
      st.toast({ kind: 'ok', text: '已导出 HTML' })
      return
    }
    // docx / pdf need the backend; use the print dialog for PDF
    openPrintWindow(name, html)
    st.toast({ kind: 'info', text: format === 'pdf' ? '请在打印对话框中选择「另存为 PDF」' : 'Word 导出需要服务端支持，已改用打印方式' })
  } catch (e) {
    st.toast({ kind: 'error', text: '导出失败：' + ((e as Error)?.message || '') })
  }
}

export async function exportCurrentDoc(format: ExportFormat) {
  const st = useStore.getState()
  const tab = st.tabs.find((t) => t.id === st.activeTabId)
  if (!tab) {
    st.toast({ kind: 'warn', text: '请先打开一篇文档' })
    return
  }
  const bridge = getBridge()
  if (bridge) {
    const value = bridge.getValue()
    const name = tab.name.replace(/\.(md|mdx|txt)$/i, '')
    if (format === 'md') {
      saveBlob(new Blob([value], { type: MIME.md }), name + '.md')
      st.toast({ kind: 'ok', text: '已导出 Markdown' })
      return
    }
    if (format === 'html') {
      saveBlob(new Blob([renderStandaloneHtml(name, value)], { type: MIME.html }), name + '.html')
      st.toast({ kind: 'ok', text: '已导出 HTML' })
      return
    }
    if (format === 'pdf') {
      openPrintWindow(name, renderStandaloneHtml(name, value))
      return
    }
  }
  await exportDoc(tab.path, format, tab.name)
}
