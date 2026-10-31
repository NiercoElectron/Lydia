import type { Point } from './selection'

// The mesh of a transform (decision 72): a grid of points that bend a smart object, like Photoshop's Warp. A curved
// surface goes through all of them (Catmull-Rom, each way), so dragging a point makes a curve with no corners.
//
// The points are in the object's own square, from (0, 0) at its top left corner to (1, 1) at its bottom right, where an
// unbent mesh has them evenly spread. So a mesh and the transform's four corners work together: the mesh bends the
// object inside its square, and the corners then put that square on the paper
export type Warp = {
  side: number // how many points each way
  points: Point[] // row by row, from the top left
}

export const WARP_SIDES = [3, 4, 5, 6]
export const DEFAULT_WARP_SIDE = 4

export function flatWarp(side: number): Warp {
  const points: Point[] = []
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) points.push({ x: column / (side - 1), y: row / (side - 1) })
  }
  return { side, points }
}

// Whether a mesh bends nothing, so the object doesn't need one
export function isFlatWarp({ side, points }: Warp) {
  const flat = flatWarp(side).points
  return points.every((point, i) => Math.abs(point.x - flat[i].x) < 1e-6 && Math.abs(point.y - flat[i].y) < 1e-6)
}

// The Catmull-Rom curve through "b" and "c", "t" of the way from one to the other
function curve(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
}

// One of the numbers of the points of a mesh, with a row more on each side: the curves near the edge need points past
// it, which follow the line of the last two
function withEdges(side: number, value: (point: Point) => number, points: Point[]) {
  const wide = side + 2
  const values = new Float64Array(wide * wide)
  const at = (column: number, row: number): number => {
    if (column < 0) return 2 * at(0, row) - at(1, row)
    if (column >= side) return 2 * at(side - 1, row) - at(side - 2, row)
    if (row < 0) return 2 * at(column, 0) - at(column, 1)
    if (row >= side) return 2 * at(column, side - 1) - at(column, side - 2)
    return value(points[row * side + column])
  }
  for (let row = 0; row < wide; row++) {
    for (let column = 0; column < wide; column++) values[row * wide + column] = at(column - 1, row - 1)
  }
  return values
}

// A surface is worked out for thousands of points each time a point of the mesh moves (see smartObject.ts), so the
// numbers above are kept for each mesh
const edges = new WeakMap<Warp, { xs: Float64Array; ys: Float64Array }>()

function edgesOf(warp: Warp) {
  let found = edges.get(warp)
  if (!found) {
    found = {
      xs: withEdges(warp.side, point => point.x, warp.points),
      ys: withEdges(warp.side, point => point.y, warp.points),
    }
    edges.set(warp, found)
  }
  return found
}

// One of the numbers of a point of the surface, in the cell whose first point is "first" of the numbers, "across" and
// "down" of the way through it
function surface(values: Float64Array, first: number, wide: number, across: number, down: number) {
  const rowAt = (i: number) => curve(values[i - 1], values[i], values[i + 1], values[i + 2], across)
  return curve(rowAt(first - wide), rowAt(first), rowAt(first + wide), rowAt(first + 2 * wide), down)
}

// Where a point of the object's square goes. Points just outside the square move along with its edge
export function warpPoint(warp: Warp, u: number, v: number): Point {
  const insideU = Math.min(1, Math.max(0, u))
  const insideV = Math.min(1, Math.max(0, v))
  const { xs, ys } = edgesOf(warp)
  const last = warp.side - 1
  const wide = warp.side + 2
  const column = Math.min(last - 1, Math.floor(insideU * last))
  const row = Math.min(last - 1, Math.floor(insideV * last))
  const across = insideU * last - column
  const down = insideV * last - row
  const first = (row + 1) * wide + column + 1
  return {
    x: surface(xs, first, wide, across, down) + u - insideU,
    y: surface(ys, first, wide, across, down) + v - insideV,
  }
}

// The same surface, as nearly as this many points each way can follow it
export function resizedWarp(warp: Warp, side: number): Warp {
  if (side === warp.side) return warp
  const points: Point[] = []
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      points.push(warpPoint(warp, column / (side - 1), row / (side - 1)))
    }
  }
  return { side, points }
}
