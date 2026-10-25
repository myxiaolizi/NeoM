/**
 * Binary upload helper — OSS through `/api/storage/upload` with a base64
 * fallback so images still work offline / when signed out.
 */
import { API } from '@/lib/contracts'
import { api } from '@/lib/api'

export interface UploadResult {
  url: string
  fallback: boolean
  size: number
}

export const fileToDataUrl = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })

const MAX_INLINE = 3 * 1024 * 1024

export async function uploadBinary(file: File, kind: 'tupian' | 'bk' | 'ot' = 'tupian'): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  try {
    const res = await api.upload<{ url: string; key: string; size: number }>(API.storageUpload, form)
    if (res && res.url) return { url: res.url, fallback: false, size: res.size || file.size }
    throw new Error('上传未返回地址')
  } catch {
    if (file.size > MAX_INLINE) throw new Error('未配置对象存储且文件过大，无法内嵌')
    const url = await fileToDataUrl(file)
    return { url, fallback: true, size: file.size }
  }
}

/** Open the OS file picker and resolve the chosen files. */
export function pickFiles(accept = 'image/*', multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.onchange = () => finish(Array.from(input.files || []))
    input.oncancel = () => finish([])
    window.addEventListener(
      'focus',
      () => window.setTimeout(() => { if (!input.files?.length) finish([]) }, 600),
      { once: true }
    )
    input.click()
  })
}

/** Pick one image and return its URL (uploaded or inlined). */
export async function pickAndUploadImage(): Promise<UploadResult | null> {
  const [file] = await pickFiles('image/*')
  if (!file) return null
  return uploadBinary(file, 'tupian')
}
