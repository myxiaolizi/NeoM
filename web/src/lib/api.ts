/**
 * NeoM API client — the ONLY allowed way to talk to the backend from the web app.
 * Handles auth token, envelope unwrapping, 401 redirect, and SSE streaming.
 */
import type { ApiResp } from './contracts'

const TOKEN_KEY = 'neom.token'

/**
 * Absolute API base for shells whose document origin is not the server
 * (Capacitor: https://localhost, Electron: app://neom — the latter also works
 * same-origin through the main-process proxy). Empty string = same origin.
 */
const API_BASE: string =
  (typeof window !== 'undefined' && (window as any).__NEOM_API_BASE__) ||
  (import.meta as any).env?.VITE_API_BASE ||
  ''

const withBase = (url: string): string => {
  if (!API_BASE || !url.startsWith('/')) return url
  // `//host/path` is protocol-relative, keep it untouched.
  if (url.startsWith('//')) return url
  return API_BASE.replace(/\/$/, '') + url
}

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  code?: string
  data?: unknown
  statusCode?: number
  constructor(msg: string, code?: string, data?: unknown, statusCode?: number) {
    super(msg)
    this.code = code
    this.data = data
    this.statusCode = statusCode
  }
}

const authHeaders = (): Record<string, string> => {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(method: string, url: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(withBase(url), {
    method,
    headers: isForm ? { ...authHeaders() } : { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: isForm ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body)
  })

  if (res.status === 401) {
    setToken(null)
    onUnauthorized?.()
  }
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'HTTP_' + res.status, null, res.status)
    if (opts.raw) return res as unknown as T
    return (await res.text()) as unknown as T
  }
  let payload: ApiResp<T>
  try {
    payload = (await res.json()) as ApiResp<T>
  } catch {
    throw new ApiError('响应解析失败', 'BAD_JSON', null, res.status)
  }
  if (!payload || payload.status !== true) {
    const err = payload as { msg?: string; code?: string; data?: unknown }
    throw new ApiError(err?.msg || `请求失败 (${res.status})`, err?.code, err?.data, res.status)
  }
  return payload.data
}

export const api = {
  get: <T,>(url: string, opts?: { raw?: boolean }) => request<T>('GET', url, undefined, opts),
  post: <T,>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T,>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T,>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  upload: <T,>(url: string, form: FormData) => request<T>('POST', url, form)
}

/** SSE-ish streaming chat. Yields text deltas. */
export async function* streamChat(
  body: Record<string, unknown>,
  signal?: AbortSignal
): AsyncGenerator<{ delta?: string; done?: boolean; usage?: unknown; error?: string }> {
  const res = await fetch(withBase('/api/ai/chat/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(body),
    signal
  })
  if (res.status === 401) { setToken(null); onUnauthorized?.() }
  if (!res.ok || !res.body) {
    let msg = `流式请求失败 (${res.status})`
    try { const j = await res.json(); msg = j.msg || msg } catch { /* noop */ }
    throw new ApiError(msg, 'STREAM_FAILED', null, res.status)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() || ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') { yield { done: true }; continue }
      try {
        const obj = JSON.parse(raw)
        if (obj.error) yield { error: String(obj.error) }
        else yield obj
      } catch { /* ignore malformed chunk */ }
    }
  }
}

/** Download a file from an authed endpoint (export etc.) */
export async function downloadFile(url: string, body: unknown, filename: string) {
  const res = await fetch(withBase(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new ApiError(`导出失败 (${res.status})`, 'EXPORT_FAILED', null, res.status)
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const j = await res.json()
    if (j.status === true && j.data?.fallback === 'html') return j.data
    throw new ApiError(j.msg || '导出失败', j.code)
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
