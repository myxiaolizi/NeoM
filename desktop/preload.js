'use strict'
/**
 * NeoM desktop preload — the ONLY bridge between the renderer and Node.
 *
 * The exposed surface is the contract declared in web/src/lib/platform.ts
 * (`window.neom` → `LocalFileApi`). Keep the signatures byte-compatible with it.
 *
 * Extra (additive) helpers are namespaced under `neom.window`, `neom.app`,
 * `neom.dialog`, `neom.openExternal` and never change existing method shapes.
 */

const { contextBridge, ipcRenderer } = require('electron')

const API_BASE = (process.env.NEOM_API_BASE || 'https://m.zhengl.vip').replace(/\/+$/, '')
/**
 * By default the renderer talks to the API with RELATIVE urls: main.js registers
 * the `app://neom/` protocol and reverse-proxies /api, /s, /p to API_BASE.
 * That avoids CORS entirely. Set NEOM_DIRECT_API=1 to make the renderer call the
 * absolutely-qualified origin instead (requires server-side CORS).
 */
const DIRECT_API = process.env.NEOM_DIRECT_API === '1'
const EFFECTIVE_API_BASE = DIRECT_API ? API_BASE : ''

/** Read a plain value out of the injected config (package.json extraMetadata). */
const appTargetPlatform = process.platform

/* ------------------------------------------------------------------ local fs */
const local = {
  /* --------- contract methods (web/src/lib/platform.ts -> LocalFileApi) --------- */
  openVault: () => ipcRenderer.invoke('neom:openVault'),
  readDir: (dir) => ipcRenderer.invoke('neom:readDir', dir),
  readFile: (path) => ipcRenderer.invoke('neom:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('neom:writeFile', path, content),
  deleteFile: (path) => ipcRenderer.invoke('neom:deleteFile', path),
  createDir: (path) => ipcRenderer.invoke('neom:createDir', path),
  rename: (from, to) => ipcRenderer.invoke('neom:rename', from, to),
  move: (from, to) => ipcRenderer.invoke('neom:move', from, to),
  revealInFolder: (path) => ipcRenderer.invoke('neom:revealInFolder', path),
  openPath: (path) => ipcRenderer.invoke('neom:openPath', path),
  setTitle: (title) => ipcRenderer.invoke('neom:setTitle', title),
  associateMd: () => ipcRenderer.invoke('neom:associateMd'),
  isMdAssociated: () => ipcRenderer.invoke('neom:isMdAssociated'),
  onOpenFile: (cb) => {
    const handler = (_event, filePath) => cb(filePath)
    ipcRenderer.on('neom:open-file', handler)
    return () => ipcRenderer.removeListener('neom:open-file', handler)
  },
  recentVaults: () => ipcRenderer.invoke('neom:recentVaults'),
  store: {
    get: (k) => ipcRenderer.invoke('neom:store:get', k),
    set: (k, v) => ipcRenderer.invoke('neom:store:set', k, v)
  },
  update: {
    check: () => ipcRenderer.invoke('neom:update:check'),
    download: (url) => ipcRenderer.invoke('neom:update:download', url),
    install: () => ipcRenderer.invoke('neom:update:install')
  },

  /* --------- additive helpers (optional for the web app) --------- */
  /** Whole subtree in one round-trip; entry paths are absolute. */
  readDirRecursive: (dir) => ipcRenderer.invoke('neom:readDir', dir, { recursive: true }),
  /** Single stat -> { size, mtime, ctime, isDir } in epoch ms. */
  stat: async (path) => {
    const dir = path.replace(/[\\/][^\\/]+$/, '') || path
    const items = await ipcRenderer.invoke('neom:readDir', dir)
    const base = path.split(/[\\/]/).pop()
    return (items || []).find((i) => i.name === base) || null
  },
  deleteRecursive: (path) => ipcRenderer.invoke('neom:deleteFile', path, { recursive: true }),
  storeDelete: (k) => ipcRenderer.invoke('neom:store:delete', k),
  openFileDialog: () => ipcRenderer.invoke('neom:openFileDialog')
}

/* ------------------------------------------------------------- window chrome */
const windowApi = {
  minimize: () => ipcRenderer.invoke('neom:win:minimize'),
  maximize: () => ipcRenderer.invoke('neom:win:maximize'),
  unmaximize: () => ipcRenderer.invoke('neom:win:maximize'),
  close: () => ipcRenderer.invoke('neom:win:close'),
  isMaximized: () => ipcRenderer.invoke('neom:win:isMaximized'),
  toggleFullScreen: () => ipcRenderer.invoke('neom:win:toggleFullScreen'),
  onStateChange: (cb) => {
    const handler = (_event, state) => cb(state)
    ipcRenderer.on('neom:win:state', handler)
    return () => ipcRenderer.removeListener('neom:win:state', handler)
  }
}

const api = {
  isDesktop: true,
  /** 'win32' | 'darwin' | 'linux' — platform.ts maps this to windows/macos/linux */
  platform: appTargetPlatform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  /** '' => relative urls through the built-in app:// reverse proxy. */
  apiBase: EFFECTIVE_API_BASE,
  remoteApiBase: API_BASE,

  local,
  window: windowApi,

  app: {
    info: () => ipcRenderer.invoke('neom:app:info')
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('neom:openFileDialog'),
    message: (opts) => ipcRenderer.invoke('neom:dialog:message', opts),
    confirm: (opts) => ipcRenderer.invoke('neom:dialog:confirm', opts)
  },
  openExternal: (url) => ipcRenderer.invoke('neom:openExternal', url)
}

contextBridge.exposeInMainWorld('neom', api)

/* ---------------------------------------------------------------- globals */
/**
 * `window.__NEOM_API_BASE__` is a plain string the web app may prefix onto
 * /api/* calls. Empty string means "same origin" (works everywhere, incl. the
 * app:// proxy). `__NEOM_REMOTE_API_BASE__` always carries the real backend.
 */
contextBridge.exposeInMainWorld('__NEOM_API_BASE__', EFFECTIVE_API_BASE)
contextBridge.exposeInMainWorld('__NEOM_REMOTE_API_BASE__', API_BASE)
