/**
 * EditorHost — Vditor kernel with four view modes.
 *
 * The Vditor instance is created lazily and destroyed/recreated whenever the
 * view mode changes. Caret offset is stashed before a rebuild and restored
 * afterwards.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Vditor from 'vditor'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { isDesktop, local, revealPath } from '@/lib/platform'
import { loadVditor, resolveVditorCdn } from '@/features/editor/vditorLoader'
import {
  applyDocContent,
  rebindPath,
  saveDoc,
  setDocContent,
  useDoc,
  type DocEntry
} from '@/features/editor/docRepo'
import { fileService, currentVault } from '@/features/files/fileService'
import { parentOf } from '@/features/files/fileUtils'
import { registerBridge, unregisterBridge, setFocusedBridge, getBridge, type BridgeKey } from '@/features/editor/bridge'
import { computeStats } from '@/features/editor/wordCount'
import { MarkdownPreview } from '@/features/editor/MarkdownPreview'
import { editorContextMenu } from '@/features/editor/contextMenu'
import { promptFileName } from '@/features/editor/dialogs'
import { uploadBinary } from '@/features/editor/upload'
import { resolveVditorTheme } from '@/features/editor/vditorLoader'
import FindBar from '@/features/editor/FindBar'

interface Props {
  tabId: string
  path: string
  group: BridgeKey
}

const VDITOR_MODE: Record<string, 'wysiwyg' | 'sv' | 'ir'> = {
  wysiwyg: 'wysiwyg',
  source: 'sv',
  split: 'sv',
  preview: 'wysiwyg'
}

const EditorHost: React.FC<Props> = ({ tabId, path, group }) => {
  const entry = useDoc(path)
  const viewMode = useStore((s) => s.viewMode)
  const pageWidth = useStore((s) => s.pageWidth)
  const fontSize = useStore((s) => s.settings.editorFontSize)
  const lineHeight = useStore((s) => s.settings.editorLineHeight)
  const spellcheck = useStore((s) => s.settings.spellcheck)
  const theme = useStore((s) => s.theme)
  const updateTab = useStore((s) => s.updateTab)
  const toast = useStore((s) => s.toast)

  const hostRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)
  const caretRef = useRef(0)
  const cdnRef = useRef<string>('')
  const modeRef = useRef(viewMode)
  const savedValueRef = useRef('')
  const themeRef = useRef(theme)
  themeRef.current = theme

  /* ---------------------------------------------------------- page width */
  useEffect(() => {
    const px = pageWidth === 'standard' ? '760px' : pageWidth === 'wide' ? '1080px' : '100%'
    document.documentElement.style.setProperty('--page-width', px)
    document.documentElement.style.setProperty('--editor-font-size', fontSize + 'px')
    document.documentElement.style.setProperty('--editor-line-height', String(lineHeight))
  }, [pageWidth, fontSize, lineHeight])

  /* ---------------------------------------------------------- caret save */
  const saveCaret = useCallback(() => {
    const v = vditorRef.current
    if (!v) return
    try {
      const sel = window.getSelection()
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0)
        const pre = range.cloneRange()
        const root = v.vditor?.element
        if (root && root.contains(range.startContainer)) {
          pre.selectNodeContents(root)
          pre.setEnd(range.startContainer, range.startOffset)
          caretRef.current = pre.toString().length
        }
      }
    } catch {
      /* caret restore is best effort */
    }
  }, [])

  /* ---------------------------------------------------------- destroy */
  const destroy = useCallback(() => {
    const v = vditorRef.current
    if (!v) return
    try {
      savedValueRef.current = v.getValue()
    } catch {
      /* ignore */
    }
    try {
      v.destroy()
    } catch {
      /* ignore */
    }
    vditorRef.current = null
    if (hostRef.current) hostRef.current.innerHTML = ''
  }, [])

  /* ---------------------------------------------------------- create Vditor */
  const create = useCallback(
    async (value: string) => {
      if (!hostRef.current) return
      const Ctor = await loadVditor()
      setReady(true)
      if (!cdnRef.current) cdnRef.current = await resolveVditorCdn()
      const mode = VDITOR_MODE[modeRef.current] || 'wysiwyg'
      const isPreview = modeRef.current === 'preview'
      const host = document.createElement('div')
      host.className = 'vditor-mount'
      hostRef.current.innerHTML = ''
      hostRef.current.appendChild(host)

      const cdn = cdnRef.current
      const dark = themeRef.current === 'dark'
      const sourceOnly = modeRef.current === 'source' || modeRef.current === 'split'
      const v = new Ctor(host, {
        mode: isPreview ? 'wysiwyg' : mode,
        value,
        cdn,
        height: '100%',
        lang: 'zh_CN',
        theme: dark ? 'dark' : 'classic',
        icon: 'material',
        cache: { enable: false },
        outline: { enable: false, position: 'left' },
        counter: { enable: false },
        resize: { enable: false },
        toolbar: [],
        preview: {
          mode: sourceOnly ? 'editor' : 'both',
          theme: { current: dark ? 'dark' : 'light' },
          hljs: { style: dark ? 'monokai' : 'github', lineNumber: false },
          math: { engine: 'KaTeX', inlineDigit: true },
          markdown: { toc: true, mark: true, footnotes: true, sanitize: true }
        },
        link: { isOpen: true },
        undoDelay: 300,
        input: (val: string) => {
          setDocContent(path, val)
        },
        after: () => {
          try {
            if (isPreview) {
              v.disabled()
              v.vditor?.element?.classList.add('neom-readonly')
            }
            const root = v.vditor?.element
            if (root) {
              root.querySelectorAll('.vditor-toolbar').forEach((el) => el.remove())
              const mt = root.querySelector('.vditor-content') as HTMLElement | null
              if (mt) mt.style.background = 'transparent'
            }
            if (caretRef.current) restoreCaret(v, caretRef.current)
          } catch {
            /* ignore */
          }
          if (document.activeElement === document.body) v.focus()
        },
        upload: {
          accept: 'image/*,.pdf,.zip,.docx,.xlsx,.pptx',
          multiple: true,
          handler: async (files: File[]): Promise<string | null> => {
            const urls: string[] = []
            let fellBack = false
            for (const f of files) {
              try {
                const res = await uploadBinary(f, 'tupian')
                urls.push(res.url)
                if (res.fallback) fellBack = true
              } catch (e) {
                toast({ kind: 'error', text: '上传失败：' + ((e as Error)?.message || '') })
                return null
              }
            }
            if (fellBack) toast({ kind: 'warn', text: '未配置对象存储，图片已内嵌到文档', timeout: 4000 })
            if (!urls.length) return null
            // Vditor expects markdown-ish; consecutive urls become a gallery
            return urls.map((u) => `![图片](${u})`).join('\n')
          }
        },
        keydown: (e: KeyboardEvent) => {
          // let the global shortcut engine own Mod combos
          if (e.key === 'Escape') return
        }
      })
      vditorRef.current = v
      vditorRef.current.vditor.element.addEventListener('focusin', () => setFocusedBridge(group))
      vditorRef.current.vditor.element.addEventListener('mousedown', () => setFocusedBridge(group))
    },
    [group, path, toast]
  )

  /* ---------------------------------------------------------- bridge */
  useEffect(() => {
    const bridge = {
      key: group,
      path,
      get mode() {
        return modeRef.current
      },
      getValue: () => {
        const v = vditorRef.current
        if (v) {
          try {
            return v.getValue()
          } catch {
            /* fall through */
          }
        }
        return savedValueRef.current
      },
      setValue: (md: string) => {
        const v = vditorRef.current
        savedValueRef.current = md
        if (v) v.setValue(md, true)
        setDocContent(path, md)
      },
      insert: (md: string) => {
        const v = vditorRef.current
        if (!v) return
        v.insertValue(md, true)
        setDocContent(path, v.getValue())
      },
      insertMD: (md: string) => {
        const v = vditorRef.current
        if (!v) return
        v.insertMD(md)
        setDocContent(path, v.getValue())
      },
      getSelection: () => {
        const v = vditorRef.current
        if (!v) return ''
        try {
          return v.getSelection()
        } catch {
          return ''
        }
      },
      focus: () => vditorRef.current?.focus(),
      contentRoot: () => (vditorRef.current?.vditor?.element as HTMLElement) || null,
      scrollToHeading: (text: string, level?: number) => {
        const root = vditorRef.current?.vditor?.element
        if (!root) return false
        const wanted = text.trim()
        const nodes = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
        const hit =
          nodes.find((n) => (n.textContent || '').trim() === wanted) ||
          nodes.find((n) => (n.textContent || '').trim().includes(wanted)) ||
          (level ? nodes.find((n) => n.tagName === 'H' + level) : undefined)
        if (!hit) return false
        hit.scrollIntoView({ block: 'center', behavior: 'smooth' })
        hit.classList.remove('heading-flash')
        void hit.offsetWidth
        hit.classList.add('heading-flash')
        return true
      }
    }
    registerBridge(group, bridge)
    return () => unregisterBridge(group, path)
  }, [group, path])

  /* ---------------------------------------------------------- mount / mode change
   * A single effect owns the Vditor lifecycle: keyed by path + view mode, it
   * destroys any previous instance and builds a fresh one. Caret offset is
   * stashed in `caretRef` before the rebuild and restored in the `after` hook.
   */
  const createdKeyRef = useRef('')

  /* reset local state per document (runs before the lifecycle effect body) */
  useEffect(() => {
    createdKeyRef.current = ''
    savedValueRef.current = ''
    caretRef.current = 0
    setFindOpen(false)
    return () => {
      destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    let cancelled = false
    if (!path || path === '__welcome__') return
    if (viewMode === 'preview') {
      destroy()
      createdKeyRef.current = ''
      setReady(false)
      return
    }
    if (!entry || entry.loading) return
    const key = path + '|' + viewMode
    if (createdKeyRef.current === key) return

    // stash the caret of the instance we are about to discard
    if (createdKeyRef.current) saveCaret()
    const carryOver = createdKeyRef.current ? savedValueRef.current : ''
    createdKeyRef.current = key
    modeRef.current = viewMode
    setLoadError(null)
    setReady(false)
    destroy()

    void (async () => {
      try {
        await create(carryOver || entry.content)
      } catch (e) {
        if (!cancelled) setLoadError((e as Error)?.message || '编辑器加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, entry?.loading, viewMode, create])

  /* react to external content replacement (restore / conflict resolution) */
  useEffect(() => {
    const v = vditorRef.current
    if (!v || !entry) return
    try {
      if (v.getValue() !== entry.content) v.setValue(entry.content, true)
    } catch {
      /* ignore */
    }
  }, [entry?.nonce])

  /* theme switch */
  useEffect(() => {
    const v = vditorRef.current
    if (!v) return
    try {
      v.setTheme(resolveVditorTheme(), theme === 'dark' ? 'dark' : 'light', theme === 'dark' ? 'monokai' : 'github')
    } catch {
      /* ignore */
    }
  }, [theme])

  /* unmount */
  useEffect(() => {
    return () => {
      destroy()
    }
  }, [destroy])

  /* ---------------------------------------------------------- stats */
  useEffect(() => {
    const st = useStore.getState()
    if (st.activeTabId !== tabId || !entry) return
    st.setStats(computeStats(entry.content))
  }, [entry?.content, tabId])

  /* ---------------------------------------------------------- find bar wiring */
  useEffect(() => {
    const onFind = (e: Event) => {
      const detail = (e as CustomEvent).detail as { replace?: boolean; path?: string }
      if (detail?.path && detail.path !== path) return
      setReplaceMode(!!detail?.replace)
      setFindOpen(true)
    }
    window.addEventListener('neom:open-find', onFind)
    return () => window.removeEventListener('neom:open-find', onFind)
  }, [path])

  /* ---------------------------------------------------------- inline rename */
  const startRename = () => {
    if (!entry) return
    setDraftName(entry.name)
    setRenaming(true)
  }

  const commitRename = async () => {
    const next = draftName.trim()
    setRenaming(false)
    if (!next || !entry || next === entry.name) return
    try {
      const vault = currentVault()
      const dir = parentOf(path)
      const to = dir ? `${dir}/${next}` : next
      await fileService.rename(vault, path, to)
      rebindPath(path, to)
      const { markUserNamed } = await import('@/features/editor/docRepo')
      markUserNamed(to)
      toast({ kind: 'ok', text: '已重命名' })
    } catch (e) {
      toast({ kind: 'error', text: '重命名失败：' + ((e as Error)?.message || '') })
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    void editorContextMenu(e.clientX, e.clientY, path)
  }

  /* ---------------------------------------------------------- render */
  const contentForPreview = entry?.content ?? ''

  return (
    <div
      className="editor-host"
      data-vm={viewMode}
      style={{ ['--editor-font-size' as string]: fontSize + 'px', ['--editor-line-height' as string]: String(lineHeight) }}
      onContextMenu={onContextMenu}
      onMouseDown={() => setFocusedBridge(group)}
    >
      <div className="editor-head">
        <Icon name="file-text" size={14} className="doc-icon" />
        {renaming ? (
          <input
            className="inline-rename editor-title-input"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commitRename() }
              if (e.key === 'Escape') { e.preventDefault(); setRenaming(false) }
            }}
          />
        ) : (
          <button className="editor-title" onClick={startRename} title="点击重命名">
            {entry?.name || path.split('/').pop()}
          </button>
        )}
        {entry?.dirty && <span className="tab-dot" title="未保存" />}
        <div className="grow" />
        <span className="editor-meta">
          {entry?.offline ? '离线缓存' : ''}
          {viewMode === 'preview' ? ' 阅读视图' : viewMode === 'source' ? ' 源码' : viewMode === 'split' ? ' 对照' : ''}
        </span>
        <button className="btn-icon" title="查找 (Ctrl+F)" onClick={() => { setReplaceMode(false); setFindOpen(true) }}>
          <Icon name="search" size={14} />
        </button>
        <button
          className="btn-icon"
          title="在文件管理器中显示"
          disabled={!isDesktop || !entry?.absPath}
          onClick={() => entry?.absPath && revealPath(entry.absPath)}
        >
          <Icon name="folder-open" size={14} />
        </button>
      </div>

      {entry?.error && <div className="editor-error">{entry.error}</div>}
      {entry?.offline && (
        <div className="editor-notice">
          <Icon name="cloud" size={13} />
          当前显示的是本地缓存，恢复连接后请重新保存以同步到云端。
        </div>
      )}

      <div className="editor-scroll">
        {viewMode === 'preview' ? (
          <MarkdownPreview markdown={contentForPreview} />
        ) : viewMode === 'split' ? (
          <SplitEditor
            hostRef={hostRef}
            value={contentForPreview}
            onInput={(v) => setDocContent(path, v)}
            ready={ready}
            loadError={loadError}
          />
        ) : (
          <div className="editor-surface">
            <div ref={hostRef} style={{ flex: 1, minHeight: 0, display: 'flex' }} />
            {!ready && !loadError && (
              <div className="editor-loading">
                <div className="spinner" />
                <span>正在加载编辑器…</span>
              </div>
            )}
            {loadError && <div className="editor-error">编辑器加载失败：{loadError}</div>}
          </div>
        )}
        {findOpen && (
          <FindBar
            replace={replaceMode}
            onClose={() => setFindOpen(false)}
            getText={() => getBridge(group)?.getValue() ?? contentForPreview}
            onJump={(offset) => {
              const b = getBridge(group)
              if (!b) return
              const root = b.contentRoot()
              if (!root) return
              const text = b.getValue()
              const before = text.slice(0, offset)
              const line = before.split('\n').length
              const nodes = Array.from(root.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,pre'))
              const target = nodes[Math.min(nodes.length - 1, Math.max(0, line - 2))]
              target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }}
            onReplaceAll={(find, rep) => {
              const b = getBridge(group)
              if (!b) return 0
              const src = b.getValue()
              const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              const re = new RegExp(escaped, 'g')
              const count = (src.match(re) || []).length
              if (count) b.setValue(src.replace(re, rep))
              return count
            }}
            onReplaceOne={(find, rep) => {
              const b = getBridge(group)
              if (!b) return false
              const sel = b.getSelection()
              if (sel && sel.includes(find)) {
                b.insert(rep)
                return true
              }
              return false
            }}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ split */
const SplitEditor: React.FC<{
  hostRef: React.RefObject<HTMLDivElement>
  value: string
  onInput: (v: string) => void
  ready: boolean
  loadError: string | null
}> = ({ hostRef, value, onInput, ready, loadError }) => (
  <div className="editor-surface" style={{ flexDirection: 'row' }}>
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, display: 'flex' }} />
      {!ready && !loadError && (
        <div className="editor-loading">
          <div className="spinner" />
          <span>正在加载编辑器…</span>
        </div>
      )}
      {loadError && <div className="editor-error">编辑器加载失败：{loadError}</div>}
    </div>
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <MarkdownPreview markdown={value} />
    </div>
  </div>
)

function restoreCaret(v: Vditor, offset: number) {
  try {
    const root = v.vditor?.element
    if (!root) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let remaining = offset
    let node: Text | null = null
    while (walker.nextNode()) {
      const t = walker.currentNode as Text
      if (remaining <= t.data.length) {
        node = t
        break
      }
      remaining -= t.data.length
    }
    if (!node) return
    const range = document.createRange()
    range.setStart(node, Math.min(remaining, node.data.length))
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    const el = node.parentElement
    el?.scrollIntoView({ block: 'nearest' })
  } catch {
    /* best effort */
  }
}

export default EditorHost
