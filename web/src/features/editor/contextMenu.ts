/**
 * Document-body right-click menu. Intercepts the native menu inside the editor
 * and offers clipboard, paragraph formatting, element insertion, AI actions,
 * find/replace, view switching and export.
 */
import { useStore, type ContextMenuItem } from '@/store'
import {
  bold,
  codeBlock,
  divider,
  footnote,
  formula,
  heading,
  highlight,
  inlineCode,
  insertImage,
  insertLink,
  italic,
  orderedList,
  quote,
  strike,
  table,
  todoList,
  unorderedList
} from './mdActions'
import { getBridge } from './bridge'
import { runAiAction, readSelectionAloud } from './aiActions'
import { friendlyCopy, friendlyPaste, friendlyCut, pastePlainText } from './clipboard'
import { exportCurrentDoc } from './exportDoc'

const HEADING_ITEMS = (): ContextMenuItem[] => [
  {
    id: 'heading',
    label: '段落格式',
    icon: 'headings',
    submenu: [
      ...[1, 2, 3, 4, 5, 6].map((lv) => ({
        id: 'h' + lv,
        label: `H${lv} 标题`,
        icon: 'headings',
        hint: `Ctrl+${lv}`,
        run: () => heading(lv)
      })),
      { id: 'd0', divider: true },
      { id: 'p', label: '正文段落', hint: 'Ctrl+0', run: () => heading(0) },
      { id: 'd1', divider: true },
      { id: 'bold', label: '加粗', icon: 'bold', hint: 'Ctrl+B', run: bold },
      { id: 'italic', label: '斜体', icon: 'italic', hint: 'Ctrl+I', run: italic },
      { id: 'strike', label: '删除线', icon: 'strike', run: strike },
      { id: 'highlight', label: '高亮', icon: 'highlight', run: highlight },
      { id: 'code', label: '行内代码', icon: 'code', run: inlineCode },
      { id: 'codeblock', label: '代码块', icon: 'code-block', run: codeBlock },
      { id: 'quote', label: '引用', icon: 'quote', run: quote },
      { id: 'todo', label: '待办', icon: 'list-todo', run: todoList },
      { id: 'ul', label: '无序列表', icon: 'list', run: unorderedList },
      { id: 'ol', label: '有序列表', icon: 'list-ordered', run: orderedList }
    ]
  }
]

const INSERT_ITEMS = (): ContextMenuItem[] => [
  {
    id: 'insert',
    label: '插入元素',
    icon: 'plus',
    submenu: [
      { id: 'link', label: '链接', icon: 'link', hint: 'Ctrl+K', run: () => void insertLink() },
      { id: 'image', label: '图片并上传对象存储', icon: 'image', run: () => void insertImage() },
      { id: 'table', label: '表格', icon: 'table', run: table },
      { id: 'formula', label: '公式', icon: 'formula', run: formula },
      { id: 'divider', label: '分割线', icon: 'hr', run: divider },
      { id: 'footnote', label: '脚注', icon: 'footnote', run: footnote },
      {
        id: 'audio',
        label: '录音 / 语音转文字',
        icon: 'mic',
        run: () => {
          useStore.getState().toast({ kind: 'info', text: '录音能力由「录音」插件提供，请在插件中心启用后使用' })
        }
      }
    ]
  }
]

const AI_ITEMS = (): ContextMenuItem[] => [
  {
    id: 'ai',
    label: 'AI',
    icon: 'sparkles',
    submenu: [
      { id: 'continue', label: '续写', icon: 'sparkles', run: () => void runAiAction('continue') },
      { id: 'polish', label: '润色', icon: 'edit', run: () => void runAiAction('polish') },
      { id: 'format', label: '排版', icon: 'list', run: () => void runAiAction('format') },
      { id: 'summary', label: '总结', icon: 'file-text', run: () => void runAiAction('summary') },
      { id: 'translate', label: '翻译选中', icon: 'globe', run: () => void runAiAction('translate') },
      { id: 'd0', divider: true },
      { id: 'tts', label: '朗读选中', icon: 'volume', run: () => void readSelectionAloud() }
    ]
  }
]

export async function editorContextMenu(x: number, y: number, path: string) {
  const st = useStore.getState()
  const bridge = getBridge()
  const hasSelection = !!bridge?.getSelection()

  st.openContextMenu({
    x,
    y,
    title: path.split('/').pop(),
    items: [
      { id: 'cut', label: '剪切', icon: 'scissors', hint: 'Ctrl+X', disabled: !hasSelection, run: () => void friendlyCut() },
      { id: 'copy', label: '复制', icon: 'copy', hint: 'Ctrl+C', disabled: !hasSelection, run: () => void friendlyCopy() },
      { id: 'paste', label: '粘贴', icon: 'paste', hint: 'Ctrl+V', run: () => void friendlyPaste() },
      { id: 'pastePlain', label: '粘贴为纯文本', icon: 'paste', hint: 'Ctrl+Shift+V', run: () => void pastePlainText() },
      { id: 'd1', divider: true },
      ...HEADING_ITEMS(),
      ...INSERT_ITEMS(),
      { id: 'd2', divider: true },
      ...AI_ITEMS(),
      { id: 'd3', divider: true },
      {
        id: 'find',
        label: '查找',
        icon: 'search',
        hint: 'Ctrl+F',
        run: () => window.dispatchEvent(new CustomEvent('neom:open-find', { detail: { path, replace: false } }))
      },
      {
        id: 'replace',
        label: '替换',
        icon: 'edit',
        hint: 'Ctrl+H',
        run: () => window.dispatchEvent(new CustomEvent('neom:open-find', { detail: { path, replace: true } }))
      },
      {
        id: 'view',
        label: '切换视图模式',
        icon: 'eye',
        hint: 'Ctrl+E',
        submenu: [
          { id: 'v-w', label: '所见即所得', icon: 'edit', run: () => st.setViewMode('wysiwyg') },
          { id: 'v-s', label: '源码模式', icon: 'code', run: () => st.setViewMode('source') },
          { id: 'v-c', label: '对照模式', icon: 'columns', run: () => st.setViewMode('split') },
          { id: 'v-p', label: '阅读视图', icon: 'eye', run: () => st.setViewMode('preview') }
        ]
      },
      { id: 'selectAll', label: '全选', icon: 'check', hint: 'Ctrl+A', run: () => document.execCommand('selectAll') },
      { id: 'd4', divider: true },
      {
        id: 'export',
        label: '导出当前文档',
        icon: 'download',
        submenu: [
          { id: 'docx', label: 'Word (.docx)', run: () => void exportCurrentDoc('docx') },
          { id: 'pdf', label: 'PDF', run: () => void exportCurrentDoc('pdf') },
          { id: 'html', label: 'HTML', run: () => void exportCurrentDoc('html') },
          { id: 'md', label: 'Markdown', run: () => void exportCurrentDoc('md') }
        ]
      }
    ]
  })
}
