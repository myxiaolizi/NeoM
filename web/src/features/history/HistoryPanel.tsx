/**
 * HistoryPanel — version list, preview, two-version diff and one-click restore.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import type { VersionMeta } from '@/lib/contracts'
import { currentVault, fileService } from '@/features/files/fileService'
import { formatBytes, relativeTime } from '@/features/files/fileUtils'
import { applyDocContent, saveDoc } from '@/features/editor/docRepo'
import { DiffView } from './DiffView'

const REASON_LABEL: Record<string, string> = {
  save: '手动保存',
  auto: '自动保存',
  restore: '回滚',
  snapshot: '快照',
  import: '导入'
}

const HistoryPanel: React.FC = () => {
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const selectedPath = useStore((s) => s.selectedPath)
  const toast = useStore((s) => s.toast)

  const activeTab = tabs.find((t) => t.id === activeTabId) || null
  const path = selectedPath || activeTab?.path || null

  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [preview, setPreview] = useState<{ id: number; content: string } | null>(null)
  const [mode, setMode] = useState<'list' | 'preview' | 'diff'>('list')

  const load = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      const list = await fileService.listVersions(currentVault(), path)
      setVersions(Array.isArray(list) ? list : [])
      setPicked([])
    } catch (e) {
      setError((e as Error)?.message || '无法读取历史版本')
      setVersions([])
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  const showVersion = async (id: number) => {
    try {
      const { content } = await fileService.readVersion(currentVault(), id)
      setPreview({ id, content })
      setMode('preview')
    } catch (e) {
      toast({ kind: 'error', text: '读取版本失败：' + ((e as Error)?.message || '') })
    }
  }

  const currentContent = useMemo(() => preview?.content || '', [preview])

  const togglePick = (id: number) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      const next = [...cur, id]
      return next.slice(-2)
    })
  }

  const compare = async () => {
    if (picked.length !== 2) {
      toast({ kind: 'warn', text: '请选择两个版本进行对比' })
      return
    }
    try {
      const [a, b] = await Promise.all(picked.map((id) => fileService.readVersion(currentVault(), id)))
      setPreview({ id: -1, content: a.content })
      setDiffPair({ left: a.content, right: b.content })
      setMode('diff')
    } catch (e) {
      toast({ kind: 'error', text: '读取版本失败：' + ((e as Error)?.message || '') })
    }
  }

  const [diffPair, setDiffPair] = useState<{ left: string; right: string } | null>(null)

  const restore = async (id: number) => {
    if (!path) return
    const { confirmAction } = await import('@/features/editor/dialogs')
    const ok = await confirmAction({
      title: '回滚到该版本',
      text: '当前内容会先保存为一个新版本，然后替换为所选版本。确定继续吗？',
      confirmText: '回滚'
    })
    if (!ok) return
    try {
      await fileService.restoreVersion(currentVault(), path, id)
      const { content } = await fileService.readVersion(currentVault(), id)
      applyDocContent(path, content)
      await saveDoc(path, { naming: false, silent: true })
      toast({ kind: 'ok', text: '已回滚到所选版本' })
      await load()
    } catch (e) {
      toast({ kind: 'error', text: '回滚失败：' + ((e as Error)?.message || '') })
    }
  }

  if (!path) {
    return (
      <div className="sb-panel">
        <div className="sb-panel-head">
          <span className="sp-title">历史版本</span>
          <button className="btn-icon" onClick={() => setLeftPanel(null)}><Icon name="x" size={13} /></button>
        </div>
        <div className="empty" style={{ padding: 22 }}>请先打开一篇文档</div>
      </div>
    )
  }

  return (
    <div className="sb-panel">
      <div className="sb-panel-head">
        <Icon name="history" size={13} />
        <span className="sp-title ellipsis" title={path}>{path.split('/').pop()}</span>
        <button className="btn-icon" title="刷新" onClick={() => void load()}><Icon name="refresh" size={13} /></button>
        <button className="btn-icon" title="关闭" onClick={() => setLeftPanel(null)}><Icon name="x" size={13} /></button>
      </div>

      {mode !== 'list' && (
        <button className="btn btn-sm btn-ghost" style={{ margin: '0 4px 6px' }} onClick={() => setMode('list')}>
          <Icon name="arrow-left" size={13} /> 返回列表
        </button>
      )}

      {mode === 'list' && (
        <>
          <div className="history-actions">
            <button className="btn btn-sm" disabled={picked.length !== 2} onClick={() => void compare()}>
              <Icon name="columns" size={13} /> 对比所选（{picked.length}/2）
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void load()} disabled={loading}>
              <Icon name="refresh" size={13} /> 刷新
            </button>
          </div>
          <div className="side-panel-body">
            {loading && <div className="empty"><span className="spinner" /> 加载中…</div>}
            {error && <div className="empty" style={{ padding: 18 }}>{error}</div>}
            {!loading && !error && !versions.length && (
              <div className="empty" style={{ padding: 22 }}>
                还没有历史版本
                <div className="tiny" style={{ marginTop: 6 }}>每次保存会自动生成一个版本</div>
              </div>
            )}
            {versions.map((v) => (
              <div
                key={v.id}
                className={'history-row' + (picked.includes(v.id) ? ' picked' : '')}
                onClick={() => void showVersion(v.id)}
                role="button"
              >
                <button
                  className="btn-icon"
                  style={{ width: 20, height: 20 }}
                  title="选择用于对比"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePick(v.id)
                  }}
                >
                  <span className={'chk-box' + (picked.includes(v.id) ? ' on' : '')} style={{ width: 13, height: 13 }}>
                    {picked.includes(v.id) && <Icon name="check" size={9} />}
                  </span>
                </button>
                <div className="hr-main">
                  <div className="hr-time">{relativeTime(v.created_at)}</div>
                  <div className="hr-meta">
                    <span>{REASON_LABEL[v.reason] || v.reason}</span>
                    <span>v{v.version}</span>
                    <span>{formatBytes(v.size)}</span>
                    {v.device && <span>{v.device}</span>}
                  </div>
                </div>
                <button
                  className="btn-icon"
                  title="回滚到该版本"
                  onClick={(e) => {
                    e.stopPropagation()
                    void restore(v.id)
                  }}
                >
                  <Icon name="undo" size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {mode === 'preview' && preview && (
        <div className="side-panel-body" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="row" style={{ padding: '2px 4px 6px', gap: 6 }}>
            <span className="small muted">版本预览</span>
            <div className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => setMode('diff')}>
              与当前对比
            </button>
            <button className="btn btn-sm" onClick={() => void restore(preview.id)}>回滚</button>
          </div>
          <pre
            className="mono"
            style={{
              flex: 1,
              margin: 0,
              padding: 10,
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.6,
              background: 'var(--surface-3)',
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {currentContent}
          </pre>
        </div>
      )}

      {mode === 'diff' && (
        <div className="side-panel-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 220 }}>
          <DiffView
            left={diffPair?.left ?? currentContent}
            right={diffPair?.right ?? currentContent}
            leftLabel="较早版本"
            rightLabel="较新版本"
          />
        </div>
      )}
    </div>
  )
}

export default HistoryPanel
