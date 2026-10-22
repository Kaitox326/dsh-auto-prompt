/**
 * Filesystem side: where products land, what they are called, and the
 * self-contained placeholder used when the user has not configured a backend
 * yet (so the very first run already shows something instead of an error).
 *
 * @module dsh-auto-prompt/media
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { resolveOutputDir } from './config.js'

const EXT_BY_MEDIA_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const EXT_BY_KIND = { image: 'png', video: 'mp4' }

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * Persist one product and return its absolute path plus byte size.
 * @param {object} cfg
 * @param {'image'|'video'} kind
 * @param {Buffer} data
 * @param {{mediaType?:string, ext?:string, suffix?:string}} [options]
 */
export async function saveProduct(cfg, kind, data, options = {}) {
  const dir = resolveOutputDir(cfg)
  await mkdir(dir, { recursive: true })
  const ext = options.ext || EXT_BY_MEDIA_TYPE[options.mediaType] || EXT_BY_KIND[kind] || 'bin'
  const prefix = (cfg.filenamePrefix || 'auto').replace(/[^\w.-]+/g, '-')
  const suffix = options.suffix ? `-${options.suffix}` : ''
  const name = `${prefix}-${kind}-${stamp()}-${randomBytes(2).toString('hex')}${suffix}.${ext}`
  const filePath = path.join(dir, name)
  await writeFile(filePath, data)
  return { path: filePath, bytes: data.length, mediaType: options.mediaType || null }
}

/* ------------------------------------------------------------------ PNG 占位图 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/**
 * A real, decodable PNG rendered without any dependency: a two-tone diagonal
 * gradient with a soft vignette. Used for demo mode so the attachment pipeline,
 * the chat image rendering and the file write all get exercised for real.
 * @param {{width?:number, height?:number, seed?:number}} [options]
 * @returns {Buffer}
 */
export function placeholderPng(options = {}) {
  const width = options.width || 768
  const height = options.height || 432
  const seed = options.seed || 0
  const hueA = (seed * 47) % 360
  const hueB = (hueA + 58) % 360

  const raw = Buffer.alloc((width * 3 + 1) * height)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0 // filter: none
    offset += 1
    for (let x = 0; x < width; x += 1) {
      const t = (x / width) * 0.65 + (y / height) * 0.35
      const [r1, g1, b1] = hslToRgb(hueA, 0.52, 0.34)
      const [r2, g2, b2] = hslToRgb(hueB, 0.58, 0.62)
      // diagonal demo stripes, very low contrast
      const stripe = Math.sin((x + y) / 26) > 0.86 ? 12 : 0
      const dx = x / width - 0.5
      const dy = y / height - 0.5
      const vignette = 1 - Math.min(0.42, (dx * dx + dy * dy) * 0.85)
      raw[offset] = Math.min(255, (r1 + (r2 - r1) * t) * vignette + stripe)
      raw[offset + 1] = Math.min(255, (g1 + (g2 - g1) * t) * vignette + stripe)
      raw[offset + 2] = Math.min(255, (b1 + (b2 - b1) * t) * vignette + stripe)
      offset += 3
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
