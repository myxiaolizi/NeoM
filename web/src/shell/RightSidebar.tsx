/**
 * RightSidebar — AI assistant plus document info / backlinks / outline tabs.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { useDoc } from '@/features/editor/docRepo'
import { OutlineTree } from '@/features/outline/OutlineTree'
import { formatBytes, formatTime } from '@/features/files/fileUtils'
import { chatStream, aiErrorText, getAiSettings } from '@/features/editor/aiClient'
import { getBridge } from '@/features/editor/bridge'
import { currentVault } from '@/features/files/fileService'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const QUICK = [
  '总结这篇文档',
  '润色选中内容',
  '列出待办事项',
  '翻译成英文',
  '生成大纲',
  '检查错别字'
]

interface Props {
  /** 'overlay' renders the panel absolutely over the editor (narrow windows) */
  variant?: 'grid' | 'overlay'
}

const RightSidebar: React.FC<Props> = ({ variant = 'grid' }) => {
  const rightVisible = useStore((s) => s.rightVisible)
  const toggleRight = useStore((s) => s.toggleRight)
  const rightPanel = useStore((s) => s.rightPanel)
  const setRightPanel = useStore((s) => s.setRightPanel)
  const settings = useStore((s) => s.settings)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const aiPanelBusy = useStore((s) => s.aiPanelBusy)
  const setAiPanelBusy = useStore((s) => s.setAiPanelBusy)
  const openContextMenu = useStore((s) => s.openContextMenu)

  const activeTab = tabs.find((t) => t.id === activeTabId) || null
  const doc = useDoc(activeTab?.path)

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [aiReady, setAiReady] = useState<boolean | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      const s = await getAiSettings()
      setAiReady(!!s)
    })()
  }, [])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, streaming])

  const items = useMemo(() => {
    const available = [
      { id: 'ai', label: 'AI 助手', icon: 'sparkles' },
      { id: 'fileinfo', label: '文件信息', icon: 'info' },
      { id: 'outline', label: '大纲', icon: 'list' },
      { id: 'backlinks', label: '反向链接', icon: 'link' }
    ]
    return settings.rightItems?.length ? available.filter((i) => settings.rightItems.includes(i.id)) : available
  }, [settings.rightItems])

  if (!rightVisible) return null

  const send = async (text?: string) => {
    const q = (text ?? input).trim()
    if (!q || aiPanelBusy) return
    const context = doc?.content?.slice(0, 4000) || ''
    setMessages((m) => [...m, { role: 'user', content: q }])
    setInput('')
    setStreaming('')
    setAiPanelBusy(true)
    try {
      const history = [...messages, { role: 'user' as const, content: q }].map((m) => ({
        role: m.role,
        content: m.content
      }))
      const full = await chatStream(
        [
          {
            role: 'system',
            content:
              '你是一位中文写作助手。回答简洁、准确，可直接使用的 Markdown。' +
              (context ? '\n\n以下是用户当前打开的文档内容，供参考：\n\n' + context : '')
          },
          ...history
        ],
        (_full, delta) => setStreaming((s) => s + delta)
      )
      setMessages((m) => [...m, { role: 'assistant', content: full || '（无内容）' }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ ' + aiErrorText(e) }])
    } finally {
      setStreaming('')
      setAiPanelBusy(false)
    }
  }

  const insertIntoDoc = (text: string) => {
    const b = getBridge()
    if (!b) return useStore.getState().toast({ kind: 'warn', text: '请先打开一篇文档' })
    b.insert(text)
    b.focus()
    useStore.getState().toast({ kind: 'ok', text: '已插入到光标处' })
  }

  return (
    <aside className={'sidebar right' + (variant === 'overlay' ? ' overlay' : '')}>
      <div className="sb-head">
        <span className="sb-title">{items.find((i) => i.id === rightPanel)?.label || 'AI 助手'}</span>
        <button
          className="btn-icon"
          title="面板配置"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const all = [
              { id: 'ai', label: 'AI 助手' },
              { id: 'fileinfo', label: '文件信息' },
              { id: 'outline', label: '大纲' },
              { id: 'backlinks', label: '反向链接' }
            ]
            openContextMenu({
              x: rect.left - 150,
              y: rect.bottom + 4,
              title: '右栏显示项',
              items: all.map((it) => ({
                id: it.id,
                label: (settings.rightItems.includes(it.id) ? '✓ ' : '　') + it.label,
                run: () => {
                  const next = settings.rightItems.includes(it.id)
                    ? settings.rightItems.filter((x) => x !== it.id)
                    : [...settings.rightItems, it.id]
                  useStore.getState().updateSettings({ rightItems: next })
                }
              }))
            })
          }}
        >
          <Icon name="sliders" size={13} />
        </button>
        <button className="btn-icon" title="关闭右栏" onClick={() => toggleRight(false)}>
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="right-tabs">
        {items.map((it) => (
          <button
            key={it.id}
            className={'chip' + (rightPanel === it.id ? ' active' : '')}
            style={{ height: 23, fontSize: 11 }}
            onClick={() => setRightPanel(it.id)}
          >
            <Icon name={it.icon} size={11} />
            {it.label}
          </button>
        ))}
      </div>

      <div className="sb-panel-body" style={{ padding: '4px 8px 8px' }}>
        {rightPanel === 'ai' && (
          <div className="ai-panel" style={{ height: '100%', margin: '0 -8px -8px' }}>
            <div className="ai-thread" ref={threadRef}>
              {!messages.length && !streaming && (
                <div className="empty" style={{ padding: 18 }}>
                  <Icon name="sparkles" size={22} />
                  <span>{aiReady === false ? '尚未配置 AI 模型，可在个人中心 → AI 设置中配置' : '问我任何关于这篇文档的问题'}</span>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={'ai-msg ' + m.role}>
                  <div className="ai-role">{m.role === 'user' ? '你' : 'AI'}</div>
                  <div className="ai-bubble">{m.content}</div>
                  {m.role === 'assistant' && (
                    <div className="ai-tools">
                      <button className="btn btn-sm btn-ghost" onClick={() => insertIntoDoc(m.content)}>插入</button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => { void navigator.clipboard?.writeText(m.content); useStore.getState().toast('已复制') }}
                      >
                        复制
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {streaming && (
                <div className="ai-msg assistant">
                  <div className="ai-role">AI</div>
                  <div className="ai-bubble">{streaming}</div>
                </div>
              )}
            </div>
            <div className="ai-quick">
              {QUICK.map((q) => (
                <button key={q} className="chip" onClick={() => void send(q)} disabled={aiPanelBusy}>
                  {q}
                </button>
              ))}
            </div>
            <div className="ai-compose">
              <textarea
                className="textarea"
                placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
                {messages.length > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setMessages([])}>清空</button>
                )}
                <button className="btn btn-sm btn-primary" disabled={aiPanelBusy || !input.trim()} onClick={() => void send()}>
                  {aiPanelBusy ? '生成中…' : '发送'}
                </button>
              </div>
            </div>
          </div>
        )}

        {rightPanel === 'fileinfo' && (
          <div className="info-list">
            {activeTab && doc ? (
              <>
                <div className="info-row"><span className="ir-k">文件名</span><span className="ir-v">{doc.name}</span></div>
                <div className="info-row"><span className="ir-k">路径</span><span className="ir-v">{doc.path}</span></div>
                <div className="info-row"><span className="ir-k">大小</span><span className="ir-v">{formatBytes(new Blob([doc.content]).size)}</span></div>
                <div className="info-row"><span className="ir-k">字符数</span><span className="ir-v">{doc.content.length}</span></div>
                <div className="info-row"><span className="ir-k">修改时间</span><span className="ir-v">{formatTime(doc.mtime)}</span></div>
                <div className="info-row"><span className="ir-k">仓库</span><span className="ir-v">{currentVault() === 'local-web' ? '本地仓库' : currentVault()}</span></div>
                <div className="info-row"><span className="ir-k">状态</span><span className="ir-v">{doc.dirty ? '有未保存的更改' : '已保存'}{doc.offline ? ' · 离线' : ''}</span></div>
              </>
            ) : (
              <div className="tree-empty">请先打开一篇文档</div>
            )}
          </div>
        )}

        {rightPanel === 'outline' && (
          activeTab ? <OutlineTree markdown={doc?.content || ''} path={activeTab.path} /> : <div className="tree-empty">请先打开一篇文档</div>
        )}

        {rightPanel === 'backlinks' && (
          <div className="tree-empty">暂无反向链接</div>
        )}
      </div>
    </aside>
  )
}

export default RightSidebar
