/**
 * Shared data helpers for the admin console:
 * deterministic demo-data builders + a tolerant merge that lets a partially
 * implemented backend fill in only the fields it knows about.
 */

/** Deep-merge an untrusted API payload onto a demo baseline. Missing fields keep the baseline. */
export const deepMerge = <T,>(base: T, patch: unknown): T => {
  if (patch === null || patch === undefined) return base
  if (Array.isArray(base)) return (Array.isArray(patch) && patch.length ? patch : base) as unknown as T
  if (typeof base === 'object' && base !== null) {
    if (typeof patch !== 'object' || Array.isArray(patch)) return base
    const src = base as unknown as Record<string, unknown>
    const out: Record<string, unknown> = { ...src }
    const p = patch as Record<string, unknown>
    for (const k of Object.keys(src)) out[k] = deepMerge(src[k], p[k])
    for (const k of Object.keys(p)) if (!(k in out)) out[k] = p[k]
    return out as unknown as T
  }
  return (typeof patch === typeof base ? (patch as T) : base)
}

/** Deterministic pseudo-random in [0,1) so demo charts don't jump between renders. */
export const rnd = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
export const rndInt = (seed: number, min: number, max: number): number => Math.floor(min + rnd(seed) * (max - min + 1))

export const seq = <T,>(n: number, fn: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => fn(i))

const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n)
/** "MM-DD" labels for the last n days, oldest first. */
export const lastDays = (n: number): string[] =>
  seq(n, (i) => {
    const d = new Date(Date.now() - (n - 1 - i) * 86400_000)
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  })
/** ISO dates (YYYY-MM-DD) for the last n days, oldest first. */
export const lastIsoDays = (n: number): string[] =>
  seq(n, (i) => {
    const d = new Date(Date.now() - (n - 1 - i) * 86400_000)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  })

/** Build a plausible rising series. */
export const series = (n: number, base: number, spread: number, seed = 1): number[] =>
  seq(n, (i) => Math.round(base + rnd(seed + i) * spread + i * (spread / n) * 0.6))

export const pickOne = <T,>(arr: T[], seed: number): T => arr[Math.floor(rnd(seed) * arr.length) % arr.length]

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/** Extract a paginated list from unknown backend shapes: [], {list}, {items}, {rows}, {data}. */
export const asList = <T,>(raw: unknown): T[] => {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const k of ['list', 'items', 'rows', 'data', 'records', 'results']) {
      if (Array.isArray(o[k])) return o[k] as T[]
    }
  }
  return []
}
