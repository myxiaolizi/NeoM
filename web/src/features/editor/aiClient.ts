/**
 * Thin AI client on top of `lib/api` — resolves the model for a scene from the
 * user's AI settings and normalizes failures into readable errors.
 */
import { API, type AiModel, type AiSettings } from '@/lib/contracts'
import { api, streamChat } from '@/lib/api'
import { useStore } from '@/store'

export type AiScene = 'chat' | 'naming' | 'asr' | 'tts'

let settingsPromise: Promise<AiSettings | null> | null = null
let modelsPromise: Promise<AiModel[]> | null = null

export const getAiSettings = (refresh = false) => {
  if (refresh || !settingsPromise) {
    settingsPromise = api.get<AiSettings>(API.aiSettings).catch(() => null)
  }
  return settingsPromise
}

export const getAiModels = (refresh = false) => {
  if (refresh || !modelsPromise) {
    modelsPromise = api.get<AiModel[]>(API.aiModels).catch(() => [] as AiModel[])
  }
  return modelsPromise
}

/** Resolve which model to use for a scene. */
export async function pickModel(scene: AiScene): Promise<string | null> {
  const forced = useStore.getState().aiModel
  if (forced) return forced
  const settings = await getAiSettings()
  const configured = settings?.defaults?.[scene]
  if (configured) return configured
  if (settings?.defaults?.chat) return settings.defaults.chat
  const models = await getAiModels()
  const match = models.find((m) => {
    if (scene === 'asr') return m.category === 'asr'
    if (scene === 'tts') return m.category === 'tts'
    if (scene === 'naming') return m.category === 'text' || m.category === 'omni'
    return m.category === 'text' || m.category === 'omni'
  })
  return match?.id ?? null
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Non-streaming completion. */
export async function chat(messages: ChatMessage[], opts: { scene?: AiScene; temperature?: number; signal?: AbortSignal } = {}): Promise<string> {
  const model = await pickModel(opts.scene || 'chat')
  if (!model) throw new Error('尚未配置可用的 AI 模型')
  const res = await api.post<{ content: string }>(API.aiChat, {
    model,
    messages,
    temperature: opts.temperature ?? 0.6,
    stream: false
  })
  return (res?.content || '').trim()
}

/** Streaming completion; `onDelta` receives incremental text. */
export async function chatStream(
  messages: ChatMessage[],
  onDelta: (full: string, delta: string) => void,
  opts: { scene?: AiScene; temperature?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const model = await pickModel(opts.scene || 'chat')
  if (!model) throw new Error('尚未配置可用的 AI 模型')
  let full = ''
  for await (const chunk of streamChat(
    { model, messages, temperature: opts.temperature ?? 0.6, stream: true },
    opts.signal
  )) {
    if (chunk.error) throw new Error(chunk.error)
    if (chunk.delta) {
      full += chunk.delta
      onDelta(full, chunk.delta)
    }
  }
  return full.trim()
}

export async function tts(text: string): Promise<string | null> {
  const model = await pickModel('tts')
  const settings = await getAiSettings()
  const res = await api.post<{ url: string }>(API.aiTts, {
    text,
    model: model || undefined,
    voice: settings?.tts_voice
  })
  return res?.url || null
}

export async function asr(file: File | Blob): Promise<string> {
  const form = new FormData()
  form.append('file', file, 'speech.webm')
  const model = await pickModel('asr')
  if (model) form.append('model', model)
  const res = await api.upload<{ text: string }>(API.aiAsr, form)
  return (res?.text || '').trim()
}

/** Friendly error text for AI failures (offline / not logged in / quota). */
export const aiErrorText = (e: unknown): string => {
  const msg = (e as Error)?.message || 'AI 服务不可用'
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return '网络不可用，AI 功能暂不可用'
  if (/401/.test(msg)) return '请先登录后再使用 AI 功能'
  return msg
}
