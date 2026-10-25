/**
 * outgoing-links — internal `[[wiki]]` links and external markdown links of the
 * active document. Unresolved internal links can be created in one click.
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps } from '../types'
import { Btn, Empty, Head, Panel, Row, Search, useActiveDoc, useVaultDocs } from '../ui'
import { resolveLink } from '../vault'
import { extractLinks, linkStem, truncate } from '../utils'

const OutgoingLinksPanel: React.FC<PanelProps> = ({ context }) => {
  const { path, content, reload } = useActiveDoc(context)
  const { docs } = useVaultDocs(context)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'internal' | 'external'>('internal')

  const links = useMemo(() => extractLinks(content || ''), [content])
  const q = query.trim().toLowerCase()

  const internal = useMemo(
    () =>
      links
        .filter((l) => l.kind === 'wiki')
        .filter((l) => !q || l.target.toLowerCase().includes(q))
        .map((l) => ({ link: l, doc: resolveLink(docs, l.target) })),
    [links, docs, q]
  )

  const external = useMemo(
    () =>
      links
        .filter((l) => l.kind === 'md')
        .filter((l) => !q || l.href.toLowerCase().includes(q) || (l.alias || '').toLowerCase().includes(q)),
    [links, q]
  )

  const create = async (name: string) => {
    const stem = linkStem(name)
    const dir = path ? path.split('/').slice(0, -1).join('/') : ''
    try {
      const p = await context.createFile(`${stem}.md`, `# ${stem}\n\n`, dir)
      context.openFile(p)
      context.toast(`已创建 ${stem}.md`, 'ok')
      reload()
    } catch (e: any) {
      context.toast(e?.message || '创建失败', 'error')
    }
  }

  return (
    <Panel>
      <Head
        icon="external"
        title="出链"
        sub={path ? `${path.split('/').pop()} · ${links.length} 个链接` : '未打开文档'}
        actions={<Btn icon="refresh" title="刷新" onClick={reload} />}
      />
      <div className="plg-pad-x"><Search value={query} onChange={setQuery} placeholder="筛选链接…" /></div>
      <div className="plg-tabs">
        <button type="button" className={tab === 'internal' ? 'on' : ''} onClick={() => setTab('internal')}>
          <Icon name="link" size={12} /> 内部 <span className="plg-count">{internal.length}</span>
        </button>
        <button type="button" className={tab === 'external' ? 'on' : ''} onClick={() => setTab('external')}>
          <Icon name="external" size={12} /> 外部 <span className="plg-count">{external.length}</span>
        </button>
      </div>
      <div className="plg-scroll">
        {!path && <Empty icon="file" text="请先打开一篇文档" />}
        {path && tab === 'internal' && !internal.length && <Empty icon="link" text="文档中没有 [[内部链接]]" />}
        {path && tab === 'internal' &&
          internal.map(({ link, doc }, i) => (
            <Row
              key={i}
              icon={doc ? 'file-text' : 'file-plus'}
              title={link.alias || link.target}
              sub={doc ? doc.path : '未找到目标（点击创建）'}
              meta={doc ? undefined : '新建'}
              onClick={() => (doc ? context.openFile(doc.path) : create(link.target))}
            />
          ))}
        {path && tab === 'external' && !external.length && <Empty icon="external" text="文档中没有外部链接" />}
        {path && tab === 'external' &&
          external.map((l, i) => (
            <Row
              key={i}
              icon={/^https?:/i.test(l.href) ? 'globe' : 'hash'}
              title={l.alias || truncate(l.href, 54)}
              sub={l.href}
              onClick={() => {
                if (/^https?:/i.test(l.href)) window.open(l.href, '_blank', 'noopener')
                else context.toast('站内锚点链接已复制', 'info')
              }}
            />
          ))}
      </div>
      <div className="plg-foot"><Icon name="info" size={11} /><span>点击未解析链接可直接新建笔记</span></div>
    </Panel>
  )
}

export default OutgoingLinksPanel
