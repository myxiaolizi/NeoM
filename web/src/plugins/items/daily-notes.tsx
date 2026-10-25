/**
 * daily-notes — `日记/YYYY-MM-DD.md` with a month calendar view and an
 * editable template (stored per plugin in localStorage).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, Spinner } from '../ui'
import { fmtDate, todayISO, writeJson, readJson } from '../utils'

const DIR = '日记'
const TPL_KEY_LEGACY = 'neom.dailynotes.template'

const DEFAULT_TEMPLATE = `# {{date}}

## 今日记录


## 待办
- [ ]

## 反思

`

const expandTemplate = (tpl: string, iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return tpl
    .replace(/\{\{date\}\}/g, iso)
    .replace(/\{\{time\}\}/g, new Date().toTimeString().slice(0, 5))
    .replace(/\{\{weekday\}\}/g, week)
    .replace(/\{\{title\}\}/g, iso)
}

const pathOf = (iso: string) => `${DIR}/${iso}.md`

const readTemplate = (ctx: PluginContext) => {
  const own = ctx.settings.get<string>('template', '')
  if (own) return own
  const legacy = readJson<string>(TPL_KEY_LEGACY, '')
  return legacy || DEFAULT_TEMPLATE
}

/** Open (or create) a daily note. Shared by the command + calendar. */
export const openDaily = async (ctx: PluginContext, iso = todayISO()) => {
  const path = pathOf(iso)
  try {
    const list = await ctx.vault.list()
    const exists = (list || []).some((f: any) => (f.path || f.id) === path && !(f.is_dir || f.isDir))
    if (!exists) {
      const tpl = expandTemplate(readTemplate(ctx), iso)
      const created = await ctx.createFile(`${iso}.md`, tpl, DIR)
      ctx.toast(`已创建 ${iso} 日记`, 'ok')
      ctx.openFile(created || path)
    } else {
      ctx.openFile(path)
    }
  } catch (e: any) {
    ctx.toast(e?.message || '无法打开日记', 'error')
  }
}

export const openToday = (ctx: PluginContext) => { void openDaily(ctx, todayISO()) }

const Calendar: React.FC<{
  month: Date
  onMonth: (d: Date) => void
  existing: Set<string>
  onPick: (iso: string) => void
  selected: string
}> = ({ month, onMonth, existing, onPick, selected }) => {
  const year = month.getFullYear()
  const m = month.getMonth()
  const first = new Date(year, m, 1)
  const startPad = first.getDay()
  const days = new Date(year, m + 1, 0).getDate()
  const cells: { iso?: string; day?: number }[] = []
  for (let i = 0; i < startPad; i++) cells.push({})
  for (let d = 1; d <= days; d++) cells.push({ iso: fmtDate(new Date(year, m, d)), day: d })
  while (cells.length % 7) cells.push({})
  const today = todayISO()

  return (
    <div className="plg-cal">
      <div className="plg-cal-head">
        <Btn icon="chevron-left" onClick={() => onMonth(new Date(year, m - 1, 1))} />
        <span className="plg-cal-title">{year} 年 {m + 1} 月</span>
        <Btn icon="chevron-right" onClick={() => onMonth(new Date(year, m + 1, 1))} />
        <Btn icon="calendar" title="回到今天" onClick={() => { onMonth(new Date()); onPick(today) }} />
      </div>
      <div className="plg-cal-week">
        {['日', '一', '二', '三', '四', '五', '六'].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="plg-cal-grid">
        {cells.map((c, i) => {
          if (!c.iso) return <span key={i} className="plg-cal-cell empty" />
          const has = existing.has(c.iso)
          return (
            <button
              key={i}
              type="button"
              className={['plg-cal-cell', has ? 'has' : '', c.iso === today ? 'today' : '', c.iso === selected ? 'on' : ''].filter(Boolean).join(' ')}
              onClick={() => onPick(c.iso!)}
              title={has ? `${c.iso} 已有日记` : `${c.iso} 创建日记`}
            >
              {c.day}
              {has && <i className="plg-cal-dot" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const DailyNotesPanel: React.FC<PanelProps> = ({ context }) => {
  const [month, setMonth] = useState(() => new Date())
  const [existing, setExisting] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [template, setTemplate] = useState(() => readTemplate(context))
  const [editTpl, setEditTpl] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const list = await context.vault.list()
      const set = new Set<string>()
      for (const f of list || []) {
        const p = f.path || f.id || ''
        const m = /^日记\/(\d{4}-\d{2}-\d{2})\.md$/.exec(p)
        if (m) set.add(m[1])
      }
      setExisting(set)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const recent = useMemo(() => Array.from(existing).sort().reverse().slice(0, 14), [existing])

  const saveTpl = () => {
    context.settings.set('template', template)
    writeJson(TPL_KEY_LEGACY, template)
    setEditTpl(false)
    context.toast('日记模板已保存', 'ok')
  }

  return (
    <Panel>
      <Head
        icon="calendar"
        title="日记"
        sub={`${existing.size} 篇日记 · ${DIR}/YYYY-MM-DD.md`}
        actions={
          <>
            <Btn icon="refresh" title="刷新" onClick={load} />
            <Btn icon="plus" primary onClick={() => openDaily(context, todayISO())}>今日</Btn>
          </>
        }
      />
      <div className="plg-pad">
        {loading ? <Spinner text="读取日记…" /> : (
          <Calendar
            month={month}
            onMonth={setMonth}
            existing={existing}
            selected={todayISO()}
            onPick={(iso) => { void openDaily(context, iso); }}
          />
        )}
      </div>
      <div className="plg-divider" />
      <div className="plg-sub-title row">
        <span className="grow">最近日记</span>
        <Btn icon={editTpl ? 'x' : 'edit'} onClick={() => setEditTpl((v) => !v)}>{editTpl ? '取消' : '模板'}</Btn>
      </div>
      {editTpl ? (
        <div className="plg-pad col">
          <textarea className="textarea mono" rows={8} value={template} onChange={(e) => setTemplate(e.target.value)} spellCheck={false} />
          <div className="row">
            <span className="dim tiny grow">支持 {'{{date}} {{time}} {{weekday}} {{title}}'} 占位符</span>
            <Btn icon="save" primary onClick={saveTpl}>保存模板</Btn>
          </div>
        </div>
      ) : (
        <div className="plg-scroll">
          {recent.length ? recent.map((iso) => (
            <div key={iso} className="plg-row clickable" onClick={() => openDaily(context, iso)}>
              <span className="plg-row-icon"><Icon name="file-text" size={13} /></span>
              <span className="plg-row-main"><span className="plg-row-title">{iso}</span></span>
              <span className="plg-count">{iso === todayISO() ? '今天' : ''}</span>
            </div>
          )) : <Empty icon="calendar" text={`还没有日记，点击「今日」在 ${DIR}/ 下创建`} />}
        </div>
      )}
      <div className="plg-foot"><Icon name="clock" size={11} /><span>日记路径：{DIR}/YYYY-MM-DD.md</span></div>
    </Panel>
  )
}

export default DailyNotesPanel
