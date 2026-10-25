/**
 * Lazy Vditor loader. The editor kernel is code-split so the first paint of
 * the shell never waits for it.
 */
type VditorCtor = typeof import('vditor').default

let loader: Promise<VditorCtor> | null = null

export const loadVditor = (): Promise<VditorCtor> => {
  if (!loader) {
    loader = (async () => {
      await import('vditor/dist/index.css')
      const mod = await import('vditor')
      return (mod as unknown as { default: VditorCtor }).default
    })()
  }
  return loader
}

let cdnPromise: Promise<string> | null = null

const probe = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'force-cache' })
    if (!res.ok) return false
    const ct = res.headers.get('content-type') || ''
    return !ct.includes('text/html')
  } catch {
    return false
  }
}

/**
 * Prefer a self-hosted `/vditor` asset dir (offline friendly); fall back to the
 * official CDN. Vditor needs this to load lute / katex / highlight assets.
 */
export const resolveVditorCdn = (): Promise<string> => {
  if (!cdnPromise) {
    cdnPromise = (async () => {
      for (const base of ['/vditor', '/static/vditor', '/assets/vditor']) {
        if (await probe(`${base}/js/lute/lute.min.js`)) return base
      }
      return 'https://unpkg.com/vditor@3.11.3'
    })()
  }
  return cdnPromise
}

export const isDarkTheme = () => document.documentElement.dataset.theme === 'dark'

/** Vditor expects 'dark' | 'classic' for its chrome theme. */
export const resolveVditorTheme = (): 'dark' | 'classic' => (isDarkTheme() ? 'dark' : 'classic')
