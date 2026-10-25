/**
 * Word/character statistics for the status bar and file info panel.
 */
import type { WordStats } from '@/store'

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g

/** Strip the most common markdown syntax so counts reflect readable text. */
export const stripMarkdown = (md: string): string =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')

export function computeStats(md: string): WordStats {
  const text = stripMarkdown(md || '')
  const cjk = text.match(CJK)?.length || 0
  const latin = (text.replace(CJK, ' ').match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).length
  const words = cjk + latin
  const chars = (md || '').length
  const charsNoSpace = (text || '').replace(/\s/g, '').length
  const lines = (md || '').split(/\r?\n/).length
  const paragraphs = (md || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean).length
  // ~380 chars per minute for mixed CJK latin reading
  const readingMinutes = Math.max(1, Math.round((cjk + latin * 2) / 380))
  return { words, chars, charsNoSpace, lines, paragraphs, readingMinutes }
}
