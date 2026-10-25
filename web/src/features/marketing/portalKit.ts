/**
 * Portal kit — tiny shared utilities for the web portal pages
 * (marketing / auth / account / store / download / share).
 * Presentation only: no business state, no direct business fetch.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

/* ------------------------------------------------------------------ class */
export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/* ----------------------------------------------------------------- arrays */
/** Accepts arrays, `{items|list|rows|records}`, and platform-grouped objects. */
export function safeArr<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of ['items', 'list', 'rows', 'records', 'data', 'result', 'comments', 'models', 'packages', 'plugins', 'releases', 'versions', 'sessions', 'orders', 'entries', 'ledger']) {
      const hit = obj[key]
      if (Array.isArray(hit)) return hit as T[]
    }
    const values = Object.values(obj)
    if (values.length) {
      const flat: T[] = []
      for (const v of values) {
        if (Array.isArray(v)) flat.push(...(v as T[]))
        else if (v && typeof v === 'object' && ('url' in (v as object) || 'version' in (v as object) || 'filename' in (v as object) || 'id' in (v as object))) flat.push(v as T)
      }
      if (flat.length) return flat
    }
  }
  return []
}

/** Picks the first defined primitive field among aliases. */
export function pick(obj: any, keys: string[], fallback?: any): any {
  if (obj && typeof obj === 'object') {
    for (const k of keys) {
      const v = obj[k]
      if (v !== undefined && v !== null && v !== '') return v
    }
  }
  return fallback
}

/* --------------------------------------------------------------- useRemote */
export interface Remote<T> {
  data: T
  loading: boolean
  error: string | null
  /** true when the request failed and built-in content is displayed */
  degraded: boolean
  reload: () => void
}

/**
 * GET a public endpoint with built-in content as graceful degradation.
 * Never throws, never blocks rendering, never leaves a blank screen.
 */
export function useRemote<T>(url: string | null, fallback: T, map?: (raw: any) => T): Remote<T> {
  const [data, setData] = useState<T>(fallback)
  const [loading, setLoading] = useState<boolean>(!!url)
  const [error, setError] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [tick, setTick] = useState(0)
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!url) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    api
      .get<any>(url)
      .then((raw) => {
        if (!alive) return
        const next = mapRef.current ? mapRef.current(raw) : (raw as T)
        if (next === undefined || next === null) {
          setData(fallback)
          setDegraded(true)
          return
        }
        setData(next)
        setDegraded(false)
      })
      .catch((e: any) => {
        if (!alive) return
        setError(e?.message || '网络请求失败，已展示内置内容')
        setData(fallback)
        setDegraded(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick])

  return { data, loading, error, degraded, reload: () => setTick((t) => t + 1) }
}

/* --------------------------------------------------------------- format */
export const fmtBytes = (n?: number | null): string => {
  const v = Number(n || 0)
  if (!v) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let x = v
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024
    i++
  }
  return `${x < 10 && i > 0 ? x.toFixed(1) : Math.round(x)} ${units[i]}`
}

export const fmtNum = (n?: number | null): string => {
  const v = Number(n || 0)
  if (!isFinite(v)) return '0'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/** Points may be fractional (AI token billing); show 2 decimals only when needed. */
export const fmtPoints = (n?: number | null): string => {
  const v = Number(n || 0)
  if (!isFinite(v)) return '0'
  const abs = Math.abs(v)
  if (abs >= 1000) return fmtNum(Math.round(v))
  return (Math.round(v * 100) / 100).toString()
}

export const fmtPrice = (n?: number | null): string => {
  const v = Number(n || 0)
  if (!v) return '免费'
  if (v < 0.01) return `¥${v.toFixed(4)}`
  return `¥${(Math.round(v * 100) / 100).toFixed(2)}`
}

const pad = (n: number) => (n < 10 ? '0' + n : '' + n)

export const fmtDate = (iso?: string | Date | null, withTime = false): string => {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(String(iso).replace(' ', 'T'))
  if (isNaN(d.getTime())) return '—'
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base
}

export const fmtRelative = (iso?: string | null): string => {
  if (!iso) return '—'
  const d = new Date(String(iso).replace(' ', 'T'))
  if (isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  if (diff < 0) return fmtDate(iso)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 31) return `${days} 天前`
  return fmtDate(iso)
}

/** Days left until an ISO date; null when there is no expiry. */
export const daysLeft = (iso?: string | null): number | null => {
  if (!iso) return null
  const d = new Date(String(iso).replace(' ', 'T'))
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

export const expiryText = (iso?: string | null): string => {
  const left = daysLeft(iso)
  if (left === null) return '永久有效'
  if (left <= 0) return '已过期'
  if (left === 1) return '今天到期'
  return `${left} 天后到期`
}

/* --------------------------------------------------------------- helpers */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export const absUrl = (path: string): string => {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return window.location.origin + (path.startsWith('/') ? path : '/' + path)
}

/** Rough OS detection for the download page. */
export const detectPlatform = (): string => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const plat = (navigator as any)?.platform || ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/mac/i.test(plat) || /mac os x/i.test(ua)) return /arm64|aarch64/i.test(ua) ? 'mac-arm64' : 'mac-x64'
  if (/win/i.test(plat) || /windows/i.test(ua)) return 'win-x64'
  if (/linux/i.test(plat)) return 'linux-x64'
  return 'web'
}

/** Smooth-scroll an anchor target inside the portal scroll container. */
export const scrollToSection = (id: string) => {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Tiny local persistence for dismissible banners. */
export const localFlag = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage may be unavailable (private mode) */
    }
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10)
