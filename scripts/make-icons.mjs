#!/usr/bin/env node
/**
 * make-icons.mjs — generate NeoM app icons with ZERO native dependencies.
 *
 * Renders a raster gradient "N" mark in plain Node (no sharp/canvas), encodes
 * PNG by hand (zlib), then assembles:
 *   assets/icon.svg                 vector master (source of truth for designers)
 *   assets/icon.png                 1024x1024 (Linux / electron-builder fallback)
 *   assets/icon.ico                 Windows multi-size ICO (PNG compressed, Vista+)
 *   assets/icon.icns                macOS multi-size ICNS
 *   assets/icons/<size>x<size>.png  Linux hicolor set
 *
 * Usage: node scripts/make-icons.mjs [--out ../../assets]
 *
 * Design: rounded square, diagonal gradient #2f6fed -> #6aa6ff, white "N".
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const outArgIdx = argv.indexOf('--out')
const OUT_DIR = resolve(here, '..', 'assets')
const outDir = outArgIdx >= 0 && argv[outArgIdx + 1] ? resolve(process.cwd(), argv[outArgIdx + 1]) : OUT_DIR

/* ------------------------------------------------------------------ colours */
const C1 = [0x2f, 0x6f, 0xed] // #2f6fed
const C2 = [0x6a, 0xa6, 0xff] // #6aa6ff
const INK = [0xff, 0xff, 0xff]

/* --------------------------------------------------------------- rasterizer */
/** Signed coverage test: point inside rounded rect (normalised 0..1 coords) */
function inRoundedRect(x, y, radius) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false
  const r = radius
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r + 1e-9
}

/** Ray-cast point-in-polygon for the "N" glyph (normalised coords) */
function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/** The letter N: two stems + one diagonal band, as three quads. */
function nGlyphQuads() {
  const x0 = 0.315
  const x1 = 0.685
  const y0 = 0.275
  const y1 = 0.725
  const w = 0.085
  return [
    // left stem
    [
      [x0, y0],
      [x0 + w, y0],
      [x0 + w, y1],
      [x0, y1]
    ],
    // right stem
    [
      [x1 - w, y0],
      [x1, y0],
      [x1, y1],
      [x1 - w, y1]
    ],
    // diagonal (top-left inner -> bottom-right inner)
    [
      [x0 + w * 0.35, y0],
      [x0 + w * 1.35, y0],
      [x1 - w * 0.35, y1],
      [x1 - w * 1.35, y1]
    ]
  ]
}

const GLYPH = nGlyphQuads()

/** Render one square RGBA buffer at `size`. */
function render(size) {
  const buf = Buffer.alloc(size * size * 4, 0)
  const radius = 0.225 // corner radius ratio (Win11-ish squircle feel)
  const SS = 4 // supersampling grid
  const step = 1 / (size * SS)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgCov = 0
      let inkCov = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) * step
          const y = (py * SS + sy + 0.5) * step
          if (!inRoundedRect(x, y, radius)) continue
          bgCov++
          let ink = false
          for (const quad of GLYPH) {
            if (inPolygon(x, y, quad)) {
              ink = true
              break
            }
          }
          if (ink) inkCov++
        }
      }
      const total = SS * SS
      const a = bgCov / total
      if (a <= 0) continue
      const inkRatio = bgCov ? inkCov / bgCov : 0

      // diagonal gradient, clipped to the rounded square
      const gx = px / (size - 1)
      const gy = py / (size - 1)
      const t = Math.min(1, Math.max(0, (gx * 0.62 + gy * 0.38)))
      const base = [
        Math.round(C1[0] + (C2[0] - C1[0]) * t),
        Math.round(C1[1] + (C2[1] - C1[1]) * t),
        Math.round(C1[2] + (C2[2] - C1[2]) * t)
      ]
      const rgb = [
        Math.round(base[0] + (INK[0] - base[0]) * inkRatio),
        Math.round(base[1] + (INK[1] - base[1]) * inkRatio),
        Math.round(base[2] + (INK[2] - base[2]) * inkRatio)
      ]
      const o = (py * size + px) * 4
      buf[o] = rgb[0]
      buf[o + 1] = rgb[1]
      buf[o + 2] = rgb[2]
      buf[o + 3] = Math.round(a * 255)
    }
  }
  return buf
}

/* -------------------------------------------------------------- PNG encoder */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0 // filter: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }
  const idat = deflateSync(raw, { level: 9 })

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------------------------------------------------------------- ICO / ICNS */
function encodeICO(images) {
  // images: [{ size, png }] — PNG-compressed entries (supported by Windows Vista+)
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = 6 + count * 16
  for (const img of images) {
    const e = Buffer.alloc(16)
    e[0] = img.size >= 256 ? 0 : img.size
    e[1] = img.size >= 256 ? 0 : img.size
    e[2] = 0 // palette
    e[3] = 0 // reserved
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(img.png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += img.png.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

const ICNS_TYPES = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10'
}

function encodeICNS(images) {
  const parts = []
  for (const img of images) {
    const type = ICNS_TYPES[img.size]
    if (!type) continue
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(img.png.length + 8, 4)
    parts.push(head, img.png)
  }
  const body = Buffer.concat(parts)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

/* --------------------------------------------------------------------- SVG */
function svgSource() {
  const quads = GLYPH.map((q) => 'M' + q.map(([x, y]) => `${(x * 1024).toFixed(1)} ${(y * 1024).toFixed(1)}`).join(' L') + ' Z')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="NeoM">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2f6fed"/>
      <stop offset="100%" stop-color="#6aa6ff"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="230" ry="230" fill="url(#g)"/>
  <g fill="#ffffff">
${quads.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
</svg>
`
}

/* -------------------------------------------------------------------- main */
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const rendered = new Map()
for (const size of SIZES) rendered.set(size, encodePNG(render(size), size))

mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'icons'), { recursive: true })

writeFileSync(join(outDir, 'icon.svg'), svgSource(), 'utf8')
writeFileSync(join(outDir, 'icon.png'), rendered.get(1024))
for (const size of SIZES) {
  writeFileSync(join(outDir, 'icons', `${size}x${size}.png`), rendered.get(size))
}
writeFileSync(
  join(outDir, 'icon.ico'),
  encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: rendered.get(size) })))
)
writeFileSync(
  join(outDir, 'icon.icns'),
  encodeICNS([16, 32, 64, 128, 256, 512, 1024].map((size) => ({ size, png: rendered.get(size) })))
)

const list = ['icon.svg', 'icon.png', 'icon.ico', 'icon.icns'].map((f) => `${f} (${(statSync(join(outDir, f)).size / 1024).toFixed(1)} KB)`)
console.log('[make-icons] generated in', outDir)
for (const l of list) console.log('  -', l)
console.log('  -', `icons/ (${SIZES.length} png sizes)`)
