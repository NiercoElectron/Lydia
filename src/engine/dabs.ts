import type { BrushShape } from './brushFile'

// A brush stroke is a row of "dabs": copies of the brush tip, close enough to look like a continuous line. A pixel
// brush's dabs have whole sizes and sit on the pixels of the paper: their corners (x - size / 2, y - size / 2) are
// whole numbers
export type Dab = {
  x: number
  y: number
  size: number // the tip's longer side, in pixels of the paper
  angle: number // how much the tip is turned, in radians, clockwise
  alpha: number // how much paint it puts down, from 0 to 1
  seed: number // the dab's own random numbers, for brushes with noise (see noiseDabs.ts)
  pressure: number // the pen's pressure there, from 0 to 1, how far it fills the paper's grain (see grain.ts)
}

export type StrokePoint = { x: number; y: number; pressure: number }

// A stroke's ends can be tapered: thinner, fainter or both toward its tips, over this many pixels of the paper from
// its start and before its end, growing evenly to the full size or paint
export const TAPER_THINS = ['size', 'opacity', 'both'] as const
export type TaperThins = (typeof TAPER_THINS)[number]
export type TaperSettings = { start: number; end: number; thins: TaperThins }
export const NO_TAPER: TaperSettings = { start: 0, end: 0, thins: 'size' }
export const MAX_TAPER = 500
// The very tip of a taper still gets this much of the full size or paint, so it isn't cut off
const TAPER_TIP = 0.05

const FULL_TURN = Math.PI * 2
const DEGREES = Math.PI / 180
// How much of the earlier direction is kept at each new point, so that a shaky hand doesn't make the tip wobble
const DIRECTION_MEMORY = 0.6
// Seeds are whole numbers below this, small enough for the graphics card to get them exactly
const SEEDS = 65536

// A pixel brush's size is a whole number of pixels, so the pen's pressure changes it a pixel at a time (a drawn tip's,
// a whole multiple of its picture's longer side, "tipSide")
const wholePixelSize = (size: number, tipSide: number) => Math.max(1, Math.round(size / tipSide)) * tipSide

// Random numbers from a seed (mulberry32): the same seed always gives the same numbers, so that a stroke can be worked
// out again exactly as it was painted (see brush.ts)
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// What else a stroke can be worked out with: its taper, the seed of its random numbers (any, if not given), its
// length along the paper once it is known, after it ended, so its end can be tapered too, and the size of the tip's
// picture, which a drawn pixel tip is painted at a whole multiple of
export type DabPathOptions = {
  taper?: TaperSettings
  seed?: number
  length?: number
  tip?: { width: number; height: number }
}

// Where the dabs of one stroke go, as the pointer passes through its points. "size" is the brush size at full
// pressure. Shared by the brush, which paints the dabs into the tiles, and the brush previews, which draw them on a
// small canvas
export function createDabPath(shape: BrushShape, size: number, options: DabPathOptions = {}) {
  const isPixel = shape.pixel !== 'none'
  const { taper = NO_TAPER, length } = options
  // A pixel dab's width and height, for each pixel of its longer side: a drawn tip's picture may be wider than tall.
  // Its size is a whole multiple of "tipSide" (any whole size for the round tip)
  const isDrawn = shape.pixel === 'drawn' && options.tip !== undefined
  const tipSide = isDrawn ? Math.max(options.tip!.width, options.tip!.height) : 1
  const across = isDrawn ? options.tip!.width / tipSide : 1
  const down = isDrawn ? options.tip!.height / tipSide : 1
  const random = seededRandom(options.seed ?? Math.floor(Math.random() * 2 ** 32))
  let last: StrokePoint | null = null
  let distanceSinceLastDab = 0
  let directionX = 0
  let directionY = 0
  // With "followStroke", the first dab waits until the stroke has a direction
  let waitingDab: StrokePoint | null = null
  let lastDab: Dab | null = null // the latest dab placed
  let isFirstMove = false // a pixel brush's stroke hasn't moved yet (see pastEdge)
  let travelled = 0 // how far along the paper the stroke has gone, to its latest point
  const strokeSeed = Math.floor(random() * SEEDS) // for brushes whose noise changes once per stroke

  // The taper's lengths. Once the stroke's length is known, ends that would overlap (a short stroke) are shortened
  // alike until they meet, so a click, with no length, has none
  let taperStart = taper.start
  let taperEnd = taper.end
  if (length !== undefined && taperStart + taperEnd > length) {
    const share = length / (taperStart + taperEnd)
    taperStart *= share
    taperEnd *= share
  }
  const thinsSize = taper.thins !== 'opacity'
  const thinsOpacity = taper.thins !== 'size'

  // How much of the full size or paint a dab gets at this distance along the stroke, from TAPER_TIP to 1. The end
  // only tapers once the stroke's length is known
  function taperAt(distance: number) {
    let share = 1
    if (taperStart > 0) share = Math.min(share, distance / taperStart)
    if (length !== undefined && taperEnd > 0) share = Math.min(share, (length - distance) / taperEnd)
    return Math.max(TAPER_TIP, share)
  }

  const sizeAt = (pressure: number, taperShare: number) => {
    const dabSize = (shape.pressureSize ? size * pressure : size) * (thinsSize ? taperShare : 1)
    return isPixel ? wholePixelSize(dabSize, tipSide) : dabSize
  }

  // A dab at this point, "along" pixels from the start of the stroke
  function dabAt(x: number, y: number, pressure: number, direction: number, along: number): Dab {
    const taperShare = taperAt(along)
    const dabSize = sizeAt(pressure, taperShare)
    const alpha = (shape.pressureFlow ? shape.flow * pressure : shape.flow) * (thinsOpacity ? taperShare : 1)
    const seed = shape.noisePerStroke ? strokeSeed : Math.floor(random() * SEEDS)
    let angle = shape.angle * DEGREES + (shape.followStroke ? direction : 0)
    if (shape.angleJitter > 0) angle += (random() - 0.5) * shape.angleJitter * FULL_TURN
    if (shape.scatter > 0) {
      // Anywhere in a circle around the point, evenly
      const distance = shape.scatter * dabSize * Math.sqrt(random())
      const toward = random() * FULL_TURN
      x += Math.cos(toward) * distance
      y += Math.sin(toward) * distance
    }
    if (isPixel) {
      // On the pixels of the paper, never turned: the tip's corner goes to the nearest corner between pixels, so an
      // odd size is centered on the pixel under the pen, and an even size on the corner nearest to it
      const width = dabSize * across
      const height = dabSize * down
      const left = Math.round(x - width / 2)
      const top = Math.round(y - height / 2)
      return { x: left + width / 2, y: top + height / 2, size: dabSize, angle: 0, alpha, seed, pressure }
    }
    return { x, y, size: dabSize, angle, alpha, seed, pressure }
  }

  // Add a dab to the stroke, unless it would paint the same pixels as the one before (a pixel brush that moved less
  // than a pixel): that would add nothing, or make those pixels darker with a brush that lets some paint through
  function place(dabs: Dab[], dab: Dab) {
    if (isPixel && lastDab && dab.x === lastDab.x && dab.y === lastDab.y && dab.size === lastDab.size) return
    dabs.push(dab)
    lastDab = dab
  }

  // A pixel brush's dabs are counted from the edge of the pixel the pen was in, so that a dab comes just as the pen
  // enters the next pixel, wherever in its pixel the stroke started. How far the pen at "along" (the place along the
  // longer side, going the way "sign" says) is past the edge of its pixel, for a tip of this size: its corner moves to
  // the next pixel at k + 0.5 + size / 2 (see dabAt)
  function pastEdge(along: number, sign: number, size: number) {
    const corner = along - size / 2 - 0.5
    return sign > 0 ? corner - Math.floor(corner) : Math.ceil(corner) - corner
  }

  // The stroke starts at this point
  function start(point: StrokePoint): Dab[] {
    last = point
    distanceSinceLastDab = 0
    isFirstMove = true
    lastDab = null
    const dabs: Dab[] = []
    if (shape.followStroke) waitingDab = point
    else place(dabs, dabAt(point.x, point.y, point.pressure, 0, 0))
    return dabs
  }

  // The stroke goes on through these points: dabs along the lines between them, one every "spacing" pixels
  function moveTo(points: StrokePoint[]): Dab[] {
    const dabs: Dab[] = []
    for (const point of points) {
      if (!last) break
      const dx = point.x - last.x
      const dy = point.y - last.y
      // A pixel brush measures along the longer side, so that a straight line paints one pixel in each column (or row)
      // with no extra pixels at its steps, as pixel artists draw lines
      const distance = isPixel ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy)
      if (distance === 0) continue
      directionX = directionX * DIRECTION_MEMORY + dx
      directionY = directionY * DIRECTION_MEMORY + dy
      const direction = Math.atan2(directionY, directionX)
      if (waitingDab) {
        place(dabs, dabAt(waitingDab.x, waitingDab.y, waitingDab.pressure, direction, 0))
        waitingDab = null
      }

      const spacing = Math.max(1, sizeAt(point.pressure, taperAt(travelled)) * shape.spacing)
      // A pixel brush starts counting from the edge of the pixel the stroke started in, along the longer side of its
      // first move
      if (isPixel && isFirstMove) {
        const isAcross = Math.abs(dx) >= Math.abs(dy)
        distanceSinceLastDab = pastEdge(
          isAcross ? last.x : last.y,
          Math.sign(isAcross ? dx : dy),
          sizeAt(last.pressure, taperAt(travelled)) * (isAcross ? across : down),
        )
      }
      isFirstMove = false
      let along = spacing - distanceSinceLastDab // how far along the line the next dab goes
      while (along <= distance) {
        // A pixel brush's dab is worked out a hair further, inside the pixel the pen enters there
        const t = isPixel ? Math.min(1, (along + 1e-6) / distance) : along / distance
        const pressure = last.pressure + (point.pressure - last.pressure) * t
        place(dabs, dabAt(last.x + dx * t, last.y + dy * t, pressure, direction, travelled + along))
        along += spacing
      }
      distanceSinceLastDab = distance - (along - spacing)
      travelled += distance
      last = point
    }
    return dabs
  }

  // The stroke ends. A first dab still waiting for a direction (a click without moving) is placed as it is. A pixel
  // brush also paints the pixels under the pen's last point, even when that is closer than the spacing to the last
  // dab, so a stroke ends exactly where the pen left
  function end(): Dab[] {
    const dabs: Dab[] = []
    if (waitingDab) place(dabs, dabAt(waitingDab.x, waitingDab.y, waitingDab.pressure, 0, 0))
    else if (isPixel && last) place(dabs, dabAt(last.x, last.y, last.pressure, 0, travelled))
    waitingDab = null
    last = null
    return dabs
  }

  // Which way the stroke is going, in radians, clockwise from the right (0 before it has moved)
  const direction = () => Math.atan2(directionY, directionX)

  // How far along the paper the stroke has gone, in pixels (a pixel brush measures along the longer side, see moveTo)
  const strokeLength = () => travelled

  return { start, moveTo, end, direction, strokeLength }
}

export type DabPath = ReturnType<typeof createDabPath>

// A pixel brush's straight line from one point of the paper to another, as the points to paint it through, at this
// pressure: one for each place of the tip's corner along the line, a pixel further along its longer side each time,
// so the line has one pixel in each column (or row). Across the shorter side, each is the pixel nearest to the line,
// as Bresenham's line algorithm finds them (halfway, the later one). A line of whole steps (2 across for 1 down, 3
// for 1, 1 for 1...), as Ctrl makes them (see straightLine.ts), has them all equal from its start instead: rounding to
// the nearest, the first and the last would be shorter. Each point is where a dab with its corner there has its
// center, so the dab path (see createDabPath) paints one dab at each of them
export function pixelLinePoints(
  shape: BrushShape,
  size: number,
  from: StrokePoint,
  to: StrokePoint,
  tip?: { width: number; height: number },
): StrokePoint[] {
  const isDrawn = shape.pixel === 'drawn' && tip !== undefined
  const tipSide = isDrawn ? Math.max(tip.width, tip.height) : 1
  const side = wholePixelSize(shape.pressureSize ? size * from.pressure : size, tipSide)
  const width = isDrawn ? (side * tip.width) / tipSide : side
  const height = isDrawn ? (side * tip.height) / tipSide : side
  const x = Math.round(from.x - width / 2)
  const y = Math.round(from.y - height / 2)
  const endX = Math.round(to.x - width / 2)
  const endY = Math.round(to.y - height / 2)
  const isAcross = Math.abs(endX - x) >= Math.abs(endY - y)
  const longer = Math.abs(isAcross ? endX - x : endY - y)
  const shorter = Math.abs(isAcross ? endY - y : endX - x)
  const longerSign = Math.sign(isAcross ? endX - x : endY - y)
  const shorterSign = Math.sign(isAcross ? endY - y : endX - x)
  const isWholeSteps = shorter > 0 && longer % shorter === 0
  // How far across the shorter side the line is, "i" pixels along the longer one
  const shorterAt = (i: number) =>
    isWholeSteps ? Math.floor((i * shorter) / longer) : Math.ceil((2 * i * shorter - longer) / (2 * longer))
  const points: StrokePoint[] = []
  for (let i = 0; i <= longer; i++) {
    const along = i * longerSign
    const aside = longer === 0 ? 0 : shorterAt(i) * shorterSign
    const cornerX = x + (isAcross ? along : aside)
    const cornerY = y + (isAcross ? aside : along)
    points.push({ x: cornerX + width / 2, y: cornerY + height / 2, pressure: from.pressure })
  }
  return points
}

// A pixel brush's stroke can be pixel-perfect: without the doubled corners of lines drawn by hand. Where the stroke
// steps across and then down (or down and then across) to a pixel diagonal from the one before, the dab at the corner
// between them is left out, so each step of the line is a single pixel, as pixel artists draw lines. The stroke stays
// unbroken, since the dabs on both sides of the corner touch at theirs. Whether "b" is such a corner between "a" and
// "c", the dabs before and after it, all of the same size (where the pen's pressure changes the size, it is no line of
// one width)
export function isCorner(a: Dab, b: Dab, c: Dab) {
  if (a.size !== b.size || b.size !== c.size) return false
  const isStep = (from: Dab, to: Dab) => Math.abs(to.x - from.x) + Math.abs(to.y - from.y) === 1
  return isStep(a, b) && isStep(b, c) && a.x !== c.x && a.y !== c.y
}

// A stroke's dabs without its doubled corners, taken out in the order the dabs were placed, as the brush does while
// painting (see brush.ts)
export function withoutCorners(dabs: Dab[]) {
  const kept: Dab[] = []
  for (const dab of dabs) {
    const count = kept.length
    if (count >= 2 && isCorner(kept[count - 2], kept[count - 1], dab)) kept.pop()
    kept.push(dab)
  }
  return kept
}
