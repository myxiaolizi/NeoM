/**
 * footnote-view — list every `[^id]` reference and definition, jump to them,
 * and edit definitions in place (writes the new definition back to the doc).
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Spinner, useActiveDoc } from '../ui'
import { extractFootnotes, truncate } from '../utils'

const FootnotePanel: React.FC<PanelProps> = ({ context }) => {
  const { path, content, reload } = useActiveDoc(context)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const { refs, defs } = useMemo(() => extractFootnotes(content || ''), [content])
  const refCount = useMemo(() => {
    const m = new Map<string, number>()
    refs.forEach((r) => m.set(r.id, (m.get(r.id) || 0) + 1))
    return m
  }, [refs])
  const orphanRefs = refs.filter((r) => !defs.some((d) => d.id === r.id))
  const unusedDefs = defs.filter((d) => !refCount.has(d.id))

  const startEdit = (id: string, text: string) => { setEditing(id); setDraft(text.trim()) }

  const save = async (defId: string) => {
    if (!path || editing === null) return
    setBusy(true)
    try {
      const def = defs.find((d) => d.id === defId)
      if (!def) return
      const lines = draft.trim().split('\n')
      const replacement = `[^${defId}]: ${lines[0] || ''}${lines.slice(1).map((l) => '\n  ' + l).join('')}\n`
      const next = content.slice(0, def.offset) + replacement + content.slice(def.endOffset)
      await context.vault.write(path, next)
      context.toast('脚注定义已写回', 'ok')
      setEditing(null)
      reload()
    } catch (e: any) {
      context.toast(e?.message || '写回失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const addDef = async () => {
    if (!path) return
    const id = window.prompt('新脚注 ID（不含方括号）', String(defs.length + 1))
    if (!id) return
    const text = window.prompt('脚注内容', '') || ''
    const next = content.trimEnd() + `\n\n[^${id}]: ${text}\n`
    try {
      await context.vault.write(path, next)
      context.toast('已添加脚注定义', 'ok')
      reload()
    } catch (e: any) {
      context.toast(e?.message || '添加失败', 'error')
    }
  }

  return (
    <Panel>
      <Head
        icon="footnote"
        title="脚注"
        sub={path ? `${refs.length} 处引用 · ${defs.length} 个定义` : '未打开文档'}
        actions={<Btn icon="plus" title="添加脚注定义" onClick={addDef} disabled={!path} />}
      />
      <div className="plg-scroll">
        {!path && <Empty icon="file" text="请先打开一篇文档" />}
        {path && !refs.length && !defs.length && <Empty icon="footnote" text="文档中没有脚注（[^1] 语法）" />}
        {defs.map((d) => (
          <div key={`${d.id}-${d.offset}`} className="plg-fn-def">
            <div className="plg-fn-head">
              <span className="plg-fn-id">[^{d.id}]</span>
              <span className="plg-cell-dim tiny">L{d.line} · 被引用 {refCount.get(d.id) || 0} 次</span>
              <span className="grow" />
              {editing === d.id ? (
                <>
                  <Btn icon="x" onClick={() => setEditing(null)}>取消</Btn>
                  <Btn icon="save" primary onClick={() => save(d.id)} disabled={busy}>保存</Btn>
                </>
              ) : (
                <>
                  <button type="button" className="plg-icon-btn" title="跳转" onClick={() => {
                    window.dispatchEvent(new CustomEvent('neom:outline-jump', { detail: { offset: d.offset } }))
                  }}><Icon name="arrow-right" size={12} /></button>
                  <button type="button" className="plg-icon-btn" title="编辑" onClick={() => startEdit(d.id, d.text)}>
                    <Icon name="edit" size={12} />
                  </button>
                </>
              )}
            </div>
            {editing === d.id ? (
              <textarea className="textarea" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            ) : (
              <div className="plg-fn-text">{truncate(d.text.trim() || '（空定义）', 240)}</div>
            )}
          </div>
        ))}
        {editing && <Spinner text="写回中…" />}
        <div className="plg-divider" />
        <div className="plg-sub-title">引用位置</div>
        {refs.map((r, i) => (
          <div
            key={`${r.id}-${r.offset}-${i}`}
            className="plg-row clickable"
            onClick={() => window.dispatchEvent(new CustomEvent('neom:outline-jump', { detail: { offset: r.offset } }))}
          >
            <span className="plg-row-icon"><Icon name="footnote" size={12} /></span>
            <span className="plg-row-title">[^{r.id}]</span>
            <span className="plg-row-meta">L{r.line}</span>
          </div>
        ))}
        {(orphanRefs.length > 0 || unusedDefs.length > 0) && (
          <div className="plg-warn-box">
            {orphanRefs.length > 0 && <div><Icon name="alert" size={11} /> {orphanRefs.length} 处引用没有对应定义</div>}
            {unusedDefs.length > 0 && <div><Icon name="info" size={11} /> {unusedDefs.length} 个定义未被引用</div>}
          </div>
        )}
      </div>
      <div className="plg-foot"><Icon name="info" size={11} /><span>编辑定义后自动写回当前文档</span></div>
    </Panel>
  )
}

export default FootnotePanel
