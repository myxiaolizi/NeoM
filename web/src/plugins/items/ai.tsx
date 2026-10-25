/**
 * ai — AI assistant plugin.
 * Provides the reusable `AiChatPanel` (model picker, streaming output, quick
 * actions, insert-to-document) plus inline writing commands
 * (续写/润色/扩写/缩写/翻译/总结/排版/标题/朗读).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { streamChat } from '@/lib/api'
import type { AiModel } from '@/lib/contracts'
import { useStore } from '@/store'
import type { PanelProps, PluginContext } from '../types'
import { Btn, Empty, Head, Panel, useActiveDoc } from '../ui'
import { openPluginWindow } from '../fullscreen'
import { mdToPlain, renderMarkdown } from '../md'
import { truncate } from '../utils'

/* --------------------------------------------------------------- helpers */
const SYSTEM = '你是 NeoM 笔记应用的写作助手。使用简体中文，直接给出结果，不要解释过程，保持 Markdown 格式。'

const PROMPTS: Record<string, string> = {
  continue: '请顺着下面的内容继续自然地写下去，长度约 200 字，只输出续写部分：\n\n',
  polish: '请润色下面的文字，保持原意与语言，语句更通顺，只输出润色后的正文：\n\n',
  expand: '请把下面的内容扩写得更充实（约 2 倍长度），保持结构，只输出正文：\n\n',
  shorten: '请把下面的内容精简到原长度的 50% 左右，保留关键信息，只输出正文：\n\n',
  translate: '请把下面的内容翻译成中文；若已是中文则翻译成英文。只输出译文：\n\n',
  summary: '请用要点总结下面的文档，输出 Markdown 无序列表，不超过 8 条：\n\n',
  format: '请整理下面 Markdown 的排版：补全标题层级、列表与空行，不改变文字内容，只输出排版后的正文：\n\n',
  title: '请为下面的文档起 5 个简洁的中文标题，用 Markdown 有序列表输出：\n\n'
}

const QUICK = [
  { id: 'polish', label: '润色', icon: 'sparkles' },
  { id: 'continue', label: '续写', icon: 'ai' },
  { id: 'expand', label: '扩写', icon: 'plus' },
  { id: 'shorten', label: '缩写', icon: 'minus' },
  { id: 'translate', label: '翻译', icon: 'globe' },
  { id: 'summary', label: '总结', icon: 'list' },
  { id: 'format', label: '排版', icon: 'sliders' },
  { id: 'title', label: '标题', icon: 'headings' }
]

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

const selectionText = () => {
  try {
    return window.getSelection()?.toString() || ''
  } catch {
    return ''
  }
}

const pickModel = (ctx: PluginContext) => ctx.settings.get<string>('model', '')

/** Stream a completion; falls back to the non-streaming endpoint. */
const ask = async (
  ctx: PluginContext,
  user: string,
  opts: { system?: string; history?: ChatMsg[]; onDelta?: (t: string) => void; signal?: AbortSignal } = {}
): Promise<string> => {
  const model = pickModel(ctx)
  const messages = [
    { role: 'system' as const, content: opts.system || SYSTEM },
    ...(opts.history || []).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: user }
  ]
  let acc = ''
  try {
    for await (const chunk of streamChat({ model: model || undefined, messages, temperature: 0.7 }, opts.signal)) {
      if (chunk.error) throw new Error(chunk.error)
      if (chunk.delta) {
        acc += chunk.delta
        opts.onDelta?.(acc)
      }
    }
    if (acc.trim()) return acc
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    // fall through to non-streaming
  }
  try {
    const res = await ctx.api.post('/api/ai/chat', { model: model || undefined, messages, temperature: 0.7 })
    const text = res?.content || res?.data?.content || ''
    if (text) { opts.onDelta?.(text); return text }
    throw new Error('AI 未返回内容')
  } catch (e: any) {
    throw new Error(e?.message || 'AI 请求失败（请检查模型配置或登录状态）')
  }
}

/* ------------------------------------------------------------- chat panel */
const AiChatPanel: React.FC<PanelProps> = ({ context }) => {
  const { path, content } = useActiveDoc(context)
  const [models, setModels] = useState<AiModel[]>([])
  const [model, setModel] = useState(() => pickModel(context))
  const [messages, setMessages] = useState<ChatMsg[]>(() => context.settings.get<ChatMsg[]>('history', []))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const aiOpen = useStore((s) => s.aiOpen)
  const setAiOpen = useStore((s) => s.setAiOpen)

  useEffect(() => {
    let alive = true
    context.api
      .get('/api/ai/models')
      .then((rows: AiModel[]) => {
        if (!alive) return
        const list = (Array.isArray(rows) ? rows : []).filter((m) => m && m.category !== 'asr' && m.category !== 'tts' && m.enabled !== false)
        setModels(list)
        if (!model && list[0]) { setModel(list[0].id); context.settings.set('model', list[0].id) }
      })
      .catch(() => { /* offline / not logged in */ })
    return () => { alive = false }
  }, [context, model])

  useEffect(() => { context.settings.set('history', messages.slice(-40)) }, [messages, context])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, draft])

  const send = async (text?: string) => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    const history = [...messages, { role: 'user' as const, content: q }]
    setMessages(history)
    setBusy(true)
    setDraft('')
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const answer = await ask(context, q, {
        history: messages.slice(-8),
        onDelta: (acc) => setDraft(acc),
        signal: abortRef.current.signal
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
      setDraft('')
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        context.toast(e?.message || 'AI 请求失败', 'error')
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${e?.message || '请求失败'}` }])
      }
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  const insert = (text: string, replace = false) => {
    if (!text.trim()) return
    if (replace) context.replaceSelection(text)
    else context.insertText(text.startsWith('\n') ? text : '\n\n' + text)
    context.toast('已插入到文档', 'ok')
  }

  const runQuick = (action: string) => {
    const sel = selectionText()
    const src = sel || content
    if (!src.trim()) { context.toast('当前文档为空', 'warn'); return }
    void send(PROMPTS[action] + truncate(src, 6000))
  }

  return (
    <Panel className="plg-ai">
      <Head
        icon="sparkles"
        title="AI 助手"
        sub={model ? models.find((m) => m.id === model)?.label || model : '未选择模型'}
        actions={
          <>
            <Btn icon="trash" title="清空对话" onClick={() => {
              if (busy) return
              setMessages([])
              context.settings.set('history', [])
            }} />
            {aiOpen && <Btn icon="panel-bottom" title="收起" onClick={() => setAiOpen(false)} />}
          </>
        }
      />
      <div className="plg-pad-x">
        <select
          className="select"
          value={model}
          onChange={(e) => { setModel(e.target.value); context.settings.set('model', e.target.value) }}
        >
          <option value="">默认模型</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label || m.id}{m.tag ? ` · ${m.tag}` : ''}</option>
          ))}
        </select>
      </div>
      <div className="plg-ai-quick">
        {QUICK.map((q) => (
          <button key={q.id} type="button" className="chip" disabled={busy} onClick={() => runQuick(q.id)}>
            <Icon name={q.icon} size={11} />{q.label}
          </button>
        ))}
      </div>
      <div className="plg-ai-body" ref={bodyRef}>
        {!messages.length && !draft && (
          <Empty
            icon="robot"
            text={<>
              向 AI 提问，或用上方快捷指令处理{path ? `《${path.split('/').pop()}》` : '当前文档'}
              <br />选中正文后点「润色」可原地替换
            </>}
          />
        )}
        {messages.map((m, i) => (
          <div key={i} className={'plg-ai-msg ' + m.role}>
            <div className="plg-ai-avatar"><Icon name={m.role === 'user' ? 'user' : 'sparkles'} size={12} /></div>
            <div className="plg-ai-bubble">
              {m.role === 'assistant'
                ? <div className="plg-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                : <div className="plg-ai-user-text">{m.content}</div>}
              {m.role === 'assistant' && (
                <div className="plg-ai-actions">
                  <Btn icon="paste" onClick={() => insert(m.content)}>插入</Btn>
                  <Btn icon="edit" onClick={() => insert(m.content, true)}>替换选中</Btn>
                  <Btn icon="copy" onClick={() => { void navigator.clipboard?.writeText(m.content); context.toast('已复制', 'ok') }}>复制</Btn>
                </div>
              )}
            </div>
          </div>
        ))}
        {draft && (
          <div className="plg-ai-msg assistant">
            <div className="plg-ai-avatar"><Icon name="sparkles" size={12} /></div>
            <div className="plg-ai-bubble">
              <div className="plg-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }} />
              <span className="plg-ai-caret" />
            </div>
          </div>
        )}
      </div>
      <div className="plg-ai-input">
        <textarea
          className="textarea"
          rows={3}
          value={input}
          placeholder="问点什么…（Ctrl+Enter 发送）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send() }
          }}
        />
        <div className="row">
          <span className="dim tiny grow">{content ? `${mdToPlain(content).length} 字上下文` : '无文档上下文'}</span>
          {busy ? <Btn icon="stop" danger onClick={() => abortRef.current?.abort()}>停止</Btn> : (
            <Btn icon="send" primary disabled={!input.trim()} onClick={() => void send()}>发送</Btn>
          )}
        </div>
      </div>
    </Panel>
  )
}

/* --------------------------------------------------------------- commands */
/** Shared inline transformation used by every polish* command. */
const transform = async (ctx: PluginContext, action: string, fallbackWhole = true) => {
  const sel = selectionText()
  const whole = ctx.getActiveContent() || ''
  const src = sel || (fallbackWhole ? whole : '')
  if (!src.trim()) { ctx.toast('请先选中文字或打开文档', 'warn'); return }
  ctx.toast('AI 正在处理…', 'info')
  try {
    const out = await ask(ctx, PROMPTS[action] + truncate(src, 8000))
    if (!out.trim()) { ctx.toast('AI 未返回内容', 'warn'); return }
    if (sel) ctx.replaceSelection(out.trim())
    else ctx.insertText('\n\n' + out.trim())
    ctx.toast('已写入文档', 'ok')
  } catch (e: any) {
    ctx.toast(e?.message || 'AI 处理失败', 'error')
  }
}

export const polishContinue = (ctx: PluginContext) => transform(ctx, 'continue')
export const polishSelection = (ctx: PluginContext) => transform(ctx, 'polish')
export const polishExpand = (ctx: PluginContext) => transform(ctx, 'expand')
export const polishShorten = (ctx: PluginContext) => transform(ctx, 'shorten')
export const polishTranslate = (ctx: PluginContext) => transform(ctx, 'translate')
export const polishSummary = (ctx: PluginContext) => transform(ctx, 'summary')
export const polishFormat = (ctx: PluginContext) => transform(ctx, 'format')
export const polishTitle = (ctx: PluginContext) => transform(ctx, 'title')

export const speakSelection = async (ctx: PluginContext) => {
  const text = selectionText() || ctx.getActiveContent()
  if (!text.trim()) { ctx.toast('没有可朗读的内容', 'warn'); return }
  try {
    const res = await ctx.api.post('/api/ai/tts', { text: truncate(text, 2000), model: ctx.settings.get<string>('ttsModel', '') || undefined })
    const url = res?.url || res?.data?.url
    if (!url) throw new Error('TTS 未返回音频地址')
    const audio = new Audio(url)
    await audio.play()
    ctx.toast('开始朗读', 'ok')
  } catch (e: any) {
    ctx.toast(e?.message || '朗读失败（请检查 TTS 配置）', 'error')
  }
}

/** Open the AI panel in the shell's right sidebar, falling back to a window. */
export const openAiChat = (ctx: PluginContext) => {
  try {
    const s = useStore.getState()
    s.setRightPanel('ai')
    s.toggleRight(true)
    s.setAiOpen(true)
  } catch { /* noop */ }
  window.setTimeout(() => {
    if (!document.querySelector('.plg-ai')) openPluginWindow('ai', ctx)
  }, 260)
}

export default AiChatPanel
