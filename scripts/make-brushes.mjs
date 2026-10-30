// Makes the brushes that come with Lydia: draws each tip with a little math and writes it, with its settings, as a
// .lydbrush file in src/brushes (the format is explained in src/engine/brushFile.ts), and the paper grains that come
// with Lydia as PNG images in src/grains. Run it from the project folder
// with "node scripts/make-brushes.mjs" after changing a brush here. The random parts use a fixed seed, so running it
// again writes the same files
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const OUT = 'src/brushes'
const GRAINS_OUT = 'src/grains'

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

// Lydia works out the Pixel brush's tip for each size (src/engine/pixelTip.ts). This picture is only for versions of
// Lydia without pixel brushes, which paint with it as a hard round brush
const pixelTip = drawTip(64, (x, y) => (Math.hypot(x, y) <= 32 ? 1 : 0))

// A pencil's lead: round, its edge softened over a few pixels
const pencil = drawTip(64, (x, y) => (30 - Math.hypot(x, y)) / 4)

// ----- Paper grains -----

// The paper grains that come with Lydia, offered in the Brush Designer (src/grains) and used by the brushes below.
// A grain repeats across the paper, so each one joins up with itself at its edges. In the picture, darker is higher:
// the paint reaches the dark places first, and the light ones (the grooves) only with more pressure
const GRAIN_SIZE = 256

// Smooth random bumps that repeat every GRAIN_SIZE pixels: "cells" cells across, each corner of the grid wrapping
// around to the other side
function wrappingNoise(cells, next) {
  const values = Array.from({ length: cells * cells }, next)
  const smooth = t => t * t * (3 - 2 * t)
  const cell = GRAIN_SIZE / cells
  return (x, y) => {
    const gx = x / cell
    const gy = y / cell
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const tx = smooth(gx - x0)
    const ty = smooth(gy - y0)
    const at = (cx, cy) => values[(cy % cells) * cells + (cx % cells)]
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
    return top * (1 - ty) + bottom * ty
  }
}

// Bumps of several sizes added up: [cells across, weight] for each
function layeredNoise(layers, next) {
  const noises = layers.map(([cells, weight]) => [wrappingNoise(cells, next), weight])
  return (x, y) => noises.reduce((sum, [noise, weight]) => sum + noise(x, y) * weight, 0)
}

// A grain from how high the paper is at each point. The heights are spread evenly from the lowest to the highest
// (each pixel takes its rank among all of them), so that each grain's depth means the same: at 50%, half of the paper
// is out of reach of light pressure
function drawGrain(heightAt) {
  const count = GRAIN_SIZE * GRAIN_SIZE
  const heights = new Float64Array(count)
  for (let y = 0; y < GRAIN_SIZE; y++) {
    for (let x = 0; x < GRAIN_SIZE; x++) heights[y * GRAIN_SIZE + x] = heightAt(x, y)
  }
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => heights[a] - heights[b])
  const gray = Buffer.alloc(count)
  order.forEach((pixel, rank) => (gray[pixel] = Math.round(255 * (1 - rank / (count - 1)))))
  return encodePng(GRAIN_SIZE, gray)
}

const paperRandom = random(21)
const paperNoise = layeredNoise(
  [
    [32, 0.1],
    [64, 0.3],
    [128, 0.6],
  ],
  paperRandom,
)
const paperGrain = drawGrain((x, y) => paperNoise(x, y) + 0.15 * paperRandom())

const roughNoise = layeredNoise(
  [
    [8, 0.35],
    [16, 0.3],
    [32, 0.2],
    [64, 0.15],
  ],
  random(22),
)
const roughGrain = drawGrain(roughNoise)

// Woven threads 8 pixels wide, over and under each other: each square of 8×8 is the top of a thread across or of a
// thread down, by turns, rounded across the thread, with a little unevenness
const THREAD = 8
const canvasNoise = wrappingNoise(64, random(23))
const canvasGrain = drawGrain((x, y) => {
  const across = (Math.floor(x / THREAD) + Math.floor(y / THREAD)) % 2 === 0
  const sideways = across ? y % THREAD : x % THREAD
  return Math.sin((Math.PI * (sideways + 0.5)) / THREAD) + 0.3 * canvasNoise(x, y)
})

const noiseRandom = random(24)
const noiseGrain = drawGrain(() => noiseRandom())

const grains = { paper: paperGrain, rough: roughGrain, canvas: canvasGrain, noise: noiseGrain }

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
  pixel: { name: 'Pixel', spacing: 0.01, pixel: 'round', tip: pixelTip },
  airbrush: { name: 'Airbrush', spacing: 0.05, flow: 0.1, pressureSize: false, pressureFlow: true, tip: airbrush },
  // The paper's grain: pressed lightly, only its tops take the lead; pressed harder, its grooves fill too. Washed, so
  // going over the same place again doesn't fill them
  pencil: {
    name: 'Pencil',
    spacing: 0.05,
    flow: 0.85,
    wash: true,
    pressureFlow: true,
    grainDepth: 0.75,
    grainScale: 1,
    tip: pencil,
    grain: paperGrain,
  },
  chalk: { name: 'Chalk', spacing: 0.15, angleJitter: 1, scatter: 0.05, flow: 0.9, pressureFlow: true, tip: chalk },
  calligraphy: { name: 'Calligraphy', spacing: 0.02, angle: 315, tip: calligraphy },
  dashes: { name: 'Dashes', spacing: 1.6, followStroke: true, pressureSize: false, tip: dashes },
  // Filtered noise (src/engine/noiseDabs.ts): the same noise all along the stroke, stretched into streaks that turn
  // with the stroke, and washed so they show inside it
  bristles: {
    name: 'Bristles',
    spacing: 0.04,
    followStroke: true,
    wash: true,
    noiseAmount: 0.9,
    noiseGrain: 3,
    noiseLayers: 4,
    noiseStretch: 12,
    noiseContrast: 2,
    noisePerStroke: true,
    tip: hardRound,
  },
  // New noise for each dab, with dabs far apart, turned and scattered: blotches, each one different
  sponge: {
    name: 'Sponge',
    spacing: 0.35,
    angleJitter: 1,
    scatter: 0.25,
    pressureSize: false,
    pressureFlow: true,
    noiseAmount: 1,
    noiseGrain: 6,
    noiseLayers: 3,
    noiseContrast: 2.5,
    tip: softRound,
  },
}

mkdirSync(OUT, { recursive: true })
for (const [file, { name, tip, grain, ...settings }] of Object.entries(brushes)) {
  const brush = { format: 'lydia-brush', version: 1, name, ...usual, ...settings }
  brush.tip = 'data:image/png;base64,' + tip.toString('base64')
  if (grain) brush.grain = 'data:image/png;base64,' + grain.toString('base64')
  writeFileSync(`${OUT}/${file}.lydbrush`, JSON.stringify(brush, null, 2) + '\n')
  console.log(`${file}.lydbrush: ${Math.round(tip.length / 1024)} KB of tip`)
}

mkdirSync(GRAINS_OUT, { recursive: true })
for (const [file, grain] of Object.entries(grains)) {
  writeFileSync(`${GRAINS_OUT}/${file}.png`, grain)
  console.log(`${file}.png: ${Math.round(grain.length / 1024)} KB`)
}
