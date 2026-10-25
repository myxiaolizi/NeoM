/**
 * publish — turn the active document into a public (optionally encrypted)
 * HTML page via `/api/publish/create`, then manage / revoke published pages.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PublishPage } from '@/lib/contracts'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Spinner, useActiveDoc } from '../ui'
import { copyText, fmtDate } from '../utils'

const PublishPanel: React.FC<PanelProps> = ({ context }) => {
  const { path } = useActiveDoc(context)
  const [encrypted, setEncrypted] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [pages, setPages] = useState<PublishPage[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUrl, setLastUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await context.api.get('/api/publish/list')
      setPages(Array.isArray(rows) ? rows : [])
    } catch {
      setPages([])
    } finally {
      setLoading(false)
    }
  }, [context])

  useEffect(() => { void load() }, [load])

  const publish = async () => {
    if (!path) { context.toast('请先打开要发布的文档', 'warn'); return }
    if (encrypted && !password.trim()) { context.toast('请输入访问密码', 'warn'); return }
    setBusy(true)
    try {
      const page: PublishPage = await context.api.post('/api/publish/create', {
        path,
        encrypted,
        password: encrypted ? password : undefined
      })
      const url = page?.url || ''
      setLastUrl(url)
      context.toast('发布成功', 'ok')
      void load()
      window.open(url, '_blank', 'noopener')
    } catch (e: any) {
      context.toast(e?.message || '发布失败（请检查登录状态）', 'error')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    if (!window.confirm('确定取消发布？公开链接将立即失效。')) return
    try {
      await context.api.post('/api/publish/revoke', { id })
      context.toast('已取消发布', 'ok')
      void load()
    } catch (e: any) {
      context.toast(e?.message || '操作失败', 'error')
    }
  }

  return (
    <Panel>
      <Head
        icon="globe"
        title="发布"
        sub={path ? path.split('/').pop() : '未打开文档'}
        actions={<Btn icon="refresh" title="刷新列表" onClick={load} />}
      />
      <div className="plg-pad col">
        <div className="plg-publish-hero">
          <Icon name="globe" size={20} />
          <div className="grow">
            <div className="plg-head-title">发布为 HTML 网页</div>
            <div className="plg-head-sub">生成一个可分享的公开链接，无需登录即可阅读</div>
          </div>
        </div>
        <label className="plg-check">
          <input type="checkbox" checked={encrypted} onChange={(e) => setEncrypted(e.target.checked)} />
          需要访问密码（加密发布）
        </label>
        {encrypted && (
          <input
            className="input"
            type="password"
            placeholder="访问密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <Btn icon={busy ? 'sync' : 'globe'} primary onClick={publish} disabled={busy || !path}>
          {busy ? '发布中…' : '立即发布'}
        </Btn>
        {lastUrl && (
          <div className="plg-publish-link">
            <a href={lastUrl} target="_blank" rel="noreferrer" className="ellipsis">{lastUrl}</a>
            <Btn icon="copy" onClick={async () => {
              const ok = await copyText(lastUrl)
              context.toast(ok ? '链接已复制' : '复制失败', ok ? 'ok' : 'error')
            }}>复制</Btn>
          </div>
        )}
      </div>
      <div className="plg-divider" />
      <div className="plg-sub-title">已发布的页面 · {pages.length}</div>
      <div className="plg-scroll">
        {loading && <Spinner text="读取发布列表…" />}
        {!loading && !pages.length && <Empty icon="globe" text="还没有发布过页面" />}
        {pages.map((p) => (
          <div key={p.id} className="plg-publish-row">
            <Icon name="globe" size={13} />
            <div className="grow">
              <div className="plg-row-title ellipsis">{p.doc_name}</div>
              <div className="plg-row-sub ellipsis">{p.url}</div>
            </div>
            <span className="badge neutral">{p.encrypted ? '加密' : '公开'}</span>
            <span className="plg-cell-dim tiny">{p.views ?? 0} 次</span>
            <span className="plg-cell-dim tiny">{fmtDate(p.created_at)}</span>
            <button type="button" className="plg-icon-btn" title="复制链接" onClick={async () => {
              const ok = await copyText(p.url)
              context.toast(ok ? '链接已复制' : '复制失败', ok ? 'ok' : 'error')
            }}><Icon name="copy" size={12} /></button>
            <button type="button" className="plg-icon-btn" title="打开" onClick={() => window.open(p.url, '_blank', 'noopener')}>
              <Icon name="external" size={12} />
            </button>
            <button type="button" className="plg-icon-btn" title="取消发布" onClick={() => revoke(p.id)}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="plg-foot"><Icon name="lock" size={11} /><span>取消发布后公开链接立即失效</span></div>
    </Panel>
  )
}

export default PublishPanel
