#!/usr/bin/env node
/**
 * check-contract.mjs — verify desktop/preload.js + desktop/main.js implement the
 * LocalFileApi contract declared in web/src/lib/platform.ts.
 *
 * This is the only hard interface between the web app and the desktop shell, so a
 * CI-able check prevents silent drift (e.g. a renamed method in platform.ts).
 *
 * Exit code 0 = contract satisfied, 1 = drift detected.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const PLATFORM_TS = join(ROOT, 'web', 'src', 'lib', 'platform.ts')
const PRELOAD = join(ROOT, 'desktop', 'preload.js')
const MAIN = join(ROOT, 'desktop', 'main.js')

const problems = []
const notes = []

function must(path, label) {
  if (!existsSync(path)) {
    problems.push(`${label} not found: ${path}`)
    return null
  }
  return readFileSync(path, 'utf8')
}

const platformSrc = must(PLATFORM_TS, 'platform.ts contract')
const preloadSrc = must(PRELOAD, 'preload.js')
const mainSrc = must(MAIN, 'main.js')
if (!platformSrc || !preloadSrc || !mainSrc) {
  console.error(problems.join('\n'))
  process.exit(1)
}

/* ------------------------------------------------- 1. parse LocalFileApi */
const ifaceMatch = platformSrc.match(/export interface LocalFileApi \{([\s\S]*?)\n\}/)
if (!ifaceMatch) {
  console.error('cannot locate `export interface LocalFileApi` in platform.ts')
  process.exit(1)
}
const ifaceBody = ifaceMatch[1]

/** Collect top-level members: `  name(` or `  name:`. */
const members = []
for (const line of ifaceBody.split('\n')) {
  const m = line.match(/^ {2}([A-Za-z_$][\w$]*)\s*[:(]/)
  if (m) members.push(m[1])
}

/** Extract the body of a brace-delimited block starting at `fromIndex`. */
function braceBody(text, fromIndex) {
  const start = text.indexOf('{', fromIndex)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return null
}

/**
 * Nested namespaces (`store`, `update`). Handles BOTH shapes used in
 * platform.ts: a single-line literal (`store: { get: ...; set: ... }`) and a
 * multi-line one (`update: {\n  check: ...\n}`).
 */
const nested = {}
for (const ns of ['store', 'update']) {
  const declRe = new RegExp(`\\n {2}${ns}\\s*:\\s*\\{`, 'm')
  const decl = ifaceBody.match(declRe)
  if (!decl) continue
  const body = braceBody(ifaceBody, decl.index + decl[0].length - 1)
  if (body == null) continue
  const fns = []
  // Brace/paren-depth aware scan: a member is an identifier at depth 0 that is
  // immediately followed by ':' or '('. This skips parameter names
  // (`get: (k: string) => ...`) and inline object types
  // (`check: () => Promise<{ version: string; url: string }>`).
  let depth = 0
  let paren = 0
  let atMemberStart = true
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '{') { depth++; atMemberStart = false; continue }
    if (c === '}') { depth--; atMemberStart = false; continue }
    if (c === '(') { paren++; atMemberStart = false; continue }
    if (c === ')') { paren--; atMemberStart = false; continue }
    if (depth === 0 && paren === 0 && (c === ';' || c === '\n' || c === ',')) {
      atMemberStart = true
      continue
    }
    if (depth === 0 && paren === 0 && /[A-Za-z_$]/.test(c) && atMemberStart) {
      let j = i
      while (j < body.length && /[\w$]/.test(body[j])) j++
      let k = j
      while (k < body.length && /\s/.test(body[k])) k++
      if (body[k] === ':' || body[k] === '(') fns.push(body.slice(i, j))
      atMemberStart = false
      i = j - 1
      continue
    }
    if (!/\s/.test(c)) atMemberStart = false
  }
  nested[ns] = [...new Set(fns)]
}

console.log('contract members:', members.join(', ') || '(none)')
for (const [ns, fns] of Object.entries(nested)) {
  console.log(`  ${ns}: ${fns.join(', ')}`)
}

/* -------------------------------- 2. preload must expose every member */
// preload builds a `local` object literal: `  openVault: () => ...`
const localBlockMatch = preloadSrc.match(/const local = \{([\s\S]*?)\n\}/)
if (!localBlockMatch) {
  problems.push('preload.js: cannot find `const local = { ... }`')
} else {
  const localBody = localBlockMatch[1]
  for (const member of members) {
    if (member === 'store' || member === 'update') continue
    const re = new RegExp(`(^|[\\s{,])${member}\\s*:`, 'm')
    if (!re.test(localBody)) problems.push(`preload.js local.${member} is missing`)
  }
  // nested blocks inside `local`
  for (const [ns, fns] of Object.entries(nested)) {
    const nsDecl = localBody.match(new RegExp(`\\n\\s{2}${ns}\\s*:\\s*\\{`, 'm'))
    if (!nsDecl) {
      problems.push(`preload.js local.${ns} namespace is missing`)
      continue
    }
    const nsBody = braceBody(localBody, nsDecl.index + nsDecl[0].length - 1)
    if (nsBody == null) {
      problems.push(`preload.js local.${ns} block is unbalanced`)
      continue
    }
    for (const fn of fns) {
      const re = new RegExp(`(^|[\\s{,])${fn}\\s*:\\s*\\(`, 'm')
      if (!re.test(nsBody)) problems.push(`preload.js local.${ns}.${fn} is missing`)
    }
  }
}

/* ----------------- 3. every preload IPC channel has a main-process handler */
const channels = new Set()
for (const m of preloadSrc.matchAll(/invoke\(\s*'([^']+)'/g)) channels.add(m[1])
for (const m of preloadSrc.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)) channels.add(m[1])
// reverse: main writes to the renderer
const mainSends = new Set()
for (const m of mainSrc.matchAll(/webContents\.send\(\s*'([^']+)'/g)) mainSends.add(m[1])

const handled = new Set()
for (const m of mainSrc.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)) handled.add(m[1])

for (const ch of channels) {
  if (mainSends.has(ch)) continue // renderer->main is not required for push channels
  if (!handled.has(ch)) problems.push(`main.js has no ipcMain.handle for channel "${ch}"`)
}

/* ------------------------------------- 4. bridge globals platform.ts reads */
for (const key of ['isDesktop', 'platform']) {
  if (!new RegExp(`\\b${key}\\s*:`).test(preloadSrc)) {
    problems.push(`preload.js does not expose \`${key}\` (platform.ts reads window.neom.${key})`)
  }
}

/* ------------------------------------------------ 5. security invariants */
const securityChecks = [
  ['contextIsolation: true', /contextIsolation:\s*true/],
  ['nodeIntegration: false', /nodeIntegration:\s*false/],
  ['sandbox: false (fs bridge)', /sandbox:\s*false/],
  ['contextBridge used', /contextBridge\.exposeInMainWorld/]
]
for (const [label, re] of securityChecks) {
  if (!re.test(preloadSrc) && !re.test(mainSrc)) problems.push(`security: ${label} not found`)
}

/* ------------------------------------------------------------ report */
console.log(`\nchannels used by preload (${channels.size}):`, [...channels].join(', '))
console.log(`handlers in main (${handled.size})`)

if (problems.length) {
  console.error('\nCONTRACT CHECK FAILED:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\nCONTRACT CHECK PASSED — preload/main satisfy LocalFileApi.')
if (notes.length) notes.forEach((n) => console.log('note: ' + n))
