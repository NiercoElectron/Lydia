import type { Point } from './selection'

// Shift + click with the brush or the eraser paints a straight line from where the last stroke ended (see view.ts).
// With Ctrl too, the line keeps to a few angles: for a pixel brush, the clean angles of pixel art, where every step of
// the line is as long as the others (across, down, and 1 pixel across for 1, 2 or 3 down, or the other way round);
// for the other brushes, every 15 degrees, as in Photoshop
const SMOOTH_STEP = (15 * Math.PI) / 180
const PIXEL_STEPS: Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 1, y: 2 },
  { x: 3, y: 1 },
  { x: 1, y: 3 },
]
// Each of them going any way: left or right, up or down
const PIXEL_DIRECTIONS = PIXEL_STEPS.flatMap(({ x, y }) =>
  [1, -1].flatMap(signX => [1, -1].map(signY => ({ x: x * signX, y: y * signY }))),
).filter((step, i, all) => all.findIndex(other => other.x === step.x && other.y === step.y) === i)

// Where a straight line from "from" toward "to" ends: at "to", or, keeping to the angles, at the place along the
// nearest of them closest to "to". A pixel brush's line then goes a whole number of steps, so it ends where a step
// does
export function straightLineEnd(from: Point, to: Point, keepsAngle: boolean, isPixel: boolean): Point {
  if (!keepsAngle) return to
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (isPixel) {
    let best = PIXEL_DIRECTIONS[0]
    let bestCos = -Infinity
    const length = Math.hypot(dx, dy) || 1
    for (const step of PIXEL_DIRECTIONS) {
      const cos = (step.x * dx + step.y * dy) / (Math.hypot(step.x, step.y) * length)
      if (cos > bestCos) {
        bestCos = cos
        best = step
      }
    }
    const steps = Math.max(0, Math.round((best.x * dx + best.y * dy) / (best.x * best.x + best.y * best.y)))
    return { x: from.x + best.x * steps, y: from.y + best.y * steps }
  }
  const angle = Math.round(Math.atan2(dy, dx) / SMOOTH_STEP) * SMOOTH_STEP
  const along = Math.max(0, dx * Math.cos(angle) + dy * Math.sin(angle))
  return { x: from.x + Math.cos(angle) * along, y: from.y + Math.sin(angle) * along }
}
