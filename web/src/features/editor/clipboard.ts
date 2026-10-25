/**
 * Clipboard helpers for the document context menu. Rich paste goes through the
 * async Clipboard API where permitted, plain paste always works.
 */
import { useStore } from '@/store'
import { getBridge } from './bridge'
import { mdToPlainText } from './mdRenderer'

const toast = (text: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info') =>
  useStore.getState().toast({ kind, text })

export async function friendlyCopy() {
  const sel = getBridge()?.getSelection() || ''
  if (!sel) return
  try {
    await navigator.clipboard.writeText(sel)
    toast('已复制', 'ok')
  } catch {
    document.execCommand('copy')
  }
}

export async function friendlyCut() {
  const bridge = getBridge()
  const sel = bridge?.getSelection() || ''
  if (!sel) return
  try {
    await navigator.clipboard.writeText(sel)
  } catch {
    /* clipboard may be blocked */
  }
  bridge?.insert('')
}

export async function friendlyPaste() {
  const bridge = getBridge()
  if (!bridge) return
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      bridge.insert(text)
      return
    }
  } catch {
    /* fall through */
  }
  toast('浏览器阻止了读取剪贴板，请使用 Ctrl+V', 'warn')
}

export async function pastePlainText() {
  const bridge = getBridge()
  if (!bridge) return
  try {
    const items = await navigator.clipboard.read()
    for (const it of items) {
      if (it.types.includes('text/html')) {
        const html = await (await it.getType('text/html')).text()
        const div = document.createElement('div')
        div.innerHTML = html
        const plain = mdToPlainText(div.textContent || '')
        bridge.insert(plain)
        return
      }
      if (it.types.includes('text/plain')) {
        bridge.insert(await (await it.getType('text/plain')).text())
        return
      }
    }
  } catch {
    toast('浏览器阻止了读取剪贴板，请使用 Ctrl+Shift+V', 'warn')
  }
}
