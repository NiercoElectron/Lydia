import type { StrokePoint } from './dabs'

// The stabilizer smooths strokes: the brush doesn't paint exactly where the pen is, but follows it, so that a shaky
// hand draws smooth lines. It works in one of two ways, as in Photoshop and Krita:
// - "smooth": the brush chases the pen, closing part of the distance at every moment, so it lags behind it and cuts
//   its wobbles and corners. The stronger, the slower it closes in. When the pen holds still, the brush keeps going
//   until it reaches it
// - "string": the pen pulls the brush on a string. The brush stays where it is while the pen moves within the string's
//   length, and is pulled straight toward the pen when it goes further, so small wobbles never reach the paper
// When the pen comes up, the stroke goes on straight to where it left, so lines end where they were drawn to
export type StabilizerMode = 'smooth' | 'string'
export type StabilizerSettings = { mode: StabilizerMode; strength: number } // from 0 (off) to MAX_STABILIZER

export const MAX_STABILIZER = 100
export const STABILIZER_MODES: readonly StabilizerMode[] = ['smooth', 'string']
export const DEFAULT_STABILIZER: StabilizerSettings = { mode: 'smooth', strength: 0 }

// At full strength, the smooth brush closes about two thirds of its distance to the pen in this many milliseconds. It
// grows with the square of the strength, so the low strengths, for a light touch, get more of the slider
const SLOWEST_MS = 300
// At full strength, the string is this many pixels of the screen long: it feels the same at any zoom
const LONGEST_STRING = 80
// Between two points of the pen, the smooth brush is worked out at least every this many milliseconds, along the line
// between them, so it follows a curve and not a few jumps. At most this many times, after a long pause
const STEP_MS = 4
const MAX_STEPS = 64
// Closer than this to the pen (in pixels of the paper), the smooth brush has reached it and stops
const CLOSE_ENOUGH = 0.01

// A stroke's stabilizer, from the point where the pen went down, at the view's zoom then. "now" is the time, in
// milliseconds (performance.now()). Each function returns the points the brush passes through, to paint along them
export function createStabilizer(settings: StabilizerSettings, start: StrokePoint, zoom: number, now: number) {
  const share = settings.strength / MAX_STABILIZER
  const slowness = SLOWEST_MS * share * share
  const stringLength = (LONGEST_STRING * share) / zoom
  let pen = { ...start }
  const brush = { ...start }
  let time = now

  // The smooth brush chases "target" for "elapsed" milliseconds
  function chase(target: StrokePoint, elapsed: number) {
    const closed = 1 - Math.exp(-elapsed / slowness)
    brush.x += (target.x - brush.x) * closed
    brush.y += (target.y - brush.y) * closed
    brush.pressure += (target.pressure - brush.pressure) * closed
  }

  // The pen moved through these points since the last time. Those the browser grouped into one event came over the
  // time since then, evenly as far as can be told
  function follow(points: StrokePoint[], now: number): StrokePoint[] {
    const passed: StrokePoint[] = []
    if (settings.mode === 'string') {
      for (const point of points) {
        pen = { ...point }
        const distance = Math.hypot(pen.x - brush.x, pen.y - brush.y)
        if (distance <= stringLength) continue
        const pulled = (distance - stringLength) / distance
        brush.x += (pen.x - brush.x) * pulled
        brush.y += (pen.y - brush.y) * pulled
        brush.pressure = pen.pressure
        passed.push({ ...brush })
      }
      return passed
    }
    const elapsed = Math.max(0, now - time) / Math.max(1, points.length)
    time = now
    for (const point of points) {
      const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(elapsed / STEP_MS)))
      for (let step = 1; step <= steps; step++) {
        const t = step / steps
        const target = {
          x: pen.x + (point.x - pen.x) * t,
          y: pen.y + (point.y - pen.y) * t,
          pressure: pen.pressure + (point.pressure - pen.pressure) * t,
        }
        chase(target, elapsed / steps)
        passed.push({ ...brush })
      }
      pen = { ...point }
    }
    return passed
  }

  // Time passed without the pen moving: the smooth brush goes on toward it. Called every frame
  function wait(now: number): StrokePoint[] {
    const elapsed = Math.max(0, now - time)
    time = now
    if (settings.mode === 'string' || Math.hypot(pen.x - brush.x, pen.y - brush.y) < CLOSE_ENOUGH) return []
    const passed: StrokePoint[] = []
    const steps = Math.min(MAX_STEPS, Math.ceil(elapsed / STEP_MS))
    for (let step = 0; step < steps; step++) {
      chase(pen, elapsed / steps)
      passed.push({ ...brush })
    }
    return passed
  }

  // The pen came up: the stroke goes straight on to where it left
  function finish(): StrokePoint[] {
    if (Math.hypot(pen.x - brush.x, pen.y - brush.y) < CLOSE_ENOUGH) return []
    Object.assign(brush, pen)
    return [{ ...pen }]
  }

  return {
    follow,
    wait,
    finish,
    brushAt: () => ({ x: brush.x, y: brush.y }), // where the brush is now
  }
}

export type Stabilizer = ReturnType<typeof createStabilizer>
