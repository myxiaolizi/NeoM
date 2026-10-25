#!/usr/bin/env node
/**
 * prepare-web.mjs (mobile) — verify the web bundle is ready for `cap sync`.
 *
 * Capacitor's webDir points straight at ../web/dist, so unlike the desktop
 * target there is no copying: this script only validates the bundle and writes
 * a small build stamp used by the diagnostics screen.
 *
 *   node prepare-web.mjs         validate (warn + fallback stub when missing)
 *   node prepare-web.mjs --strict fail when ../web/dist/index.html is absent
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '..', 'web', 'dist')
const args = new Set(process.argv.slice(2))
const log = (...a) => console.log('[mobile:prepare-web]', ...a)

function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(p)
    else if (entry.isFile()) total += statSync(p).size
  }
  return total
}

const indexHtml = join(distDir, 'index.html')
if (!existsSync(indexHtml)) {
  log('!! web/dist/index.html NOT found — run `npm --prefix web run build` first')
  if (args.has('--strict')) process.exit(1)
  // Keep `cap sync` from failing with a cryptic error: create a minimal shell.
  mkdirSync(distDir, { recursive: true })
  writeFileSync(
    indexHtml,
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>NeoM</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f3f4f7;color:#1b1f27;padding:24px;text-align:center}code{background:#e8edf7;padding:2px 6px;border-radius:6px}</style>
</head><body><div><h3>NeoM 移动端占位页</h3><p>打包时 <code>web/dist</code> 尚未生成。</p><p>请先执行 <code>npm --prefix web run build</code>，再重新 <code>npx cap sync</code>。</p></div></body></html>`,
    'utf8'
  )
  log('staged a placeholder index.html so cap sync can run')
  process.exit(0)
}

const bytes = dirSize(distDir)
const assets = existsSync(join(distDir, 'assets')) ? readdirSync(join(distDir, 'assets')).length : 0
log(`web bundle OK — ${(bytes / 1024 / 1024).toFixed(2)} MB, ${assets} asset chunks`)

writeFileSync(
  join(here, 'build-stamp.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      webDistBytes: bytes,
      assetCount: assets,
      appId: 'vip.zhengl.neom',
      apiBase: process.env.VITE_API_BASE || 'https://m.zhengl.vip'
    },
    null,
    2
  ),
  'utf8'
)
