import type { Dab } from './dabs'
import type { Point } from './selection'

// Symmetry (decision 77): what is painted on one side shows on the others too. Every tool that works through dabs asks
// for each dab's copies here, so a stroke and its copies are one stroke: one step of undo, and no darker where they cross.
//
// - "vertical": mirrored across a vertical line through the center, left and right
// - "horizontal": mirrored across a horizontal line, up and down
// - "both": both of them, in four parts
// - "radial": turned around the center, in "sectors" equal parts
//
// A mirrored dab has its tip mirrored too ("flipped" in dabs.ts), or a brush that isn't round would lean the wrong way.
//
// The lines can be turned around the center by "angle" (decision 88): the mirrors are then across the turned lines. The
// copies of a radial symmetry are the same at any angle: only its lines turn.

export const SYMMETRY_MODES = ['off', 'vertical', 'horizontal', 'both', 'radial'] as const
export type SymmetryMode = (typeof SYMMETRY_MODES)[number]

export const MIN_SECTORS = 2
export const MAX_SECTORS = 12
const DEFAULT_SECTORS = 6

export const SYMMETRY_ANGLE_STEP = 15 // degrees, with Shift on the handle that turns it
// The angle in hundredths of a degree: far from the center, a whole degree moves a line too far (35 pixels at 2000)
export const SYMMETRY_ANGLE_PRECISION = 0.01
export const roundAngle = (degrees: number) => Math.round(degrees * 100) / 100

// "angle": in degrees, clockwise, from -180 to 180
export type Symmetry = { mode: SymmetryMode; sectors: number; center: Point; angle: number }

// On whole or half pixels: so a mirrored pixel falls exactly on a pixel, and both sides are the same to the pixel
export const onHalfPixels = ({ x, y }: Point) => ({ x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 })

export const noSymmetry = (width: number, height: number): Symmetry => ({
  mode: 'off',
  sectors: DEFAULT_SECTORS,
  center: onHalfPixels({ x: width / 2, y: height / 2 }),
  angle: 0,
})

// A symmetry read from a file or an autosave: without an angle (before 1.1), it isn't turned
export function isSymmetry(value: unknown, width: number, height: number): value is Symmetry {
  if (typeof value !== 'object' || value === null) return false
  const { mode, sectors, center, angle } = value as Partial<Symmetry>
  return (
    SYMMETRY_MODES.includes(mode as SymmetryMode) &&
    Number.isInteger(sectors) &&
    sectors! >= MIN_SECTORS &&
    sectors! <= MAX_SECTORS &&
    typeof center?.x === 'number' &&
    typeof center?.y === 'number' &&
    center.x >= 0 &&
    center.x <= width &&
    center.y >= 0 &&
    center.y <= height &&
    (angle === undefined || (typeof angle === 'number' && Math.abs(angle) <= 180))
  )
}

// How many dabs each dab becomes
export function copiesOf({ mode, sectors }: Symmetry) {
  if (mode === 'off') return 1
  if (mode === 'both') return 4
  return mode === 'radial' ? sectors : 2
}

// The dab and its copies, the dab first and always in the same order. A pixel brush's dabs stay on the pixels, and its
// tip doesn't turn with the radial copies (see pixelTip.ts)
export function symmetricDabs(symmetry: Symmetry, dab: Dab, isPixel: boolean): Dab[] {
  const { mode, sectors, center } = symmetry
  if (mode === 'off') return [dab]
  // Turned around the center by "turn" (in radians), its tip too, except a pixel brush's
  const turned = (from: Dab, turn: number): Dab => {
    if (turn === 0) return from
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    const dx = from.x - center.x
    const dy = from.y - center.y
    return {
      ...from,
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
      angle: isPixel ? from.angle : from.angle + turn,
    }
  }
  const across = (from: Dab): Dab => ({
    ...from,
    x: 2 * center.x - from.x,
    angle: -from.angle,
    flipped: !from.flipped,
  })
  const down = (from: Dab): Dab => ({
    ...from,
    y: 2 * center.y - from.y,
    angle: Math.PI - from.angle,
    flipped: !from.flipped,
  })
  const onPixels = (copy: Dab): Dab => {
    if (!isPixel) return copy
    const half = copy.size / 2
    return { ...copy, x: Math.round(copy.x - half) + half, y: Math.round(copy.y - half) + half }
  }
  if (mode === 'radial') {
    return Array.from({ length: sectors }, (_, sector) =>
      sector === 0 ? dab : onPixels(turned(dab, (sector * 2 * Math.PI) / sectors)),
    )
  }
  // Turned lines mirror as if the drawing were turned back by their angle: turned, mirrored, and turned again
  const by = (symmetry.angle * Math.PI) / 180
  const mirrored = (mirror: (from: Dab) => Dab) => onPixels(turned(mirror(turned(dab, -by)), by))
  if (mode === 'vertical') return [dab, mirrored(across)]
  if (mode === 'horizontal') return [dab, mirrored(down)]
  return [dab, mirrored(across), mirrored(down), mirrored(from => down(across(from)))]
}
