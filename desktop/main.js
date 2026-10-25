'use strict'
/**
 * NeoM — Electron main process.
 *
 * Responsibilities
 *  - Frameless window (Win/Linux `frame:false`, macOS `titleBarStyle:'hiddenInset'` + traffic lights)
 *  - Single instance lock + argv forwarding (second instance opens .md in the running one)
 *  - Local file system bridge (implements web/src/lib/platform.ts -> LocalFileApi)
 *  - `.md` file association (Windows registry HKCU, macOS Info.plist via electron-builder)
 *  - Window state persistence, custom menu, auto update
 *  - `app://neom/...` custom protocol:
 *      * serves the built web app (desktop/app-web)
 *      * transparently reverse-proxies /api, /s, /p to the online backend so the
 *        web bundle can keep using relative URLs (no CORS, no api.ts rewrite needed)
 *
 * Security: contextIsolation:true, nodeIntegration:false, sandbox:false (fs needs Node),
 * renderer never touches Node directly — everything goes through preload.js.
 */

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  protocol,
  net,
  screen
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { execFile, exec } = require('node:child_process')

/* ------------------------------------------------------------------ config */
const APP_ID = 'vip.zhengl.neom'
const SCHEME = 'app'
const SCHEME_HOST = 'neom'
const PROTOCOL_URL_SCHEME = 'neom'
const APP_ORIGIN = `${SCHEME}://${SCHEME_HOST}`

/** Renderer root: staged web build (see prepare-web.mjs). */
const RENDERER_DIR = path.join(__dirname, 'app-web')
const RENDERER_INDEX = path.join(RENDERER_DIR, 'index.html')

/** Online backend used for update checks and the built-in API reverse proxy. */
const API_BASE = (process.env.NEOM_API_BASE || 'https://m.zhengl.vip').replace(/\/+$/, '')
/** When set, the renderer is expected to call the API cross-origin (needs server CORS). */
const DIRECT_API = process.env.NEOM_DIRECT_API === '1'
const DEV_URL = process.env.NEOM_DEV_URL || ''
const isDev = !app.isPackaged
const MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd']

/** Paths that are proxied to API_BASE instead of read from disk. */
const PROXY_PREFIXES = ['/api/', '/s/', '/p/']

let mainWindow = null
let pendingOpenPaths = []
let rendererReady = false
let downloadedInstaller = null

/* --------------------------------------------------- privileged scheme (before ready) */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      allowServiceWorkers: false,
      bypassCSP: false
    }
  }
])

app.setAppUserModelId(APP_ID)

/* ------------------------------------------------------------ tiny json store */
class JsonStore {
  constructor(file) {
    this.file = file
    this.data = {}
    this.timer = null
    this.load()
  }
  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      this.data = {}
    }
  }
  get(key) {
    const v = this.data[key]
    return typeof v === 'string' ? v : v == null ? null : JSON.stringify(v)
  }
  set(key, value) {
    this.data[key] = value
    this.save()
  }
  save() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
      } catch (e) {
        console.error('[neom] store save failed:', e)
      }
    }, 120)
  }
  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (e) {
      console.error('[neom] store flush failed:', e)
    }
  }
}

let store = null
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json')
const storeFile = () => path.join(app.getPath('userData'), 'neom-store.json')

/* ------------------------------------------------------------------ argv utils */
function filePathFromArgv(argv) {
  if (!Array.isArray(argv)) return null
  for (const raw of argv) {
    if (typeof raw !== 'string') continue
    let candidate = raw
    if (/^file:\/\//i.test(candidate)) {
      try {
        candidate = decodeURIComponent(new URL(candidate).pathname)
        if (/^\/[A-Za-z]:/.test(candidate)) candidate = candidate.slice(1)
      } catch {
        continue
      }
    }
    if (!candidate || candidate.startsWith('-')) continue
    if (candidate === '.' || candidate === '..') continue
    const lower = candidate.toLowerCase()
    if (!MD_EXTENSIONS.some((e) => lower.endsWith(e))) continue
    try {
      if (!fs.existsSync(candidate)) continue
      if (!fs.statSync(candidate).isFile()) continue
    } catch {
      continue
    }
    return path.resolve(candidate)
  }
  return null
}

function deliverOpenFile(filePath) {
  if (!filePath) return
  if (mainWindow && rendererReady && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('neom:open-file', filePath)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else {
    pendingOpenPaths.push(filePath)
  }
}

function flushPendingOpenFiles() {
  if (!mainWindow || !rendererReady) return
  const items = pendingOpenPaths.splice(0, pendingOpenPaths.length)
  for (const p of items) mainWindow.webContents.send('neom:open-file', p)
}

/* ------------------------------------------------------------------- app:// io */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm'
}

function isProxyPath(pathname) {
  return PROXY_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p))
}

async function proxyToApi(request, url) {
  const target = API_BASE + url.pathname + url.search
  const headers = {}
  for (const [k, v] of request.headers.entries()) {
    const key = k.toLowerCase()
    if (key === 'host' || key === 'origin' || key === 'referer' || key.startsWith('sec-') || key === 'connection') continue
    headers[k] = v
  }
  headers['accept-encoding'] = 'gzip, deflate, br'
  const init = { method: request.method, headers, redirect: 'follow' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = Buffer.from(await request.arrayBuffer())
    if (body.length) init.body = body
  }
  try {
    const res = await net.fetch(target, init)
    const outHeaders = new Headers()
    for (const [k, v] of res.headers.entries()) {
      const key = k.toLowerCase()
      if (key === 'content-encoding' || key === 'transfer-encoding' || key === 'content-length') continue
      if (key === 'set-cookie') continue // cookies are meaningless for the app:// origin
      outHeaders.set(k, v)
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: outHeaders })
  } catch (err) {
    console.error('[neom] proxy failed', target, err && err.message)
    return new Response(
      JSON.stringify({ status: false, msg: `NeoM 无法连接后端：${(err && err.message) || 'network error'}` }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } }
    )
  }
}

async function serveStatic(url) {
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const resolved = path.normalize(path.join(RENDERER_DIR, rel))
  if (!resolved.startsWith(RENDERER_DIR)) {
    return new Response('Forbidden', { status: 403 })
  }
  let filePath = resolved
  try {
    const st = await fsp.stat(filePath)
    if (st.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
    /* handled below */
  }
  try {
    const data = await fsp.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      }
    })
  } catch {
    const ext = path.extname(rel)
    if (ext && ext !== '.html') return new Response('Not Found', { status: 404 })
    // SPA fallback — BrowserRouter routes such as /app or /account/profile
    try {
      const html = await fsp.readFile(RENDERER_INDEX)
      return new Response(html, { status: 200, headers: { 'content-type': MIME['.html'], 'cache-control': 'no-cache' } })
    } catch {
      return new Response('NeoM renderer missing (run prepare-web.mjs)', { status: 500 })
    }
  }
}

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (isProxyPath(url.pathname)) return await proxyToApi(request, url)
      return await serveStatic(url)
    } catch (err) {
      console.error('[neom] protocol handler error', err)
      return new Response('Internal Error: ' + (err && err.message), { status: 500 })
    }
  })
}

/* ---------------------------------------------------------- window state */
const DEFAULT_WINDOW_STATE = { width: 1280, height: 820, x: undefined, y: undefined, maximized: false }

function readWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))
    return { ...DEFAULT_WINDOW_STATE, ...raw }
  } catch {
    return { ...DEFAULT_WINDOW_STATE }
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return
  try {
    const isMax = win.isMaximized()
    const bounds = isMax ? win.getNormalBounds() : win.getBounds()
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true })
    fs.writeFileSync(
      windowStateFile(),
      JSON.stringify({ width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, maximized: isMax }, null, 2),
      'utf8'
    )
  } catch (e) {
    console.error('[neom] save window state failed', e)
  }
}

function clampToDisplays(state) {
  const out = { ...state }
  if (typeof out.x !== 'number' || typeof out.y !== 'number') {
    delete out.x
    delete out.y
    return out
  }
  const displays = screen.getAllDisplays()
  const visible = displays.some((d) => {
    const b = d.workArea
    return out.x < b.x + b.width - 40 && out.x + out.width > b.x + 40 && out.y < b.y + b.height - 40 && out.y + 60 > b.y
  })
  if (!visible) {
    delete out.x
    delete out.y
  }
  return out
}

/* -------------------------------------------------------------- window */
function createWindow() {
  const state = clampToDisplays(readWindowState())
  const common = {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'NeoM',
    backgroundColor: '#f3f4f7',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false, // fs + os access is required by the local vault bridge
      webviewTag: false,
      spellcheck: false,
      devTools: true,
      backgroundThrottling: false
    }
  }

  const platformChrome =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, frame: true, tabbingIdentifier: 'neom' }
      : { frame: false, roundedCorners: true, thickFrame: true }

  mainWindow = new BrowserWindow({ ...common, ...platformChrome })

  if (state.maximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (isDev && process.env.NEOM_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  const sendWinState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('neom:win:state', {
        maximized: mainWindow.isMaximized(),
        fullscreen: mainWindow.isFullScreen(),
        focused: mainWindow.isFocused()
      })
    }
  }
  for (const evt of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'resize']) {
    mainWindow.on(evt, sendWinState)
  }

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    flushPendingOpenFiles()
    sendWinState()
  })
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })

  // External links open in the system browser, never inside the shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    else if (url.startsWith(`${SCHEME}://`)) mainWindow.loadURL(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith(`${SCHEME}://${SCHEME_HOST}`) ||
      url.startsWith('devtools://') ||
      (DEV_URL && url.startsWith(DEV_URL)) ||
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('http://localhost')
    if (!allowed) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    }
  })

  mainWindow.on('close', () => saveWindowState(mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
  })

  const entry = process.env.NEOM_ENTRY || ''
  if (DEV_URL) {
    mainWindow.loadURL(entry ? `${DEV_URL}${entry}` : DEV_URL).catch((e) => console.error('[neom] dev load failed', e))
  } else {
    const hashOrPath = entry && entry !== '/' ? entry : '/'
    mainWindow.loadURL(`${APP_ORIGIN}${hashOrPath}`).catch((e) => console.error('[neom] load failed', e))
  }

  return mainWindow
}

/* ---------------------------------------------------------------- menu */
function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  // macOS needs a menu for copy/paste/quit; nothing here steals web shortcuts.
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 NeoM' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 NeoM' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 NeoM' }
      ]
    },
    { role: 'editMenu', label: '编辑' },
    { role: 'windowMenu', label: '窗口' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ------------------------------------------------------- .md association */
function mdProgId() {
  return 'NeoM.Markdown'
}

function regExec(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => resolve({ ok: !err, stdout: stdout || '' }))
  })
}

async function associateMdWindows() {
  const exe = process.execPath
  const progId = mdProgId()
  const classes = 'HKCU\\Software\\Classes'
  const steps = [
    ['add', `${classes}\\${progId}`, '/ve', '/d', 'NeoM Markdown 文档', '/f'],
    ['add', `${classes}\\${progId}\\DefaultIcon`, '/ve', '/d', `"${exe}",0`, '/f'],
    ['add', `${classes}\\${progId}\\shell\\open\\command`, '/ve', '/d', `"${exe}" "%1"`, '/f'],
    ['add', `${classes}\\.md`, '/ve', '/d', progId, '/f'],
    ['add', `${classes}\\.markdown`, '/ve', '/d', progId, '/f'],
    ['add', `${classes}\\.md\\OpenWithProgids`, '/v', progId, '/t', 'REG_NONE', '/d', '', '/f'],
    ['add', `${classes}\\.markdown\\OpenWithProgids`, '/v', progId, '/t', 'REG_NONE', '/d', '', '/f']
  ]
  let ok = true
  for (const step of steps) {
    const r = await regExec(step)
    if (!r.ok) ok = false
  }
  // Best-effort: tell Explorer the association table changed.
  exec('ie4uinit.exe -show', { windowsHide: true }, () => {})
  return ok
}

async function isMdAssociatedWindows() {
  const progId = mdProgId()
  const hkcu = await regExec(['query', 'HKCU\\Software\\Classes\\.md', '/ve'])
  if (hkcu.ok && hkcu.stdout.toLowerCase().includes(progId.toLowerCase())) return true
  const hkcr = await regExec(['query', 'HKCR\\.md', '/ve'])
  return hkcr.ok && hkcr.stdout.toLowerCase().includes(progId.toLowerCase())
}

function macInfoPlistPath() {
  // .../NeoM.app/Contents/MacOS/NeoM -> .../NeoM.app/Contents/Info.plist
  return path.join(path.dirname(process.execPath), '..', 'Info.plist')
}

async function isMdAssociatedMac() {
  try {
    const plist = await fsp.readFile(macInfoPlistPath(), 'utf8')
    return plist.includes('net.daringfireball.markdown') || plist.includes('CFBundleDocumentTypes')
  } catch {
    return false
  }
}

/* --------------------------------------------------------------- updater */
function platformTag() {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  return `${os}-${process.arch}`
}

let autoUpdater = null
function getAutoUpdater() {
  if (autoUpdater !== null) return autoUpdater || null
  try {
    // eslint-disable-next-line global-require
    const { autoUpdater: au } = require('electron-updater')
    au.autoDownload = false
    au.autoInstallOnAppQuit = true
    au.logger = {
      info: (...a) => console.log('[updater]', ...a),
      warn: (...a) => console.warn('[updater]', ...a),
      error: (...a) => console.error('[updater]', ...a),
      debug: () => {}
    }
    autoUpdater = au
    return au
  } catch (e) {
    autoUpdater = false
    console.warn('[neom] electron-updater unavailable (dev install?):', e && e.message)
    return null
  }
}

async function checkUpdateFromApi() {
  const current = app.getVersion()
  const url = `${API_BASE}/api/releases/check?platform=${encodeURIComponent(platformTag())}&version=${encodeURIComponent(current)}`
  const res = await net.fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const payload = await res.json()
  const data = payload && payload.status === true ? payload.data : null
  if (!data) return null
  // Tolerate several shapes: {hasUpdate,version,url,notes} | {latest:{...}} | release row
  const node = data.latest || data.release || data
  const version = node.version || node.latest_version
  const fileUrl = node.url || node.download_url || node.file_url || (Array.isArray(node.assets) ? (node.assets[0] && node.assets[0].url) : '')
  if (!version) return null
  const hasUpdate = typeof data.hasUpdate === 'boolean' ? data.hasUpdate : compareVersion(version, current) > 0
  if (!hasUpdate) return null
  return { version: String(version), url: String(fileUrl || ''), notes: String(node.changelog || node.notes || '') }
}

function compareVersion(a, b) {
  const pa = String(a).split(/[.\-+]/).map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split(/[.\-+]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

async function updateCheck() {
  try {
    const fromApi = await checkUpdateFromApi()
    if (fromApi) return fromApi
  } catch (e) {
    console.warn('[neom] update check via API failed:', e && e.message)
  }
  const au = getAutoUpdater()
  if (!au || !app.isPackaged) return null
  try {
    const r = await au.checkForUpdates()
    if (!r || !r.updateInfo) return null
    if (compareVersion(r.updateInfo.version, app.getVersion()) <= 0) return null
    const files = (r.updateInfo.files || []).map((f) => f.url).filter(Boolean)
    return {
      version: r.updateInfo.version,
      url: files.find((u) => /\.(exe|zip|dmg|AppImage)$/i.test(u)) || files[0] || '',
      notes: typeof r.updateInfo.releaseNotes === 'string' ? r.updateInfo.releaseNotes : ''
    }
  } catch (e) {
    console.warn('[neom] electron-updater check failed:', e && e.message)
    return null
  }
}

async function updateDownload(url) {
  // Prefer electron-updater when the URL is a differential/NSIS payload it understands.
  if (!url) {
    const au = getAutoUpdater()
    if (au && app.isPackaged) await au.downloadUpdate()
    return
  }
  const dir = path.join(app.getPath('temp'), 'neom-update')
  await fsp.mkdir(dir, { recursive: true })
  const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'NeoM-update.bin')
  const dest = path.join(dir, name)
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fsp.writeFile(dest, buf)
  downloadedInstaller = dest
  return dest
}

async function updateInstall() {
  const au = getAutoUpdater()
  if (downloadedInstaller && fs.existsSync(downloadedInstaller)) {
    const err = await shell.openPath(downloadedInstaller)
    if (err) throw new Error(err)
    setTimeout(() => app.quit(), 400)
    return
  }
  if (au && app.isPackaged) {
    au.quitAndInstall(false, true)
    return
  }
  throw new Error('没有已下载的更新包')
}

/* ------------------------------------------------------------------ ipc */
function windowFrom(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow
}

function readRecentVaults() {
  try {
    const raw = store.get('recentVaults')
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((x) => x && typeof x.path === 'string') : []
  } catch {
    return []
  }
}

function rememberVault(vaultPath) {
  const entry = { path: vaultPath, name: path.basename(vaultPath) || vaultPath, at: Date.now() }
  const list = readRecentVaults().filter((x) => x.path !== vaultPath)
  list.unshift(entry)
  store.set('recentVaults', JSON.stringify(list.slice(0, 12)))
}

async function statEntry(dir, dirent) {
  const full = path.join(dir, dirent.name)
  let st = null
  try {
    st = await fsp.stat(full)
  } catch {
    /* broken symlink / permission */
  }
  return {
    name: dirent.name,
    path: full,
    isDir: dirent.isDirectory() || (st ? st.isDirectory() : false),
    size: st ? st.size : 0,
    mtime: st ? Math.round(st.mtimeMs) : 0,
    ctime: st ? Math.round(st.ctimeMs) : 0
  }
}

function registerIpc() {
  /* ---- local file api (mirrors LocalFileApi in web/src/lib/platform.ts) ---- */

  ipcMain.handle('neom:openVault', async (event) => {
    const win = windowFrom(event)
    const res = await dialog.showOpenDialog(win, {
      title: '选择本地笔记库（Vault）',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '打开此文件夹'
    })
    if (res.canceled || !res.filePaths.length) return null
    const vaultPath = res.filePaths[0]
    rememberVault(vaultPath)
    return { path: vaultPath, name: path.basename(vaultPath) || vaultPath }
  })

  /**
   * readDir(dir[, opts]) — direct children only (web/src/lib/fs.ts walks the tree
   * itself). `opts.recursive === true` returns the whole subtree flattened.
   * mtime/ctime are epoch milliseconds.
   */
  ipcMain.handle('neom:readDir', async (_event, dir, opts) => {
    const recursive = !!(opts && opts.recursive)
    const out = []
    const walk = async (current) => {
      let dirents
      try {
        dirents = await fsp.readdir(current, { withFileTypes: true })
      } catch (e) {
        if (current === dir) throw e
        return
      }
      for (const d of dirents) {
        const entry = await statEntry(current, d)
        out.push(entry)
        if (recursive && entry.isDir) await walk(entry.path)
      }
    }
    await walk(dir)
    out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.isDir ? -1 : 1))
    return out
  })

  ipcMain.handle('neom:readFile', async (_event, filePath) => {
    return fsp.readFile(filePath, 'utf8')
  })

  ipcMain.handle('neom:writeFile', async (_event, filePath, content) => {
    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, typeof content === 'string' ? content : String(content ?? ''), 'utf8')
      return true
    } catch (e) {
      console.error('[neom] writeFile failed', filePath, e && e.message)
      return false
    }
  })

  ipcMain.handle('neom:deleteFile', async (_event, filePath, opts) => {
    try {
      await fsp.rm(filePath, { recursive: !!(opts && opts.recursive), force: false })
      return true
    } catch (e) {
      console.error('[neom] deleteFile failed', filePath, e && e.message)
      return false
    }
  })

  ipcMain.handle('neom:createDir', async (_event, dirPath) => {
    try {
      await fsp.mkdir(dirPath, { recursive: true })
      return true
    } catch (e) {
      console.error('[neom] createDir failed', dirPath, e && e.message)
      return false
    }
  })

  ipcMain.handle('neom:rename', async (_event, from, to) => {
    try {
      if (path.normalize(from) === path.normalize(to)) return true
      await fsp.mkdir(path.dirname(to), { recursive: true })
      await fsp.rename(from, to)
      return true
    } catch (e) {
      console.error('[neom] rename failed', from, '->', to, e && e.message)
      return false
    }
  })

  ipcMain.handle('neom:move', async (_event, from, to) => {
    try {
      await fsp.mkdir(path.dirname(to), { recursive: true })
      await fsp.rename(from, to)
      return true
    } catch (e) {
      // EXDEV: different volumes -> copy + unlink
      try {
        await fsp.cp(from, to, { recursive: true })
        await fsp.rm(from, { recursive: true, force: true })
        return true
      } catch (e2) {
        console.error('[neom] move failed', from, '->', to, e2 && e2.message)
        return false
      }
    }
  })

  ipcMain.handle('neom:revealInFolder', async (_event, targetPath) => {
    if (!targetPath) return
    if (process.platform === 'win32') {
      const safe = String(targetPath).replace(/"/g, '')
      await new Promise((resolve) => {
        exec(`explorer.exe /select,"${safe}"`, { windowsHide: true }, () => resolve())
      })
      return
    }
    if (process.platform === 'darwin') {
      await new Promise((resolve) => {
        execFile('open', ['-R', String(targetPath)], () => resolve())
      })
      return
    }
    shell.showItemInFolder(String(targetPath))
  })

  ipcMain.handle('neom:openPath', async (_event, targetPath) => {
    const err = await shell.openPath(String(targetPath))
    if (err) throw new Error(err)
  })

  ipcMain.handle('neom:openExternal', async (_event, url) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('只允许打开 http/https 链接')
    await shell.openExternal(String(url))
  })

  ipcMain.handle('neom:setTitle', async (event, title) => {
    const win = windowFrom(event)
    if (!win || win.isDestroyed()) return
    const t = title == null ? '' : String(title)
    win.setTitle(t || 'NeoM')
  })

  ipcMain.handle('neom:associateMd', async () => {
    if (process.platform === 'win32') return associateMdWindows()
    if (process.platform === 'darwin') {
      // Declared through electron-builder fileAssociations -> CFBundleDocumentTypes.
      // macOS forbids silently stealing the default handler; guide the user instead.
      const declared = await isMdAssociatedMac()
      if (declared) {
        await dialog.showMessageBox({
          type: 'info',
          title: '设为默认 Markdown 打开方式',
          message: 'NeoM 已声明为 .md 文件的可选打开方式',
          detail: '在 Finder 中右键任意 .md 文件 →「显示简介」→「打开方式」选择 NeoM →「全部更改…」即可。',
          buttons: ['好的']
        })
      }
      return declared
    }
    return false
  })

  ipcMain.handle('neom:isMdAssociated', async () => {
    if (process.platform === 'win32') return isMdAssociatedWindows()
    if (process.platform === 'darwin') return isMdAssociatedMac()
    return false
  })

  ipcMain.handle('neom:recentVaults', async () => readRecentVaults().map((v) => ({ path: v.path, name: v.name })))

  ipcMain.handle('neom:store:get', async (_event, key) => store.get(String(key)))
  ipcMain.handle('neom:store:set', async (_event, key, value) => {
    store.set(String(key), value == null ? '' : String(value))
  })
  ipcMain.handle('neom:store:delete', async (_event, key) => {
    delete store.data[String(key)]
    store.save()
  })

  /* ---- window controls (custom titlebar is drawn by the web shell) ---- */
  ipcMain.handle('neom:win:minimize', async (event) => {
    const win = windowFrom(event)
    if (win) win.minimize()
  })
  ipcMain.handle('neom:win:maximize', async (event) => {
    const win = windowFrom(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('neom:win:close', async (event) => {
    const win = windowFrom(event)
    if (win) win.close()
  })
  ipcMain.handle('neom:win:isMaximized', async (event) => {
    const win = windowFrom(event)
    return !!(win && win.isMaximized())
  })
  ipcMain.handle('neom:win:toggleFullScreen', async (event) => {
    const win = windowFrom(event)
    if (!win) return false
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })
  ipcMain.handle('neom:app:info', async () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    apiBase: DIRECT_API ? API_BASE : '',
    remoteApiBase: API_BASE,
    isPackaged: app.isPackaged,
    paths: {
      userData: app.getPath('userData'),
      home: app.getPath('home'),
      documents: app.getPath('documents'),
      temp: app.getPath('temp'),
      appPath: app.getAppPath()
    }
  }))

  /* ---- auto update ---- */
  ipcMain.handle('neom:update:check', async () => {
    try {
      return await updateCheck()
    } catch (e) {
      console.warn('[neom] update check error', e && e.message)
      return null
    }
  })
  ipcMain.handle('neom:update:download', async (_event, url) => {
    await updateDownload(url)
  })
  ipcMain.handle('neom:update:install', async () => {
    await updateInstall()
  })

  /* ---- misc ---- */
  ipcMain.handle('neom:openFileDialog', async (event) => {
    const res = await dialog.showOpenDialog(windowFrom(event), {
      title: '打开 Markdown 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('neom:dialog:message', async (event, opts) => {
    const res = await dialog.showMessageBox(windowFrom(event), {
      type: (opts && opts.type) || 'info',
      title: (opts && opts.title) || 'NeoM',
      message: (opts && opts.message) || '',
      detail: (opts && opts.detail) || '',
      buttons: (opts && opts.buttons) || ['确定'],
      cancelId: (opts && opts.cancelId) ?? 0,
      defaultId: (opts && opts.defaultId) ?? 0
    })
    return res.response
  })

  ipcMain.handle('neom:dialog:confirm', async (event, opts) => {
    const res = await dialog.showMessageBox(windowFrom(event), {
      type: 'question',
      title: (opts && opts.title) || 'NeoM',
      message: (opts && opts.message) || '确定执行此操作？',
      detail: (opts && opts.detail) || '',
      buttons: [(opts && opts.okLabel) || '确定', (opts && opts.cancelLabel) || '取消'],
      defaultId: 0,
      cancelId: 1
    })
    return res.response === 0
  })
}

/* ------------------------------------------------------------- lifecycle */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const file = filePathFromArgv(argv.slice(1))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
    if (file) deliverOpenFile(file)
    else if (mainWindow) mainWindow.focus()
  })

  // macOS: file dropped on dock icon / opened via Finder association
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    deliverOpenFile(filePath)
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    try {
      const u = new URL(url)
      if (u.protocol === `${PROTOCOL_URL_SCHEME}:`) {
        const target = decodeURIComponent(u.searchParams.get('file') || u.pathname.replace(/^\/+/, ''))
        if (target) deliverOpenFile(target)
      }
    } catch {
      /* ignore malformed deep links */
    }
  })

  app.whenReady().then(async () => {
    store = new JsonStore(storeFile())

    // deep links: neom://file/<path>
    if (process.defaultApp) {
      if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL_URL_SCHEME, process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL_URL_SCHEME)
    }

    registerAppProtocol()
    registerIpc()
    buildMenu()

    // CLI: `NeoM.exe "C:\\notes\\a.md"` (or forwarded from a second instance)
    const initialFile = filePathFromArgv(process.argv.slice(1))
    if (initialFile) pendingOpenPaths.push(initialFile)

    createWindow()

    if (isDev && process.env.NEOM_DEV_URL) {
      console.log('[neom] dev renderer:', process.env.NEOM_DEV_URL)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    if (store) store.flush()
    if (mainWindow) saveWindowState(mainWindow)
  })
}
