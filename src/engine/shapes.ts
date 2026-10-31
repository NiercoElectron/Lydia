import { homography, multiply, placed, type Matrix3, type Quad, type Rect } from './smartObject'
import type { Point } from './selection'
import { straightLineEnd } from './straightLine'
import type { Warp } from './warp'

// Shapes (decision 79): a layer that keeps what it draws, like a smart object keeps its source (see smartObject.ts), and
// whose tiles are worked out from that (see shapePainter.ts). So everything about a shape can change after it is drawn,
// and it can't be painted on until it is turned into a normal layer.
//
// A shape is two points, where the pointer went down and came up, which make the box it is drawn in, and its
// "placements": where transforms took it. A transform moves the points of its outline, and the outline is painted again
// with the same tip along them, so it stays as thick as it was, and how many sides it has can still change.

export const SHAPE_KINDS = ['rectangle', 'ellipse', 'line', 'polygon', 'star'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

export const MIN_SIDES = 3
export const MAX_SIDES = 12
export const MIN_DEPTH = 10 // how far in a star's points go between them: its inner circle, in percent of the outer one
export const MAX_DEPTH = 90

// A transform of the shape's points: bent by the mesh, if any, then taken by "matrix" (see placed in smartObject.ts)
export type ShapePlacement = { bounds: Rect; matrix: Matrix3; warp?: Warp }

// "brush" is the brush's whole .lydbrush file, so a drawing doesn't need the brush to be in Lydia. It is kept off and on
// with its colors, so turning a fill or an outline off and on again finds them as they were
export type ShapeStyle = {
  kind: ShapeKind
  sides: number // of a polygon, or the points of a star
  depth: number // of a star
  fill: { isOn: boolean; color: string }
  outline: { isOn: boolean; color: string; size: number; brush: string }
}

export type Shape = ShapeStyle & { from: Point; to: Point; placements: ShapePlacement[] }

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  kind: 'rectangle',
  sides: 5,
  depth: 50,
  fill: { isOn: true, color: '#000000' },
  outline: { isOn: false, color: '#000000', size: 20, brush: '' },
}

const STEP = 4 // along a curve or a bent side, a point every this many pixels of the paper
const MAX_STEPS = 8192
const MIN_ELLIPSE_POINTS = 32
const ELLIPSE_SAMPLES = 64 // how many points measure how long an ellipse is

// A line has nothing to fill. So one shape has something to show, a line's outline stays on
export const canFill = (kind: ShapeKind) => kind !== 'line'

// Where a point of the box ends up after the shape's transforms
const placedPoint = ({ placements }: Pick<Shape, 'placements'>, point: Point) =>
  placements.reduce((at, { bounds, matrix, warp }) => placed(bounds, matrix, warp, at), point)

// Where a shape goes after a transform of the rectangle "bounds". Transforms with no mesh become one matrix
export function transformedShape(shape: Shape, bounds: Rect, corners: Quad, warp?: Warp): Shape {
  const matrix = homography(bounds, corners)
  const last = shape.placements.at(-1)
  if (warp || !last || last.warp) {
    return { ...shape, placements: [...shape.placements, { bounds, matrix, ...(warp && { warp }) }] }
  }
  return {
    ...shape,
    placements: [...shape.placements.slice(0, -1), { ...last, matrix: multiply(matrix, last.matrix) }],
  }
}

// The two ends of a line on the paper. A line bent by a mesh isn't a line any more, so it has none
export function lineEnds(shape: Shape): [Point, Point] | null {
  if (shape.kind !== 'line' || shape.placements.some(placement => placement.warp)) return null
  return [placedPoint(shape, shape.from), placedPoint(shape, shape.to)]
}

// The corners of the shape in its box, going around it; for an ellipse, none: it has its own points
function cornersOf({ kind, from, to, sides, depth }: Shape): Point[] {
  if (kind === 'line') return [from, to]
  if (kind === 'rectangle') {
    return [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }]
  }
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const across = Math.abs(to.x - from.x) / 2
  const down = Math.abs(to.y - from.y) / 2
  const count = kind === 'star' ? sides * 2 : sides
  return Array.from({ length: count }, (_, corner) => {
    const turn = (corner * 2 * Math.PI) / count - Math.PI / 2 // the first one straight up
    const reach = kind === 'star' && corner % 2 === 1 ? depth / 100 : 1
    return { x: middle.x + across * reach * Math.cos(turn), y: middle.y + down * reach * Math.sin(turn) }
  })
}

function ellipsePoints(shape: Shape) {
  const { from, to } = shape
  const onEllipse = (turn: number) => {
    const { x, y } = {
      x: (from.x + to.x) / 2 + (Math.abs(to.x - from.x) / 2) * Math.cos(turn),
      y: (from.y + to.y) / 2 + (Math.abs(to.y - from.y) / 2) * Math.sin(turn),
    }
    return placedPoint(shape, { x, y })
  }
  let length = 0
  let last = onEllipse(0)
  for (let sample = 1; sample <= ELLIPSE_SAMPLES; sample++) {
    const next = onEllipse((sample * 2 * Math.PI) / ELLIPSE_SAMPLES)
    length += Math.hypot(next.x - last.x, next.y - last.y)
    last = next
  }
  const count = Math.min(MAX_STEPS, Math.max(MIN_ELLIPSE_POINTS, Math.ceil(length / STEP)))
  return Array.from({ length: count }, (_, point) => onEllipse((point * 2 * Math.PI) / count))
}

// The outline of a shape on the paper, for the brush to go along and to fill. Straight sides stay straight, unless a
// mesh bends them
export function shapePath(shape: Shape): { points: Point[]; isClosed: boolean } {
  if (shape.kind === 'ellipse') return { points: ellipsePoints(shape), isClosed: true }
  const isClosed = shape.kind !== 'line'
  const corners = cornersOf(shape)
  const isBent = shape.placements.some(placement => placement.warp)
  const points: Point[] = []
  const last = isClosed ? corners.length : corners.length - 1
  for (let side = 0; side < last; side++) {
    const a = corners[side]
    const b = corners[(side + 1) % corners.length]
    const start = placedPoint(shape, a)
    const end = placedPoint(shape, b)
    const steps = isBent
      ? Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / STEP)))
      : 1
    for (let step = 0; step < steps; step++) {
      const share = step / steps
      points.push(placedPoint(shape, { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share }))
    }
  }
  if (!isClosed) points.push(placedPoint(shape, corners.at(-1)!))
  return { points, isClosed }
}

// Where the box goes up to, with the keys held: Shift keeps it square (a line, to a few angles), and Alt draws it from
// its middle. "from" is where the pointer went down
export function shapeBox(kind: ShapeKind, from: Point, pointer: Point, isEven: boolean, isFromMiddle: boolean) {
  let to = pointer
  if (isEven && kind === 'line') {
    to = straightLineEnd(from, pointer, true, false)
  } else if (isEven) {
    const side = Math.max(Math.abs(pointer.x - from.x), Math.abs(pointer.y - from.y))
    to = { x: from.x + Math.sign(pointer.x - from.x) * side, y: from.y + Math.sign(pointer.y - from.y) * side }
  }
  const start = isFromMiddle ? { x: 2 * from.x - to.x, y: 2 * from.y - to.y } : from
  return { from: start, to }
}
