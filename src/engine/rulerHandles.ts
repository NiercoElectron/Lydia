import type { Graphics } from 'pixi.js'
import { ellipseAxes, type Ruler } from './rulers'
import type { Point } from './selection'

// How the rulers look on the screen, and how they are moved. The lines are over everything and as thin at any zoom, and
// they aren't part of the drawing: they never come out in an exported image.

const COLOR = 0x2e9bff
const RAY_ALPHA = 0.3 // the lines around a vanishing point are only a hint
const POINT_RADIUS = 4
const HANDLE_RADIUS = 6
const HANDLE_REACH = 12 // how close to a handle the pointer has to go, in pixels of the screen
const LINE_REACH = 6 // and to a ruler's line, to move all of it
const ELLIPSE_PIECES = 128 // the straight pieces an ellipse is drawn with
const RAYS = 24 // how many lines go out from a vanishing point on the paper
const FAR_RAYS = 12 // from one off the paper, across it
const MIN_AXIS = 1 // an ellipse's axes can't get shorter than this, in pixels of the paper

// What can be taken hold of on a ruler
type RulerPart = 'whole' | 'from' | 'to' | 'center' | 'end' | 'side' | 'at'
export type RulerGrip = { index: number; part: RulerPart }

function handlesOf(ruler: Ruler): { part: RulerPart; point: Point }[] {
  if (ruler.kind === 'line') {
    return [
      { part: 'from', point: ruler.from },
      { part: 'to', point: ruler.to },
    ]
  }
  if (ruler.kind === 'point') return [{ part: 'at', point: ruler.at }]
  const { side, cos, sin } = ellipseAxes(ruler)
  const { center, end } = ruler
  return [
    { part: 'center', point: center },
    { part: 'end', point: end },
    { part: 'side', point: { x: center.x - sin * side, y: center.y + cos * side } },
  ]
}

// An ellipse as the points of its outline, on the paper
function ellipseOutline(ruler: Extract<Ruler, { kind: 'ellipse' }>) {
  const { across, side, cos, sin } = ellipseAxes(ruler)
  return Array.from({ length: ELLIPSE_PIECES }, (_, piece) => {
    const turn = (piece * 2 * Math.PI) / ELLIPSE_PIECES
    const x = across * Math.cos(turn)
    const y = side * Math.sin(turn)
    return { x: ruler.center.x + x * cos - y * sin, y: ruler.center.y + x * sin + y * cos }
  })
}

// How far a point is from the piece of line from "a" to "b"
function distanceToLine(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const share = lengthSquared > 0 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared : 0
  const along = Math.max(0, Math.min(1, share))
  return Math.hypot(point.x - (a.x + dx * along), point.y - (a.y + dy * along))
}

// What of the rulers is at this point of the screen: a handle first, then a ruler's line, the newest ruler first
export function gripAt(rulers: Ruler[], screen: Point, toScreen: (paper: Point) => Point): RulerGrip | null {
  for (let index = rulers.length - 1; index >= 0; index--) {
    for (const { part, point } of handlesOf(rulers[index])) {
      const { x, y } = toScreen(point)
      if (Math.hypot(screen.x - x, screen.y - y) <= HANDLE_REACH) return { index, part }
    }
  }
  for (let index = rulers.length - 1; index >= 0; index--) {
    const ruler = rulers[index]
    if (ruler.kind === 'point') continue
    const outline = (ruler.kind === 'line' ? [ruler.from, ruler.to] : ellipseOutline(ruler)).map(toScreen)
    const last = ruler.kind === 'line' ? outline.length - 1 : outline.length
    for (let piece = 0; piece < last; piece++) {
      const isOnIt = distanceToLine(screen, outline[piece], outline[(piece + 1) % outline.length]) <= LINE_REACH
      if (isOnIt) return { index, part: 'whole' }
    }
  }
  return null
}

// A ruler with one of its parts dragged from one point of the paper to another
export function movedRuler(ruler: Ruler, part: RulerPart, from: Point, to: Point): Ruler {
  const moved = ({ x, y }: Point) => ({ x: x + to.x - from.x, y: y + to.y - from.y })
  if (ruler.kind === 'line') {
    return {
      ...ruler,
      from: part === 'to' ? ruler.from : moved(ruler.from),
      to: part === 'from' ? ruler.to : moved(ruler.to),
    }
  }
  if (ruler.kind === 'point') return { ...ruler, at: moved(ruler.at) }
  const { center } = ruler
  if (part === 'center' || part === 'whole') return { ...ruler, center: moved(center), end: moved(ruler.end) }
  if (part === 'end') {
    const end = moved(ruler.end)
    return Math.hypot(end.x - center.x, end.y - center.y) < MIN_AXIS ? ruler : { ...ruler, end }
  }
  // How far the pointer is from the axis the handle is across from
  const { side, cos, sin } = ellipseAxes(ruler)
  const handle = moved({ x: center.x - sin * side, y: center.y + cos * side })
  return { ...ruler, side: Math.max(MIN_AXIS, Math.abs((handle.y - center.y) * cos - (handle.x - center.x) * sin)) }
}

// The lines around a vanishing point, as far as they cross the paper. From one on the paper they go all around it; from
// one off it, they spread over the angle the paper takes up as seen from there
function raysOf(at: Point, width: number, height: number): [Point, Point][] {
  const isOnPaper = at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height
  const toMiddle = Math.atan2(height / 2 - at.y, width / 2 - at.x)
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => {
    const turn = Math.atan2(y - at.y, x - at.x) - toMiddle
    return Math.atan2(Math.sin(turn), Math.cos(turn))
  })
  const first = isOnPaper ? -Math.PI : Math.min(...corners)
  const last = isOnPaper ? Math.PI : Math.max(...corners)
  const count = isOnPaper ? RAYS : FAR_RAYS
  const rays: [Point, Point][] = []
  for (let ray = 0; ray < count; ray++) {
    const turn = toMiddle + first + ((ray + 0.5) * (last - first)) / count
    const dx = Math.cos(turn)
    const dy = Math.sin(turn)
    // Where it goes into the paper and out of it, as distances from the point
    let enter = 0
    let leave = Infinity
    for (const [from, step, size] of [
      [at.x, dx, width],
      [at.y, dy, height],
    ]) {
      if (step === 0) continue
      const near = -from / step
      const far = (size - from) / step
      enter = Math.max(enter, Math.min(near, far))
      leave = Math.min(leave, Math.max(near, far))
    }
    if (enter >= leave) continue
    const point = (distance: number) => ({ x: at.x + dx * distance, y: at.y + dy * distance })
    rays.push([point(enter), point(leave)])
  }
  return rays
}

type RulersShown = {
  rulers: Ruler[]
  chosen: number | null // the one that is being edited
  isEditing: boolean
  width: number // the paper's
  height: number
  toScreen: (paper: Point) => Point
}

export function drawRulers(graphics: Graphics, { rulers, chosen, isEditing, width, height, toScreen }: RulersShown) {
  graphics.clear()
  rulers.forEach((ruler, index) => {
    if (ruler.kind === 'point') {
      for (const [from, to] of raysOf(ruler.at, width, height)) {
        const start = toScreen(from)
        const end = toScreen(to)
        graphics.moveTo(start.x, start.y).lineTo(end.x, end.y)
      }
      graphics.stroke({ width: 1, color: COLOR, alpha: RAY_ALPHA })
      const { x, y } = toScreen(ruler.at)
      graphics.circle(x, y, POINT_RADIUS).stroke({ width: index === chosen ? 2 : 1, color: COLOR })
      return
    }
    const isClosed = ruler.kind === 'ellipse'
    const outline = (isClosed ? ellipseOutline(ruler) : [ruler.from, ruler.to]).map(toScreen)
    graphics.poly(outline, isClosed).stroke({ width: index === chosen ? 2 : 1, color: COLOR })
  })
  if (!isEditing) return
  for (const ruler of rulers) {
    for (const { point } of handlesOf(ruler)) {
      const { x, y } = toScreen(point)
      graphics.circle(x, y, HANDLE_RADIUS).fill({ color: 0xffffff }).stroke({ width: 2, color: COLOR })
    }
  }
}
