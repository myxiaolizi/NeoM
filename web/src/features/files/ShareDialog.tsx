/**
 * Share / publish dialog for a document. Creates a share link or a publish
 * page through the backend contract; degrades gracefully when offline.
 */
import React, { useEffect, useState } from 'react'
import { registerModal } from '@/components/Overlays'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { API, type ShareLink, type PublishPage } from '@/lib/contracts'
import { api } from '@/lib/api'
import { formatTime } from './fileUtils'

type Mode = 'read' | 'comment' | 'edit'

interface Payload {
  path: string
}

const ShareModal: React.FC<{ props?: Record<string, unknown>; onClose: () => void }> = ({ props, onClose }) => {
  const payload = props?.payload as Payload | undefined
  const toast = useStore((s) => s.toast)
  const [mode, setMode] = useState<Mode>('read')
  const [password, setPassword] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState<'share' | 'publish' | null>(null)
  const [link, setLink] = useState<ShareLink | null>(null)
  const [pub, setPub] = useState<PublishPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<ShareLink[]>([])

  const path = payload?.path || ''

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<ShareLink[]>(API.shareList)
        setExisting((list || []).filter((s) => s.status === 'active').slice(0, 5))
      } catch {
        /* offline — the create flow will surface the error */
      }
    })()
  }, [])

  const createShare = async () => {
    setBusy('share')
    setError(null)
    try {
      const res = await api.post<ShareLink>(API.shareCreate, {
        path,
        mode,
        password: password || undefined,
        expiresAt: expires || undefined
      })
      setLink(res)
      const url = res.url?.startsWith('http') ? res.url : window.location.origin + (res.url || `/s/${res.id}`)
      await navigator.clipboard?.writeText(url).catch(() => undefined)
      toast({ kind: 'ok', text: '分享链接已创建并复制' })
    } catch (e) {
      setError((e as Error)?.message || '创建分享链接失败')
    } finally {
      setBusy(null)
    }
  }

  const createPublish = async () => {
    setBusy('publish')
    setError(null)
    try {
      const res = await api.post<PublishPage>(API.publishCreate, {
        path,
        encrypted: !!password,
        password: password || undefined
      })
      setPub(res)
      const url = res.url?.startsWith('http') ? res.url : window.location.origin + (res.url || `/p/${res.id}`)
      await navigator.clipboard?.writeText(url).catch(() => undefined)
      toast({ kind: 'ok', text: '发布页已创建并复制链接' })
    } catch (e) {
      setError((e as Error)?.message || '创建发布页失败')
    } finally {
      setBusy(null)
    }
  }

  const openLink = (url?: string) => {
    if (!url) return
    window.open(url.startsWith('http') ? url : window.location.origin + url, '_blank', 'noopener')
  }

  return (
    <div className="modal" style={{ maxWidth: 560 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <Icon name="share" size={17} />
        <h3 className="grow ellipsis">分享 / 发布</h3>
        <button className="btn-icon" onClick={onClose} aria-label="关闭">
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="tip-line">
          <Icon name="file-text" size={13} />
          <span className="ellipsis">{path}</span>
        </div>

        <div className="field">
          <label>协作权限</label>
          <div className="seg">
            {(
              [
                ['read', '仅阅读'],
                ['comment', '可评论'],
                ['edit', '可编辑']
              ] as [Mode, string][]
            ).map(([id, label]) => (
              <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label>访问密码（可选）</label>
            <input
              className="input"
              placeholder="留空表示公开访问"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label>有效期（可选）</label>
            <input type="date" className="input" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>

        {error && <div className="tip-line" style={{ color: 'var(--danger)' }}><Icon name="alert" size={13} />{error}</div>}

        {link && (
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <Icon name="link" size={14} />
              <strong className="small">分享链接已创建</strong>
              <span className="badge ok">已复制</span>
            </div>
            <div className="mono tiny ellipsis">{link.url}</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => openLink(link.url)}>打开</button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  await navigator.clipboard?.writeText(link.url)
                  toast({ kind: 'ok', text: '已复制' })
                }}
              >
                复制
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  try {
                    await api.post(API.shareRevoke, { id: link.id })
                    setLink(null)
                    toast({ kind: 'ok', text: '分享链接已撤销' })
                  } catch (e) {
                    toast({ kind: 'error', text: (e as Error)?.message || '撤销失败' })
                  }
                }}
              >
                撤销
              </button>
            </div>
          </div>
        )}

        {pub && (
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <Icon name="globe" size={14} />
              <strong className="small">发布页已创建</strong>
              <span className="badge ok">已复制</span>
            </div>
            <div className="mono tiny ellipsis">{pub.url}</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => openLink(pub.url)}>打开</button>
              <button
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  try {
                    await api.post(API.publishRevoke, { id: pub.id })
                    setPub(null)
                    toast({ kind: 'ok', text: '发布页已下线' })
                  } catch (e) {
                    toast({ kind: 'error', text: (e as Error)?.message || '下线失败' })
                  }
                }}
              >
                下线
              </button>
            </div>
          </div>
        )}

        {existing.length > 0 && (
          <div>
            <div className="sb-section" style={{ paddingLeft: 0 }}>已有分享链接</div>
            {existing.map((s) => (
              <div key={s.id} className="hover-row">
                <Icon name="link" size={13} />
                <span className="ellipsis" style={{ flex: 1 }}>{s.doc_name}</span>
                <span className="tiny dim">{formatTime(s.created_at).slice(0, 16)}</span>
                <button className="btn-icon" title="打开" onClick={() => openLink(s.url)}>
                  <Icon name="external" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void createPublish()}>
          {busy === 'publish' ? '发布中…' : '发布为网页'}
        </button>
        <button className="btn btn-primary" disabled={busy !== null || !path} onClick={() => void createShare()}>
          {busy === 'share' ? '创建中…' : '创建分享链接'}
        </button>
      </div>
    </div>
  )
}

let registered = false
export const registerShareDialog = () => {
  if (registered) return
  registered = true
  registerModal('share.doc', ShareModal)
}

/** Open the share dialog for a vault path. */
export const openShareDialog = (path: string) => {
  registerShareDialog()
  useStore.getState().openModal('share.doc', { payload: { path } })
}

export default ShareModal
