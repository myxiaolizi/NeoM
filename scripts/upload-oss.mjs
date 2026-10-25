#!/usr/bin/env node
/**
 * upload-oss.mjs — upload release artifacts to Aliyun OSS and emit a manifest.
 *
 * Credentials are read ONLY from the environment (never hard-coded, never logged):
 *
 *   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET       required (ali-oss AK/SK)
 *   OSS_BUCKET                                     required, e.g. neom-release
 *   OSS_REGION                                     optional, default oss-cn-hangzhou
 *   OSS_ENDPOINT                                   optional, custom endpoint
 *   OSS_PREFIX                                     optional, default md/mdadmin/
 *   OSS_PUBLIC_BASE                                optional, default https://mdadmin.zhengl.vip
 *   OSS_SECURITY_TOKEN                             optional (STS temporary credentials)
 *
 * Layout written to OSS (under OSS_PREFIX, default md/mdadmin/):
 *   md/mdadmin/<version>/<filename>      immutable, versioned
 *   md/mdadmin/latest/<filename>         copy of the newest build (stable download links)
 *   md/mdadmin/manifest.json             build manifest consumed by the admin panel
 *
 * Local output:
 *   release/manifest.json                (input manifest, enriched with urls)
 *   release/oss-upload.json              (upload result log)
 *
 * Usage:
 *   node scripts/upload-oss.mjs                    # upload everything in release/
 *   node scripts/upload-oss.mjs --dry-run          # plan only, no network
 *   node scripts/upload-oss.mjs --platform win-x64 # only artifacts of one platform
 *   node scripts/upload-oss.mjs --no-latest        # skip the latest/ mirror
 *   node scripts/upload-oss.mjs --dir release/win-x64
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const RELEASE_DIR = join(ROOT, 'release')

/* ------------------------------------------------------------------- args */
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, fallback = '') => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const DRY_RUN = flag('--dry-run')
const NO_LATEST = flag('--no-latest')
const ONLY_PLATFORM = opt('--platform', '')
const ONLY_DIR = opt('--dir', '')

/* -------------------------------------------------------------- constants */
const PREFIX = (process.env.OSS_PREFIX || 'md/mdadmin/').replace(/^\/+/, '').replace(/\/?$/, '/')
const PUBLIC_BASE = (process.env.OSS_PUBLIC_BASE || 'https://mdadmin.zhengl.vip').replace(/\/+$/, '')
const CDN_PATH = PREFIX.replace(/^md\/mdadmin\/?/, 'md/mdadmin/') // as mounted by the web server

/** Artifact extensions we consider "releases". */
const UPLOADABLE = new Set(['.exe', '.zip', '.dmg', '.apk', '.aab', '.ipa', '.AppImage', '.deb', '.msi', '.7z', '.tar.gz'])
/** Files electron-updater needs next to the binary. */
const UPDATER_META = new Set(['latest.yml', 'latest-mac.yml', 'latest-linux.yml'])

const log = (...a) => console.log('[upload-oss]', ...a)
const fail = (msg) => {
  console.error('[upload-oss] ERROR:', msg)
  process.exit(1)
}

/* ------------------------------------------------------------ credentials */
function readCredentials() {
  const ak = process.env.OSS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID
  const sk = process.env.OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  // Hard guard: refuse obviously committed secrets.
  for (const [k, v] of [
    ['OSS_ACCESS_KEY_ID', ak],
    ['OSS_ACCESS_KEY_SECRET', sk]
  ]) {
    if (v && /^(LTAI)?(x{4,}|0{4,}|your|test|changeme|placeholder)/i.test(v)) {
      fail(`${k} looks like a placeholder — set real credentials in the environment`)
    }
  }
  return { ak, sk, bucket }
}

/* --------------------------------------------------------------- helpers */
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** Infer the public platform tag from an artifact filename. */
function platformOf(filename) {
  const n = filename.toLowerCase()
  if (n.includes('win') && n.includes('green')) return 'win-green'
  if (n.includes('win')) return 'win-x64'
  if (n.includes('mac') && n.includes('arm64')) return 'mac-arm64'
  if (n.includes('mac')) return 'mac-x64'
  if (n.includes('android') || n.endsWith('.apk') || n.endsWith('.aab')) return 'android'
  if (n.endsWith('.ipa') || n.includes('ios')) return 'ios'
  if (n.includes('linux')) return 'linux-x64'
  return 'unknown'
}

function channelOf(filename) {
  return /beta|canary|rc|alpha/i.test(filename) ? 'beta' : 'stable'
}

function versionOf(filename, fallback) {
  // Only treat real prerelease suffixes (beta/rc/alpha/canary) as part of the
  // version — otherwise "NeoM-1.0.0-win-x64-setup.exe" would yield "1.0.0-win".
  const m = filename.match(/(\d+\.\d+\.\d+(?:[-+](?:beta|rc|alpha|canary)[\w.]*)?)/i)
  return m ? m[1] : fallback
}

/** Directories that contain intermediate build trees, never releasable files. */
const SKIP_DIRS = new Set([
  'node_modules',
  'win-unpacked',   // electron-builder staging copy (raw Electron binary)
  'mac',            // mac staging dir inside the mac output
  'linux-unpacked',
  'unpacked',
  '.cache'
])

/** Walk release/ collecting uploadable artifacts (skips manifest/logs + staging trees). */
function collectArtifacts(dir) {
  const out = []
  const skipNames = new Set(['manifest.json', 'oss-upload.json', 'neom-build.json', 'builder-debug.yml', 'builder-effective-config.yaml'])
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (skipNames.has(entry.name)) continue
      const lower = entry.name.toLowerCase()
      const isMeta = UPDATER_META.has(entry.name) || lower.endsWith('.blockmap')
      // Channel yml files (alpha/beta/latest) are updater metadata too.
      const isChannelYml = /^(latest|alpha|beta)(-mac|-linux)?\.yml$/.test(entry.name)
      const ext = lower.slice(lower.lastIndexOf('.'))
      const isUploadable = UPLOADABLE.has(ext) || lower.endsWith('.tar.gz')
      if (!isMeta && !isChannelYml && !isUploadable) continue
      out.push(full)
    }
  }
  walk(dir)
  return out
}

/* ------------------------------------------------------------------- OSS */
async function createClient(creds) {
  let OSS
  try {
    ;({ default: OSS } = await import('ali-oss'))
  } catch {
    fail(
      'ali-oss is not installed.\n' +
        '        Install it first:  npm install --no-save ali-oss\n' +
        '        (or add it to the root package.json devDependencies)'
    )
  }
  const opts = {
    accessKeyId: creds.ak,
    accessKeySecret: creds.sk,
    bucket: creds.bucket,
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    secure: true,
    timeout: 600000
  }
  if (process.env.OSS_ENDPOINT) opts.endpoint = process.env.OSS_ENDPOINT
  if (process.env.OSS_SECURITY_TOKEN) opts.stsToken = process.env.OSS_SECURITY_TOKEN
  return new OSS(opts)
}

async function putObject(client, objectKey, filePath, contentType) {
  const buf = readFileSync(filePath)
  await client.put(objectKey, buf, {
    headers: {
      'Content-Type': contentType || guessContentType(filePath),
      'Cache-Control': objectKey.includes('/latest/') ? 'public, max-age=300' : 'public, max-age=31536000, immutable'
    }
  })
  return buf.length
}

function guessContentType(file) {
  const n = file.toLowerCase()
  if (n.endsWith('.exe') || n.endsWith('.msi')) return 'application/vnd.microsoft.portable-executable'
  if (n.endsWith('.zip')) return 'application/zip'
  if (n.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (n.endsWith('.apk')) return 'application/vnd.android.package-archive'
  if (n.endsWith('.aab')) return 'application/octet-stream'
  if (n.endsWith('.ipa')) return 'application/octet-stream'
  if (n.endsWith('.yml')) return 'text/yaml; charset=utf-8'
  if (n.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

/* ------------------------------------------------------------------- main */
async function main() {
  log(`root        : ${ROOT}`)
  log(`prefix      : ${PREFIX}`)
  log(`public base : ${PUBLIC_BASE}`)
  log(`dry run     : ${DRY_RUN}`)

  const scanDir = ONLY_DIR ? resolve(ROOT, ONLY_DIR) : RELEASE_DIR
  if (!existsSync(scanDir)) fail(`directory not found: ${scanDir}`)

  // --- existing local manifest (written by package-all.ps1) -------------------
  const localManifestPath = join(RELEASE_DIR, 'manifest.json')
  let localManifest = null
  if (existsSync(localManifestPath)) {
    try {
      localManifest = JSON.parse(readFileSync(localManifestPath, 'utf8'))
    } catch (e) {
      log(`warn: cannot parse ${localManifestPath}: ${e.message}`)
    }
  }
  const defaultVersion = (localManifest && localManifest.version) || '1.0.0'

  // --- collect ---------------------------------------------------------------
  let files = collectArtifacts(scanDir)
  if (ONLY_PLATFORM) {
    files = files.filter((f) => platformOf(f.split(/[\\/]/).pop()) === ONLY_PLATFORM)
  }
  if (!files.length) fail(`no uploadable artifacts found under ${scanDir}`)

  log(`found ${files.length} artifact(s):`)
  for (const f of files) log(`  - ${relative(ROOT, f)} (${humanSize(statSync(f).size)})`)

  const creds = readCredentials()
  if (!DRY_RUN) {
    if (!creds.ak || !creds.sk) fail('OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET are required (unless --dry-run)')
    if (!creds.bucket) fail('OSS_BUCKET is required (unless --dry-run)')
  }

  const client = DRY_RUN ? null : await createClient(creds)

  // --- upload ----------------------------------------------------------------
  const uploaded = []
  for (const filePath of files) {
    const filename = filePath.split(/[\\/]/).pop()
    const version = versionOf(filename, defaultVersion)
    const versionedKey = posix.join(PREFIX, version, filename)
    const latestKey = posix.join(PREFIX, 'latest', filename)
    const size = statSync(filePath).size
    const digest = sha256(readFileSync(filePath))

    const record = {
      filename,
      version,
      platform: platformOf(filename),
      channel: channelOf(filename),
      size,
      sha256: digest,
      localPath: relative(ROOT, filePath).replace(/\\/g, '/'),
      url: `${PUBLIC_BASE}/${versionedKey}`,
      latestUrl: `${PUBLIC_BASE}/${latestKey}`,
      keys: { versioned: versionedKey, latest: latestKey },
      uploadedAt: new Date().toISOString()
    }

    if (DRY_RUN) {
      log(`[dry-run] would upload ${filename} -> oss://${creds.bucket || '<bucket>'}/${versionedKey}`)
      uploaded.push(record)
      continue
    }

    try {
      const sent = await putObject(client, versionedKey, filePath)
      log(`uploaded ${filename} -> ${record.url} (${humanSize(sent)})`)
      if (!NO_LATEST && (UPLOADABLE.has(filename.slice(filename.lastIndexOf('.')).toLowerCase()) || filename.endsWith('.tar.gz'))) {
        await putObject(client, latestKey, filePath)
        log(`  mirrored -> ${record.latestUrl}`)
      }
      uploaded.push(record)
    } catch (e) {
      console.error(`[upload-oss] FAILED ${filename}: ${e.code || ''} ${e.message}`)
      record.error = { code: e.code || 'ERR', message: e.message }
      uploaded.push(record)
    }
  }

  const failed = uploaded.filter((u) => u.error)
  if (failed.length) {
    log(`!! ${failed.length} upload(s) failed`)
  }

  // --- manifest --------------------------------------------------------------
  const byPlatform = {}
  for (const item of uploaded.filter((u) => !u.error)) {
    const p = item.platform
    if (!byPlatform[p]) byPlatform[p] = []
    byPlatform[p].push(item)
  }

  const manifest = {
    product: 'NeoM',
    version: localManifest?.version || defaultVersion,
    generated_at: new Date().toISOString(),
    public_base: PUBLIC_BASE,
    oss: {
      bucket: creds.bucket || null,
      prefix: PREFIX,
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      cdn_prefix: CDN_PATH
    },
    api_base: localManifest?.api_base || 'https://m.zhengl.vip',
    artifacts: uploaded,
    by_platform: byPlatform,
    skipped: localManifest?.skipped || [],
    failures: failed.map((f) => ({ filename: f.filename, error: f.error })),
    source_manifest: localManifest ? 'release/manifest.json' : null
  }

  const outPath = join(RELEASE_DIR, 'manifest.json')
  writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8')
  log(`manifest written: ${outPath}`)

  const logPath = join(RELEASE_DIR, 'oss-upload.json')
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        generated_at: manifest.generated_at,
        dry_run: DRY_RUN,
        total: uploaded.length,
        ok: uploaded.filter((u) => !u.error).length,
        failed: failed.length,
        entries: uploaded
      },
      null,
      2
    ),
    'utf8'
  )
  log(`upload log written: ${logPath}`)

  if (failed.length) process.exit(1)
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)))
