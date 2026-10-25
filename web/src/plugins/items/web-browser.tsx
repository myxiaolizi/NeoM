/**
 * web-browser — split-pane embedded browser (address bar, back/forward/reload,
 * bookmarks) plus a web clipper: URL or pasted HTML → Markdown → new note.
 */
import React, { useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Search, Segmented } from '../ui'
import { extractTitle, htmlToMarkdown, mdToPlain } from '../md'
import { copyText, readJson, uid, writeJson } from '../utils'

const LS_BOOKMARKS = 'neom.webbrowser.bookmarks'

interface WebBookmark { id: string; title: string; url: string }

const normalizeUrl = (raw: string): string => {
  const s = raw.trim()
  if (!s) return ''
  if (/^(https?:|file:)/i.test(s)) return s
  if (/^[\w-]+(\.[\w-]+)+/.test(s)) return `https://${s}`
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`
}

const WebBrowserPanel: React.FC<PanelProps> = ({ context, full, onClose }) => {
  const [tab, setTab] = useState<'browse' | 'clip'>('browse')
  const [address, setAddress] = useState('https://')
  const [url, setUrl] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState(-1)
  const [key, setKey] = useState(0)
  const [blocked, setBlocked] = useState(false)

  const [clipUrl, setClipUrl] = useState('')
  const [clipHtml, setClipHtml] = useState('')
  const [clipping, setClipping] = useState(false)
  const [clipResult, setClipResult] = useState<{ title: string; markdown: string } | null>(null)
  const [mode, setMode] = useState<'url' | 'html'>('url')
  const [bookmarks, setBookmarks] = useState<WebBookmark[]>(() => readJson<WebBookmark[]>(LS_BOOKMARKS, []))
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const go = (raw: string) => {
    const target = normalizeUrl(raw)
    if (!target) return
    setUrl(target)
    setAddress(target)
    setBlocked(false)
    const next = [...history.slice(0, cursor + 1), target]
    setHistory(next)
    setCursor(next.length - 1)
  }

  const back = () => {
    if (cursor <= 0) return
    const c = cursor - 1
    setCursor(c)
    setUrl(history[c])
    setAddress(history[c])
  }

  const forward = () => {
    if (cursor >= history.length - 1) return
    const c = cursor + 1
    setCursor(c)
    setUrl(history[c])
    setAddress(history[c])
  }

  const reload = () => { setKey((k) => k + 1); setBlocked(false) }

  const saveBookmark = () => {
    if (!url) { context.toast('先打开一个页面', 'warn'); return }
    const title = address.replace(/^https?:\/\//, '').slice(0, 40)
    const next = [{ id: uid('wb-'), title, url }, ...bookmarks].slice(0, 40)
    setBookmarks(next)
    writeJson(LS_BOOKMARKS, next)
    context.toast('已加入书签', 'ok')
  }

  /* ------------------------------------------------------------- clipper */
  const runClip = async () => {
    setClipping(true)
    try {
      let html = clipHtml
      let srcUrl = clipUrl
      if (mode === 'url') {
        if (!clipUrl.trim()) { context.toast('请输入网页地址', 'warn'); return }
        srcUrl = normalizeUrl(clipUrl)
        try {
          const res = await context.api.post('/api/files/import', { url: srcUrl, kind: 'html' })
          const payload = res?.html || res?.content || ''
          if (payload) html = payload
        } catch { /* fall through to fetch */ }
        if (!html) {
          try {
            const r = await fetch(srcUrl, { credentials: 'omit' })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            html = await r.text()
          } catch (e: any) {
            throw new Error(`抓取失败：${e?.message || '跨域限制'}。可切换到「粘贴 HTML」模式`)
          }
        }
      }
      if (!html.trim()) throw new Error('没有可转换的 HTML')
      const markdown = htmlToMarkdown(html, srcUrl)
      if (!markdown.trim()) throw new Error('转换结果为空')
      const title = extractTitle(html, '网页剪藏')
      setClipResult({ title, markdown })
    } catch (e: any) {
      context.toast(e?.message || '剪藏失败', 'error')
    } finally {
      setClipping(false)
    }
  }

  const insertClip = (asNew: boolean) => {
    if (!clipResult) return
    const body = `# ${clipResult.title}\n\n> 来源：${clipUrl || '手动粘贴'}\n> 剪藏时间：${new Date().toLocaleString()}\n\n${clipResult.markdown}\n`
    if (asNew) {
      const safe = clipResult.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60)
      void context.createFile(`${safe}.md`, body, '剪藏').then((p) => {
        context.openFile(p)
        context.toast('已新建剪藏笔记', 'ok')
      }).catch((e: any) => context.toast(e?.message || '创建失败', 'error'))
    } else {
      context.insertText(`\n\n${body}\n`)
      context.toast('已插入当前文档', 'ok')
    }
  }

  const clipPreview = useMemo(() => (clipResult ? clipResult.markdown.slice(0, 1500) : ''), [clipResult])

  return (
    <Panel className="plg-browser">
      <Head
        icon="browser"
        title="网页浏览器"
        sub={tab === 'browse' ? (url || '输入地址开始浏览') : '网页剪藏 → Markdown'}
        actions={
          <>
            <Segmented value={tab} options={[{ value: 'browse', label: '浏览', icon: 'globe' }, { value: 'clip', label: '剪藏', icon: 'scissors' }]} onChange={(v) => setTab(v as 'browse' | 'clip')} />
            {full && onClose && <Btn icon="x" onClick={onClose} title="关闭" />}
          </>
        }
      />
      {tab === 'browse' ? (
        <>
          <div className="plg-browser-bar">
            <Btn icon="arrow-left" title="后退" onClick={back} disabled={cursor <= 0} />
            <Btn icon="arrow-right" title="前进" onClick={forward} disabled={cursor >= history.length - 1} />
            <Btn icon="refresh" title="刷新" onClick={reload} disabled={!url} />
            <form
              className="grow"
              onSubmit={(e) => { e.preventDefault(); go(address) }}
              style={{ display: 'flex' }}
            >
              <input
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="输入网址或搜索关键词"
                spellCheck={false}
              />
            </form>
            <Btn icon="external" title="新窗口打开" onClick={() => url && window.open(url, '_blank', 'noopener')} disabled={!url} />
            <Btn icon="bookmark" title="收藏当前页" onClick={saveBookmark} />
          </div>
          <div className="plg-browser-body">
            {!url || blocked ? (
              <div className="plg-browser-start">
                <Icon name="globe" size={30} />
                <div className="plg-head-title">内嵌浏览器</div>
                <div className="plg-head-sub">
                  很多站点（Google / 微信 / 知乎等）会通过 X-Frame-Options 拒绝被嵌入。
                  <br />被拒绝时请用「新窗口打开」或「剪藏」。
                </div>
                {blocked && (
                  <div className="plg-warn-box">
                    <Icon name="alert" size={11} /> 该页面拒绝被嵌入，建议用「剪藏」保存内容或在新窗口打开
                  </div>
                )}
                <div className="row center" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {['https://www.bing.com', 'https://developer.mozilla.org', 'https://wikipedia.org', 'https://github.com'].map((u) => (
                    <button key={u} type="button" className="chip" onClick={() => go(u)}>{u.replace('https://', '')}</button>
                  ))}
                </div>
              </div>
            ) : (
              <iframe
                key={key}
                ref={iframeRef}
                src={url}
                title="NeoM 内嵌浏览器"
                className="plg-browser-frame"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                referrerPolicy="no-referrer"
                onError={() => setBlocked(true)}
                onLoad={() => {
                  try {
                    const doc = iframeRef.current?.contentDocument
                    if (!doc || doc.body?.innerHTML === '') return
                  } catch {
                    setBlocked(true)
                  }
                }}
              />
            )}
          </div>
          {!!bookmarks.length && (
            <div className="plg-browser-bm">
              <Icon name="bookmark" size={11} />
              {bookmarks.map((b) => (
                <span key={b.id} className="chip" onClick={() => go(b.url)} title={b.url}>
                  {b.title}
                  <button type="button" className="plg-icon-btn" style={{ width: 14, height: 14 }} title="删除" onClick={(e) => {
                    e.stopPropagation()
                    const next = bookmarks.filter((x) => x.id !== b.id)
                    setBookmarks(next)
                    writeJson(LS_BOOKMARKS, next)
                  }}><Icon name="x" size={9} /></button>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="plg-scroll plg-pad col">
            <Segmented value={mode} options={[{ value: 'url', label: '从 URL 抓取', icon: 'globe' }, { value: 'html', label: '粘贴 HTML', icon: 'code' }]} onChange={(v) => setMode(v as 'url' | 'html')} />
            {mode === 'url' ? (
              <div className="row">
                <input className="input" placeholder="https://example.com/article" value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} />
                <Btn icon="download" primary onClick={runClip} disabled={clipping}>{clipping ? '抓取中…' : '抓取'}</Btn>
              </div>
            ) : (
              <>
                <input className="input" placeholder="来源地址（可选，用于补全相对链接）" value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} />
                <textarea className="textarea mono" rows={6} placeholder="粘贴网页 HTML 源码…" value={clipHtml} onChange={(e) => setClipHtml(e.target.value)} spellCheck={false} />
                <Btn icon="scissors" primary onClick={runClip} disabled={clipping || !clipHtml.trim()}>转换为 Markdown</Btn>
              </>
            )}
            {clipResult && (
              <>
                <div className="plg-sub-title">转换结果 · {clipResult.title}</div>
                <pre className="plg-clip-preview">{clipPreview}{clipResult.markdown.length > 1500 ? '\n…' : ''}</pre>
                <div className="row">
                  <Btn icon="copy" onClick={async () => {
                    const ok = await copyText(clipResult.markdown)
                    context.toast(ok ? 'Markdown 已复制' : '复制失败', ok ? 'ok' : 'error')
                  }}>复制</Btn>
                  <Btn icon="paste" onClick={() => insertClip(false)}>插入当前文档</Btn>
                  <Btn icon="file-plus" primary onClick={() => insertClip(true)}>新建剪藏笔记</Btn>
                  <span className="grow" />
                  <span className="dim tiny">{mdToPlain(clipResult.markdown).length} 字</span>
                </div>
              </>
            )}
            {!clipResult && <Empty icon="scissors" text="把网页正文保存为 Markdown 笔记（自带简易 HTML→MD 转换）" />}
          </div>
        </>
      )}
    </Panel>
  )
}

/** `plugin.webBrowser.clip` — open the clipper window. */
export const openClipper = (ctx: PluginContext) => {
  import('../fullscreen').then((m) => m.openPluginWindow('web-browser', ctx))
}

export default WebBrowserPanel
