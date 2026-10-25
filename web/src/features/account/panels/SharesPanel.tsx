/**
 * shares — 我的分享与发布
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API, type PublishPage, type ShareLink } from '@/lib/contracts'
import { useStore } from '@/store'
import { Dialog } from '@/components/Overlays'
import { absUrl, copyText, expiryText, fmtDate, pick, safeArr, useRemote } from '@/features/marketing/portalKit'
import { EmptyBox, ErrorBox, Loading, Section } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

const MODE_META: Record<string, { label: string; cls: string; icon: string }> = {
  read: { label: '只读', cls: 'neutral', icon: 'eye' },
  comment: { label: '可评论', cls: 'ok', icon: 'edit' },
  edit: { label: '可协同编辑', cls: 'warn', icon: 'users' }
}

const normalizeShare = (raw: any): ShareLink => {
  const id = String(pick(raw, ['id', 'share_id'], ''))
  return {
    id,
    doc_id: String(pick(raw, ['doc_id', 'docId', 'path'], '')),
    doc_name: String(pick(raw, ['doc_name', 'docName', 'name', 'path'], '未命名文档')),
    mode: (pick(raw, ['mode'], 'read') as ShareLink['mode']) || 'read',
    expires_at: pick(raw, ['expires_at', 'expiresAt'], null),
    password: pick(raw, ['password'], null),
    url: String(pick(raw, ['url', 'link'], '') || `/s/${id}`),
    views: Number(pick(raw, ['views', 'view_count'], 0)),
    comments: Number(pick(raw, ['comments', 'comment_count'], 0)),
    created_at: String(pick(raw, ['created_at', 'createdAt'], '')),
    status: (pick(raw, ['status'], 'active') as ShareLink['status']) || 'active'
  }
}

const normalizePublish = (raw: any): PublishPage => {
  const id = String(pick(raw, ['id', 'page_id'], ''))
  return {
    id,
    doc_id: String(pick(raw, ['doc_id', 'docId', 'path'], '')),
    doc_name: String(pick(raw, ['doc_name', 'docName', 'name', 'path'], '未命名文档')),
    url: String(pick(raw, ['url', 'link'], '') || `/p/${id}`),
    encrypted: !!pick(raw, ['encrypted'], false),
    views: Number(pick(raw, ['views', 'view_count'], 0)),
    status: (pick(raw, ['status'], 'active') as PublishPage['status']) || 'active',
    created_at: String(pick(raw, ['created_at', 'createdAt'], ''))
  }
}

const STATE_META: Record<string, { label: string; cls: string }> = {
  active: { label: '生效中', cls: 'ok' },
  blocked: { label: '已屏蔽', cls: 'danger' },
  expired: { label: '已过期', cls: 'warn' }
}

const SharesPanel: React.FC<PanelProps> = () => {
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<'share' | 'publish'>('share')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<{ kind: 'share' | 'publish'; row: ShareLink | PublishPage } | null>(null)

  const shares = useRemote<any>(API.shareList, [], (raw) => safeArr<any>(raw).map(normalizeShare))
  const publishes = useRemote<any>(API.publishList, [], (raw) => safeArr<any>(raw).map(normalizePublish))

  const active = tab === 'share' ? shares : publishes
  const rows = useMemo(() => active.data, [active.data])

  const open = (url: string) => {
    const abs = absUrl(url)
    if (!abs) {
      toast({ kind: 'warn', text: '该链接地址尚未生成' })
      return
    }
    window.open(abs, '_blank', 'noopener,noreferrer')
  }

  const copy = async (url: string) => {
    const ok = await copyText(absUrl(url))
    toast({ kind: ok ? 'ok' : 'warn', text: ok ? '链接已复制到剪贴板' : '复制失败，请手动复制' })
  }

  const revoke = async () => {
    if (!confirmRevoke) return
    const { kind, row } = confirmRevoke
    setBusy(row.id)
    try {
      await api.post(kind === 'share' ? API.shareRevoke : API.publishRevoke, { id: row.id })
      toast({ kind: 'ok', text: kind === 'share' ? '已取消分享' : '已取消发布' })
      setConfirmRevoke(null)
      ;(kind === 'share' ? shares : publishes).reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '操作失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Section
        icon="share"
        title="我的分享与发布"
        desc="协作文档生成带权限与有效期的链接；HTML 发布页可加密访问并附带评论挂件。"
        actions={
          <button className="btn btn-sm" onClick={active.reload} disabled={active.loading}>
            {active.loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
          </button>
        }
      >
        <div className="ac-tabs" style={{ marginBottom: 14 }}>
          <button className={'ac-tab' + (tab === 'share' ? ' active' : '')} onClick={() => setTab('share')}>
            <Icon name="users" size={13} /> 协作分享
            <span className="badge neutral" style={{ height: 16, padding: '0 5px' }}>{shares.data.length}</span>
          </button>
          <button className={'ac-tab' + (tab === 'publish' ? ' active' : '')} onClick={() => setTab('publish')}>
            <Icon name="globe" size={13} /> HTML 发布
            <span className="badge neutral" style={{ height: 16, padding: '0 5px' }}>{publishes.data.length}</span>
          </button>
        </div>

        {active.loading ? (
          <Loading text="正在加载分享列表…" />
        ) : active.error ? (
          <ErrorBox message={active.error} onRetry={active.reload} />
        ) : rows.length === 0 ? (
          <EmptyBox
            icon={tab === 'share' ? 'users' : 'globe'}
            title={tab === 'share' ? '还没有创建分享' : '还没有发布网页'}
            desc={
              tab === 'share'
                ? '在编辑器中右键文档 → 分享，即可生成只读 / 可评论 / 可协同编辑链接。'
                : '在编辑器中右键文档 → 发布为网页，可生成带密码的独立 HTML 页面。'
            }
          />
        ) : tab === 'share' ? (
          <div>
            {(rows as ShareLink[]).map((s) => {
              const mode = MODE_META[s.mode] || MODE_META.read
              const state = STATE_META[s.status] || STATE_META.active
              return (
                <div className="ac-row" key={s.id}>
                  <span className="p-tile" style={{ width: 32, height: 32, borderRadius: 9 }}>
                    <Icon name="file-text" size={15} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="title">
                      <span title={s.doc_name}>{s.doc_name}</span>
                      <span className={'badge ' + mode.cls}>
                        <Icon name={mode.icon} size={10} /> {mode.label}
                      </span>
                      <span className={'badge ' + state.cls}>{state.label}</span>
                      {s.password && (
                        <span className="badge neutral">
                          <Icon name="lock" size={10} /> 有密码
                        </span>
                      )}
                    </div>
                    <div className="meta">
                      <span>
                        <Icon name="eye" size={11} /> {s.views} 次访问
                      </span>
                      <span>
                        <Icon name="edit" size={11} /> {s.comments} 条评论
                      </span>
                      <span>
                        <Icon name="clock" size={11} /> {expiryText(s.expires_at)}
                      </span>
                      <span>创建于 {fmtDate(s.created_at)}</span>
                    </div>
                  </div>
                  <div className="ops">
                    <button className="btn btn-sm" onClick={() => open(s.url)} title="在新标签打开分享页">
                      <Icon name="external" size={12} /> 访问
                    </button>
                    <button className="btn btn-sm" onClick={() => copy(s.url)}>
                      <Icon name="copy" size={12} /> 复制链接
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setConfirmRevoke({ kind: 'share', row: s })}
                      disabled={busy === s.id || s.status !== 'active'}
                    >
                      {busy === s.id ? <span className="spinner" /> : <Icon name="x" size={12} />} 取消分享
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div>
            {(rows as PublishPage[]).map((p) => {
              const state = STATE_META[p.status] || STATE_META.active
              return (
                <div className="ac-row" key={p.id}>
                  <span className="p-tile" style={{ width: 32, height: 32, borderRadius: 9 }}>
                    <Icon name="globe" size={15} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="title">
                      <span title={p.doc_name}>{p.doc_name}</span>
                      <span className={'badge ' + state.cls}>{state.label}</span>
                      {p.encrypted && (
                        <span className="badge neutral">
                          <Icon name="lock" size={10} /> 加密访问
                        </span>
                      )}
                    </div>
                    <div className="meta">
                      <span>
                        <Icon name="eye" size={11} /> {p.views} 次访问
                      </span>
                      <span>发布于 {fmtDate(p.created_at)}</span>
                      <span className="mono">{absUrl(p.url)}</span>
                    </div>
                  </div>
                  <div className="ops">
                    <button className="btn btn-sm" onClick={() => open(p.url)}>
                      <Icon name="external" size={12} /> 打开
                    </button>
                    <button className="btn btn-sm" onClick={() => copy(p.url)}>
                      <Icon name="copy" size={12} /> 复制链接
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setConfirmRevoke({ kind: 'publish', row: p })}
                      disabled={busy === p.id || p.status !== 'active'}
                    >
                      {busy === p.id ? <span className="spinner" /> : <Icon name="x" size={12} />} 取消发布
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section icon="info" title="分享说明" desc="链接权限与访问控制。">
        <div className="sync-list">
          {[
            { icon: 'hash', t: '免登录访问', d: '分享链接无需登录即可阅读，适合对外交付与临时协作。' },
            { icon: 'lock', t: '密码与有效期', d: '创建时可设置访问密码和过期时间，到期自动失效。' },
            { icon: 'edit', t: '评论标注', d: '选择「可评论」后，访客选中文字即可添加标注，评论不会修改正文。' },
            { icon: 'shield', t: '随时撤销', d: '撤销后链接立即失效；被举报的内容可能被管理员屏蔽。' }
          ].map((x) => (
            <div className="sync-item" key={x.t}>
              <span className="p-tile">
                <Icon name={x.icon} size={16} />
              </span>
              <div>
                <div className="t">{x.t}</div>
                <div className="d">{x.d}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {confirmRevoke && (
        <Dialog
          title={confirmRevoke.kind === 'share' ? '确认取消分享？' : '确认取消发布？'}
          icon="alert"
          onClose={() => setConfirmRevoke(null)}
          width={430}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmRevoke(null)}>
                取消
              </button>
              <button className="btn btn-danger" onClick={revoke} disabled={busy === confirmRevoke.row.id}>
                {busy === confirmRevoke.row.id ? <span className="spinner" /> : null} 确认
              </button>
            </>
          }
        >
          <p className="small" style={{ lineHeight: 1.7, margin: 0 }}>
            「{confirmRevoke.row.doc_name}」的
            {confirmRevoke.kind === 'share' ? '分享链接将立即失效' : '发布页将立即下线'}
            ，已打开的页面刷新后将无法访问。文档本身不会被删除。
          </p>
        </Dialog>
      )}
    </>
  )
}

export default SharesPanel
