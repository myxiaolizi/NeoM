/**
 * note-restructure — split one document into many, merge many into one,
 * and restructure a document by reordering its sections.
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Row, Search, Segmented, Spinner, useActiveDoc, useVaultDocs, docTitle } from '../ui'
import { extractHeadings, type Heading } from '../utils'

type Mode = 'split' | 'merge' | 'sections'

const splitByHeadings = (content: string, level: number): { title: string; body: string }[] => {
  const heads = extractHeadings(content).filter((h) => h.level <= level)
  if (!heads.length) return []
  const out: { title: string; body: string }[] = []
  const preamble = content.slice(0, heads[0].offset).trim()
  if (preamble) out.push({ title: '前言', body: preamble })
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].offset : content.length
    out.push({ title: h.text.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60), body: content.slice(h.offset, end).trim() })
  })
  return out.filter((s) => s.body)
}

const splitBySeparator = (content: string, sep: string): { title: string; body: string }[] => {
  const parts = content.split(sep)
  return parts
    .map((p, i) => {
      const h = /^#{1,6}\s+(.+)$/m.exec(p)
      return { title: (h ? h[1] : `片段 ${i + 1}`).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60), body: p.trim() }
    })
    .filter((s) => s.body)
}

const NoteRestructurePanel: React.FC<PanelProps> = ({ context }) => {
  const { path, content, reload } = useActiveDoc(context)
  const { docs } = useVaultDocs(context)
  const [mode, setMode] = useState<Mode>('split')
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState(2)
  const [sep, setSep] = useState('---')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [mergeTitle, setMergeTitle] = useState('合并笔记')
  const [keepHeadings, setKeepHeadings] = useState(true)
  const [sections, setSections] = useState<Heading[] | null>(null)

  const stem = (path || '').split('/').pop()?.replace(/\.(md|mdx|txt)$/i, '') || '未命名'
  const dir = (path || '').split('/').slice(0, -1).join('/')

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase()
    return docs.filter((d) => d.path !== path && (!q || d.path.toLowerCase().includes(q) || docTitle(d).toLowerCase().includes(q)))
  }, [docs, query, path])

  const activeSections = useMemo(() => sections || extractHeadings(content), [sections, content])

  const doSplit = async (kind: 'heading' | 'separator') => {
    if (!path || !content) { context.toast('请先打开要拆分的文档', 'warn'); return }
    const parts = kind === 'heading' ? splitByHeadings(content, level) : splitBySeparator(content, sep)
    if (!parts.length) { context.toast('没有可拆分的内容', 'warn'); return }
    if (!window.confirm(`将拆分为 ${parts.length} 个文件，写入「${dir || '根目录'}」，继续？`)) return
    setBusy(true)
    let ok = 0
    for (const p of parts) {
      try {
        await context.createFile(`${stem}-${p.title}.md`, p.body + '\n', dir)
        ok++
      } catch { /* keep going */ }
    }
    setBusy(false)
    context.refreshTree()
    context.toast(`已拆分 ${ok}/${parts.length} 个文件`, ok ? 'ok' : 'error')
  }

  const doMerge = async () => {
    if (picked.length < 2) { context.toast('至少选择 2 篇笔记', 'warn'); return }
    setBusy(true)
    try {
      const chunks: string[] = []
      for (const p of picked) {
        const raw = await context.vault.read(p)
        const text = typeof raw === 'string' ? raw : raw?.content || ''
        const title = p.split('/').pop()?.replace(/\.(md|mdx|txt)$/i, '') || p
        chunks.push((keepHeadings ? `# ${title}\n\n` : '') + text.trim())
      }
      const merged = chunks.join('\n\n---\n\n') + '\n'
      const created = await context.createFile(`${mergeTitle || '合并笔记'}.md`, merged, dir)
      context.toast(`已合并 ${picked.length} 篇 → ${created}`, 'ok')
      context.openFile(created)
      setPicked([])
      context.refreshTree()
    } catch (e: any) {
      context.toast(e?.message || '合并失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const moveSection = async (idx: number, delta: number) => {
    const list = [...activeSections]
    const target = idx + delta
    if (target < 0 || target >= list.length) return
    const from = list[idx]
    const to = list[target]
    if (to.offset >= from.offset && to.offset < from.endOffset) return
    const block = content.slice(from.offset, from.endOffset)
    const rest = content.slice(0, from.offset) + content.slice(from.endOffset)
    const pos = to.offset > from.endOffset ? to.offset - block.length : to.offset
    const next = (rest.slice(0, pos) + block + rest.slice(pos)).replace(/\n{3,}/g, '\n\n')
    if (!path) return
    setBusy(true)
    try {
      await context.vault.write(path, next)
      const fresh = extractHeadings(next)
      setSections(fresh)
      reload()
      context.toast('章节顺序已写回', 'ok')
    } catch (e: any) {
      context.toast(e?.message || '写回失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <Head
        icon="scissors"
        title="笔记重组"
        sub={path ? path.split('/').pop() : '未打开文档'}
        actions={<Segmented
          value={mode}
          options={[
            { value: 'split', label: '拆分', icon: 'scissors' },
            { value: 'merge', label: '合并', icon: 'layers' },
            { value: 'sections', label: '章节', icon: 'headings' }
          ]}
          onChange={(v) => setMode(v as Mode)}
        />}
      />
      <div className="plg-scroll plg-pad">
        {mode === 'split' && (
          <>
            <div className="plg-sub-title">拆分为多个文件</div>
            <div className="plg-field">
              <span className="plg-field-label">按标题级别拆分</span>
              <div className="row">
                <select className="select" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((l) => <option key={l} value={l}>H{l} 及以下</option>)}
                </select>
                <Btn icon="scissors" primary onClick={() => doSplit('heading')} disabled={busy}>拆分</Btn>
              </div>
            </div>
            <div className="plg-field">
              <span className="plg-field-label">按分隔符拆分</span>
              <div className="row">
                <input className="input" value={sep} onChange={(e) => setSep(e.target.value)} placeholder="---" />
                <Btn icon="scissors" onClick={() => doSplit('separator')} disabled={busy}>拆分</Btn>
              </div>
              <span className="plg-field-hint">文件名规则：{stem}-章节标题.md</span>
            </div>
            <div className="plg-preview-list">
              {(level ? splitByHeadings(content, level) : []).slice(0, 12).map((p, i) => (
                <Row key={i} icon="file-plus" title={p.title} meta={`${p.body.length} 字`} />
              ))}
              {!content && <Empty icon="file" text="请先打开要拆分的文档" />}
            </div>
          </>
        )}
        {mode === 'merge' && (
          <>
            <div className="plg-sub-title">合并为一篇（按选择顺序）</div>
            <div className="row">
              <input className="input" value={mergeTitle} onChange={(e) => setMergeTitle(e.target.value)} placeholder="合并后的文件名" />
              <Btn icon="layers" primary onClick={doMerge} disabled={busy || picked.length < 2}>合并 {picked.length}</Btn>
            </div>
            <label className="plg-check">
              <input type="checkbox" checked={keepHeadings} onChange={(e) => setKeepHeadings(e.target.checked)} />
              为每篇插入标题
            </label>
            <Search value={query} onChange={setQuery} placeholder="搜索要合并的笔记…" />
            <div className="plg-merge-order">
              {picked.map((p, i) => (
                <span key={p} className="chip" onClick={() => setPicked((x) => x.filter((y) => y !== p))}>
                  {i + 1}. {p.split('/').pop()} <Icon name="x" size={10} />
                </span>
              ))}
            </div>
            <div className="plg-scroll" style={{ maxHeight: 260 }}>
              {filteredDocs.map((d) => (
                <Row
                  key={d.path}
                  icon={picked.includes(d.path) ? 'check' : 'file-text'}
                  title={docTitle(d)}
                  sub={d.path}
                  active={picked.includes(d.path)}
                  onClick={() => setPicked((x) => (x.includes(d.path) ? x.filter((y) => y !== d.path) : [...x, d.path]))}
                />
              ))}
            </div>
          </>
        )}
        {mode === 'sections' && (
          <>
            <div className="plg-sub-title">章节顺序（↑↓ 调整后自动写回）</div>
            {!activeSections.length && <Empty icon="headings" text="当前文档没有标题层级" />}
            {activeSections.map((h, i) => (
              <div key={`${h.offset}-${i}`} className="plg-row">
                <span className="plg-row-icon"><Icon name="headings" size={12} /></span>
                <span className={'plg-h' + h.level}>H{h.level}</span>
                <span className="grow ellipsis">{h.text}</span>
                <span className="plg-cell-dim tiny">{h.endOffset - h.offset} 字符</span>
                <button type="button" className="plg-icon-btn" onClick={() => moveSection(i, -1)} title="上移"><Icon name="chevron-up" size={12} /></button>
                <button type="button" className="plg-icon-btn" onClick={() => moveSection(i, 1)} title="下移"><Icon name="chevron-down" size={12} /></button>
              </div>
            ))}
            {busy && <Spinner text="写回中…" />}
          </>
        )}
      </div>
      <div className="plg-foot"><Icon name="info" size={11} /><span>拆分/合并都会新建文件，原文档保持不变</span></div>
    </Panel>
  )
}

export default NoteRestructurePanel
