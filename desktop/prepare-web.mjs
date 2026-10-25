#!/usr/bin/env node
/**
 * prepare-web.mjs — stage the built web app into desktop/app-web/.
 *
 * Input  : ../web/dist/index.html  (produced by `npm --prefix web run build`)
 * Output : desktop/app-web/        (what main.js serves over app://neom/)
 *
 * If the web build is missing the script stages desktop/loader.html instead of
 * failing, so electron-builder can still produce a valid (installable, runnable)
 * desktop artifact on a machine where the frontend build is not ready yet.
 *
 * Flags:
 *   --dev     only make sure the directory exists (dev loads the Vite dev server)
 *   --strict  exit 1 instead of staging the fallback page
 */
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '..', 'web', 'dist')
const outDir = join(here, 'app-web')
const loaderHtml = join(here, 'loader.html')
const args = new Set(process.argv.slice(2))

const log = (...a) => console.log('[prepare-web]', ...a)

if (args.has('--dev')) {
  mkdirSync(outDir, { recursive: true })
  log('dev mode: app-web/ ensured (electron loads NEOM_DEV_URL)')
  process.exit(0)
}

const hasDist = existsSync(join(distDir, 'index.html'))

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

if (hasDist) {
  cpSync(distDir, outDir, { recursive: true })
  log(`staged web/dist -> desktop/app-web (${readdirSync(outDir).length} top-level entries)`)
  stageIcons()
  process.exit(0)
}

if (args.has('--strict')) {
  console.error('[prepare-web] web/dist/index.html not found — run `npm --prefix web run build` first')
  process.exit(1)
}

log('!! web/dist/index.html not found — staging desktop/loader.html as the renderer')
cpSync(loaderHtml, join(outDir, 'index.html'))
writeFileSync(
  join(outDir, 'BUILD-NOTICE.txt'),
  [
    'This desktop package was produced WITHOUT a successful web build.',
    'Build the web app first, then repackage:',
    '  npm --prefix web install',
    '  npm --prefix web run build',
    '  node desktop/prepare-web.mjs --strict',
    '  npm --prefix desktop run build:win',
    ''
  ].join('\n'),
  'utf8'
)
log('fallback renderer staged (desktop/app-web/index.html)')
stageIcons()

/**
 * Keep desktop/assets/ in sync with the generated icon masters in <repo>/assets.
 * electron-builder resolves `win.icon: 'assets/icon.ico'` against buildResources
 * (directories.buildResources === 'assets'), and main.js loads the same file at
 * runtime for the BrowserWindow icon — both need it inside desktop/.
 */
function stageIcons() {
  const srcAssets = join(here, '..', 'assets')
  const dstAssets = join(here, 'assets')
  if (!existsSync(srcAssets)) {
    log('no <repo>/assets directory — run scripts/make-icons.mjs to create icons')
    return
  }
  mkdirSync(dstAssets, { recursive: true })
  let copied = 0
  for (const name of ['icon.ico', 'icon.icns', 'icon.png', 'icon.svg']) {
    const src = join(srcAssets, name)
    if (!existsSync(src)) continue
    cpSync(src, join(dstAssets, name))
    copied++
  }
  log(`staged ${copied} icon file(s) -> desktop/assets/`)
}
