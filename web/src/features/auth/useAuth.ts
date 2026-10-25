/**
 * Shared login logic for the `/login` page and the landing login dialog.
 */
import { useCallback, useState } from 'react'
import { api, setToken } from '@/lib/api'
import { API, type User } from '@/lib/contracts'
import { useStore } from '@/store'

const REMEMBER_KEY = 'neom.remember'

/** Map backend / network failures to a clear Chinese message. */
export function friendlyAuthError(e: any, mode: 'login' | 'register' = 'login'): string {
  const raw = String(e?.message || '')
  const code = String(e?.code || '')
  if (!raw || /failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return '网络异常，无法连接服务器。请检查网络或稍后重试。'
  }
  if (code === 'HTTP_401' || /密码|password|凭证|credential/i.test(raw)) return '账号或密码错误，请重新输入。'
  if (/不存在|not found|no such user|用户|account/i.test(raw) && mode === 'login') return '该账号不存在，请确认用户名或邮箱。'
  if (/封禁|banned|禁用|停用|disabled|blocked/i.test(raw)) return '账号已被封禁，请联系管理员申诉。'
  if (/频繁|too many|rate|限流|429/i.test(raw)) return '尝试过于频繁，请稍等片刻再试。'
  if (/已存在|重复|exist|taken|duplicate/i.test(raw)) return '该用户名或邮箱已被注册。'
  if (/密码.*(长度|强度)|至少|too short|weak/i.test(raw)) return '密码强度不足，请使用至少 8 位字母与数字组合。'
  return raw || (mode === 'login' ? '登录失败，请稍后重试。' : '注册失败，请稍后重试。')
}

export const loadRemembered = (): { account: string; remember: boolean } => {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY)
    if (!raw) return { account: '', remember: false }
    const v = JSON.parse(raw)
    return { account: String(v?.account || ''), remember: !!v?.account }
  } catch {
    return { account: '', remember: false }
  }
}

export const saveRemembered = (account: string, remember: boolean) => {
  try {
    if (remember) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ account }))
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* private mode — ignore */
  }
}

export interface LoginResult {
  ok: boolean
  user?: User
  error?: string
}

export function useLogin() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = useCallback(
    async (account: string, password: string, remember = false): Promise<LoginResult> => {
      const acc = account.trim()
      if (!acc) {
        setError('请输入用户名或邮箱')
        return { ok: false, error: '请输入用户名或邮箱' }
      }
      if (!password) {
        setError('请输入密码')
        return { ok: false, error: '请输入密码' }
      }
      setBusy(true)
      setError(null)
      try {
        const res = await api.post<{ token?: string; user?: User }>(API.authLogin, {
          account: acc,
          password,
          remember
        } as any)
        if (res?.token) setToken(res.token)
        let user = res?.user as User | undefined
        if (!user) {
          const me = await api.get<any>(API.authMe)
          user = (me?.user || me) as User
        }
        useStore.getState().setUser(user || null)
        saveRemembered(acc, remember)
        useStore.getState().toast({
          kind: 'ok',
          text: `欢迎回来，${user?.nickname || user?.username || acc}`
        })
        return { ok: true, user }
      } catch (e: any) {
        const msg = friendlyAuthError(e, 'login')
        setError(msg)
        return { ok: false, error: msg }
      } finally {
        setBusy(false)
      }
    },
    []
  )

  return { busy, error, setError, signIn }
}

export function useRegister() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signUp = useCallback(
    async (payload: { username: string; password: string; email?: string }): Promise<LoginResult & { points?: number }> => {
      setBusy(true)
      setError(null)
      try {
        const res = await api.post<{ token?: string; user?: User; points?: number; gift?: number }>(API.authRegister, payload)
        if (res?.token) setToken(res.token)
        let user = res?.user as User | undefined
        if (!user) {
          const me = await api.get<any>(API.authMe)
          user = (me?.user || me) as User
        }
        useStore.getState().setUser(user || null)
        return { ok: true, user, points: res?.points ?? res?.gift }
      } catch (e: any) {
        const msg = friendlyAuthError(e, 'register')
        setError(msg)
        return { ok: false, error: msg }
      } finally {
        setBusy(false)
      }
    },
    []
  )

  return { busy, error, setError, signUp }
}
