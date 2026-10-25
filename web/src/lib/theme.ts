import { useStore } from '@/store'
import type { Theme } from './contracts'

const apply = (mode: 'light' | 'dark') => {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#121318' : '#eceef3')
  useStore.setState({ theme: mode })
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export const setTheme = (t: Theme) => {
  const s = useStore.getState()
  s.updateSettings({ theme: t })
  if (t === 'system') apply(systemDark() ? 'dark' : 'light')
  else apply(t)
}

export const toggleTheme = () => {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  setTheme(cur)
}

export const initTheme = () => {
  const t = useStore.getState().settings.theme || 'system'
  apply(t === 'system' ? (systemDark() ? 'dark' : 'light') : t)
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (useStore.getState().settings.theme === 'system') apply(systemDark() ? 'dark' : 'light')
  })
  const accent = useStore.getState().settings.accent
  if (accent) {
    document.documentElement.style.setProperty('--accent', accent)
  }
}

export const applyAccent = (hex: string) => {
  document.documentElement.style.setProperty('--accent', hex)
  useStore.getState().updateSettings({ accent: hex })
}
