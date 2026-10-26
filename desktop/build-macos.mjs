#!/usr/bin/env node
/**
 * build-macos.mjs — assemble real macOS .app bundles (+ .zip) from the darwin
 * Electron binaries on a non-macOS host.
 *
 * Why not electron-builder? Its `dmg`/`zip` targets for `arch: darwin` require
 * hdiutil / codesign on macOS. But a `.app` is just a directory tree with an
 * Info.plist, and a .zip is a zip — both can be produced anywhere. This script
 * therefore builds the distributable that matters (the .app inside a .zip) and
 * leaves dmg creation to a macOS runner / CI (see .github/workflows/build.yml).
 *
 * Usage:
 *   node build-macos.mjs --arch arm64|arm64,x64 [--electron-dir <dir>] [--out <dir>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d
}

const ARCHES = (arg('arch', 'arm64,x64')).split(',').map((s) => s.trim()).filter(Boolean)
const ELECTRON_DIR = path.resolve(arg('electron-dir', 'C:/data/tools/electron-mac'))
const OUT = path.resolve(ROOT, arg('out', '../release/mac'))
const WEB = path.join(ROOT, 'app-web')
const VERSION = pkg.version
const APP_ID = 'vip.zhengl.neom'

const log = (...a) => console.log('[macos]', ...a)

/* ------------------------------------------------------------------ plist */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const infoPlist = ({ arch }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>NeoM</string>
  <key>CFBundleExecutable</key><string>NeoM</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIdentifier</key><string>${APP_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>NeoM</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Copyright © ${new Date().getFullYear()} NeoM</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSSupportsOpeningDocumentsInPlace</key><true/>
  <key>UIFileSharingEnabled</key><true/>
  <key>NSRequiresAquaSystemAppearance</key><false/>

  <!-- .md file association (Finder double-click / "Open With") -->
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Markdown Document</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>net.daringfireball.markdown</string>
        <string>public.plain-text</string>
      </array>
      <key>CFBundleTypeExtensions</key>
      <array><string>md</string><string>markdown</string><string>mdown</string><string>mkd</string></array>
    </dict>
  </array>

  <key>UTImportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key><string>net.daringfireball.markdown</string>
      <key>UTTypeDescription</key><string>Markdown Document</string>
      <key>UTTypeConformsTo</key><array><string>public.plain-text</string></array>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array><string>md</string><string>markdown</string><string>mdown</string><string>mkd</string></array>
        <key>public.mime-type</key>
        <array><string>text/markdown</string><string>text/x-markdown</string></array>
      </dict>
    </dict>
  </array>

  <!-- Custom URL scheme neom:// -->
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>NeoM Note Link</string>
      <key>CFBundleURLSchemes</key><array><string>neom</string></array>
    </dict>
  </array>

  <!-- Network access for the OSS / AI proxy -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key><false/>
    <key>NSExceptionDomains</key>
    <dict>
      <key>m.zhengl.vip</key>
      <dict><key>NSIncludesSubdomains</key><true/><key>NSExceptionAllowsInsecureHTTPLoads</key><false/></dict>
      <key>mdadmin.zhengl.vip</key>
      <dict><key>NSIncludesSubdomains</key><true/><key>NSExceptionAllowsInsecureHTTPLoads</key><false/></dict>
    </dict>
  </dict>
  <key>NSMicrophoneUsageDescription</key><string>NeoM 需要使用麦克风进行语音输入与语音转文字。</string>
  <key>NSCameraUsageDescription</key><string>NeoM 需要使用摄像头拍摄图片并插入笔记。</string>
</dict>
</plist>
`

/* ----------------------------------------------------------------- asar */
/** Minimal asar writer: header = 8-byte prefix + uint32 jsonSize + json, then blocks. */
function buildAsar(files, outFile) {
  const entries = { files: {} }
  const blocks = []
  let offset = 0

  const addFile = (relPath) => {
    const parts = relPath.split('/')
    let cur = entries
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur.files[parts[i]]) cur.files[parts[i]] = { files: {} }
      cur = cur.files[parts[i]]
    }
    const name = parts[parts.length - 1]
    const buf = fs.readFileSync(relPath)
    cur.files[name] = { size: buf.length, offset: String(offset) }
    blocks.push(buf)
    offset += buf.length
  }

  for (const f of files) addFile(f)
  const header = JSON.stringify({ files: entries.files })
  const headerBuf = Buffer.from(header, 'utf8')
  const sizeBuf = Buffer.alloc(8)
  sizeBuf.writeUInt32LE(headerBuf.length + 8, 4)

  fs.writeFileSync(outFile, Buffer.concat([sizeBuf, headerBuf, ...blocks]))
  return fs.statSync(outFile).size
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, base, out)
    else out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

/* ------------------------------------------------------------------ main */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

function zipDir(srcDir, outZip) {
  // Compress-Archive is available on Windows PowerShell 5.1+
  const ps = `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${outZip}' -Force -CompressionLevel Optimal`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' })
}

const main = () => {
  if (!fs.existsSync(WEB)) throw new Error(`web bundle missing: ${WEB} (run prepare-web.mjs first)`)
  fs.mkdirSync(OUT, { recursive: true })

  // Bundle the Electron app once (identical for both arches).
  const stage = path.join(OUT, '.stage')
  fs.rmSync(stage, { recursive: true, force: true })
  fs.mkdirSync(stage, { recursive: true })

  const appFiles = ['main.js', 'preload.js', 'loader.html']
  for (const f of appFiles) {
    if (!fs.existsSync(path.join(ROOT, f))) throw new Error(`missing ${f}`)
    fs.copyFileSync(path.join(ROOT, f), path.join(stage, f))
  }
  copyDir(WEB, path.join(stage, 'app-web'))

  const pkgOut = {
    name: 'neom-desktop',
    productName: 'NeoM',
    version: VERSION,
    description: 'NeoM — AI 原生 Markdown 知识库桌面端',
    main: 'main.js',
    author: pkg.author || 'NeoM'
  }
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkgOut, null, 2))

  const iconIcns = path.join(ROOT, 'assets', 'icon.icns')
  const asarPath = path.join(stage, 'app.asar')
  const asarSize = buildAsar(walk(stage).filter((f) => f !== 'app.asar'), asarPath)
  log(`app.asar ${(asarSize / 1048576).toFixed(2)} MB`)

  for (const arch of ARCHES) {
    const zip = path.join(ELECTRON_DIR, `electron-darwin-${arch}.zip`)
    if (!fs.existsSync(zip)) throw new Error(`missing electron darwin ${arch}: ${zip}`)

    const unpack = path.join(OUT, `.extract-${arch}`)
    fs.rmSync(unpack, { recursive: true, force: true })
    fs.mkdirSync(unpack, { recursive: true })
    execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -Path '${zip}' -DestinationPath '${unpack}' -Force`],
      { stdio: 'inherit' })

    const srcApp = path.join(unpack, 'Electron.app')
    if (!fs.existsSync(srcApp)) throw new Error(`Electron.app not found after extract (${arch})`)

    const appName = `NeoM.app`
    const destApp = path.join(OUT, arch, appName)
    fs.rmSync(path.join(OUT, arch), { recursive: true, force: true })
    fs.mkdirSync(path.join(OUT, arch), { recursive: true })
    copyDir(srcApp, destApp)

    const contents = path.join(destApp, 'Contents')
    const macos = path.join(contents, 'MacOS')
    const res = path.join(contents, 'Resources')

    // Rename helper apps / executables Electron ships (Electron Helper*.app)
    const renameHelpers = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name.startsWith('Electron Helper') && e.name.endsWith('.app')) {
            const newName = e.name.replace(/^Electron/, 'NeoM')
            const np = path.join(dir, newName)
            fs.renameSync(p, np)
            // inside: Contents/MacOS/<old helper binary> -> rename too
            const helperMac = path.join(np, 'Contents', 'MacOS')
            if (fs.existsSync(helperMac)) {
              for (const h of fs.readdirSync(helperMac)) {
                const nh = h.replace(/^Electron/, 'NeoM')
                if (nh !== h) fs.renameSync(path.join(helperMac, h), path.join(helperMac, nh))
              }
            }
            const helperPlist = path.join(np, 'Contents', 'Info.plist')
            if (fs.existsSync(helperPlist)) {
              let t = fs.readFileSync(helperPlist, 'utf8')
              t = t.replace(/(<string>)(Electron)( Helper[^<]*)(<\/string>)/g, '$1NeoM$3$4')
              t = t.replace(/(<key>CFBundleExecutable<\/key>\s*<string>)Electron/g, '$1NeoM')
              t = t.replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)com\.github\.Electron/g, '$1vip.zhengl.neom')
              fs.writeFileSync(helperPlist, t)
            }
            continue
          }
          renameHelpers(p)
        }
      }
    }
    renameHelpers(contents)

    // Main executable: Electron.app/Contents/MacOS/Electron -> NeoM
    const mainExe = path.join(macos, 'Electron')
    if (fs.existsSync(mainExe)) fs.renameSync(mainExe, path.join(macos, 'NeoM'))

    // Icon
    if (fs.existsSync(iconIcns)) fs.copyFileSync(iconIcns, path.join(res, 'icon.icns'))

    // Our app payload replaces Electron's default_app.asar
    const defaultAsar = path.join(res, 'default_app.asar')
    if (fs.existsSync(defaultAsar)) fs.rmSync(defaultAsar)
    fs.copyFileSync(asarPath, path.join(res, 'app.asar'))
    fs.rmSync(path.join(res, 'app'), { recursive: true, force: true })

    // Info.plist last so ours wins
    fs.writeFileSync(path.join(contents, 'Info.plist'), infoPlist({ arch }))

    // Strip quarantine-irrelevant cruft to keep the zip small
    fs.rmSync(path.join(contents, '_CodeSignature'), { recursive: true, force: true })

    const zipOut = path.join(OUT, `NeoM-${VERSION}-mac-${arch}.zip`)
    fs.rmSync(zipOut, { force: true })
    zipDir(path.join(OUT, arch), zipOut)
    const mb = (fs.statSync(zipOut).size / 1048576).toFixed(1)
    log(`${path.basename(zipOut)} ${mb} MB`)

    fs.rmSync(unpack, { recursive: true, force: true })
  }

  fs.rmSync(stage, { recursive: true, force: true })
  log('done')
}

main()
