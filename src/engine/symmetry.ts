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

export const SYMMETRY_MODES = ['off', 'vertical', 'horizontal', 'both', 'radial'] as const
export type SymmetryMode = (typeof SYMMETRY_MODES)[number]

export const MIN_SECTORS = 2
export const MAX_SECTORS = 12
const DEFAULT_SECTORS = 6

export type Symmetry = { mode: SymmetryMode; sectors: number; center: Point }

// On whole or half pixels: so a mirrored pixel falls exactly on a pixel, and both sides are the same to the pixel
export const onHalfPixels = ({ x, y }: Point) => ({ x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 })

export const noSymmetry = (width: number, height: number): Symmetry => ({
  mode: 'off',
  sectors: DEFAULT_SECTORS,
  center: onHalfPixels({ x: width / 2, y: height / 2 }),
})

export function isSymmetry(value: unknown, width: number, height: number): value is Symmetry {
  if (typeof value !== 'object' || value === null) return false
  const { mode, sectors, center } = value as Partial<Symmetry>
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
    center.y <= height
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
  if (mode === 'vertical') return [dab, onPixels(across(dab))]
  if (mode === 'horizontal') return [dab, onPixels(down(dab))]
  if (mode === 'both') return [dab, onPixels(across(dab)), onPixels(down(dab)), onPixels(down(across(dab)))]
  const dx = dab.x - center.x
  const dy = dab.y - center.y
  const turned = (sector: number): Dab => {
    if (sector === 0) return dab
    const turn = (sector * 2 * Math.PI) / sectors
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    return onPixels({
      ...dab,
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
      angle: isPixel ? dab.angle : dab.angle + turn,
    })
  }
  return Array.from({ length: sectors }, (_, sector) => turned(sector))
}
