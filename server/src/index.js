/**
 * NeoM server entry — Express 4.
 * Mounts domain routers. Routers are loaded defensively so that a partially
 * developed checkout still boots (fail soft with a clear log line).
 */
import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const WEB_DIR = process.env.WEB_ROOT || path.resolve(ROOT, '..', 'web', 'dist')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)

/* ------------------------------------------------------------- middleware */
app.use((req, res, next) => {
  const origin = req.headers.origin || ''
  const allowed = [
    'https://m.zhengl.vip',
    'http://m.zhengl.vip',
    'http://localhost:5273',
    'http://127.0.0.1:5273',
    'app://neom',
    'capacitor://localhost',
    'http://localhost'
  ]
  if (allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '24mb' }))
app.use(express.urlencoded({ extended: true, limit: '24mb' }))

const started = Date.now()
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    const t0 = Date.now()
    res.on('finish', () => {
      const ms = Date.now() - t0
      if (process.env.REQ_LOG !== '0') {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`)
      }
    })
  }
  next()
})

/* ---------------------------------------------------------------- routers */
const mounted = []
const failed = []
const mods = {}

const load = async (relPath) => {
  const mod = await import(new URL(relPath, import.meta.url).href)
  return mod
}

const mountRouter = (prefix, router, label) => {
  const name = label || prefix
  if (typeof router !== 'function') {
    failed.push({ prefix: name, err: 'not a Router' })
    console.warn(`[NeoM] router ${name} 未挂载: 导出的不是 express.Router`)
    return
  }
  app.use(prefix, router)
  mounted.push(name)
}

/** Mount a router module defensively; records failure but keeps booting. */
const mount = async (prefix, relPath, exportName) => {
  try {
    const mod = await load(relPath)
    mods[relPath] = mod
    const router = (exportName ? mod[exportName] : null) || mod.default || mod.router
    mountRouter(prefix, router, prefix)
  } catch (e) {
    failed.push({ prefix, err: e?.message || String(e) })
    console.warn(`[NeoM] router ${prefix} 未挂载: ${e?.message || e}`)
  }
}

await mount('/api/auth', './routes/auth.js')
await mount('/api/files', './routes/files.js')
await mount('/api/versions', './routes/versions.js')
await mount('/api/share', './routes/share.js')
await mount('/api/publish', './routes/publish.js')
await mount('/api/storage', './routes/storage.js')
await mount('/api/releases', './routes/releases.js')
await mount('/api/site', './routes/site.js', 'siteRouter')
await mount('/api/plugins', './routes/plugins.js')
await mount('/api/ai', './routes/ai.js')
await mount('/api/billing', './routes/billing.js')
await mount('/api/admin', './routes/admin.js')

/* /api/bootstrap — aggregated first-paint payload (site.js exports bootstrapRouter) */
try {
  const mod = mods['./routes/site.js'] || (await load('./routes/site.js'))
  if (mod.bootstrapRouter) mountRouter('/api/bootstrap', mod.bootstrapRouter, '/api/bootstrap')
} catch (e) {
  failed.push({ prefix: '/api/bootstrap', err: e?.message })
}

/* Public, non-/api HTML pages: /s/:id (share) and /p/:id (publish) */
try {
  const share = mods['./routes/share.js'] || (await load('./routes/share.js'))
  if (typeof share.renderSharePage === 'function') {
    app.get('/s/:id', (req, res, next) => Promise.resolve(share.renderSharePage(req, res)).catch(next))
    mounted.push('/s/:id')
  }
} catch (e) {
  failed.push({ prefix: '/s/:id', err: e?.message })
}
try {
  const pub = mods['./routes/publish.js'] || (await load('./routes/publish.js'))
  if (typeof pub.renderPublishPage === 'function') {
    app.get('/p/:id', (req, res, next) => Promise.resolve(pub.renderPublishPage(req, res)).catch(next))
    mounted.push('/p/:id')
  }
} catch (e) {
  failed.push({ prefix: '/p/:id', err: e?.message })
}

/* --------------------------------------------------------------- health */
app.get('/api/health', async (_req, res) => {
  let db = false
  try {
    const { pool } = await import('./lib/db.js')
    const [rows] = await pool.query('SELECT 1 AS ok')
    db = rows?.[0]?.ok === 1
  } catch { db = false }
  res.json({
    status: true,
    data: {
      ok: true,
      db,
      ts: new Date().toISOString(),
      uptime: Math.floor((Date.now() - started) / 1000),
      version: '1.0.0',
      node: process.version,
      mounted,
      failed: failed.map((f) => f.prefix)
    }
  })
})

/* ---------------------------------------------------------------- static */
if (fs.existsSync(WEB_DIR)) {
  app.use(
    express.static(WEB_DIR, {
      maxAge: '7d',
      setHeaders: (res, p) => {
        if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store')
      }
    })
  )
  app.get(/^\/(?!api|s\/|p\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIR, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => {
    res.status(200).type('html').send(
      `<h1>NeoM API</h1><p>前端产物未找到：${WEB_DIR}</p><p>健康检查：<a href="/api/health">/api/health</a></p>`
    )
  })
}

/* ------------------------------------------------------------- error mw */
app.use((err, req, res, _next) => {
  console.error('[NeoM] 未捕获错误', err)
  if (res.headersSent) return
  res.status(err.status || 500).json({
    status: false,
    msg: err.expose ? err.message : '服务器内部错误',
    code: err.code || 'INTERNAL_ERROR'
  })
})

process.on('unhandledRejection', (r) => console.error('[NeoM] unhandledRejection', r))
process.on('uncaughtException', (e) => console.error('[NeoM] uncaughtException', e))

const PORT = Number(process.env.PORT || 3300)
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => {
  console.log(`[NeoM] 服务已启动 http://${HOST}:${PORT}  node=${process.version} pid=${process.pid}`)
  console.log(`[NeoM] 已挂载路由: ${mounted.join(', ') || '(none)'}`)
  if (failed.length) console.log(`[NeoM] 未挂载: ${failed.map((f) => f.prefix).join(', ')}`)
  console.log(`[NeoM] 静态目录: ${WEB_DIR} (exists=${fs.existsSync(WEB_DIR)})`)
  console.log(`[NeoM] 内存: ${(os.totalmem() / 1e9).toFixed(1)}GB, CPU: ${os.cpus().length} 核`)
})
