/**
 * Tiny line diff (LCS) used by /api/versions/diff.
 * The frontend does the rich rendering; we return both sides plus a unified diff.
 */
const MAX_LINES = 4000;

export function splitLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

/** Returns array of {type:'equal'|'add'|'del', value} */
export function lineDiff(leftText, rightText) {
  const a = splitLines(leftText);
  const b = splitLines(rightText);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      { type: 'del', value: `(内容过长，仅显示摘要：左侧 ${a.length} 行)` },
      { type: 'add', value: `(内容过长，仅显示摘要：右侧 ${b.length} 行)` }
    ];
  }
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', value: a[i++] });
    } else {
      ops.push({ type: 'add', value: b[j++] });
    }
  }
  while (i < n) ops.push({ type: 'del', value: a[i++] });
  while (j < m) ops.push({ type: 'add', value: b[j++] });
  return ops;
}

export function unifiedDiff(leftText, rightText, { context = 3, leftLabel = 'left', rightLabel = 'right' } = {}) {
  const ops = lineDiff(leftText, rightText);
  const out = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  let added = 0;
  let removed = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      i++;
      continue;
    }
    // gather a change hunk with context
    const start = Math.max(0, i - context);
    let end = i;
    while (end < ops.length) {
      if (ops[end].type === 'equal') {
        let k = end;
        while (k < ops.length && ops[k].type === 'equal') k++;
        if (k - end >= context * 2 || k >= ops.length) {
          end += context;
          break;
        }
        end = k;
        continue;
      }
      end++;
    }
    const hunk = ops.slice(start, Math.min(ops.length, end));
    out.push(`@@ -${start + 1} +${start + 1} @@`);
    for (const op of hunk) {
      const prefix = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' ';
      if (op.type === 'add') added++;
      if (op.type === 'del') removed++;
      out.push(`${prefix}${op.value}`);
    }
    i = Math.max(end, i + 1);
  }
  return { unified: out.join('\n'), added, removed };
}

export function diffStat(leftText, rightText) {
  const { added, removed } = unifiedDiff(leftText, rightText);
  return { added, removed, changed: added + removed > 0 };
}

export default { lineDiff, unifiedDiff, diffStat, splitLines };
