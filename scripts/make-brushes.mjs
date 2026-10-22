// Makes the brushes that come with Lydia: draws each tip with a little math and writes it, with its settings, as a
// .lydbrush file in src/brushes (the format is explained in src/engine/brushFile.ts). Run it from the project folder
// with "node scripts/make-brushes.mjs" after changing a brush here. The random parts use a fixed seed, so running it
// again writes the same files
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const OUT = 'src/brushes'

// ----- A small PNG writer: grayscale, 8 bits per pixel -----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// A PNG chunk: its length, its type, its data and a checksum of the type and the data
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(size, gray) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per pixel
  header[9] = 0 // grayscale
  // Each row starts with the byte 0: the row is stored as it is, without a filter
  const rows = Buffer.alloc(size * (size + 1))
  for (let y = 0; y < size; y++) gray.copy(rows, y * (size + 1) + 1, y * size, (y + 1) * size)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ----- Drawing tips -----

const clamp01 = value => Math.min(1, Math.max(0, value))

// Random numbers from a seed, the same every time
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Smooth random bumps, "cell" pixels apart: random values on a grid, blended between the grid points
function smoothNoise(size, cell, next) {
  const cells = Math.ceil(size / cell) + 2
  const values = Array.from({ length: cells * cells }, next)
  const smooth = t => t * t * (3 - 2 * t)
  return (x, y) => {
    const gx = x / cell
    const gy = y / cell
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const tx = smooth(gx - x0)
    const ty = smooth(gy - y0)
    const at = (cx, cy) => values[cy * cells + cx]
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
    return top * (1 - ty) + bottom * ty
  }
}

// A square tip of "size" pixels. "paintAt" says how much paint (0 to 1) goes at each point, measured from the center.
// In the picture, black paints and white doesn't
function drawTip(size, paintAt) {
  const gray = Buffer.alloc(size * size)
  const center = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const paint = clamp01(paintAt(x + 0.5 - center, y + 0.5 - center, x, y))
      gray[y * size + x] = Math.round(255 * (1 - paint))
    }
  }
  return encodePng(size, gray)
}

// A shape with a sharp edge, smoothed over one pixel. "distance" is how far outside the shape the point is
const edge = distance => clamp01(0.5 - distance)

const softRound = drawTip(128, (x, y) => (1 - Math.hypot(x, y) / 64) / 0.5) // full up to half the radius, then fading

const hardRound = drawTip(128, (x, y) => edge(Math.hypot(x, y) - 63))

const airbrush = drawTip(128, (x, y) => {
  // A bell curve that reaches zero at the edge
  const fadeAtEdge = Math.exp(-4.5)
  return (Math.exp(-4.5 * (Math.hypot(x, y) / 64) ** 2) - fadeAtEdge) / (1 - fadeAtEdge)
})

const chalkRandom = random(11)
const chalkBumps = smoothNoise(256, 7, chalkRandom)
const phases = [chalkRandom(), chalkRandom(), chalkRandom()].map(p => p * Math.PI * 2)
const chalk = drawTip(256, (x, y, column, row) => {
  // An uneven blob, full of small holes
  const turn = Math.atan2(y, x)
  const radius =
    112 *
    (1 +
      0.1 * Math.sin(3 * turn + phases[0]) +
      0.06 * Math.sin(5 * turn + phases[1]) +
      0.04 * Math.sin(9 * turn + phases[2]))
  const grain = clamp01((0.65 * chalkBumps(column, row) + 0.35 * chalkRandom()) * 2 - 0.55)
  return edge(Math.hypot(x, y) - Math.min(radius, 126)) * grain
})

const calligraphy = drawTip(128, (x, y) => {
  // A thin ellipse. Its distance to a point is roughly how far the point is outside it, divided by how fast that changes
  const [width, height] = [62, 11]
  const outside = Math.hypot(x / width, y / height) - 1
  const change = Math.hypot(x / width ** 2, y / height ** 2) / Math.max(1e-6, Math.hypot(x / width, y / height))
  return edge(outside / change)
})

const dashes = drawTip(128, (x, y) => {
  // A short bar with round ends
  const half = 15.5
  return edge(Math.hypot(Math.max(Math.abs(x) - (62 - half), 0), y) - half)
})

// ----- The brushes -----

const usual = {
  spacing: 0.1,
  angle: 0,
  followStroke: false,
  angleJitter: 0,
  scatter: 0,
  flow: 1,
  pressureSize: true,
  pressureFlow: false,
}

const brushes = {
  'soft-round': { name: 'Soft round', tip: softRound },
  'hard-round': { name: 'Hard round', spacing: 0.08, tip: hardRound },
  airbrush: { name: 'Airbrush', spacing: 0.05, flow: 0.1, pressureSize: false, pressureFlow: true, tip: airbrush },
  chalk: { name: 'Chalk', spacing: 0.15, angleJitter: 1, scatter: 0.05, flow: 0.9, pressureFlow: true, tip: chalk },
  calligraphy: { name: 'Calligraphy', spacing: 0.02, angle: 315, tip: calligraphy },
  dashes: { name: 'Dashes', spacing: 1.6, followStroke: true, pressureSize: false, tip: dashes },
}

mkdirSync(OUT, { recursive: true })
for (const [file, { name, tip, ...settings }] of Object.entries(brushes)) {
  const brush = { format: 'lydia-brush', version: 1, name, ...usual, ...settings }
  brush.tip = 'data:image/png;base64,' + tip.toString('base64')
  writeFileSync(`${OUT}/${file}.lydbrush`, JSON.stringify(brush, null, 2) + '\n')
  console.log(`${file}.lydbrush: ${Math.round(tip.length / 1024)} KB of tip`)
}
