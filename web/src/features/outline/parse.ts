/**
 * Markdown heading extraction for the outline tree.
 * Fenced code blocks are skipped so `# comment` inside code never shows up.
 */
export interface OutlineItem {
  id: string
  level: number
  text: string
  line: number
  children: OutlineItem[]
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/

export function parseOutline(markdown: string): OutlineItem[] {
  const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n')
  const flat: OutlineItem[] = []
  let fence: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0]
      else if (line.trim().startsWith(fence.repeat(3))) fence = null
      continue
    }
    if (fence) continue
    const m = HEADING_RE.exec(line)
    if (!m) continue
    const text = m[2].replace(/\s*#+\s*$/, '').replace(/[*_`~]/g, '').trim()
    if (!text) continue
    flat.push({ id: `h-${i}`, level: m[1].length, text, line: i + 1, children: [] })
  }

  const roots: OutlineItem[] = []
  const stack: OutlineItem[] = []
  for (const item of flat) {
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(item)
    else roots.push(item)
    stack.push(item)
  }
  return roots
}

export function flattenOutline(items: OutlineItem[]): OutlineItem[] {
  const out: OutlineItem[] = []
  const walk = (list: OutlineItem[]) => {
    for (const it of list) {
      out.push(it)
      walk(it.children)
    }
  }
  walk(items)
  return out
}

/** Outline as a nested Markdown bullet list (context-menu action). */
export function outlineToMarkdown(items: OutlineItem[], indent = 0): string {
  return items
    .map((it) => {
      const pad = '  '.repeat(indent)
      const nested = it.children.length ? '\n' + outlineToMarkdown(it.children, indent + 1) : ''
      return `${pad}- ${it.text}${nested}`
    })
    .join('\n')
}

/** Anchor used by "copy heading link". */
export const headingLink = (path: string, text: string) =>
  `neom://doc/${encodeURIComponent(path)}#${encodeURIComponent(text)}`
