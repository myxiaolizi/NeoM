/**
 * Line-level LCS diff used by the history panel and the conflict merge dialog.
 * No dependencies — a plain dynamic-programming LCS with a size guard.
 */

export type DiffOpType = 'equal' | 'add' | 'del'

export interface DiffOp {
  type: DiffOpType
  text: string
  aLine: number | null
  bLine: number | null
}

export interface DiffCell {
  no: number | null
  text: string
  kind: 'equal' | 'add' | 'del' | 'empty'
}

const MAX_LINES = 4000

const splitLines = (s: string) => (s || '').replace(/\r\n/g, '\n').split('\n')

export function diffLines(left: string, right: string): DiffOp[] {
  const a = splitLines(left)
  const b = splitLines(right)
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    // too large for O(n*m): fall back to a coarse replace-all diff
    return [
      ...a.map((text, i) => ({ type: 'del' as DiffOpType, text, aLine: i + 1, bLine: null })),
      ...b.map((text, i) => ({ type: 'add' as DiffOpType, text, aLine: null, bLine: i + 1 }))
    ]
  }

  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:], b[j:]
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i], aLine: i + 1, bLine: j + 1 })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ type: 'del', text: a[i], aLine: i + 1, bLine: null })
      i++
    } else {
      ops.push({ type: 'add', text: b[j], aLine: null, bLine: j + 1 })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i], aLine: i + 1, bLine: null })
    i++
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j], aLine: null, bLine: j + 1 })
    j++
  }
  return ops
}

/** Convert a linear op list into aligned left/right columns. */
export function sideBySide(ops: DiffOp[]): { left: DiffCell[]; right: DiffCell[] } {
  const left: DiffCell[] = []
  const right: DiffCell[] = []
  let pendingDel: DiffOp[] = []
  let pendingAdd: DiffOp[] = []

  const flush = () => {
    const len = Math.max(pendingDel.length, pendingAdd.length)
    for (let k = 0; k < len; k++) {
      const d = pendingDel[k]
      const ad = pendingAdd[k]
      left.push(d ? { no: d.aLine, text: d.text, kind: 'del' } : { no: null, text: '', kind: 'empty' })
      right.push(ad ? { no: ad.bLine, text: ad.text, kind: 'add' } : { no: null, text: '', kind: 'empty' })
    }
    pendingDel = []
    pendingAdd = []
  }

  for (const op of ops) {
    if (op.type === 'equal') {
      flush()
      left.push({ no: op.aLine, text: op.text, kind: 'equal' })
      right.push({ no: op.bLine, text: op.text, kind: 'equal' })
    } else if (op.type === 'del') {
      pendingDel.push(op)
    } else {
      pendingAdd.push(op)
    }
  }
  flush()
  return { left, right }
}

export interface DiffStat {
  added: number
  removed: number
}

export function diffStat(ops: DiffOp[]): DiffStat {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'add') added++
    else if (op.type === 'del') removed++
  }
  return { added, removed }
}
