/**
 * backup — 云端备份与历史版本
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API, type VersionMeta } from '@/lib/contracts'
import { useStore } from '@/store'
import { Dialog } from '@/components/Overlays'
import { fmtBytes, fmtDate, fmtRelative, pick, safeArr, useRemote } from '@/features/marketing/portalKit'
import { EmptyBox, ErrorBox, Loading, Section } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

interface Row extends VersionMeta {
  source: 'version' | 'backup'
  url?: string
  name?: string
  status?: string
}

const REASON_LABEL: Record<string, string> = {
  save: '保存',
  auto: '自动保存',
  restore: '恢复',
  snapshot: '快照',
  import: '导入'
}

const normalizeVersion = (raw: any): Row => ({
  id: Number(pick(raw, ['id', 'version_id'], 0)),
  doc_id: String(pick(raw, ['doc_id', 'docId'], '')),
  path: String(pick(raw, ['path', 'file', 'name'], '')),
  version: Number(pick(raw, ['version', 'ver'], 0)),
  size: Number(pick(raw, ['size', 'bytes'], 0)),
  created_at: String(pick(raw, ['created_at', 'createdAt', 'date'], '')),
  reason: (pick(raw, ['reason'], 'save') as VersionMeta['reason']) || 'save',
  device: pick(raw, ['device'], ''),
  source: 'version'
})

const normalizeBackup = (raw: any): Row => ({
  id: Number(pick(raw, ['id'], 0)),
  doc_id: '',
  path: String(pick(raw, ['name', 'path', 'title'], '备份文件')),
  version: 0,
  size: Number(pick(raw, ['size', 'bytes'], 0)),
  created_at: String(pick(raw, ['created_at', 'createdAt', 'date'], '')),
  reason: 'snapshot',
  source: 'backup',
  url: String(pick(raw, ['url', 'download_url'], '') || ''),
  name: String(pick(raw, ['name'], '')),
  status: String(pick(raw, ['status', 'state'], 'done') || 'done')
})

const BackupPanel: React.FC<PanelProps> = () => {
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<'versions' | 'backups'>('versions')
  const [preview, setPreview] = useState<{ row: Row; content: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<Row | null>(null)

  const versions = useRemote<any>(API.versionsList + '?limit=60', [], (raw) => safeArr<any>(raw).map(normalizeVersion))
  const backups = useRemote<any>('/api/backup/list', [], (raw) => safeArr<any>(raw).map(normalizeBackup))

  const active = tab === 'versions' ? versions : backups
  const rows = useMemo(() => active.data.filter((r) => r.path), [active.data])

  const openPreview = async (row: Row) => {
    if (row.source !== 'version' || !row.id) {
      if (row.url) window.open(row.url, '_blank', 'noopener,noreferrer')
      return
    }
    setBusy('preview-' + row.id)
    try {
      const raw = await api.get<any>(API.versionsRead + '?id=' + encodeURIComponent(String(row.id)))
      setPreview({ row, content: String(pick(raw, ['content', 'body'], '') || '') })
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '读取版本内容失败' })
    } finally {
      setBusy(null)
    }
  }

  const restore = async (row: Row) => {
    setBusy('restore-' + row.id)
    try {
      await api.post(API.versionsRestore, { id: row.id })
      toast({ kind: 'ok', text: '已恢复到该版本，原内容已另存为历史版本' })
      setConfirmRestore(null)
      versions.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '恢复失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  const download = async (row: Row) => {
    if (row.url) {
      window.open(row.url, '_blank', 'noopener,noreferrer')
      return
    }
    if (row.source !== 'version' || !row.id) return
    setBusy('dl-' + row.id)
    try {
      const raw = await api.get<any>(API.versionsRead + '?id=' + encodeURIComponent(String(row.id)))
      const content = String(pick(raw, ['content', 'body'], '') || '')
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (row.path.split('/').pop() || 'note.md').replace(/\.md$/i, '') + `-v${row.version}.md`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      toast({ kind: 'ok', text: '已开始下载' })
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '下载失败' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Section
        icon="history"
        title="历史版本"
        desc="每次保存都会留下快照，可对比或恢复到任意时间点。删除的文件在回收站中保留 30 天。"
        actions={
          <button className="btn btn-sm" onClick={active.reload} disabled={active.loading}>
            {active.loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
          </button>
        }
      >
        <div className="ac-tabs" style={{ marginBottom: 14 }}>
          <button className={'ac-tab' + (tab === 'versions' ? ' active' : '')} onClick={() => setTab('versions')}>
            <Icon name="history" size={13} /> 文件版本
          </button>
          <button className={'ac-tab' + (tab === 'backups' ? ' active' : '')} onClick={() => setTab('backups')}>
            <Icon name="database" size={13} /> 云端备份
          </button>
        </div>

        {active.loading ? (
          <Loading text={tab === 'versions' ? '正在加载版本记录…' : '正在加载备份列表…'} />
        ) : active.error ? (
          <ErrorBox message={active.error} onRetry={active.reload} />
        ) : rows.length === 0 ? (
          <EmptyBox
            icon={tab === 'versions' ? 'history' : 'database'}
            title={tab === 'versions' ? '还没有历史版本' : '还没有云端备份'}
            desc={
              tab === 'versions'
                ? '在编辑器中保存文档后，NeoM 会自动记录版本，可在此查看与恢复。'
                : '管理员开启自动备份后会在此展示数据库与站点备份包，可下载或在指定时间点恢复。'
            }
          />
        ) : (
          <div>
            {rows.map((row) => (
              <div className="ac-version" key={`${row.source}-${row.id}-${row.path}`}>
                <span className="p-tile" style={{ width: 30, height: 30, borderRadius: 9 }}>
                  <Icon name={row.source === 'version' ? 'file-text' : 'database'} size={14} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="path" title={row.path}>
                    {row.path}
                  </div>
                  <div className="meta">
                    {row.source === 'version' ? (
                      <>
                        <span className="mono">v{row.version}</span>
                        <span>{REASON_LABEL[row.reason] || row.reason}</span>
                        <span>{row.size ? fmtBytes(row.size) : '—'}</span>
                        <span>{fmtDate(row.created_at, true)}</span>
                        {row.device && <span>{row.device}</span>}
                      </>
                    ) : (
                      <>
                        <span>{row.status === 'done' ? '备份完成' : row.status}</span>
                        <span>{row.size ? fmtBytes(row.size) : '—'}</span>
                        <span>{fmtDate(row.created_at, true)}</span>
                        <span>{fmtRelative(row.created_at)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => openPreview(row)} disabled={busy === 'preview-' + row.id}>
                    {busy === 'preview-' + row.id ? <span className="spinner" /> : <Icon name="eye" size={12} />} 查看
                  </button>
                  <button className="btn btn-sm" onClick={() => download(row)} disabled={busy === 'dl-' + row.id}>
                    {busy === 'dl-' + row.id ? <span className="spinner" /> : <Icon name="download" size={12} />} 下载
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => setConfirmRestore(row)}>
                    <Icon name="refresh" size={12} /> 恢复
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon="calendar" title="关于保留策略" desc="版本与备份的存储规则。">
        <div className="ac-grid3">
          {[
            { icon: 'clock', t: '版本保留', d: '每个文件保留最近 100 个版本，超过后按时间淘汰最旧的自动保存记录。' },
            { icon: 'trash', t: '回收站', d: '删除的文件进入回收站保留 30 天，期间可一键还原。' },
            { icon: 'database', t: '云端备份', d: '数据库备份每日一次，保留 14 天；站点文件备份每周一次。' }
          ].map((x) => (
            <div key={x.t} className="p-card" style={{ padding: 14, boxShadow: 'none' }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Icon name={x.icon} size={14} />
                <b className="small">{x.t}</b>
              </div>
              <div className="tiny muted" style={{ lineHeight: 1.65 }}>
                {x.d}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {preview && (
        <Dialog
          title={`${preview.row.path} · v${preview.row.version}`}
          icon="file-text"
          onClose={() => setPreview(null)}
          width={760}
          footer={
            <>
              <button className="btn" onClick={() => setPreview(null)}>
                关闭
              </button>
              <button className="btn btn-primary" onClick={() => { setPreview(null); setConfirmRestore(preview.row) }}>
                <Icon name="refresh" size={13} /> 恢复此版本
              </button>
            </>
          }
        >
          <div className="tiny dim" style={{ marginBottom: 8 }}>
            {fmtDate(preview.row.created_at, true)} · {REASON_LABEL[preview.row.reason] || preview.row.reason} ·{' '}
            {preview.row.size ? fmtBytes(preview.row.size) : '—'}
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 'var(--r-md)',
              background: 'var(--code-bg)',
              border: '1px solid var(--code-border)',
              fontSize: 12,
              lineHeight: 1.65,
              maxHeight: '56vh',
              overflow: 'auto',
              whiteSpace: 'pre-wrap'
            }}
          >
            {preview.content || '（空内容）'}
          </pre>
        </Dialog>
      )}

      {confirmRestore && (
        <Dialog
          title="确认恢复到此版本？"
          icon="alert"
          onClose={() => setConfirmRestore(null)}
          width={460}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmRestore(null)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => restore(confirmRestore)} disabled={busy === 'restore-' + confirmRestore.id}>
                {busy === 'restore-' + confirmRestore.id ? <span className="spinner" /> : null} 确认恢复
              </button>
            </>
          }
        >
          <p className="small" style={{ lineHeight: 1.7, margin: 0 }}>
            将把 <b>{confirmRestore.path}</b> 恢复为 {fmtDate(confirmRestore.created_at, true)} 的内容。
            当前内容会先另存为一个新的历史版本，不会丢失。
          </p>
        </Dialog>
      )}
    </>
  )
}

export default BackupPanel
