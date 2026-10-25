/**
 * properties — YAML frontmatter inspector/editor with typed fields, plus a
 * vault-wide property statistics view.
 */
import React, { useMemo, useState } from 'react'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Search, Segmented, Spinner, useActiveDoc, useVaultDocs } from '../ui'
import { collectPropertyStats } from '../vault'
import {
  parseFrontmatter,
  stringifyFrontmatter,
  type Frontmatter
} from '../utils'
import { Icon } from '@/components/Icon'

type FieldType = 'text' | 'number' | 'date' | 'checkbox' | 'list'

const inferType = (v: unknown): FieldType => {
  if (Array.isArray(v)) return 'list'
  if (typeof v === 'boolean') return 'checkbox'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'date'
  return 'text'
}

const toValue = (raw: string, type: FieldType): unknown => {
  if (type === 'number') return raw === '' ? '' : Number(raw)
  if (type === 'list') return raw.split(',').map((x) => x.trim()).filter(Boolean)
  if (type === 'checkbox') return raw === 'true'
  return raw
}

const asText = (v: unknown, type: FieldType): string => {
  if (type === 'list') return Array.isArray(v) ? v.join(', ') : String(v ?? '')
  if (type === 'checkbox') return v ? 'true' : 'false'
  return v === null || v === undefined ? '' : String(v)
}

interface Row { key: string; value: unknown; type: FieldType; isNew?: boolean }

const PropertiesPanel: React.FC<PanelProps> = ({ context }) => {
  const { path, content, reload } = useActiveDoc(context)
  const { docs } = useVaultDocs(context)
  const [tab, setTab] = useState<'doc' | 'stats'>('doc')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [override, setOverride] = useState<Row[] | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')

  const fm: Frontmatter = useMemo(() => parseFrontmatter(content || ''), [content])
  const baseRows = useMemo<Row[]>(
    () => Object.entries(fm.data).map(([k, v]) => ({ key: k, value: v, type: inferType(v) })),
    [fm]
  )
  const rows = override ?? baseRows

  const stats = useMemo(() => collectPropertyStats(docs), [docs])
  const filteredStats = useMemo(() => {
    const q = query.trim().toLowerCase()
    return stats.filter((s) => !q || s.key.toLowerCase().includes(q))
  }, [stats, query])

  const write = async (nextRows: Row[]) => {
    if (!path) return
    setBusy(true)
    try {
      const data: Record<string, unknown> = {}
      nextRows.forEach((r) => {
        if (!r.key.trim()) return
        if (r.value === '' || r.value === null || r.value === undefined) return
        data[r.key.trim()] = r.value
      })
      const next = stringifyFrontmatter(data, fm.body)
      await context.vault.write(path, next)
      setOverride(nextRows)
      context.toast('属性已写回文档', 'ok')
      reload()
      setTimeout(() => setOverride(null), 400)
    } catch (e: any) {
      context.toast(e?.message || '写回失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const setField = (key: string, patch: Partial<Row>) => {
    setOverride(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const commitAll = () => write(rows)

  const addField = () => {
    const key = newKey.trim()
    if (!key) return
    if (rows.some((r) => r.key === key)) { context.toast('该属性已存在', 'warn'); return }
    const value = newType === 'checkbox' ? false : newType === 'list' ? [] : ''
    setOverride([...rows, { key, value, type: newType, isNew: true }])
    setNewKey('')
  }

  const removeField = (key: string) => {
    const next = rows.filter((r) => r.key !== key)
    setOverride(next)
    void write(next)
  }

  return (
    <Panel>
      <Head
        icon="sliders"
        title="属性"
        sub={path ? `${path.split('/').pop()} · ${rows.length} 个属性` : '未打开文档'}
        actions={
          <>
            <Segmented value={tab} options={[{ value: 'doc', label: '当前文档' }, { value: 'stats', label: '全库统计' }]} onChange={(v) => setTab(v as 'doc' | 'stats')} />
            {tab === 'doc' && <Btn icon="save" primary onClick={commitAll} disabled={busy || !path || !override}>保存</Btn>}
          </>
        }
      />
      {tab === 'doc' ? (
        <>
          <div className="plg-scroll plg-pad">
            {!path && <Empty icon="file" text="请先打开一篇文档" />}
            {path && !rows.length && !fm.has && (
              <Empty icon="sliders" text="当前文档没有 YAML frontmatter，可在下方添加属性" />
            )}
            {!fm.has && !!rows.length && <div className="plg-warn-box"><Icon name="info" size={11} /> 保存后将自动添加 frontmatter 区块</div>}
            {rows.map((r) => (
              <div key={r.key} className="plg-prop-row">
                <span className="plg-prop-key ellipsis" title={r.key}>{r.key}</span>
                <span className="plg-prop-type">{r.type}</span>
                {r.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={!!r.value}
                    onChange={(e) => setField(r.key, { value: e.target.checked })}
                  />
                ) : r.type === 'list' ? (
                  <input
                    className="input"
                    value={asText(r.value, r.type)}
                    placeholder="用逗号分隔"
                    onChange={(e) => setField(r.key, { value: toValue(e.target.value, 'list') })}
                  />
                ) : r.type === 'date' ? (
                  <input
                    className="input"
                    type="date"
                    value={String(r.value || '').slice(0, 10)}
                    onChange={(e) => setField(r.key, { value: e.target.value })}
                  />
                ) : (
                  <input
                    className="input"
                    type={r.type === 'number' ? 'number' : 'text'}
                    value={asText(r.value, r.type)}
                    onChange={(e) => setField(r.key, { value: toValue(e.target.value, r.type) })}
                  />
                )}
                <button type="button" className="plg-icon-btn" title="删除属性" onClick={() => removeField(r.key)}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
            <div className="plg-divider" />
            <div className="row">
              <input className="input" placeholder="新属性名" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addField() }} />
              <select className="select" style={{ width: 96 }} value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="date">date</option>
                <option value="checkbox">checkbox</option>
                <option value="list">list</option>
              </select>
              <Btn icon="plus" onClick={addField}>添加</Btn>
            </div>
            {busy && <Spinner text="写回中…" />}
          </div>
          <div className="plg-foot"><Icon name="info" size={11} /><span>修改后点「保存」写回 YAML frontmatter</span></div>
        </>
      ) : (
        <>
          <div className="plg-pad-x"><Search value={query} onChange={setQuery} placeholder="筛选属性名…" /></div>
          <div className="plg-scroll">
            {!filteredStats.length && <Empty icon="chart" text="全库还没有任何 frontmatter 属性" />}
            {filteredStats.map((s) => (
              <div key={s.key} className="plg-prop-stat">
                <span className="plg-prop-key ellipsis">{s.key}</span>
                <span className="badge neutral">{s.types.join('/')}</span>
                <span className="grow" />
                <span className="plg-count">{s.count} 篇</span>
                <span className="plg-cell-dim tiny ellipsis" style={{ maxWidth: 140 }} title={JSON.stringify(s.samples)}>
                  {s.samples.map((x) => JSON.stringify(x)).join(', ')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

export const openStats = (ctx: PluginContext) => {
  import('../fullscreen').then((m) => m.openPluginWindow('properties', ctx))
  ctx.toast('已打开属性统计', 'info')
}

export default PropertiesPanel
