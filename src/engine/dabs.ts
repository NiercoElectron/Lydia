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
}

export type StrokePoint = { x: number; y: number; pressure: number }

const FULL_TURN = Math.PI * 2
const DEGREES = Math.PI / 180
// How much of the earlier direction is kept at each new point, so that a shaky hand doesn't make the tip wobble
const DIRECTION_MEMORY = 0.6
// Seeds are whole numbers below this, small enough for the graphics card to get them exactly
const SEEDS = 65536

// Where the dabs of one stroke go, as the pointer passes through its points. "size" is the brush size at full
// pressure. Shared by the brush, which paints the dabs into the tiles, and the brush previews, which draw them on a
// small canvas
export function createDabPath(shape: BrushShape, size: number) {
  const isPixel = shape.pixel !== 'none'
  let last: StrokePoint | null = null
  let distanceSinceLastDab = 0
  let directionX = 0
  let directionY = 0
  // With "followStroke", the first dab waits until the stroke has a direction
  let waitingDab: StrokePoint | null = null
  let lastDab: Dab | null = null // the latest dab placed
  let isFirstMove = false // a pixel brush's stroke hasn't moved yet (see pastEdge)
  const strokeSeed = Math.floor(Math.random() * SEEDS) // for brushes whose noise changes once per stroke

  // A pixel brush's size is a whole number of pixels, so the pen's pressure changes it a pixel at a time
  const sizeAt = (pressure: number) => {
    const dabSize = shape.pressureSize ? size * pressure : size
    return isPixel ? Math.max(1, Math.round(dabSize)) : dabSize
  }

  function dabAt(x: number, y: number, pressure: number, direction: number): Dab {
    const dabSize = sizeAt(pressure)
    const alpha = shape.pressureFlow ? shape.flow * pressure : shape.flow
    const seed = shape.noisePerStroke ? strokeSeed : Math.floor(Math.random() * SEEDS)
    let angle = shape.angle * DEGREES + (shape.followStroke ? direction : 0)
    if (shape.angleJitter > 0) angle += (Math.random() - 0.5) * shape.angleJitter * FULL_TURN
    if (shape.scatter > 0) {
      // Anywhere in a circle around the point, evenly
      const distance = shape.scatter * dabSize * Math.sqrt(Math.random())
      const toward = Math.random() * FULL_TURN
      x += Math.cos(toward) * distance
      y += Math.sin(toward) * distance
    }
    if (isPixel) {
      // On the pixels of the paper, never turned: the tip's corner goes to the nearest corner between pixels, so an
      // odd size is centered on the pixel under the pen, and an even size on the corner nearest to it
      const left = Math.round(x - dabSize / 2)
      const top = Math.round(y - dabSize / 2)
      return { x: left + dabSize / 2, y: top + dabSize / 2, size: dabSize, angle: 0, alpha, seed }
    }
    return { x, y, size: dabSize, angle, alpha, seed }
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
    else place(dabs, dabAt(point.x, point.y, point.pressure, 0))
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
        place(dabs, dabAt(waitingDab.x, waitingDab.y, waitingDab.pressure, direction))
        waitingDab = null
      }

      const spacing = Math.max(1, sizeAt(point.pressure) * shape.spacing)
      // A pixel brush starts counting from the edge of the pixel the stroke started in, along the longer side of its
      // first move
      if (isPixel && isFirstMove) {
        const isAcross = Math.abs(dx) >= Math.abs(dy)
        distanceSinceLastDab = pastEdge(
          isAcross ? last.x : last.y,
          Math.sign(isAcross ? dx : dy),
          sizeAt(last.pressure),
        )
      }
      isFirstMove = false
      let along = spacing - distanceSinceLastDab // how far along the line the next dab goes
      while (along <= distance) {
        // A pixel brush's dab is worked out a hair further, inside the pixel the pen enters there
        const t = isPixel ? Math.min(1, (along + 1e-6) / distance) : along / distance
        const pressure = last.pressure + (point.pressure - last.pressure) * t
        place(dabs, dabAt(last.x + dx * t, last.y + dy * t, pressure, direction))
        along += spacing
      }
      distanceSinceLastDab = distance - (along - spacing)
      last = point
    }
    return dabs
  }

  // The stroke ends. A first dab still waiting for a direction (a click without moving) is placed as it is. A pixel
  // brush also paints the pixels under the pen's last point, even when that is closer than the spacing to the last
  // dab, so a stroke ends exactly where the pen left
  function end(): Dab[] {
    const dabs: Dab[] = []
    if (waitingDab) place(dabs, dabAt(waitingDab.x, waitingDab.y, waitingDab.pressure, 0))
    else if (isPixel && last) place(dabs, dabAt(last.x, last.y, last.pressure, 0))
    waitingDab = null
    last = null
    return dabs
  }

  // Which way the stroke is going, in radians, clockwise from the right (0 before it has moved)
  const direction = () => Math.atan2(directionY, directionX)

  return { start, moveTo, end, direction }
}

export type DabPath = ReturnType<typeof createDabPath>
