/**
 * Markdown formatting actions shared by the toolbar, context menu, ribbon,
 * command palette and keyboard shortcuts.
 */
import { useStore } from '@/store'
import { getBridge } from './bridge'
import { pickAndUploadImage } from './upload'
import { promptText } from './dialogs'

const toast = (text: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info') =>
  useStore.getState().toast({ kind, text })

const NO_EDITOR = '编辑器尚未就绪'

export function wrapInline(prefix: string, suffix = prefix, placeholder = '文本'): void {
  const b = getBridge()
  if (!b) return toast(NO_EDITOR, 'warn')
  const sel = b.getSelection()
  b.insert(sel ? prefix + sel + suffix : prefix + placeholder + suffix)
  b.focus()
}

export function insertBlock(markdown: string): void {
  const b = getBridge()
  if (!b) return toast(NO_EDITOR, 'warn')
  b.insert('\n' + markdown + '\n')
  b.focus()
}

export const bold = () => wrapInline('**', '**', '加粗文本')
export const italic = () => wrapInline('*', '*', '斜体文本')
export const strike = () => wrapInline('~~', '~~', '删除线')
export const highlight = () => wrapInline('==', '==', '高亮')
export const inlineCode = () => wrapInline('`', '`', '代码')
export const codeBlock = () => insertBlock('```\n代码\n```')
export const quote = () => insertBlock('> 引用内容')
export const todoList = () => insertBlock('- [ ] 待办事项')
export const unorderedList = () => insertBlock('- 列表项')
export const orderedList = () => insertBlock('1. 列表项')
export const divider = () => insertBlock('---')
export const table = () => insertBlock('| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |')
export const formula = () => insertBlock('$$\nE = mc^2\n$$')
export const footnote = () => insertBlock('脚注内容[^1]\n\n[^1]: 脚注说明')

export function heading(level: number): void {
  const b = getBridge()
  if (!b) return toast(NO_EDITOR, 'warn')
  const sel = b.getSelection().replace(/\s*\n\s*/g, ' ').trim()
  if (level < 1) {
    // level 0 = normal paragraph: no leading #
    b.insert('\n' + (sel || '正文段落') + '\n')
    b.focus()
    return
  }
  const lv = Math.min(6, level)
  b.insert('\n' + '#'.repeat(lv) + ' ' + (sel || `标题 ${lv}`) + '\n')
  b.focus()
}

export async function insertLink(): Promise<void> {
  const b = getBridge()
  if (!b) return toast(NO_EDITOR, 'warn')
  const sel = b.getSelection()
  const url = await promptText({
    title: '插入链接',
    label: '链接地址',
    value: 'https://',
    icon: 'link',
    confirmText: '插入'
  })
  if (!url) return
  b.insert(`[${sel || '链接文字'}](${url})`)
  b.focus()
}

export async function insertImage(): Promise<void> {
  const b = getBridge()
  if (!b) return toast(NO_EDITOR, 'warn')
  try {
    const res = await pickAndUploadImage()
    if (!res) return
    b.insert(`![图片](${res.url})`)
    b.focus()
    if (res.fallback) {
      toast('未配置对象存储，图片已以内嵌方式插入', 'warn')
    }
  } catch (e) {
    toast('图片插入失败：' + ((e as Error)?.message || ''), 'error')
  }
}

/** Called by the editor upload hook (paste / drag / drop). */
export async function handleEditorUpload(file: File): Promise<string | null> {
  try {
    const res = await uploadFile(file)
    if (res.fallback) toast('未配置对象存储，图片已以内嵌方式插入', 'warn')
    return res.url
  } catch (e) {
    toast('上传失败：' + ((e as Error)?.message || ''), 'error')
    return null
  }
}

async function uploadFile(file: File) {
  const { uploadBinary } = await import('./upload')
  return uploadBinary(file, 'tupian')
}
