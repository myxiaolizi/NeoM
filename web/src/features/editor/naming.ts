/**
 * Document naming — timestamp template or AI-generated title.
 * Used on save when the user has not renamed the file manually.
 */
import { API } from '@/lib/contracts'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import { sanitizeName } from '@/lib/fs'

const pad = (n: number) => String(n).padStart(2, '0')

/** Extract a human title from markdown: first H1, else first ~20 plain chars. */
export function extractTitle(content: string): string {
  const h1 = /^\s{0,3}#\s+(.+?)\s*$/m.exec(content)
  if (h1 && h1[1]) {
    const t = h1[1].replace(/[*_`~#>[\]]/g, '').trim()
    if (t) return t.slice(0, 40)
  }
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^---[\s\S]*?---/, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~_|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, 20) || '未命名'
}

/** Render the naming template (default `YY年MM月DD日HHMM-【{title}】`). */
export function renderName(template: string, title: string, d = new Date()): string {
  const tpl = template || 'YY年MM月DD日HHMM-【{title}】'
  const safeTitle = (sanitizeName(title) || '未命名').slice(0, 40)
  let out = tpl
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/YY/g, pad(d.getFullYear() % 100))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()))
    .replace(/\{title\}/g, safeTitle)
  if (!/\{title\}/.test(tpl)) out += `-【${safeTitle}】`
  if (!/\.\w+$/.test(out)) out += '.md'
  return sanitizeName(out)
}

let namingModelCache: string | null | undefined

/** Resolve the AI model configured for the `naming` scene (cached). */
export async function getNamingModel(): Promise<string | null> {
  if (namingModelCache !== undefined) return namingModelCache
  try {
    const s = await api.get<{ defaults?: Record<string, string>; enabledModels?: string[] }>(API.aiSettings)
    namingModelCache = s?.defaults?.naming || s?.enabledModels?.[0] || null
  } catch {
    namingModelCache = null
  }
  return namingModelCache
}

const AI_PROMPT =
  '请根据以下正文生成不超过 20 字的标题，只输出标题本身，不要标点、不要引号、不要解释。'

/** Ask the AI for a short title. Returns null when unavailable. */
export async function aiTitle(content: string): Promise<string | null> {
  const model = await getNamingModel()
  if (!model) return null
  const body = content.slice(0, 3000).trim()
  if (!body) return null
  try {
    const res = await api.post<{ content: string }>(API.aiChat, {
      model,
      messages: [
        { role: 'system', content: AI_PROMPT },
        { role: 'user', content: body }
      ],
      temperature: 0.2,
      stream: false
    })
    const raw = (res?.content || '').trim().split('\n')[0] || ''
    const cleaned = raw.replace(/^["'「『《\s]+|["'」』》\s]+$/g, '').trim()
    return cleaned ? cleaned.slice(0, 40) : null
  } catch {
    return null
  }
}

/**
 * Decide the file name for a save. Returns null when the current name is
 * already correct. AI failures silently fall back to the template.
 */
export async function decideDocName(content: string, currentName: string): Promise<string | null> {
  const st = useStore.getState()
  let name: string | null = null
  if (st.settings.namingMode === 'ai') {
    const t = await aiTitle(content)
    if (t) name = renderName(st.settings.namingTemplate, t)
  }
  if (!name) name = renderName(st.settings.namingTemplate, extractTitle(content))
  return name === currentName ? null : name
}

/** Names created automatically by the system (safe to rename on save). */
export const looksAutoNamed = (name: string) =>
  /^(\d{2}年\d{2}月\d{2}日\d{4}-|未命名|Untitled|新建文档)/.test(name) || /^\d{10,}\.md$/.test(name)
