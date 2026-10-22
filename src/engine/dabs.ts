import type { BrushShape } from './brushFile'

// A brush stroke is a row of "dabs": copies of the brush tip, close enough to look like a continuous line
export type Dab = {
  x: number
  y: number
  size: number // the tip's longer side, in pixels of the paper
  angle: number // how much the tip is turned, in radians, clockwise
  alpha: number // how much paint it puts down, from 0 to 1
}

export type StrokePoint = { x: number; y: number; pressure: number }

const FULL_TURN = Math.PI * 2
const DEGREES = Math.PI / 180
// How much of the earlier direction is kept at each new point, so that a shaky hand doesn't make the tip wobble
const DIRECTION_MEMORY = 0.6

// Where the dabs of one stroke go, as the pointer passes through its points. "size" is the brush size at full
// pressure. Shared by the brush, which paints the dabs into the tiles, and the brush previews, which draw them on a
// small canvas
export function createDabPath(shape: BrushShape, size: number) {
  let last: StrokePoint | null = null
  let distanceSinceLastDab = 0
  let directionX = 0
  let directionY = 0
  // With "followStroke", the first dab waits until the stroke has a direction
  let waitingDab: StrokePoint | null = null

  const sizeAt = (pressure: number) => (shape.pressureSize ? size * pressure : size)

  function dabAt(x: number, y: number, pressure: number, direction: number): Dab {
    const dabSize = sizeAt(pressure)
    let angle = shape.angle * DEGREES + (shape.followStroke ? direction : 0)
    if (shape.angleJitter > 0) angle += (Math.random() - 0.5) * shape.angleJitter * FULL_TURN
    if (shape.scatter > 0) {
      // Anywhere in a circle around the point, evenly
      const distance = shape.scatter * dabSize * Math.sqrt(Math.random())
      const toward = Math.random() * FULL_TURN
      x += Math.cos(toward) * distance
      y += Math.sin(toward) * distance
    }
    return { x, y, size: dabSize, angle, alpha: shape.pressureFlow ? shape.flow * pressure : shape.flow }
  }

  // The stroke starts at this point
  function start(point: StrokePoint): Dab[] {
    last = point
    distanceSinceLastDab = 0
    if (shape.followStroke) {
      waitingDab = point
      return []
    }
    return [dabAt(point.x, point.y, point.pressure, 0)]
  }

  // The stroke goes on through these points: dabs along the lines between them, one every "spacing" pixels
  function moveTo(points: StrokePoint[]): Dab[] {
    const dabs: Dab[] = []
    for (const point of points) {
      if (!last) break
      const dx = point.x - last.x
      const dy = point.y - last.y
      const distance = Math.hypot(dx, dy)
      if (distance === 0) continue
      directionX = directionX * DIRECTION_MEMORY + dx
      directionY = directionY * DIRECTION_MEMORY + dy
      const direction = Math.atan2(directionY, directionX)
      if (waitingDab) {
        dabs.push(dabAt(waitingDab.x, waitingDab.y, waitingDab.pressure, direction))
        waitingDab = null
      }

      const spacing = Math.max(1, sizeAt(point.pressure) * shape.spacing)
      let along = spacing - distanceSinceLastDab // how far along the line the next dab goes
      while (along <= distance) {
        const t = along / distance
        const pressure = last.pressure + (point.pressure - last.pressure) * t
        dabs.push(dabAt(last.x + dx * t, last.y + dy * t, pressure, direction))
        along += spacing
      }
      distanceSinceLastDab = distance - (along - spacing)
      last = point
    }
    return dabs
  }

  // The stroke ends. A first dab still waiting for a direction (a click without moving) is placed as it is
  function end(): Dab[] {
    const dabs = waitingDab ? [dabAt(waitingDab.x, waitingDab.y, waitingDab.pressure, 0)] : []
    waitingDab = null
    last = null
    return dabs
  }

  return { start, moveTo, end }
}

export type DabPath = ReturnType<typeof createDabPath>
