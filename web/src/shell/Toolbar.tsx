/**
 * Toolbar — markdown formatting strip shown above the document body.
 * Hidden when settings.showToolbar is false.
 */
import React from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
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
} from '@/features/editor/mdActions'
import { runAiAction } from '@/features/editor/aiActions'
import type { PageWidth, ViewMode } from '@/lib/contracts'

const HEADINGS = [1, 2, 3, 4, 5, 6]

const Toolbar: React.FC = () => {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const pageWidth = useStore((s) => s.pageWidth)
  const setPageWidth = useStore((s) => s.setPageWidth)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const openContextMenu = useStore((s) => s.openContextMenu)

  if (!settings.showToolbar) return null

  const Btn: React.FC<{ icon: string; tip: string; onClick: () => void; active?: boolean }> = ({
    icon,
    tip,
    onClick,
    active
  }) => (
    <button className={'btn-icon' + (active ? ' active' : '')} title={tip} data-tip={tip} onClick={onClick}>
      <Icon name={icon} size={15} />
    </button>
  )

  const headingMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        ...HEADINGS.map((lv) => ({
          id: 'h' + lv,
          label: `H${lv} 标题`,
          icon: 'headings',
          hint: `Ctrl+${lv}`,
          run: () => heading(lv)
        })),
        { id: 'd0', divider: true },
        { id: 'p', label: '正文段落', icon: 'file-text', hint: 'Ctrl+0', run: () => heading(0) }
      ]
    })
  }

  const moreMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu({
      x: rect.left - 140,
      y: rect.bottom + 4,
      items: [
        { id: 'divider', label: '分割线', icon: 'hr', run: divider },
        { id: 'footnote', label: '脚注', icon: 'footnote', run: footnote },
        { id: 'formula', label: '公式', icon: 'formula', run: formula },
        { id: 'table', label: '表格', icon: 'table', run: table },
        { id: 'd1', divider: true },
        {
          id: 'toolbar',
          label: (settings.showToolbar ? '✓ ' : '　') + '显示格式工具栏',
          icon: 'sliders',
          run: () => updateSettings({ showToolbar: !settings.showToolbar })
        },
        {
          id: 'spell',
          label: (settings.spellcheck ? '✓ ' : '　') + '拼写检查',
          icon: 'check',
          run: () => updateSettings({ spellcheck: !settings.spellcheck })
        },
        {
          id: 'width',
          label: '页宽',
          icon: 'maximize',
          submenu: (['standard', 'wide', 'full'] as PageWidth[]).map((w) => ({
            id: 'w-' + w,
            label: (pageWidth === w ? '✓ ' : '　') + (w === 'standard' ? '标准' : w === 'wide' ? '宽' : '铺满'),
            run: () => setPageWidth(w)
          }))
        },
        { id: 'settings', label: '编辑器设置…', icon: 'settings', run: async () => (await import('@/shell/SettingsDialog')).openSettings() }
      ]
    })
  }

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <button className="btn-icon" title="撤销" onClick={() => document.execCommand('undo')}>
          <Icon name="undo" size={15} />
        </button>
        <button className="btn-icon" title="重做" onClick={() => document.execCommand('redo')}>
          <Icon name="redo" size={15} />
        </button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button className="btn-icon" title="标题级别" onClick={headingMenu}>
          <Icon name="headings" size={15} />
        </button>
        <Btn icon="bold" tip="加粗 (Ctrl+B)" onClick={bold} />
        <Btn icon="italic" tip="斜体 (Ctrl+I)" onClick={italic} />
        <Btn icon="strike" tip="删除线 (Ctrl+Shift+X)" onClick={strike} />
        <Btn icon="highlight" tip="高亮 (Ctrl+Shift+H)" onClick={highlight} />
        <Btn icon="code" tip="行内代码 (Ctrl+Shift+C)" onClick={inlineCode} />
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <Btn icon="code-block" tip="代码块" onClick={codeBlock} />
        <Btn icon="quote" tip="引用" onClick={quote} />
        <Btn icon="list-todo" tip="待办 (Ctrl+Shift+T)" onClick={todoList} />
        <Btn icon="list" tip="无序列表 (Ctrl+Shift+8)" onClick={unorderedList} />
        <Btn icon="list-ordered" tip="有序列表 (Ctrl+Shift+7)" onClick={orderedList} />
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <Btn icon="link" tip="插入链接 (Ctrl+K)" onClick={() => void insertLink()} />
        <Btn icon="image" tip="插入图片（上传到对象存储）" onClick={() => void insertImage()} />
        <Btn icon="table" tip="插入表格" onClick={table} />
        <Btn icon="formula" tip="插入公式" onClick={formula} />
        <Btn icon="footnote" tip="插入脚注" onClick={footnote} />
        <Btn icon="hr" tip="插入分割线" onClick={divider} />
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button className="btn-icon" title="AI 写作" onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          openContextMenu({
            x: rect.left - 60,
            y: rect.bottom + 4,
            items: [
              { id: 'continue', label: 'AI 续写', icon: 'sparkles', run: () => void runAiAction('continue') },
              { id: 'polish', label: 'AI 润色', icon: 'edit', run: () => void runAiAction('polish') },
              { id: 'format', label: 'AI 排版', icon: 'list', run: () => void runAiAction('format') },
              { id: 'summary', label: 'AI 总结', icon: 'file-text', run: () => void runAiAction('summary') },
              { id: 'translate', label: 'AI 翻译', icon: 'globe', run: () => void runAiAction('translate') }
            ]
          })
        }}>
          <Icon name="sparkles" size={15} />
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <div className="toolbar-group">
        <button
          className="btn-icon"
          title={'页宽：' + (pageWidth === 'standard' ? '标准' : pageWidth === 'wide' ? '宽' : '铺满')}
          onClick={() =>
            setPageWidth(pageWidth === 'standard' ? 'wide' : pageWidth === 'wide' ? 'full' : 'standard')
          }
        >
          <Icon name="maximize" size={15} />
        </button>
        <button
          className="btn-icon"
          title="视图模式"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const modes: { id: ViewMode; label: string; icon: string }[] = [
              { id: 'wysiwyg', label: '所见即所得', icon: 'edit' },
              { id: 'source', label: '源码模式', icon: 'code' },
              { id: 'split', label: '对照模式', icon: 'columns' },
              { id: 'preview', label: '阅读视图', icon: 'eye' }
            ]
            openContextMenu({
              x: rect.left - 100,
              y: rect.bottom + 4,
              items: modes.map((m) => ({
                id: m.id,
                label: (viewMode === m.id ? '✓ ' : '　') + m.label,
                icon: m.icon,
                run: () => setViewMode(m.id)
              }))
            })
          }}
        >
          <Icon name={viewMode === 'preview' ? 'eye' : viewMode === 'source' ? 'code' : viewMode === 'split' ? 'columns' : 'edit'} size={15} />
        </button>
        <button className="btn-icon" title="更多" onClick={moreMenu}>
          <Icon name="more" size={15} />
        </button>
      </div>
    </div>
  )
}

export default Toolbar
