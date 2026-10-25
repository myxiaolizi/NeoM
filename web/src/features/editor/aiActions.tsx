/**
 * AI writing actions (continue / polish / format / summarize / translate / TTS)
 * plus the floating result dialog that lets the user insert or replace text.
 */
import React, { useState } from 'react'
import { registerModal } from '@/components/Overlays'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { getBridge } from './bridge'
import { aiErrorText, chat, tts } from './aiClient'
import { sanitize } from './mdRenderer'
import { marked } from 'marked'

export type AiActionKind = 'continue' | 'polish' | 'format' | 'summary' | 'translate' | 'explain'

const LABEL: Record<AiActionKind, string> = {
  continue: 'AI 续写',
  polish: 'AI 润色',
  format: 'AI 排版',
  summary: 'AI 总结',
  translate: 'AI 翻译',
  explain: 'AI 解释'
}

const PROMPTS: Record<AiActionKind, string> = {
  continue:
    '请接着下面的内容自然续写一段，保持原有的语气与 Markdown 结构。只输出续写部分，不要重复原文。',
  polish: '请润色下面的文字：修正语病、让它更通顺自然，保持原意与 Markdown 结构。只输出润色后的正文。',
  format: '请把下面的内容重新排版为结构清晰的 Markdown：合理使用标题层级、列表、代码块与表格。只输出 Markdown 源码。',
  summary: '请用简体中文以要点列表总结下面的内容，不超过 8 条。只输出列表本身。',
  translate: '请把下面的内容翻译成英文，保留 Markdown 结构。只输出译文。',
  explain: '请用简体中文解释下面内容的核心含义，通俗易懂，不超过 200 字。'
}

/* ------------------------------------------------------------- result dialog */
interface ResultPayload {
  title: string
  text: string
  apply: (mode: 'insert' | 'replace') => void
}

const ResultModal: React.FC<{ props?: Record<string, unknown>; onClose: () => void }> = ({ props, onClose }) => {
  const payload = props?.payload as ResultPayload | undefined
  const [text, setText] = useState(payload?.text || '')
  const [preview, setPreview] = useState(false)
  if (!payload) return null
  const html = preview ? sanitize(marked.parse(text || '', { async: false }) as string) : ''
  return (
    <div className="modal" style={{ maxWidth: 680 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <Icon name="sparkles" size={17} />
        <h3 className="grow ellipsis">{payload.title}</h3>
        <button className="btn btn-sm btn-ghost" onClick={() => setPreview((v) => !v)}>
          {preview ? '编辑' : '预览'}
        </button>
        <button className="btn-icon" onClick={onClose} aria-label="关闭">
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 260 }}>
        {preview ? (
          <div className="md-prose" style={{ maxHeight: 380, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <textarea
            className="textarea"
            style={{ flex: 1, minHeight: 260 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="prompt-hint">结果可直接编辑后再应用；插入会写入光标处，替换会覆盖当前选中内容。</div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={() => { void navigator.clipboard?.writeText(text); useStore.getState().toast('已复制') }}>
          复制
        </button>
        <div className="spacer" />
        <button className="btn" onClick={() => { payload.apply('insert'); onClose() }}>插入</button>
        <button className="btn btn-primary" onClick={() => { payload.apply('replace'); onClose() }}>替换选中</button>
      </div>
    </div>
  )
}

let registered = false
const ensureModal = () => {
  if (registered) return
  registered = true
  registerModal('editor.aiResult', ResultModal)
}

function openResult(title: string, text: string, apply: ResultPayload['apply']) {
  ensureModal()
  useStore.getState().openModal('editor.aiResult', { payload: { title, text, apply } })
}

/* ------------------------------------------------------------------ actions */
export async function runAiAction(kind: AiActionKind): Promise<void> {
  const bridge = getBridge()
  const st = useStore.getState()
  if (!bridge) {
    st.toast({ kind: 'warn', text: '请先打开一篇文档' })
    return
  }
  const selection = bridge.getSelection()
  const value = bridge.getValue()
  const source = (selection || value).trim()
  if (!source) {
    st.toast({ kind: 'warn', text: '没有可处理的内容' })
    return
  }
  const clipped = source.slice(kind === 'continue' ? -4000 : 0, kind === 'continue' ? undefined : 12000)
  const finalPrompt = PROMPTS[kind] + '\n\n---\n\n' + clipped
  st.setAiPanelBusy(true)
  const toastId = 'ai-' + kind
  st.toast({ kind: 'info', text: `${LABEL[kind]} 生成中…`, timeout: 1500 })
  try {
    const result = await chat(
      [
        { role: 'system', content: '你是一位专业的中文写作助手，输出必须是纯 Markdown 正文。' },
        { role: 'user', content: finalPrompt }
      ],
      { scene: 'chat' }
    )
    if (!result) throw new Error('模型没有返回内容')
    openResult(LABEL[kind], result, (mode) => {
      const b = getBridge()
      if (!b) return
      if (mode === 'replace' && b.getSelection()) b.insert(result)
      else if (mode === 'replace') b.setValue(result)
      else b.insert(kind === 'continue' ? '\n' + result : result)
    })
    void toastId
  } catch (e) {
    st.toast({ kind: 'error', text: aiErrorText(e) })
  } finally {
    st.setAiPanelBusy(false)
  }
}

export async function readSelectionAloud(): Promise<void> {
  const st = useStore.getState()
  const bridge = getBridge()
  const text = (bridge?.getSelection() || '').trim()
  if (!text) return st.toast({ kind: 'warn', text: '请先选中要朗读的内容' })
  st.toast({ kind: 'info', text: '正在合成语音…' })
  try {
    const url = await tts(text.slice(0, 2000))
    if (!url) throw new Error('未返回音频地址')
    const audio = new Audio(url)
    void audio.play()
  } catch (e) {
    st.toast({ kind: 'error', text: aiErrorText(e) })
  }
}

export const AI_ACTIONS: { id: AiActionKind; label: string; icon: string }[] = [
  { id: 'continue', label: '续写', icon: 'sparkles' },
  { id: 'polish', label: '润色', icon: 'edit' },
  { id: 'format', label: '排版', icon: 'list' },
  { id: 'summary', label: '总结', icon: 'file-text' },
  { id: 'translate', label: '翻译', icon: 'globe' },
  { id: 'explain', label: '解释', icon: 'help' }
]
