/**
 * Full-screen / floating window hosts for plugin panels.
 * Works with or without a shell-provided `fullScreenHost`, so canvas / graph /
 * slides always have somewhere to render.
 */
import React, { Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PANELS } from './panels'
import type { PluginContext } from './types'

interface Entry {
  root: Root
  el: HTMLElement
  owned: boolean
  onKey?: (e: KeyboardEvent) => void
}

const entries = new Map<string, Entry>()

const teardown = (key: string) => {
  const e = entries.get(key)
  if (!e) return
  entries.delete(key)
  if (e.onKey) window.removeEventListener('keydown', e.onKey, true)
  try { e.root.unmount() } catch { /* already unmounted */ }
  if (e.owned) e.el.remove()
}

export const isWindowOpen = (key: string) => entries.has(key)

/** Mount a plugin panel into a shell-provided container (or tear it down). */
export const mountFullScreen = (key: string, ctx: PluginContext, container?: HTMLElement | null) => {
  if (!container) { teardown(key); return }
  const prev = entries.get(key)
  if (prev && prev.el !== container) teardown(key)
  let entry = entries.get(key)
  if (!entry) {
    entry = { root: createRoot(container), el: container, owned: false }
    entries.set(key, entry)
  }
  const Comp = PANELS[key]
  if (!Comp) return
  entry.root.render(
    <Suspense fallback={<div className="plg-fs-loading"><span className="spinner" /></div>}>
      <Comp context={ctx} full onClose={() => teardown(key)} />
    </Suspense>
  )
}

/**
 * Open a plugin panel in its own overlay.
 * `full` = edge-to-edge canvas/graph workspace; otherwise a floating window.
 */
export const openPluginWindow = (key: string, ctx: PluginContext, opts: { full?: boolean; title?: string } = {}) => {
  if (entries.has(key)) { teardown(key); if (!opts.full) return }
  const Comp = PANELS[key]
  if (!Comp) {
    ctx.toast('插件面板未注册', 'warn')
    return
  }
  const el = document.createElement('div')
  el.className = opts.full ? 'plg-fs-overlay' : 'plg-window-mask'
  document.body.appendChild(el)
  const entry: Entry = { root: createRoot(el), el, owned: true }
  entries.set(key, entry)
  const close = () => teardown(key)
  entry.onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }
  window.addEventListener('keydown', entry.onKey, true)

  const body = (
    <Suspense fallback={<div className="plg-fs-loading"><span className="spinner" /></div>}>
      <Comp context={ctx} full={!!opts.full} onClose={close} />
    </Suspense>
  )
  entry.root.render(
    opts.full ? (
      <>
        {body}
        <button type="button" className="plg-fs-close" onClick={close} title="关闭 (Esc)">
          <span aria-hidden="true">×</span>
        </button>
      </>
    ) : (
      <div className="plg-window" onMouseDown={(e) => { if (e.target === e.currentTarget) return }}>
        <div className="plg-window-head">
          <span className="grow ellipsis">{opts.title || compTitle(key)}</span>
          <button type="button" className="plg-icon-btn" onClick={close} title="关闭">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="plg-window-body">{body}</div>
      </div>
    )
  )
}

const compTitle = (key: string) => {
  const map: Record<string, string> = {
    canvas: '白板画布',
    'note-restructure': '笔记重组',
    'tag-list': '标签列表',
    'outgoing-links': '出链',
    outline: '大纲',
    publish: '发布',
    backlinks: '反向链接',
    workspace: '工作区',
    graph: '关系图谱',
    slides: '幻灯片',
    'footnote-view': '脚注视图',
    'quick-switcher': '快速切换',
    recorder: '录音机',
    'random-note': '漫游笔记',
    'daily-notes': '日记',
    bookmarks: '书签',
    properties: '属性列表',
    database: '数据库',
    'web-browser': '网页浏览器',
    'file-recovery': '文件恢复',
    'file-explorer': '文件列表',
    'slash-commands': '斜杠命令',
    'page-preview': '页面预览',
    'word-count': '字数统计',
    ai: 'AI 助手'
  }
  return map[key] || 'NeoM 插件'
}

/** Tear down every overlay (called on shell unmount). */
export const closeAllPluginWindows = () => {
  Array.from(entries.keys()).forEach(teardown)
}

export const togglePluginWindow = (key: string, ctx: PluginContext, opts: { full?: boolean } = {}) => {
  if (entries.has(key)) { teardown(key); return }
  openPluginWindow(key, ctx, opts)
}
