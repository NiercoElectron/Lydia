import type { Point } from './selection'

// Curves (decision 89), drawn with the curves tool like with Photoshop's pen or Krita's curve tool. A curve goes through
// its points, and each point has two handles: where the curve comes from before it, and where it goes after it. From a
// point to the next, the curve is a cubic Bézier curve. A handle on its point makes a corner there, and a smooth point
// keeps its two handles in one line, so the curve goes through it without a corner
export type CurvePoint = { at: Point; before: Point; after: Point; isSmooth: boolean }
export type Curve = { points: CurvePoint[]; isClosed: boolean }

// What a curve makes when it ends: a shape on a new layer, or a selection
export type CurveMakes = 'shape' | 'selection'

const STEP = 4 // along a bent part, a point every this many pixels of the paper
const MAX_STEPS = 1024 // in one part

// A point with no handles: a corner
export const cornerAt = (at: Point): CurvePoint => ({ at, before: at, after: at, isSmooth: false })

const isSame = (a: Point, b: Point) => a.x === b.x && a.y === b.y

// The other side of "at" from "point", as far
export const mirrored = (at: Point, point: Point): Point => ({ x: 2 * at.x - point.x, y: 2 * at.y - point.y })

// Each part of the curve, from a point to the next, as its Bézier curve's four points
function partsOf({ points, isClosed }: Curve) {
  const count = isClosed ? points.length : points.length - 1
  return Array.from({ length: Math.max(0, count) }, (_, part) => {
    const from = points[part]
    const to = points[(part + 1) % points.length]
    return [from.at, from.after, to.before, to.at] as const
  })
}

function onPart([a, b, c, d]: readonly Point[], t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  }
}

// The curve as points close together, for the brush to go along and to fill. "place" takes each point to where it
// goes on the paper (a shape's transforms), and "isBent" says it bends straight lines too (a mesh), so they need
// points along them. A closed curve doesn't repeat its first point at its end
export function curveLine(curve: Curve, place: (point: Point) => Point = point => point, isBent = false): Point[] {
  const parts = partsOf(curve)
  if (parts.length === 0) return curve.points.map(point => place(point.at))
  const line: Point[] = []
  for (const part of parts) {
    const isStraight = isSame(part[0], part[1]) && isSame(part[2], part[3])
    let steps = 1
    if (!isStraight || isBent) {
      const placed = part.map(place)
      let length = 0
      for (let i = 1; i < 4; i++) length += Math.hypot(placed[i].x - placed[i - 1].x, placed[i].y - placed[i - 1].y)
      steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(length / STEP)))
    }
    for (let step = 0; step < steps; step++) line.push(place(onPart(part, step / steps)))
  }
  if (!curve.isClosed) line.push(place(curve.points.at(-1)!.at))
  return line
}

// The curve with its points and handles taken somewhere else
export const placedCurve = (curve: Curve, place: (point: Point) => Point): Curve => ({
  ...curve,
  points: curve.points.map(({ at, before, after, isSmooth }) => ({
    at: place(at),
    before: place(before),
    after: place(after),
    isSmooth,
  })),
})

// The rectangle around a curve's points
export function curveBox({ points }: Curve) {
  const xs = points.map(point => point.at.x)
  const ys = points.map(point => point.at.y)
  return { from: { x: Math.min(...xs), y: Math.min(...ys) }, to: { x: Math.max(...xs), y: Math.max(...ys) } }
}

// A point moved, with its handles
export const movedPoint = (point: CurvePoint, dx: number, dy: number): CurvePoint => {
  const move = ({ x, y }: Point) => ({ x: x + dx, y: y + dy })
  return { ...point, at: move(point.at), before: move(point.before), after: move(point.after) }
}

// A point with one of its handles taken to "to". A smooth point turns its other handle to the other side, as long as
// it was, or as long as this one when it was on its point; "isBroken" (Alt) lets the other handle be, as a corner
export function withHandle(point: CurvePoint, handle: 'before' | 'after', to: Point, isBroken: boolean): CurvePoint {
  const other = handle === 'before' ? 'after' : 'before'
  if (isBroken || !point.isSmooth) return { ...point, [handle]: to, isSmooth: false }
  const reach = Math.hypot(point[other].x - point.at.x, point[other].y - point.at.y)
  const dx = to.x - point.at.x
  const dy = to.y - point.at.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return { ...point, [handle]: to }
  const share = reach === 0 ? 1 : reach / length
  return { ...point, [handle]: to, [other]: { x: point.at.x - dx * share, y: point.at.y - dy * share } }
}

// Whether a curve from a file makes sense
export function isCurve(value: unknown): value is Curve {
  const { points, isClosed } = (value ?? {}) as Partial<Curve>
  const isPoint = (point: unknown) => {
    const { x, y } = (point ?? {}) as Partial<Point>
    return Number.isFinite(x) && Number.isFinite(y)
  }
  return (
    typeof isClosed === 'boolean' &&
    Array.isArray(points) &&
    points.length >= 2 &&
    points.every(
      point =>
        isPoint(point?.at) && isPoint(point?.before) && isPoint(point?.after) && typeof point?.isSmooth === 'boolean',
    )
  )
}
