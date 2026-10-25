/**
 * SettingsDialog — editor preferences: theme, width, view, naming,
 * shortcuts (with recording), ribbon, sidebars, recent files, typography,
 * autosave.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { registerModal } from '@/components/Overlays'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { applyAccent, setTheme } from '@/lib/theme'
import { DEFAULT_SETTINGS, type LeftViewMode, type NamingMode, type PageWidth, type RibbonPosition, type Theme, type ViewMode } from '@/lib/contracts'
import { eventToShortcut, getCommands, normalizeShortcut, shortcutLabel } from '@/lib/commands'
import { ALL_RIBBON_ITEMS } from './ribbonItems'

type Section = 'appearance' | 'editor' | 'naming' | 'ribbon' | 'sidebar' | 'shortcuts' | 'about'

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'appearance', label: '外观', icon: 'eye' },
  { id: 'editor', label: '编辑器', icon: 'edit' },
  { id: 'naming', label: '文件命名', icon: 'tag' },
  { id: 'ribbon', label: '功能区', icon: 'sliders' },
  { id: 'sidebar', label: '侧边栏', icon: 'sidebar' },
  { id: 'shortcuts', label: '快捷键', icon: 'command' },
  { id: 'about', label: '关于', icon: 'info' }
]

const Seg = <T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) => (
  <div className="seg">
    {options.map((o) => (
      <button key={o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
        {o.label}
      </button>
    ))}
  </div>
)

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
  <button className={'switch' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on} />
)

const SettingsBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const reset = useStore((s) => s.resetSettings)
  const toast = useStore((s) => s.toast)
  const user = useStore((s) => s.user)
  const [section, setSection] = useState<Section>('appearance')
  const [recording, setRecording] = useState<string | null>(null)
  const recRef = useRef<string | null>(null)
  recRef.current = recording

  const commands = useMemo(() => getCommands().sort((a, b) => a.category.localeCompare(b.category, 'zh-Hans-CN')), [])
  const shortcutMap = settings.shortcuts || DEFAULT_SETTINGS.shortcuts

  /* shortcut recording */
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = eventToShortcut(e)
      if (!combo) return
      const conflict = Object.entries(shortcutMap).find(
        ([id, v]) => id !== recording && normalizeShortcut(v) === normalizeShortcut(combo)
      )
      if (conflict) {
        toast({ kind: 'warn', text: `该组合已被「${commands.find((c) => c.id === conflict[0])?.title || conflict[0]}」占用` })
      }
      update({ shortcuts: { ...shortcutMap, [recording]: combo } })
      setRecording(null)
      toast({ kind: 'ok', text: `已设置 ${shortcutLabel(combo)}` })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, shortcutMap, update, commands, toast])

  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="settings-row" key={label}>
      <div className="sr-label">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className="sr-control">{control}</div>
    </div>
  )

  return (
    <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <Icon name="settings" size={17} />
        <h3 className="grow">编辑器设置</h3>
        <button className="btn-icon" onClick={onClose} aria-label="关闭"><Icon name="x" size={15} /></button>
      </div>
      <div className="modal-body settings-body">
        <div className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} size={14} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-pane">
          {section === 'appearance' && (
            <>
              <h4>外观</h4>
              {row('主题', '浅色 / 深色 / 跟随系统', (
                <Seg<Theme>
                  value={settings.theme}
                  options={[
                    { id: 'light', label: '浅色' },
                    { id: 'dark', label: '深色' },
                    { id: 'system', label: '跟随' }
                  ]}
                  onChange={(v) => setTheme(v)}
                />
              ))}
              {row('强调色', '界面主色', (
                <input
                  type="color"
                  className="input"
                  style={{ width: 56, padding: 2, height: 30 }}
                  value={settings.accent}
                  onChange={(e) => applyAccent(e.target.value)}
                />
              ))}
              {row('默认页宽', '正文最大宽度', (
                <Seg<PageWidth>
                  value={settings.pageWidth}
                  options={[
                    { id: 'standard', label: '标准' },
                    { id: 'wide', label: '宽' },
                    { id: 'full', label: '铺满' }
                  ]}
                  onChange={(v) => useStore.getState().setPageWidth(v)}
                />
              ))}
              {row('默认视图', '新建标签的打开方式', (
                <Seg<ViewMode>
                  value={settings.viewMode}
                  options={[
                    { id: 'wysiwyg', label: '所见即所得' },
                    { id: 'source', label: '源码' },
                    { id: 'split', label: '对照' },
                    { id: 'preview', label: '阅读' }
                  ]}
                  onChange={(v) => useStore.getState().setViewMode(v)}
                />
              ))}
            </>
          )}

          {section === 'editor' && (
            <>
              <h4>编辑器</h4>
              {row('字号', '正文文字大小（px）', (
                <input
                  type="number"
                  className="input"
                  min={12}
                  max={26}
                  value={settings.editorFontSize}
                  onChange={(e) => update({ editorFontSize: Number(e.target.value) || 16 })}
                />
              ))}
              {row('行高', '正文行间距倍数', (
                <input
                  type="number"
                  className="input"
                  step={0.05}
                  min={1.2}
                  max={2.4}
                  value={settings.editorLineHeight}
                  onChange={(e) => update({ editorLineHeight: Number(e.target.value) || 1.75 })}
                />
              ))}
              {row('自动保存间隔', '单位：秒（最小 3 秒）', (
                <input
                  type="number"
                  className="input"
                  min={3}
                  max={600}
                  value={settings.autoSaveSeconds}
                  onChange={(e) => update({ autoSaveSeconds: Math.max(3, Number(e.target.value) || 20) })}
                />
              ))}
              {row('显示格式工具栏', '正文上方的 Markdown 工具栏', (
                <Switch on={settings.showToolbar} onChange={(v) => update({ showToolbar: v })} />
              ))}
              {row('拼写检查', '浏览器原生拼写检查', (
                <Switch on={settings.spellcheck} onChange={(v) => update({ spellcheck: v })} />
              ))}
              {row('显示行号', '源码模式下显示行号', (
                <Switch on={settings.lineNumbers} onChange={(v) => update({ lineNumbers: v })} />
              ))}
            </>
          )}

          {section === 'naming' && (
            <>
              <h4>文件命名</h4>
              {row('命名方式', '保存时自动决定文件名', (
                <Seg<NamingMode>
                  value={settings.namingMode}
                  options={[
                    { id: 'template', label: '时间戳模板' },
                    { id: 'ai', label: 'AI 生成' }
                  ]}
                  onChange={(v) => update({ namingMode: v })}
                />
              ))}
              {row('命名模板', '支持 YY MM DD HH mm ss 与 {title}', (
                <input
                  className="input"
                  value={settings.namingTemplate}
                  onChange={(e) => update({ namingTemplate: e.target.value })}
                />
              ))}
              <div className="prompt-hint" style={{ marginTop: 6 }}>
                预览：<span className="mono">{
                  (settings.namingTemplate || 'YY年MM月DD日HHMM-【{title}】')
                    .replace(/YY/g, String(new Date().getFullYear() % 100))
                    .replace(/MM/g, String(new Date().getMonth() + 1).padStart(2, '0'))
                    .replace(/DD/g, String(new Date().getDate()).padStart(2, '0'))
                    .replace(/HH/g, String(new Date().getHours()).padStart(2, '0'))
                    .replace(/mm/g, String(new Date().getMinutes()).padStart(2, '0'))
                    .replace(/\{title\}/g, '正文首行标题')
                }</span>
              </div>
              <div className="prompt-hint" style={{ marginTop: 8 }}>
                手动改过文件名的文档不会被自动重命名。AI 命名需要先在个人中心配置可用模型。
              </div>
            </>
          )}

          {section === 'ribbon' && (
            <>
              <h4>功能区</h4>
              {row('显示功能区', '左侧 / 右侧 / 状态栏图标条', (
                <Switch on={settings.ribbonVisible} onChange={(v) => update({ ribbonVisible: v })} />
              ))}
              {row('显示位置', '', (
                <select
                  className="select"
                  value={settings.ribbonPosition}
                  onChange={(e) => update({ ribbonPosition: e.target.value as RibbonPosition })}
                >
                  <option value="left">最左侧</option>
                  <option value="right">最右侧</option>
                  <option value="status-left">状态栏左侧</option>
                  <option value="status-right">状态栏右侧</option>
                </select>
              ))}
              <div className="sb-section" style={{ paddingLeft: 0 }}>显示按钮</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                {ALL_RIBBON_ITEMS.map((it) => {
                  const on = settings.ribbonItems.includes(it.id)
                  return (
                    <label key={it.id} className="chk-row" onClick={() => {
                      const next = on ? settings.ribbonItems.filter((x) => x !== it.id) : [...settings.ribbonItems, it.id]
                      update({ ribbonItems: next })
                    }}>
                      <span className={'chk-box' + (on ? ' on' : '')}>{on && <Icon name="check" size={10} />}</span>
                      <Icon name={it.icon} size={13} />
                      {it.label}
                    </label>
                  )
                })}
              </div>
            </>
          )}

          {section === 'sidebar' && (
            <>
              <h4>侧边栏</h4>
              {row('左侧视图', '文件列表 / 大纲 / 组合', (
                <select
                  className="select"
                  value={settings.leftViewMode}
                  onChange={(e) => {
                    const v = e.target.value as LeftViewMode
                    update({ leftViewMode: v })
                    useStore.getState().setLeftView(v)
                  }}
                >
                  <option value="files">文件列表</option>
                  <option value="outline">大纲</option>
                  <option value="outline-files">大纲 + 文件列表</option>
                </select>
              ))}
              {row('默认展开左侧栏', '', (
                <Switch on={settings.leftSidebarVisible} onChange={(v) => update({ leftSidebarVisible: v })} />
              ))}
              {row('默认展开 AI 侧栏', '', (
                <Switch on={settings.rightSidebarVisible} onChange={(v) => update({ rightSidebarVisible: v })} />
              ))}
              {row('显示最近打开', '在文件列表顶部显示最近文件', (
                <Switch on={settings.recentEnabled} onChange={(v) => update({ recentEnabled: v })} />
              ))}
              {row('最近打开数量', '1 ~ 20', (
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={20}
                  value={settings.recentCount}
                  onChange={(e) => update({ recentCount: Math.min(20, Math.max(1, Number(e.target.value) || 8)) })}
                />
              ))}
              <div className="sb-section" style={{ paddingLeft: 0 }}>右栏显示项</div>
              {['ai', 'fileinfo', 'outline', 'backlinks'].map((id) => {
                const labels: Record<string, string> = { ai: 'AI 助手', fileinfo: '文件信息', outline: '大纲', backlinks: '反向链接' }
                const on = settings.rightItems.includes(id)
                return (
                  <label key={id} className="chk-row" onClick={() => {
                    const next = on ? settings.rightItems.filter((x) => x !== id) : [...settings.rightItems, id]
                    update({ rightItems: next })
                  }}>
                    <span className={'chk-box' + (on ? ' on' : '')}>{on && <Icon name="check" size={10} />}</span>
                    {labels[id]}
                  </label>
                )
              })}
            </>
          )}

          {section === 'shortcuts' && (
            <>
              <h4>快捷键</h4>
              <div className="prompt-hint" style={{ marginBottom: 8 }}>
                点击右侧按键区后按下新的组合键即可录制；Esc 取消。冲突时会给出提示但依然保存。
              </div>
              <div className="shortcut-list">
                {commands.map((c) => {
                  const key = shortcutMap[c.id] || ''
                  return (
                    <div key={c.id} className={'shortcut-row' + (recording === c.id ? ' recording' : '')}>
                      <span className="sc-id">{c.title}<span className="dim tiny"> · {c.category}</span></span>
                      <button
                        className="btn btn-sm"
                        onClick={() => setRecording(c.id)}
                        title="点击录制新快捷键"
                      >
                        {recording === c.id ? '请按键…' : key ? shortcutLabel(key) : '未设置'}
                      </button>
                      {key && (
                        <button
                          className="btn-icon"
                          title="清除"
                          onClick={() => {
                            const next = { ...shortcutMap }
                            delete next[c.id]
                            update({ shortcuts: next })
                          }}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {section === 'about' && (
            <>
              <h4>关于</h4>
              <div className="info-list">
                <div className="info-row"><span className="ir-k">版本</span><span className="ir-v">1.0.0</span></div>
                <div className="info-row"><span className="ir-k">账户</span><span className="ir-v">{user ? user.nickname || user.username : '未登录（本地模式）'}</span></div>
                <div className="info-row"><span className="ir-k">自动保存</span><span className="ir-v">每 {settings.autoSaveSeconds} 秒</span></div>
              </div>
              <div className="row" style={{ marginTop: 16, gap: 8 }}>
                <button className="btn btn-sm" onClick={() => {
                  reset()
                  useStore.getState().setLeftView(DEFAULT_SETTINGS.leftViewMode)
                  toast({ kind: 'ok', text: '已恢复默认设置' })
                }}>
                  恢复默认设置
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => toast({ kind: 'info', text: '设置已自动保存在本机' })}>
                  设置保存在本机
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={onClose}>完成</button>
      </div>
    </div>
  )
}

let registered = false
const ensure = () => {
  if (registered) return
  registered = true
  registerModal('shell.settings', ({ onClose }) => <SettingsBody onClose={onClose} />)
}

export const openSettings = () => {
  ensure()
  useStore.getState().openModal('shell.settings')
}

export const SettingsDialog = SettingsBody
export default SettingsBody
