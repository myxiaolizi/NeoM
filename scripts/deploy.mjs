#!/usr/bin/env node
/**
 * NeoM deploy packer + OSS transfer.
 *
 * Local machine:
 *   node scripts/deploy.mjs --pack            # build tar.gz of server + web dist
 *   node scripts/deploy.mjs --upload          # pack + upload to OSS, print signed URLs
 *
 * The server then runs `scripts/deploy.sh` (downloaded with the URLs printed here).
 *
 * Credentials come from server/.env — never hardcoded here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(ROOT, 'server', '.env') })

const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i >= 0) {
    const v = process.argv[i + 1]
    return v && !v.startsWith('--') ? v : true
  }
  return d
}

const STAGE = path.join(ROOT, '.deploy-stage')
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const TARBALL = `neom-${STAMP}.tar.gz`

const log = (...a) => console.log('[deploy]', ...a)

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (!filter(s, e)) continue
    if (e.isDirectory()) copyDir(s, d, filter)
    else fs.copyFileSync(s, d)
  }
}

/** Collect source files, excluding build noise and secrets that must not ship. */
function stage() {
  rmrf(STAGE)
  fs.mkdirSync(STAGE, { recursive: true })

  const skip = /(^|\/)(node_modules|\.git|legacy|out|\.deploy-stage|release)(\/|$)/
  copyDir(path.join(ROOT, 'server'), path.join(STAGE, 'server'), (p) => {
    if (skip.test(p)) return false
    if (p.endsWith('.env')) return false        // provisioned separately on the server
    if (p.endsWith('out.log') || p.endsWith('err.log')) return false
    if (p.endsWith('login.json') || p.endsWith('login-res.json')) return false
    return true
  })

  const dist = path.join(ROOT, 'web', 'dist')
  if (!fs.existsSync(dist)) throw new Error('web/dist 不存在，请先 `cd web && npm run build`')
  copyDir(dist, path.join(STAGE, 'web', 'dist'))

  fs.writeFileSync(path.join(STAGE, 'VERSION'), process.env.npm_package_version || '1.0.0\n')
  fs.writeFileSync(
    path.join(STAGE, 'STAMP'),
    JSON.stringify({ stamp: STAMP, created: new Date().toISOString(), dist: size(dist) }, null, 2)
  )
  log('staged at', STAGE)
}

const size = (p) => {
  let n = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else n += fs.statSync(f).size
    }
  }
  walk(p)
  return n
}

function pack() {
  stage()
  const out = path.join(ROOT, '.deploy-stage', TARBALL)
  execFileSync('tar', ['-czf', out, '-C', STAGE, 'server', 'web', 'VERSION', 'STAMP'], { stdio: 'inherit' })
  const bytes = fs.statSync(out).size
  log(`packed ${TARBALL} (${(bytes / 1048576).toFixed(2)} MB)`)
  return out
}

async function upload(tarPath) {
  const OSS = (await import('ali-oss')).default
  const client = new OSS({
    region: process.env.OSS_REGION || 'oss-cn-guangzhou',
    accessKeyId: process.env.OSS_AK,
    accessKeySecret: process.env.OSS_SK,
    bucket: process.env.OSS_BUCKET || 'zhengle',
    endpoint: process.env.OSS_ENDPOINT || 'oss-cn-guangzhou.aliyuncs.com',
    secure: true
  })
  const key = `md/mdadmin/_deploy/${TARBALL}`
  log('uploading to OSS', key)
  await client.put(key, tarPath)
  const url = client.signatureUrl(key, { expires: 3600 })
  const publicUrl = `https://${process.env.OSS_DOMAIN?.replace(/^https?:\/\//, '') || 'mdadmin.zhengl.vip'}/${key}`
  log('signed url (1h):')
  console.log(url)
  log('oss key:', key)
  fs.writeFileSync(path.join(ROOT, '.deploy-stage', 'upload.json'), JSON.stringify({ key, url, tar: TARBALL, stamp: STAMP }, null, 2))
  return { key, url, publicUrl }
}

const main = async () => {
  if (arg('pack')) { pack(); return }
  if (arg('upload')) {
    const tar = pack()
    await upload(tar)
    return
  }
  pack()
}

main().catch((e) => {
  console.error('[deploy] 失败:', e.message)
  process.exit(1)
})
