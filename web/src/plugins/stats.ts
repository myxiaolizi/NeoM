/**
 * Word / character statistics shared by the word-count panel and the status
 * bar item. Chinese is counted per character (400 chars/min), latin per word
 * (200 words/min), matching the product spec.
 */
import { parseFrontmatter } from './utils'

export interface DocStats {
  /** chars + latin words */
  words: number
  chars: number
  charsNoSpace: number
  lines: number
  paragraphs: number
  cjk: number
  latinWords: number
  readingMinutes: number
  /** ms, 0 when unknown */
  savedAt: number
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
const LATIN_RE = /[A-Za-z0-9][A-Za-z0-9'’\-]*/g

export const computeStats = (content: string, opts: { skipFrontmatter?: boolean } = {}): DocStats => {
  const doc = String(content || '')
  const body = opts.skipFrontmatter === false ? doc : parseFrontmatter(doc).body
  const chars = body.length
  const charsNoSpace = body.replace(/\s/g, '').length
  const cjk = (body.match(CJK_RE) || []).length
  const latinWords = (body.replace(CJK_RE, ' ').match(LATIN_RE) || []).length
  const words = cjk + latinWords
  const lines = body ? body.split('\n').length : 0
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length
  const readingMinutes = cjk / 400 + latinWords / 200
  return {
    words,
    chars,
    charsNoSpace,
    lines,
    paragraphs,
    cjk,
    latinWords,
    readingMinutes,
    savedAt: 0
  }
}

export const fmtReading = (minutes: number) => {
  if (!minutes || minutes < 0.1) return '< 1 分钟'
  if (minutes < 1) return `约 ${Math.round(minutes * 60)} 秒`
  return `约 ${Math.round(minutes)} 分钟`
}

export const fmtNumber = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n))
