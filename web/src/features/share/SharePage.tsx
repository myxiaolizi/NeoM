/**
 * `/s/:id` — public share page. Works without login.
 * Renders markdown (marked + DOMPurify + highlight.js + KaTeX, mermaid lazy),
 * supports password-protected links and inline comment annotations.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API } from '@/lib/contracts'
import { useStore } from '@/store'
import { BrandMark } from '@/features/marketing/Brand'
import { expiryText, localFlag, pick, safeArr } from '@/features/marketing/portalKit'
import { renderMarkdown, renderMermaidBlocks } from './markdown'
import '@/styles/portal-base.css'
import '@/styles/portal-share.css'

/* ------------------------------------------------------------------ types */
interface ShareComment {
  id?: string | number
  author: string
  content: string
  anchor?: string | null
  created_at?: string
}

interface ShareData {
  name: string
  content: string
  mode: 'read' | 'comment' | 'edit'
  expires_at?: string | null
  creator?: string
  comments: ShareComment[]
  status: string
}

type Phase = 'loading' | 'ready' | 'password' | 'expired' | 'blocked' | 'missing' | 'error'

interface Anchor {
  text: string
  offset: number
}

/* -------------------------------------------------------------- normalize */
const normalizeComment = (raw: any): ShareComment => ({
  id: pick(raw, ['id', 'comment_id'], undefined),
  author: String(pick(raw, ['author', 'nickname', 'user', 'name'], '匿名访客')),
  content: String(pick(raw, ['content', 'text', 'body'], '')),
  anchor: pick(raw, ['anchor', 'quote', 'selection'], null),
  created_at: pick(raw, ['created_at', 'createdAt', 'time', 'date'], '')
})

const normalizeShare = (raw: any): ShareData => {
  const root = raw || {}
  const doc = root.doc || root.document || root.file || root
  const comments = safeArr<any>(root.comments ?? root.comment_list).map(normalizeComment)
  return {
    name: String(pick(doc, ['name', 'title', 'doc_name', 'filename'], '未命名文档')),
    content: String(pick(doc, ['content', 'body', 'markdown', 'text', 'md'], '')),
    mode: (pick(root, ['mode', 'share_mode'], 'read') as ShareData['mode']) || 'read',
    expires_at: pick(root, ['expiresAt', 'expires_at', 'expire_at'], null),
    creator: String(pick(root, ['creator', 'author', 'owner', 'username', 'nickname'], '')),
    comments,
    status: String(pick(root, ['status', 'state'], 'active'))
  }
}

const MODE_META: Record<string, { label: string; cls: string; icon: string }> = {
  read: { label: '只读', cls: 'neutral', icon: 'eye' },
  comment: { label: '可评论', cls: 'ok', icon: 'edit' },
  edit: { label: '可协同编辑', cls: 'warn', icon: 'users' }
}

/** Character-anchored selection inside the rendered document. */
function readSelection(container: HTMLElement | null): Anchor | null {
  if (!container) return null
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const text = sel.toString().replace(/\s+/g, ' ').trim()
  if (text.length < 2) return null
  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  try {
    const pre = range.cloneRange()
    pre.selectNodeContents(container)
    pre.setEnd(range.startContainer, range.startOffset)
    return { text: text.slice(0, 200), offset: pre.toString().length }
  } catch {
    return { text: text.slice(0, 200), offset: 0 }
  }
}

const parseAnchor = (raw?: string | null): Anchor | null => {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object' && v.text) return { text: String(v.text), offset: Number(v.offset) || 0 }
  } catch {
    /* anchor may be plain text */
  }
  return { text: String(raw).slice(0, 200), offset: 0 }
}

/* ------------------------------------------------------------------- page */
const SharePage: React.FC = () => {
  const { id = '' } = useParams()
  const toast = useStore((s) => s.toast)
  const user = useStore((s) => s.user)

  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const [data, setData] = useState<ShareData | null>(null)
  const [comments, setComments] = useState<ShareComment[]>([])
  const [html, setHtml] = useState('')
  const [password, setPassword] = useState('')
  const [pwdBusy, setPwdBusy] = useState(false)

  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [nick, setNick] = useState(localFlag.get('neom.share.nick') || '')
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  const docRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)

  /* ------------------------------------------------------------- loading */
  const load = useCallback(
    async (pwd?: string) => {
      if (!id) {
        setPhase('missing')
        return
      }
      setPhase('loading')
      /* never leave the visitor on a spinner forever if the network stalls */
      let timer: number | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error('请求超时，请检查网络后重试')),
          15000
        )
      })
      try {
        const url =
          API.shareGet + '?id=' + encodeURIComponent(id) + (pwd ? '&password=' + encodeURIComponent(pwd) : '')
        const raw = await Promise.race([api.get<any>(url), timeout])
        const parsed = normalizeShare(raw)
        if ((raw as any)?.needsPassword || (raw as any)?.need_password) {
          setPhase('password')
          return
        }
        const expires = parsed.expires_at ? new Date(String(parsed.expires_at).replace(' ', 'T')).getTime() : 0
        setData(parsed)
        setComments(parsed.comments)
        if (parsed.status === 'blocked') setPhase('blocked')
        else if (parsed.status === 'expired' || (expires && expires < Date.now())) setPhase('expired')
        else setPhase('ready')
      } catch (e: any) {
        const msg = String(e?.message || '')
        setMessage(msg)
        if (/密码|password|口令/i.test(msg) || e?.code === 'PASSWORD_REQUIRED') setPhase('password')
        else if (/过期|expire|超时/i.test(msg) || e?.code === 'EXPIRED') setPhase('expired')
        else if (/屏蔽|封禁|block|禁用|下架/i.test(msg)) setPhase('blocked')
        else if (/不存在|not found|已删除|找不到/i.test(msg) || e?.statusCode === 404) setPhase('missing')
        else setPhase('error')
      } finally {
        if (timer) window.clearTimeout(timer)
      }
    },
    [id]
  )

  useEffect(() => {
    load()
  }, [load])

  /* ------------------------------------------------------- render markdown */
  useEffect(() => {
    if (phase !== 'ready' || !data) return
    let alive = true
    setHtml('')
    renderMarkdown(data.content)
      .then((out) => {
        if (alive) setHtml(out)
      })
      .catch(() => {
        if (alive) setHtml('')
      })
    return () => {
      alive = false
    }
  }, [phase, data])

  useEffect(() => {
    if (!html) return
    renderMermaidBlocks(docRef.current)
  }, [html])

  useEffect(() => {
    if (data?.name) document.title = `${data.name} · NeoM 分享`
    return () => {
      document.title = 'NeoM'
    }
  }, [data?.name])

  /* ---------------------------------------------------------- selection */
  const canComment = phase === 'ready' && (data?.mode === 'comment' || data?.mode === 'edit')
  useEffect(() => {
    if (!canComment) return
    const onUp = () => setAnchor(readSelection(docRef.current))
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchend', onUp)
    }
  }, [canComment])

  const focusDraft = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => draftRef.current?.focus(), 220)
  }

  /* ----------------------------------------------------------- comments */
  const sorted = useMemo(
    () =>
      [...comments].sort((a, b) => {
        const ta = a.created_at ? new Date(String(a.created_at).replace(' ', 'T')).getTime() : 0
        const tb = b.created_at ? new Date(String(b.created_at).replace(' ', 'T')).getTime() : 0
        return tb - ta
      }),
    [comments]
  )

  const submitComment = async () => {
    const content = draft.trim()
    if (!content) {
      toast({ kind: 'warn', text: '请先填写评论内容' })
      return
    }
    setPosting(true)
    try {
      const payload: Record<string, unknown> = {
        id,
        content,
        author: nick.trim() || '匿名访客'
      }
      if (anchor) payload.anchor = JSON.stringify(anchor)
      const res = await api.post<any>(API.shareComment, payload)
      const created = normalizeComment((res as any)?.comment || res || {
        author: nick.trim() || '匿名访客',
        content,
        anchor: anchor ? JSON.stringify(anchor) : null,
        created_at: new Date().toISOString()
      })
      setComments((list) => [created, ...list])
      if (nick.trim()) localFlag.set('neom.share.nick', nick.trim())
      setDraft('')
      setAnchor(null)
      toast({ kind: 'ok', text: '评论已提交' })
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '评论提交失败，请稍后重试' })
    } finally {
      setPosting(false)
    }
  }

  /* --------------------------------------------------------------- render */
  const modeMeta = MODE_META[data?.mode || 'read'] || MODE_META.read

  /* --------------------------------------------------------- gate states */
  if (phase === 'loading') {
    return (
      <div className="portal">
        <div className="share-state">
          <div className="spinner" style={{ width: 26, height: 26, borderWidth: 3 }} />
          <p>正在打开分享文档…</p>
        </div>
      </div>
    )
  }

  if (phase === 'password') {
    return (
      <div className="portal">
        <div className="share-gate-wrap">
          <div className="share-gate">
            <span className="p-tile lg">
              <Icon name="lock" size={20} />
            </span>
            <h2>这篇分享受密码保护</h2>
            <p>请输入创建者设置的访问密码后继续阅读。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!password) return
                setPwdBusy(true)
                load(password).finally(() => setPwdBusy(false))
              }}
            >
              <div className="field">
                <input
                  className="input"
                  type="password"
                  autoFocus
                  placeholder="访问密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {message && (
                  <span className="hint" style={{ color: 'var(--danger)' }}>
                    {message}
                  </span>
                )}
              </div>
              <button className="p-btn p-btn-primary p-btn-block" type="submit" disabled={pwdBusy || !password}>
                {pwdBusy ? <span className="spinner" /> : <Icon name="unlock" size={15} />} 打开文档
              </button>
            </form>
            <div className="tiny dim" style={{ marginTop: 14 }}>
              密码由分享创建者设置，忘了可以联系对方重新分享
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'expired' || phase === 'blocked' || phase === 'missing' || phase === 'error') {
    const meta = {
      expired: {
        icon: 'clock',
        title: '这个分享链接已过期',
        desc: message || '分享有效期已结束，或创建者撤销了本次分享。请联系对方重新生成链接。'
      },
      blocked: {
        icon: 'shield',
        title: '该分享已被屏蔽',
        desc: message || '内容可能违反站点规范已被管理员屏蔽，如有疑问请联系站点管理员。'
      },
      missing: {
        icon: 'search',
        title: '找不到这篇分享',
        desc: message || '链接可能输入有误，或文档已被删除。'
      },
      error: {
        icon: 'alert',
        title: '文档加载失败',
        desc: message || '网络异常或服务暂时不可用，请稍后重试。'
      }
    }[phase]

    return (
      <div className="portal">
        <div className="share-state">
          <div className="icon-wrap">
            <Icon name={meta.icon} size={28} />
          </div>
          <h2>{meta.title}</h2>
          <p>{meta.desc}</p>
          <div className="row" style={{ marginTop: 8, gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link className="p-btn p-btn-primary" to="/">
              回到 NeoM 首页
            </Link>
            {phase === 'error' && (
              <button className="p-btn" onClick={() => load()}>
                <Icon name="refresh" size={14} /> 重新加载
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ----------------------------------------------------------- ready view */
  return (
    <div className="portal">
      <div className="share-bar">
        <Link to="/" className="p-brand" title="NeoM 首页">
          <BrandMark size={24} />
        </Link>
        <div className="doc-title">
          <Icon name="file-text" size={14} />
          <span title={data?.name}>{data?.name || '未命名文档'}</span>
        </div>

        <div className="meta">
          <span className={'badge ' + modeMeta.cls}>
            <Icon name={modeMeta.icon} size={11} /> {modeMeta.label}
          </span>
          <span className="badge neutral">
            <Icon name="clock" size={11} /> {expiryText(data?.expires_at)}
          </span>
          {data?.creator && (
            <span className="creator">
              <Icon name="user" size={12} /> {data.creator}
            </span>
          )}
          {canComment && (
            <span className="badge neutral">
              <Icon name="edit" size={11} /> {comments.length} 条评论
            </span>
          )}
          <Link className="p-btn p-btn-sm p-btn-primary" to="/app">
            {user ? '打开 NeoM' : '免费使用 NeoM'}
          </Link>
        </div>
      </div>

      <div className="share-page">
        <article className="share-doc">
          {html ? (
            <div ref={docRef} className="p-md" dangerouslySetInnerHTML={{ __html: html }} />
          ) : data?.content ? (
            <div className="p-md" style={{ whiteSpace: 'pre-wrap' }}>
              {data.content}
            </div>
          ) : (
            <div className="p-state">
              <Icon name="file-text" size={22} />
              <strong>这是一篇空文档</strong>
              <span>创建者还没有写入内容</span>
            </div>
          )}
        </article>

        <p className="share-foot-note">
          由 NeoM 提供分享服务 · 免登录阅读
          {canComment ? ' · 选中任意文字即可添加标注评论' : ''}
        </p>

        {canComment && (
          <section className="cmt-section" ref={formRef}>
            <div className="cmt-head">
              <h3>评论与标注</h3>
              <span className="badge neutral">{comments.length}</span>
              <span className="tiny dim" style={{ marginLeft: 'auto' }}>
                免登录可评论，昵称留空则显示为匿名访客
              </span>
            </div>

            <div className="cmt-form">
              {anchor && (
                <div className="cmt-anchor">
                  <Icon name="quote" size={13} />
                  <span className="txt grow">“{anchor.text}”</span>
                  <button type="button" className="btn-icon" style={{ width: 20, height: 20 }} onClick={() => setAnchor(null)}>
                    <Icon name="x" size={11} />
                  </button>
                </div>
              )}
              <textarea
                ref={draftRef}
                className="textarea"
                placeholder={anchor ? '针对选中的文字写一条标注…' : '写下你的评论或建议…'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitComment()
                }}
              />
              <div className="row" style={{ marginTop: 10 }}>
                <input
                  className="input"
                  style={{ maxWidth: 180 }}
                  placeholder="你的昵称（可选）"
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  maxLength={24}
                />
                <span className="tiny dim grow">Ctrl / ⌘ + Enter 快速发送</span>
                <button className="p-btn p-btn-primary p-btn-sm" onClick={submitComment} disabled={posting}>
                  {posting ? <span className="spinner" /> : <Icon name="send" size={13} />} 提交评论
                </button>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="p-state">
                <Icon name="edit" size={20} />
                <strong>还没有评论</strong>
                <span>成为第一个留下想法的人</span>
              </div>
            ) : (
              <div className="cmt-list">
                {sorted.map((c, i) => {
                  const a = parseAnchor(c.anchor)
                  return (
                    <div className="cmt-item" key={String(c.id ?? i)}>
                      <span className="cmt-avatar">{(c.author || '匿').slice(0, 1)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="cmt-author">
                          {c.author || '匿名访客'}
                          <span className="cmt-time">
                            <Icon name="clock" size={10} /> {c.created_at ? new Date(String(c.created_at).replace(' ', 'T')).toLocaleString('zh-CN') : '刚刚'}
                          </span>
                        </div>
                        <div className="cmt-body">{c.content}</div>
                        {a && <div className="cmt-anchor-inline">“{a.text}”</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {anchor && (
        <div className="sel-bar">
          <Icon name="quote" size={13} />
          <span className="quote">“{anchor.text}”</span>
          <span className="tiny dim">已选中 {anchor.text.length} 字</span>
          <button className="p-btn p-btn-sm p-btn-primary" onClick={focusDraft}>
            <Icon name="edit" size={12} /> 添加标注
          </button>
          <button className="btn-icon" style={{ width: 22, height: 22 }} onClick={() => setAnchor(null)} aria-label="取消选择">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

export default SharePage
