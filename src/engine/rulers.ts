import type { StrokePoint } from './dabs'
import type { Point } from './selection'

// Rulers (decision 78): while they are on, a stroke doesn't go where the pen goes, but along the ruler that fits it. It
// starts where the pen touches the paper, wherever that is, and from there:
//
// - "line": goes parallel to the line
// - "ellipse": goes around the ellipse with the same center, angle and proportions that passes through there
// - "point" (a vanishing point): goes straight, on the line through that point
//
// With several rulers on the paper, the pen chooses: the stroke waits for the first few pixels, and takes the ruler whose
// direction there is closest to the pen's. So two points make a perspective of two points. A single ruler needs no
// waiting.
//
// The tools ask nothing: the view holds the pen's points here before they reach any of them (see view.ts), after the
// stabilizer, or the stabilizer would cut the corners of an ellipse.

export const RULER_KINDS = ['line', 'ellipse', 'point'] as const
export type RulerKind = (typeof RULER_KINDS)[number]

// An ellipse is its center, the end of one of its axes (which says how it is turned), and half the length of the other
export type Ruler =
  | { kind: 'line'; from: Point; to: Point }
  | { kind: 'ellipse'; center: Point; end: Point; side: number }
  | { kind: 'point'; at: Point }

export type Rulers = { isOn: boolean; list: Ruler[] }

export const noRulers = (): Rulers => ({ isOn: false, list: [] })

// Along an ellipse, a stroke gets a point every this many pixels of the paper, or it would be made of straight pieces
// when the pen moves fast. At most this many in one go
const ELLIPSE_STEP = 4
const MAX_ELLIPSE_STEPS = 720
const CLOSEST_POINT_ROUNDS = 4 // how many times the closest point on an ellipse is worked out: more changes nothing

// A new ruler at this point, about "size" pixels long
export function newRuler(kind: RulerKind, at: Point, size: number): Ruler {
  const half = size / 2
  if (kind === 'line') return { kind, from: { x: at.x - half, y: at.y }, to: { x: at.x + half, y: at.y } }
  if (kind === 'ellipse') return { kind, center: at, end: { x: at.x + half, y: at.y }, side: half / 2 }
  return { kind, at }
}

const isPoint = (value: unknown): value is Point =>
  Number.isFinite((value as Point | undefined)?.x) && Number.isFinite((value as Point | undefined)?.y)

function isRuler(value: unknown) {
  if (typeof value !== 'object' || value === null) return false
  const ruler = value as Partial<Record<'kind' | 'from' | 'to' | 'center' | 'end' | 'at' | 'side', unknown>>
  if (ruler.kind === 'line') return isPoint(ruler.from) && isPoint(ruler.to)
  if (ruler.kind === 'point') return isPoint(ruler.at)
  const hasSide = typeof ruler.side === 'number' && ruler.side > 0 && Number.isFinite(ruler.side)
  return ruler.kind === 'ellipse' && isPoint(ruler.center) && isPoint(ruler.end) && hasSide
}

export function isRulers(value: unknown): value is Rulers {
  if (typeof value !== 'object' || value === null) return false
  const { isOn, list } = value as Partial<Rulers>
  return typeof isOn === 'boolean' && Array.isArray(list) && list.every(isRuler)
}

// How long this direction is cut down to 1, or null when it has no length
function unit(x: number, y: number): Point | null {
  const length = Math.hypot(x, y)
  return length > 0 ? { x: x / length, y: y / length } : null
}

// An ellipse as its two half lengths and how it is turned
export function ellipseAxes({ center, end, side }: Extract<Ruler, { kind: 'ellipse' }>) {
  const across = Math.hypot(end.x - center.x, end.y - center.y)
  const turn = Math.atan2(end.y - center.y, end.x - center.x)
  return { across, side, cos: Math.cos(turn), sin: Math.sin(turn) }
}

// The direction a stroke starting at this point would go along this ruler, either way; null when it has none: the ruler
// has no length, or the point is on the vanishing point or in the middle of the ellipse
function directionAt(ruler: Ruler, { x, y }: Point): Point | null {
  if (ruler.kind === 'line') return unit(ruler.to.x - ruler.from.x, ruler.to.y - ruler.from.y)
  if (ruler.kind === 'point') return unit(x - ruler.at.x, y - ruler.at.y)
  const { across, side, cos, sin } = ellipseAxes(ruler)
  const dx = x - ruler.center.x
  const dy = y - ruler.center.y
  // On the ellipse's own axes, then turned back
  const alongX = (dx * cos + dy * sin) / (across * across)
  const alongY = (dy * cos - dx * sin) / (side * side)
  return unit(-alongY * cos - alongX * sin, -alongY * sin + alongX * cos)
}

// The way a stroke goes on: from the last point it reached, to as close as it can get to the pen. Returns the points to
// go through
type Track = (last: StrokePoint, pen: StrokePoint) => StrokePoint[]

const freeTrack: Track = (_, pen) => [pen]

function straightTrack(start: Point, direction: Point): Track {
  return (_, { x, y, pressure }) => {
    const along = (x - start.x) * direction.x + (y - start.y) * direction.y
    return [{ x: start.x + direction.x * along, y: start.y + direction.y * along, pressure }]
  }
}

// The closest point to (x, y) on an ellipse with these half lengths, along its axes, as an angle around it. It is worked
// out in the quarter where both are positive, going around the circle that fits the ellipse's curve at each guess, which
// gets there in a few steps at any proportions
function closestTurn(x: number, y: number, across: number, side: number) {
  const px = Math.abs(x)
  const py = Math.abs(y)
  let cos = Math.SQRT1_2
  let sin = Math.SQRT1_2
  for (let round = 0; round < CLOSEST_POINT_ROUNDS; round++) {
    const atX = across * cos
    const atY = side * sin
    const curveX = ((across * across - side * side) * cos ** 3) / across
    const curveY = ((side * side - across * across) * sin ** 3) / side
    const reachX = atX - curveX
    const reachY = atY - curveY
    const toPenX = px - curveX
    const toPenY = py - curveY
    const toPen = Math.hypot(toPenX, toPenY)
    if (toPen === 0) break
    const reach = Math.hypot(reachX, reachY)
    cos = Math.min(1, Math.max(0, ((toPenX * reach) / toPen + curveX) / across))
    sin = Math.min(1, Math.max(0, ((toPenY * reach) / toPen + curveY) / side))
    const length = Math.hypot(cos, sin)
    cos /= length
    sin /= length
  }
  return Math.atan2(y < 0 ? -sin : sin, x < 0 ? -cos : cos)
}

function ellipseTrack(ruler: Extract<Ruler, { kind: 'ellipse' }>, start: Point): Track {
  const { center } = ruler
  const { across, side, cos, sin } = ellipseAxes(ruler)
  const onAxes = ({ x, y }: Point) => {
    const dx = x - center.x
    const dy = y - center.y
    return { x: dx * cos + dy * sin, y: dy * cos - dx * sin }
  }
  const first = onAxes(start)
  const scale = Math.hypot(first.x / across, first.y / side)
  if (scale === 0) return freeTrack // the middle of the ellipse is on none of them
  const radiusX = across * scale
  const radiusY = side * scale
  const turnOf = (point: Point) => {
    const { x, y } = onAxes(point)
    return closestTurn(x, y, radiusX, radiusY)
  }
  let turn = turnOf(start)
  return (last, pen) => {
    const next = turnOf(pen)
    const gap = Math.atan2(Math.sin(next - turn), Math.cos(next - turn)) // the short way around
    const length = Math.abs(gap) * Math.max(radiusX, radiusY)
    const steps = Math.min(MAX_ELLIPSE_STEPS, Math.max(1, Math.ceil(length / ELLIPSE_STEP)))
    const points: StrokePoint[] = []
    for (let step = 1; step <= steps; step++) {
      const share = step / steps
      const x = radiusX * Math.cos(turn + gap * share)
      const y = radiusY * Math.sin(turn + gap * share)
      points.push({
        x: center.x + x * cos - y * sin,
        y: center.y + x * sin + y * cos,
        pressure: last.pressure + (pen.pressure - last.pressure) * share,
      })
    }
    turn = next
    return points
  }
}

// The way along this ruler of a stroke that started at "start". "pen": where the pen is now, for a stroke starting on a
// vanishing point, which any line goes through
function trackOf(ruler: Ruler, start: Point, pen: Point): Track {
  if (ruler.kind === 'ellipse') return ellipseTrack(ruler, start)
  const direction =
    directionAt(ruler, start) ?? (ruler.kind === 'point' ? unit(pen.x - start.x, pen.y - start.y) : null)
  return direction ? straightTrack(start, direction) : freeTrack
}

// The ruler whose direction at the start of a stroke is the closest to the way the pen went
function chooseRuler(rulers: Ruler[], start: Point, pen: Point) {
  const way = unit(pen.x - start.x, pen.y - start.y)
  let chosen = rulers[0]
  let best = -1
  for (const ruler of rulers) {
    const direction = directionAt(ruler, start)
    let fit = ruler.kind === 'point' ? 1 : 0 // a line in any direction goes through a vanishing point under the pen
    if (direction) fit = way ? Math.abs(direction.x * way.x + direction.y * way.y) : 0
    if (fit > best) {
      best = fit
      chosen = ruler
    }
  }
  return chosen
}

// A stroke held to the rulers, from the point where the pen went down, which every way along them goes through.
// "chooseAfter": how far the pen goes, in pixels of the paper, before the ruler is chosen. Each function returns the
// points the stroke goes through, to paint along them
export function createHold(rulers: Ruler[], start: StrokePoint, chooseAfter: number) {
  const canStart = rulers.length === 1 && directionAt(rulers[0], start) !== null
  let track: Track | null = canStart ? trackOf(rulers[0], start, start) : null
  const waiting: StrokePoint[] = [] // where the pen went while the ruler isn't chosen
  let last = start

  function go(pen: StrokePoint) {
    const points = track!(last, pen)
    last = points.at(-1) ?? last
    return points
  }

  // Take a ruler, and go through what was waiting for it
  function choose(pen: StrokePoint) {
    track = trackOf(chooseRuler(rulers, start, pen), start, pen)
    return waiting.splice(0).flatMap(go)
  }

  // The pen (or the stabilizer) moved through these points
  function along(points: StrokePoint[]): StrokePoint[] {
    const passed: StrokePoint[] = []
    for (const point of points) {
      if (track) {
        passed.push(...go(point))
      } else {
        waiting.push(point)
        if (Math.hypot(point.x - start.x, point.y - start.y) >= chooseAfter) passed.push(...choose(point))
      }
    }
    return passed
  }

  // The pen came up before the ruler was chosen: what it did so far is all there is to go by
  function finish(): StrokePoint[] {
    return track || waiting.length === 0 ? [] : choose(waiting.at(-1)!)
  }

  return { along, finish, brushAt: (): Point => ({ x: last.x, y: last.y }) }
}

export type Hold = ReturnType<typeof createHold>
