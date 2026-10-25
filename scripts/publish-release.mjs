#!/usr/bin/env node
/**
 * publish-release.mjs — register built artifacts in the NeoM backend `releases` table.
 *
 * Reads release/manifest.json (produced by upload-oss.mjs) and POSTs each artifact
 * to https://m.zhengl.vip/api/admin/releases using an admin JWT.
 *
 * Credentials come from the environment ONLY:
 *   NEOM_ADMIN_TOKEN     required — admin JWT (Authorization: Bearer <token>)
 *   NEOM_API_BASE        optional — default https://m.zhengl.vip
 *   NEOM_ADMIN_ACCOUNT   optional — used with NEOM_ADMIN_PASSWORD to log in first
 *   NEOM_ADMIN_PASSWORD  optional — see above
 *
 * Usage:
 *   NEOM_ADMIN_TOKEN=xxx node scripts/publish-release.mjs
 *   node scripts/publish-release.mjs --dry-run
 *   node scripts/publish-release.mjs --changelog release/CHANGELOG-1.0.0.md
 *   node scripts/publish-release.mjs --only win-x64,win-green
 *   node scripts/publish-release.mjs --force        # mark update as mandatory
 *   node scripts/publish-release.mjs --channel beta
 *
 * Exit code: 0 when every artifact was registered, 1 on any failure.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const MANIFEST = join(ROOT, 'release', 'manifest.json')

/* ------------------------------------------------------------------- args */
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d = '') => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}

const DRY_RUN = flag('--dry-run')
const FORCED = flag('--force')
const CHANNEL = opt('--channel', 'stable')
const ONLY = opt('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const API_BASE = (process.env.NEOM_API_BASE || 'https://m.zhengl.vip').replace(/\/+$/, '')
const CHANGELOG_FILE = opt('--changelog', '')

const log = (...a) => console.log('[publish-release]', ...a)

function die(msg) {
  console.error('[publish-release] ERROR:', msg)
  process.exit(1)
}

/** Platforms the backend `releases` table understands (contracts.ts ReleaseAsset). */
const KNOWN_PLATFORMS = new Set(['win-x64', 'win-green', 'mac-arm64', 'mac-x64', 'android', 'ios', 'linux-x64'])

const PLATFORM_ALIASES = {
  'win-x64': 'win-x64',
  win: 'win-x64',
  'windows-x64': 'win-x64',
  'win-green': 'win-green',
  'windows-portable': 'win-green',
  'mac-arm64': 'mac-arm64',
  'mac-x64': 'mac-x64',
  mac: 'mac-x64',
  android: 'android',
  apk: 'android',
  ios: 'ios',
  ipa: 'ios',
  'linux-x64': 'linux-x64',
  linux: 'linux-x64'
}

function normalizePlatform(p) {
  const key = String(p || '').toLowerCase()
  return PLATFORM_ALIASES[key] || (KNOWN_PLATFORMS.has(key) ? key : '')
}

/* ------------------------------------------------------------- auth token */
async function resolveToken() {
  if (process.env.NEOM_ADMIN_TOKEN) return process.env.NEOM_ADMIN_TOKEN

  const account = process.env.NEOM_ADMIN_ACCOUNT
  const password = process.env.NEOM_ADMIN_PASSWORD
  if (!account || !password) return ''

  log('NEOM_ADMIN_TOKEN not set — logging in as', account)
  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password })
  })
  const payload = await res.json().catch(() => null)
  if (!payload || payload.status !== true || !payload.data?.token) {
    die(`admin login failed: ${payload?.msg || `HTTP ${res.status}`}`)
  }
  return payload.data.token
}

/* ------------------------------------------------------------------- main */
async function main() {
  if (!existsSync(MANIFEST)) {
    die(`manifest not found: ${MANIFEST}\n        Run scripts/package-all.ps1 and scripts/upload-oss.mjs first.`)
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const version = manifest.version || '1.0.0'
  let artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : []

  // Only real binaries go into `releases` (skip .yml/.blockmap updater metadata).
  const isBinary = (a) => /\.(exe|zip|dmg|apk|aab|ipa|AppImage|deb|msi|7z)$/i.test(a.filename || a.path || '')

  artifacts = artifacts.filter(isBinary)
  if (ONLY.length) {
    artifacts = artifacts.filter((a) => ONLY.includes(normalizePlatform(a.platform)))
  }
  if (!artifacts.length) die('no publishable artifacts in the manifest (after filtering)')

  const changelog = CHANGELOG_FILE && existsSync(resolve(ROOT, CHANGELOG_FILE))
    ? readFileSync(resolve(ROOT, CHANGELOG_FILE), 'utf8')
    : manifest.changelog || `NeoM ${version}`

  log(`api base  : ${API_BASE}`)
  log(`version   : ${version}`)
  log(`channel   : ${CHANNEL}`)
  log(`artifacts : ${artifacts.length}`)

  const token = DRY_RUN ? '' : await resolveToken()
  if (!DRY_RUN && !token) {
    die(
      'no admin credentials. Set NEOM_ADMIN_TOKEN (recommended) or\n' +
        '        NEOM_ADMIN_ACCOUNT + NEOM_ADMIN_PASSWORD. Use --dry-run to preview.'
    )
  }

  const results = []
  for (const a of artifacts) {
    const platform = normalizePlatform(a.platform)
    if (!platform) {
      // Not an error: staging binaries (win-unpacked/*.exe) and helper tools are
      // simply not part of the public release matrix.
      log(`skip ${a.filename}: not a release platform ("${a.platform || 'unknown'}")`)
      results.push({ ok: true, filename: a.filename, skipped: true })
      continue
    }

    const body = {
      platform,
      version: a.version || version,
      filename: a.filename,
      size: a.size,
      url: a.url || a.latestUrl || '',
      sha256: a.sha256,
      changelog,
      forced: FORCED,
      channel: a.channel || CHANNEL
    }

    if (!body.url) {
      log(`skip ${a.filename}: no url (run upload-oss.mjs first)`)
      results.push({ ok: false, filename: a.filename, error: 'no-url' })
      continue
    }

    if (DRY_RUN) {
      log(`[dry-run] POST ${API_BASE}/api/admin/releases`)
      log(`   ${platform.padEnd(10)} ${a.filename} (${a.size} bytes) -> ${body.url}`)
      results.push({ ok: true, filename: a.filename, platform, dryRun: true })
      continue
    }

    try {
      const res = await fetch(`${API_BASE}/api/admin/releases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !payload || payload.status !== true) {
        const msg = payload?.msg || `HTTP ${res.status}`
        // 409 = already registered; treat as success (idempotent re-publish).
        const alreadyThere = res.status === 409 || /已存在|exists|duplicate/i.test(msg)
        if (alreadyThere) {
          log(`= ${platform.padEnd(10)} ${a.filename} already registered`)
          results.push({ ok: true, filename: a.filename, platform, existed: true })
        } else {
          log(`X ${platform.padEnd(10)} ${a.filename} -> ${msg}`)
          results.push({ ok: false, filename: a.filename, platform, error: msg })
        }
        continue
      }
      log(`+ ${platform.padEnd(10)} ${a.filename} registered (id=${payload.data?.id ?? '?'})`)
      results.push({ ok: true, filename: a.filename, platform, id: payload.data?.id })
    } catch (e) {
      log(`X ${platform.padEnd(10)} ${a.filename} -> ${e.message}`)
      results.push({ ok: false, filename: a.filename, platform, error: e.message })
    }
  }

  const ok = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const bad = results.length - ok
  log(`\nsummary: ${ok - skipped} registered, ${skipped} skipped, ${bad} failed (${DRY_RUN ? 'dry run' : 'live'})`)
  if (bad) process.exit(1)
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)))
