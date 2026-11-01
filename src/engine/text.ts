import { premultiply, toStoredTile, type StoredTile } from './memory'
import type { Point } from './selection'
import { homography, placed, type Quad, type Rect } from './smartObject'
import { TILE_SIZE, tileKey } from './tiles'
import type { Warp } from './warp'

// Text (decision 81): a smart object (see smartObject.ts) that also keeps its words, so its source can always be made
// again. That is how it stays sharp: after a transform, the source is written again as big as it will show, instead of
// being stretched. And since a drawing keeps the source, a text whose font isn't on this computer still shows and
// transforms as it was, and only editing it changes the font.
//
// Its words are laid out in a space of their own, where 1 is a pixel of the font's size. The first line starts at (0, 0)
// or, for a text in the center or on the right, has its middle or its end there. "box" is the rectangle of that space
// with all of the letters, the one the smart object's corners show.

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const
export type TextAlign = (typeof TEXT_ALIGNS)[number]

export const MIN_TEXT_SIZE = 8
export const MAX_TEXT_SIZE = 2000
const MAX_WORDS = 10000 // characters

export type TextStyle = {
  font: string
  size: number
  color: string
  isBold: boolean
  isItalic: boolean
  align: TextAlign
}

export type TextData = TextStyle & { words: string; box: Rect }

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Inter',
  size: 64,
  color: '#000000',
  isBold: false,
  isItalic: false,
  align: 'left',
}

const LINE_SPACING = 1.25 // from one line to the next, in font sizes
const MAX_SOURCE_SIDE = 16384 // how many pixels a source goes up to each way, however big the text is made
const STRETCH_SAMPLES = 8 // how many times each way a bent text is measured
const TOLERANCE = 0.02 // a source this much too big or too small for the way the text shows is still sharp

export const lineHeightOf = (size: number) => Math.round(size * LINE_SPACING)

// The font as CSS writes it, with one that is always there for when it isn't
export const fontFamilies = (font: string) => `"${font.replaceAll('"', '')}", sans-serif`

export function cssFont({ font, size, isBold, isItalic }: TextStyle) {
  return `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${size}px ${fontFamilies(font)}`
}

function prepare(context: OffscreenCanvasRenderingContext2D, style: TextStyle) {
  context.font = cssFont(style)
  context.textRendering = 'geometricPrecision' // letters keep their proportions at any size
  context.fontKerning = 'normal'
}

let ruler: OffscreenCanvasRenderingContext2D | null = null // made when first used: reading a file needs no canvas

// Where each line goes. "area" is where the lines are, as the text box being typed in shows them; "box" also has what
// sticks out of them, like the tail of an italic letter
export function layoutText(words: string, style: TextStyle) {
  const measurer = (ruler ??= new OffscreenCanvas(1, 1).getContext('2d')!)
  prepare(measurer, style)
  const lineHeight = lineHeightOf(style.size)
  const measured = words.split('\n').map(line => ({ line, metrics: measurer.measureText(line) }))
  const { fontBoundingBoxAscent, fontBoundingBoxDescent } = measured[0].metrics
  const ascent = Math.round(fontBoundingBoxAscent)
  const descent = Math.round(fontBoundingBoxDescent)
  const baseline = Math.floor((lineHeight - ascent - descent) / 2) + ascent // as CSS places a line in its height
  const startOf = (width: number) => (style.align === 'left' ? 0 : style.align === 'center' ? -width / 2 : -width)
  const lines = measured.map(({ line, metrics }, index) => ({
    words: line,
    x: startOf(metrics.width),
    y: index * lineHeight + baseline,
    width: metrics.width,
  }))
  const left = Math.min(...lines.map(line => line.x))
  const right = Math.max(...lines.map(line => line.x + line.width))
  const height = lines.length * lineHeight
  const area: Rect = { x: left, y: 0, width: right - left, height }
  let inkLeft = left
  let inkTop = 0
  let inkRight = right
  let inkBottom = height
  measured.forEach(({ metrics }, index) => {
    const { x, y } = lines[index]
    inkLeft = Math.min(inkLeft, x - metrics.actualBoundingBoxLeft)
    inkRight = Math.max(inkRight, x + metrics.actualBoundingBoxRight)
    inkTop = Math.min(inkTop, y - metrics.actualBoundingBoxAscent)
    inkBottom = Math.max(inkBottom, y + metrics.actualBoundingBoxDescent)
  })
  // On whole pixels, with one more on each side for a letter's soft edge
  const x = Math.floor(inkLeft) - 1
  const y = Math.floor(inkTop) - 1
  const box: Rect = { x, y, width: Math.ceil(inkRight) + 1 - x, height: Math.ceil(inkBottom) + 1 - y }
  return { lines, area, box, lineHeight }
}

// How much a text is made bigger or smaller on the paper at these corners, the most each way. A source of that size
// shows each of its pixels as one of the paper. With perspective or a mesh some parts show smaller than that
export function stretchOf(box: Rect, corners: Quad, warp?: Warp) {
  const matrix = homography(box, corners)
  const steps = warp ? STRETCH_SAMPLES : 1
  const at = (column: number, row: number) =>
    placed(box, matrix, warp, {
      x: box.x + (box.width * column) / steps,
      y: box.y + (box.height * row) / steps,
    })
  const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
  let x = 0
  let y = 0
  for (let column = 0; column <= steps; column++) {
    for (let row = 0; row <= steps; row++) {
      if (column < steps) x = Math.max(x, (length(at(column, row), at(column + 1, row)) * steps) / box.width)
      if (row < steps) y = Math.max(y, (length(at(column, row), at(column, row + 1)) * steps) / box.height)
    }
  }
  return { x, y }
}

// How many pixels the source of a text has each way, at this stretch
const sourceSide = (side: number, stretch: number) => Math.max(1, Math.min(MAX_SOURCE_SIDE, Math.round(side * stretch)))

// Whether a text's source is too small or too big now for how it shows, so that it should be written again
export function needsNewSource(text: TextData, bounds: Rect, corners: Quad, warp?: Warp) {
  const stretch = stretchOf(text.box, corners, warp)
  const width = sourceSide(text.box.width, stretch.x)
  const height = sourceSide(text.box.height, stretch.y)
  return Math.abs(width / bounds.width - 1) > TOLERANCE || Math.abs(height / bounds.height - 1) > TOLERANCE
}

// Write a text as the tiles of a smart object's source, in one tile at a time, as sharp as the letters can be at this
// stretch, with the source's top left corner at the paper's. It is on the paper's grid of tiles like any source
export async function textTiles(text: TextData, stretch: Point, pace: () => Promise<void>) {
  const { box } = text
  const { lines, lineHeight } = layoutText(text.words, text)
  const width = sourceSide(box.width, stretch.x)
  const height = sourceSide(box.height, stretch.y)
  const scaleX = width / box.width
  const scaleY = height / box.height
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  prepare(context, text)
  context.fillStyle = text.color
  const tiles = new Map<string, StoredTile>()
  for (let row = 0; row * TILE_SIZE < height; row++) {
    for (let column = 0; column * TILE_SIZE < width; column++) {
      await pace()
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, TILE_SIZE, TILE_SIZE)
      const left = column * TILE_SIZE + box.x * scaleX
      const top = row * TILE_SIZE + box.y * scaleY
      context.setTransform(scaleX, 0, 0, scaleY, -left, -top)
      for (const line of lines) {
        // A letter never goes further than this from its line
        const nearest = top / scaleY - 2 * lineHeight
        const furthest = (top + TILE_SIZE) / scaleY + 2 * lineHeight
        if (line.y > nearest && line.y < furthest) context.fillText(line.words, line.x, line.y)
      }
      const pixels = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data
      premultiply(pixels)
      const tile = toStoredTile(pixels)
      if (tile) tiles.set(tileKey(column, row), tile)
    }
  }
  return { tiles, bounds: { x: 0, y: 0, width, height } }
}

// A layer's name, from its words
export const nameOfWords = (words: string) => words.trim().split('\n')[0].slice(0, 32).trim()

// Text from a file, or null when it isn't one that makes sense: its layer then stays a smart object
export function textInProject(value: unknown): TextData | null {
  if (typeof value !== 'object' || value === null) return null
  const { words, box, font, size, color, isBold, isItalic, align } = value as Partial<TextData>
  const isGood =
    typeof words === 'string' &&
    words.length <= MAX_WORDS &&
    typeof font === 'string' &&
    font.length > 0 &&
    font.length <= 200 &&
    Number.isInteger(size) &&
    size! >= MIN_TEXT_SIZE &&
    size! <= MAX_TEXT_SIZE &&
    typeof color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(color) &&
    typeof isBold === 'boolean' &&
    typeof isItalic === 'boolean' &&
    TEXT_ALIGNS.includes(align as TextAlign) &&
    typeof box === 'object' &&
    box !== null &&
    [box.x, box.y, box.width, box.height].every(Number.isInteger) &&
    box.width > 0 &&
    box.height > 0
  return isGood ? ({ words, box, font, size, color, isBold, isItalic, align } as TextData) : null
}
