'use strict'
/**
 * electron-builder configuration — NeoM desktop.
 *
 * Targets
 *   Windows : nsis installer (.exe) + zip (绿色版/解压即用) + portable (单文件 exe)
 *   macOS   : dmg + zip for arm64 and x64 (universal artifacts are per-arch)
 *   Linux   : AppImage + deb
 *
 * Usage
 *   npx electron-builder --config builder.config.js --win --x64
 *   NEOM_OUT_DIR=../release/win-x64 npx electron-builder --config builder.config.js --win --x64
 *
 * Env
 *   NEOM_OUT_DIR      output directory (default ../release)
 *   NEOM_UPDATE_URL   generic update feed (default https://mdadmin.zhengl.vip/md/mdadmin/)
 *   CSC_LINK/CSC_KEY_PASSWORD   Windows/macOS code signing (never hard-coded here)
 *   APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID   macOS notarization
 */

const path = require('node:path')
const fs = require('node:fs')
const pkg = require('./package.json')

/**
 * Reuse the Electron binary already unpacked by `npm install` instead of letting
 * electron-builder re-download it from GitHub (which stalls behind some ISPs).
 * NEOM_ELECTRON_DIST overrides the location; set NEOM_NO_ELECTRON_DIST=1 to force
 * a normal download (e.g. when the local dist is for the wrong platform).
 */
function resolveElectronDist() {
  if (process.env.NEOM_NO_ELECTRON_DIST === '1') return undefined
  const explicit = process.env.NEOM_ELECTRON_DIST
  const candidate = explicit || path.join(__dirname, 'node_modules', 'electron', 'dist')
  const marker = process.platform === 'darwin' ? 'Electron.app' : process.platform === 'win32' ? 'electron.exe' : 'electron'
  try {
    if (fs.existsSync(path.join(candidate, marker))) return candidate
  } catch {
    /* ignore */
  }
  return undefined
}

const ELECTRON_DIST = resolveElectronDist()

const OUT_DIR = process.env.NEOM_OUT_DIR
  ? path.resolve(__dirname, process.env.NEOM_OUT_DIR)
  : path.resolve(__dirname, '..', 'release')

const UPDATE_URL = (process.env.NEOM_UPDATE_URL || 'https://mdadmin.zhengl.vip/md/mdadmin/').replace(/\/+$/, '') + '/'

/** macOS UTI declaration so Finder / "Open With" knows about .md */
const MAC_DOCUMENT_TYPES = [
  {
    CFBundleTypeName: 'Markdown Document',
    CFBundleTypeRole: 'Editor',
    LSHandlerRank: 'Alternate',
    LSItemContentTypes: ['net.daringfireball.markdown', 'public.plain-text'],
    CFBundleTypeExtensions: ['md', 'markdown', 'mdown', 'mkd']
  }
]

const MAC_IMPORTED_UTIS = [
  {
    UTTypeIdentifier: 'net.daringfireball.markdown',
    UTTypeDescription: 'Markdown Document',
    UTTypeConformsTo: ['public.plain-text'],
    UTTypeTagSpecification: {
      'public.filename-extension': ['md', 'markdown', 'mdown', 'mkd'],
      'public.mime-type': ['text/markdown', 'text/x-markdown']
    }
  }
]

module.exports = {
  appId: 'vip.zhengl.neom',
  productName: 'NeoM',
  copyright: `Copyright © ${new Date().getFullYear()} NeoM`,
  artifactName: 'NeoM-${version}-${os}-${arch}.${ext}',

  /* ------------------------------------------------------------ directories */
  directories: {
    output: OUT_DIR,
    buildResources: 'assets'
  },

  /* ------------------------------------------------------------------ files */
  files: [
    'main.js',
    'preload.js',
    'loader.html',
    'assets/icon.*',
    '!**/*.map',
    '!**/*.md',
    '!**/{.github,.vscode,test,tests,__tests__}/**',
    'app-web/**/*'
  ],
  asar: true,
  asarUnpack: ['**/*.node'],
  /** Local Electron build, avoids re-downloading ~115 MB from GitHub. */
  electronDist: ELECTRON_DIST,
  /** Staged web bundle is already minified; do not waste time on double compression. */
  compression: 'normal',
  removePackageScripts: true,

  extraMetadata: {
    name: 'neom-desktop',
    productName: 'NeoM',
    version: pkg.version,
    description: 'NeoM — AI 原生 Markdown 知识库桌面端',
    author: pkg.author
  },

  /* -------------------------------------------------------------- .md files */
  fileAssociations: [
    {
      ext: 'md',
      name: 'Markdown Document',
      description: 'Markdown 文档',
      role: 'Editor',
      mimeType: 'text/markdown'
    },
    {
      ext: 'markdown',
      name: 'Markdown Document',
      description: 'Markdown 文档',
      role: 'Editor',
      mimeType: 'text/markdown'
    }
  ],

  /* --------------------------------------------------------------- Windows */
  win: {
    icon: 'assets/icon.ico',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    requestedExecutionLevel: 'asInvoker',
    legalTrademarks: 'NeoM',
    signtoolOptions: {
      publisherName: 'NeoM'
    },
    /** falling back to win.artifactName => NeoM-1.0.0-win-x64.zip (绿色版) */
    artifactName: 'NeoM-${version}-win-${arch}-green.${ext}',
    signAndEditExecutable: true,
    verifyUpdateCodeSignature: false
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'NeoM',
    uninstallDisplayName: 'NeoM ${version}',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    installerHeaderIcon: 'assets/icon.ico',
    artifactName: 'NeoM-${version}-win-${arch}-setup.${ext}',
    warningsAsErrors: false,
    unicode: true
  },

  portable: {
    artifactName: 'NeoM-${version}-win-${arch}-portable.${ext}',
    requestExecutionLevel: 'user',
    unpackDirName: false
  },

  /* ------------------------------------------------------------------- macOS */
  mac: {
    icon: 'assets/icon.icns',
    category: 'public.app-category.productivity',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    artifactName: 'NeoM-${version}-mac-${arch}.${ext}',
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    /** Set CSC_IDENTITY_AUTO_DISCOVERY=false to skip signing on unconfigured machines */
    entitlements: undefined,
    entitlementsInherit: undefined,
    extendInfo: {
      CFBundleDocumentTypes: MAC_DOCUMENT_TYPES,
      UTImportedTypeDeclarations: MAC_IMPORTED_UTIS,
      LSSupportsOpeningDocumentsInPlace: true,
      UIFileSharingEnabled: true,
      NSHumanReadableCopyright: `Copyright © ${new Date().getFullYear()} NeoM`,
      LSMinimumSystemVersion: '11.0',
      NSHighResolutionCapable: true
    }
  },

  dmg: {
    title: 'NeoM ${version}',
    artifactName: 'NeoM-${version}-mac-${arch}.${ext}',
    window: { width: 540, height: 380 },
    contents: [
      { x: 140, y: 190, type: 'file' },
      { x: 400, y: 190, type: 'link', path: '/Applications' }
    ],
    sign: false
  },

  /* ------------------------------------------------------------------- Linux */
  linux: {
    icon: 'assets',
    category: 'Office',
    desktop: {
      entry: {
        Name: 'NeoM',
        Comment: 'AI 原生 Markdown 知识库',
        Categories: 'Office;TextEditor;',
        MimeType: 'text/markdown;'
      }
    },
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],
    artifactName: 'NeoM-${version}-linux-${arch}.${ext}'
  },

  /* ---------------------------------------------------------------- updates */
  electronUpdaterCompatibility: '>=2.16',
  publish: [
    {
      provider: 'generic',
      url: UPDATE_URL,
      channel: 'latest'
    }
  ],
  generateUpdatesFilesForAllChannels: true
}
