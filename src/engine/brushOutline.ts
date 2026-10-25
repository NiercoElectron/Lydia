import { PIXEL_PAINTS, type BrushTip } from './brushTip'
import { roundTipRows } from './pixelTip'
import type { Point } from './selection'

// The outline of a brush's tip, shown under the pointer (see view.ts) so that the size and the shape of the brush can
// be seen before painting

// The tip's picture is shrunk to at most this many squares across before its outline is worked out: enough to follow
// its shape, few enough to work it out at once and draw it every frame
const MAX_CELLS = 64
// The outline goes where the tip paints this much of the most it paints anywhere, so that a soft tip's outline is
// nearly as big as all it paints, and the small holes of a grainy tip are filled in
const PAINT_EDGE = 0.05
// Loops around less than this fraction of the tip's square are left out: specks of paint and holes in it
const SMALLEST_LOOP = 0.002
// How far, in squares, the outline may stray from its exact path, to keep fewer points
const SIMPLIFY = 0.3

// Each tip's outline, worked out once
const outlines = new WeakMap<BrushTip, Point[][]>()

// The outline of a smooth tip: closed loops of points, measured from the tip's center in sizes of the brush (the tip's
// longer side is 1), the way a dab places the tip (see dabPainter.ts). A tip painted in parts (Dashes) has a loop for
// each part
export function tipOutline(tip: BrushTip): Point[][] {
  let loops = outlines.get(tip)
  if (!loops) {
    loops = traceTip(tip)
    outlines.set(tip, loops)
  }
  return loops
}

function traceTip(tip: BrushTip): Point[][] {
  const { width, height } = tip.image
  const side = Math.max(width, height)
  const cell = Math.ceil(side / MAX_CELLS) // pixels of the tip on each side of a square
  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)

  // How much paint each square has on average, with a row of empty squares all around, so every loop closes
  const across = columns + 2
  const down = rows + 2
  const paint = new Float32Array(across * down)
  const data = tip.image.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      paint[(Math.floor(y / cell) + 1) * across + Math.floor(x / cell) + 1] += data[(y * width + x) * 4 + 3]
    }
  }
  let most = 0
  for (let i = 0; i < paint.length; i++) most = Math.max(most, paint[i])
  if (most === 0) return []
  const edge = most * PAINT_EDGE

  // Marching squares: the outline crosses the side between two neighboring squares where one has more paint than
  // "edge" and the other doesn't, at the place in between where the paint would be "edge". Each group of four
  // neighbors gives one or two pieces of the outline, joining the sides it crosses
  const crossings = new Map<string, Point>() // a side ("x,y" of its first square and "a" across or "d" down) -> where
  const joined = new Map<string, string[]>() // a side -> the sides it is joined to, two once all are found
  const isIn = (x: number, y: number) => paint[y * across + x] > edge
  // Where the outline crosses the side from square (x, y) to its neighbor across or down, in pixels of the tip
  function crossing(x: number, y: number, isAcross: boolean) {
    const key = `${x},${y}${isAcross ? 'a' : 'd'}`
    if (!crossings.has(key)) {
      const from = paint[y * across + x]
      const to = isAcross ? paint[y * across + x + 1] : paint[(y + 1) * across + x]
      const t = (edge - from) / (to - from)
      // A square's center is in the middle of its pixels; the empty squares around are one square outside the tip
      crossings.set(key, {
        x: (x - 0.5 + (isAcross ? t : 0)) * cell,
        y: (y - 0.5 + (isAcross ? 0 : t)) * cell,
      })
    }
    return key
  }
  function join(a: string, b: string) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const list = joined.get(from)
      if (list) list.push(to)
      else joined.set(from, [to])
    }
  }
  for (let y = 0; y < down - 1; y++) {
    for (let x = 0; x < across - 1; x++) {
      const topLeft = isIn(x, y)
      const topRight = isIn(x + 1, y)
      const bottomRight = isIn(x + 1, y + 1)
      const bottomLeft = isIn(x, y + 1)
      const sides: string[] = [] // the sides crossed, going round: top, right, bottom, left
      if (topLeft !== topRight) sides.push(crossing(x, y, true))
      if (topRight !== bottomRight) sides.push(crossing(x + 1, y, false))
      if (bottomLeft !== bottomRight) sides.push(crossing(x, y + 1, true))
      if (topLeft !== bottomLeft) sides.push(crossing(x, y, false))
      if (sides.length === 2) join(sides[0], sides[1])
      else if (sides.length === 4) {
        // Two opposite corners in and two out: the middle of the four decides whether the two in are joined. The
        // outline cuts off the top right corner (and the bottom left) when it differs from the middle
        const middle =
          (paint[y * across + x] +
            paint[y * across + x + 1] +
            paint[(y + 1) * across + x] +
            paint[(y + 1) * across + x + 1]) /
            4 >
          edge
        if (topRight !== middle) {
          join(sides[0], sides[1])
          join(sides[2], sides[3])
        } else {
          join(sides[0], sides[3])
          join(sides[1], sides[2])
        }
      }
    }
  }

  // Follow the joined pieces round into loops, then measure them from the tip's center in sizes of the brush
  const loops: Point[][] = []
  const done = new Set<string>()
  for (const start of joined.keys()) {
    if (done.has(start)) continue
    const loop: Point[] = []
    let previous = ''
    let key = start
    while (!done.has(key)) {
      done.add(key)
      loop.push(crossings.get(key)!)
      const [a, b] = joined.get(key)!
      const next = a === previous ? b : a
      previous = key
      key = next
    }
    if (Math.abs(area(loop)) < SMALLEST_LOOP * side * side) continue
    loops.push(
      simplify(loop, SIMPLIFY * cell).map(p => ({ x: (p.x - width / 2) / side, y: (p.y - height / 2) / side })),
    )
  }
  return loops
}

// The area inside a loop (negative when it goes round the other way)
function area(loop: Point[]) {
  let sum = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

// The same loop with fewer points, none of the left out ones further than "tolerance" from it (Ramer–Douglas–Peucker):
// the loop is cut in two at the point furthest from its first one, and each half keeps only the points that stray
// from the line between its ends
function simplify(loop: Point[], tolerance: number): Point[] {
  if (loop.length < 4) return loop
  let far = 0
  let farthest = 0
  for (let i = 1; i < loop.length; i++) {
    const distance = Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y)
    if (distance > farthest) {
      farthest = distance
      far = i
    }
  }
  const kept = [loop[0]]
  keepStraying(loop, 0, far, tolerance, kept)
  kept.push(loop[far])
  keepStraying([...loop, loop[0]], far, loop.length, tolerance, kept)
  return kept
}

// Add to "kept" the points between "first" and "last" (left out themselves) that stray further than "tolerance" from
// the line between them, in order
function keepStraying(points: Point[], first: number, last: number, tolerance: number, kept: Point[]) {
  const a = points[first]
  const b = points[last]
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  let far = -1
  let farthest = tolerance
  for (let i = first + 1; i < last; i++) {
    const p = points[i]
    const distance =
      length === 0
        ? Math.hypot(p.x - a.x, p.y - a.y)
        : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length
    if (distance > farthest) {
      farthest = distance
      far = i
    }
  }
  if (far === -1) return
  keepStraying(points, first, far, tolerance, kept)
  kept.push(points[far])
  keepStraying(points, far, last, tolerance, kept)
}

// The outline of a pixel brush's tip at this brush size, along the edges of the pixels it would paint with the pointer
// at "center", placed as a pixel dab is (see dabs.ts). A drawn tip is a whole multiple of its picture's size
export function pixelBrushOutline(tip: BrushTip, isDrawn: boolean, size: number, center: Point): Point[][] {
  let loops: Point[][]
  let width: number
  let height: number
  let times = 1
  if (isDrawn) {
    times = Math.max(1, Math.round(size / Math.max(tip.image.width, tip.image.height)))
    width = tip.image.width * times
    height = tip.image.height * times
    loops = drawnTipOutline(tip)
  } else {
    width = height = Math.max(1, Math.round(size))
    loops = [pixelTipOutline(width)]
  }
  const left = Math.round(center.x - width / 2)
  const top = Math.round(center.y - height / 2)
  return loops.map(loop => loop.map(p => ({ x: left + p.x * times, y: top + p.y * times })))
}

// Each drawn tip's outline, worked out once
const drawnOutlines = new WeakMap<BrushTip, Point[][]>()

// The outline of a drawn pixel tip at 1×, from its top left corner, along the edges between its pixels that paint and
// those that don't: a loop around each part of it, and around each hole
function drawnTipOutline(tip: BrushTip): Point[][] {
  let loops = drawnOutlines.get(tip)
  if (loops) return loops
  const { width, height } = tip.image
  const data = tip.image.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data
  const paints = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= PIXEL_PAINTS
  // The edges, each going clockwise around the pixel that paints, by the corner they start from ("x,y" -> where
  // each one from there goes). Every corner has as many edges coming in as going out, so following them always leads
  // back to where it started
  const edges = new Map<string, Point[]>()
  const add = (from: Point, to: Point) => {
    const key = `${from.x},${from.y}`
    const list = edges.get(key)
    if (list) list.push(to)
    else edges.set(key, [to])
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!paints(x, y)) continue
      if (!paints(x, y - 1)) add({ x, y }, { x: x + 1, y })
      if (!paints(x + 1, y)) add({ x: x + 1, y }, { x: x + 1, y: y + 1 })
      if (!paints(x, y + 1)) add({ x: x + 1, y: y + 1 }, { x, y: y + 1 })
      if (!paints(x - 1, y)) add({ x, y: y + 1 }, { x, y })
    }
  }
  loops = []
  for (const [start, list] of edges) {
    while (list.length > 0) {
      const [x, y] = start.split(',').map(Number)
      const loop: Point[] = [{ x, y }]
      let to = list.pop()!
      while (`${to.x},${to.y}` !== start) {
        loop.push(to)
        to = edges.get(`${to.x},${to.y}`)!.pop()!
      }
      loops.push(withoutStraightPoints(loop))
    }
  }
  drawnOutlines.set(tip, loops)
  return loops
}

// The same loop without the points where its edge goes straight on, along the edges of pixels
function withoutStraightPoints(loop: Point[]) {
  return loop.filter((p, i) => {
    const before = loop[(i + loop.length - 1) % loop.length]
    const after = loop[(i + 1) % loop.length]
    return !((before.x === p.x && p.x === after.x) || (before.y === p.y && p.y === after.y))
  })
}

// The outline of a pixel brush's round tip of this size (see pixelTip.ts), along the edges of the pixels it paints,
// from the tip's top left corner: down its right side, row by row, and back up its left side
function pixelTipOutline(size: number): Point[] {
  const rows = roundTipRows(size)
  const right: Point[] = []
  const left: Point[] = []
  rows.forEach((count, row) => {
    const start = (size - count) / 2
    right.push({ x: start + count, y: row }, { x: start + count, y: row + 1 })
    left.push({ x: start, y: row }, { x: start, y: row + 1 })
  })
  return withoutStraightPoints([...right, ...left.reverse()])
}
