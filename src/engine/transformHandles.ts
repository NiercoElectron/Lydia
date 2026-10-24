import type { Graphics } from 'pixi.js'
import { ROTATE_CURSOR } from './cursors'
import type { Point } from './selection'
import { homography, invert, mapPoint, rectQuad, type Quad, type Rect } from './smartObject'

// The handles of a transform (decision 42), like Photoshop's: a square on each corner and on the middle of each side.
// A corner scales both ways and a side one way, from the opposite corner or side (from the middle with Alt); Shift
// keeps the proportions. With Ctrl, a corner moves alone (distort) and a side moves its two corners (skew). Dragging
// inside moves the object, and outside turns it around its middle (Shift: in steps of 15°)

// What is transformed: the part of the source with paint, and where its corners are on the paper
export type TransformTarget = { bounds: Rect; corners: Quad }

export type Handle = { kind: 'corner' | 'side'; index: number } | { kind: 'inside' } | { kind: 'outside' }

export type HeldKeys = { shift: boolean; alt: boolean; ctrl: boolean }

const HANDLE_SIZE = 8 // pixels of the screen
const HANDLE_REACH = 10 // how close to a handle the pointer must be to take it, in pixels of the screen
const ROTATE_STEP = (15 * Math.PI) / 180

const middleOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const centerOf = (quad: Quad): Point => ({
  x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
  y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
})

// The handles in the source: the corners of the bounds, then the middles of their sides (top, right, bottom, left)
function sourceHandles(bounds: Rect): Point[] {
  const corners = rectQuad(bounds)
  return [...corners, ...corners.map((corner, i) => middleOf(corner, corners[(i + 1) % 4]))]
}

// Where the handles are on the paper
function handlePoints({ bounds, corners }: TransformTarget) {
  const matrix = homography(bounds, corners)
  return sourceHandles(bounds).map(point => mapPoint(matrix, point))
}

// Whether a point is inside the four corners (which always turn the same way: see isValidQuad)
function isInside(quad: Quad, point: Point) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const cross = Math.sign((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x))
    if (cross === 0) continue
    if (sign === 0) sign = cross
    else if (cross !== sign) return false
  }
  return true
}

// The handle at this point of the screen ("paper": the same point on the paper; "toScreen" takes a point of the paper
// to the screen)
export function handleAt(target: TransformTarget, screen: Point, paper: Point, toScreen: (p: Point) => Point): Handle {
  let nearest = -1
  let distance = HANDLE_REACH
  handlePoints(target).forEach((point, i) => {
    const onScreen = toScreen(point)
    const d = Math.hypot(onScreen.x - screen.x, onScreen.y - screen.y)
    if (d <= distance) {
      nearest = i
      distance = d
    }
  })
  if (nearest >= 0) return nearest < 4 ? { kind: 'corner', index: nearest } : { kind: 'side', index: nearest - 4 }
  return isInside(target.corners, paper) ? { kind: 'inside' } : { kind: 'outside' }
}

// The cursor over a handle: a double arrow along the way it scales, as the handle sits on the screen
export function cursorFor(handle: Handle, target: TransformTarget, toScreen: (p: Point) => Point, ctrl: boolean) {
  if (handle.kind === 'inside') return 'move'
  if (handle.kind === 'outside') return ROTATE_CURSOR
  if (ctrl) return 'crosshair'
  const point = toScreen(handlePoints(target)[handle.kind === 'corner' ? handle.index : handle.index + 4])
  const center = toScreen(centerOf(target.corners))
  const step = Math.round(Math.atan2(point.y - center.y, point.x - center.x) / (Math.PI / 4))
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][((step % 4) + 4) % 4]
}

// The corners after dragging a handle from "from" to "to" (points of the paper), from where they were when the drag
// started
export function transformed(target: TransformTarget, handle: Handle, from: Point, to: Point, keys: HeldKeys): Quad {
  const { bounds, corners } = target
  // Moved by whole pixels, so a smooth object doesn't get blurred by moving alone
  if (handle.kind === 'inside') {
    const dx = Math.round(to.x - from.x)
    const dy = Math.round(to.y - from.y)
    return corners.map(p => ({ x: p.x + dx, y: p.y + dy })) as Quad
  }
  if (handle.kind === 'outside') {
    const center = centerOf(corners)
    let angle = Math.atan2(to.y - center.y, to.x - center.x) - Math.atan2(from.y - center.y, from.x - center.x)
    if (keys.shift) angle = Math.round(angle / ROTATE_STEP) * ROTATE_STEP
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return corners.map(p => {
      const x = p.x - center.x
      const y = p.y - center.y
      return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
    }) as Quad
  }
  if (keys.ctrl) {
    const moved = [...corners] as Quad
    const indices = handle.kind === 'corner' ? [handle.index] : [handle.index, (handle.index + 1) % 4]
    for (const i of indices) moved[i] = { x: corners[i].x + to.x - from.x, y: corners[i].y + to.y - from.y }
    return moved
  }

  // Scaling happens in the source, along its own sides, and the result goes back through the same homography: that
  // keeps a turned or distorted object turned or distorted the same way
  const matrix = homography(bounds, corners)
  const back = invert(matrix)
  const handles = sourceHandles(bounds)
  const isCorner = handle.kind === 'corner'
  const grabbed = handles[isCorner ? handle.index : handle.index + 4]
  const opposite = handles[isCorner ? (handle.index + 2) % 4 : ((handle.index + 2) % 4) + 4]
  const anchor = keys.alt ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : opposite
  const start = mapPoint(back, from)
  const now = mapPoint(back, to)
  const pointer = { x: grabbed.x + now.x - start.x, y: grabbed.y + now.y - start.y }
  const ratio = (value: number, of: number, around: number) =>
    Math.abs(of - around) < 1e-9 ? 1 : (value - around) / (of - around)
  let sx = ratio(pointer.x, grabbed.x, anchor.x)
  let sy = ratio(pointer.y, grabbed.y, anchor.y)
  if (!isCorner) {
    if (handle.index % 2 === 0)
      sx = 1 // the top and bottom sides only scale up and down
    else sy = 1
  } else if (keys.shift) {
    // The same scale both ways: how far the pointer is along the line from the anchor through the corner
    const ax = grabbed.x - anchor.x
    const ay = grabbed.y - anchor.y
    sx = sy = ((pointer.x - anchor.x) * ax + (pointer.y - anchor.y) * ay) / (ax * ax + ay * ay)
  }
  const scaled = rectQuad(bounds).map(p => ({
    x: anchor.x + (p.x - anchor.x) * sx,
    y: anchor.y + (p.y - anchor.y) * sy,
  }))
  return scaled.map(p => mapPoint(matrix, p)) as Quad
}

// The outline and the handles, as wide at any zoom: white with black lines, like the selection's outline
export function drawHandles(graphics: Graphics, target: TransformTarget, zoom: number) {
  const width = 1 / zoom
  const size = HANDLE_SIZE / zoom
  graphics.clear()
  graphics.poly(target.corners, true).stroke({ width: 3 * width, color: 0xffffff })
  graphics.poly(target.corners, true).stroke({ width, color: 0x000000 })
  for (const { x, y } of handlePoints(target)) {
    graphics
      .rect(x - size / 2, y - size / 2, size, size)
      .fill(0xffffff)
      .stroke({ width, color: 0x000000 })
  }
}
