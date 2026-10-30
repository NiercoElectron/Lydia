// Colors as the color panel works with them (decision 65, see ColorPanel.tsx): hue, saturation and value ("HSV"),
// while the rest of Lydia uses "#rrggbb". And the triangle of the panel: where each color is in it

// h: the hue, in degrees from 0 to 360 (red, then yellow, green, cyan, blue, magenta). s and v: from 0 to 1, how far
// from gray and how far from black
export type Hsv = { h: number; s: number; v: number }

// The color as red, green and blue, from 0 to 255
export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return [channel(5), channel(3), channel(1)]
}

export function hsvToHex(hsv: Hsv) {
  return (
    '#' +
    hsvToRgb(hsv)
      .map(value => Math.round(value).toString(16).padStart(2, '0'))
      .join('')
  )
}

// A "#rrggbb" color as HSV. A gray has no hue, and black no saturation either: they keep the ones of "previous", so
// picking black or white doesn't send the panel back to red
export function hexToHsv(hex: string, previous: Hsv = { h: 0, s: 0, v: 0 }): Hsv {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const range = max - Math.min(r, g, b)
  const v = max
  const s = max === 0 ? previous.s : range / max
  let h = previous.h
  if (range > 0) {
    if (max === r) h = 60 * (((g - b) / range + 6) % 6)
    else if (max === g) h = 60 * ((b - r) / range + 2)
    else h = 60 * ((r - g) / range + 4)
  }
  return { h, s, v }
}

// A color typed as text: "#3a7bd5", "3a7bd5", "#37d" or "37d", in capitals or not. Returns "#rrggbb", or null when it
// isn't one
export function parseHex(text: string) {
  const digits = text.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(digits)) return '#' + digits
  if (/^[0-9a-f]{3}$/.test(digits)) return '#' + [...digits].map(digit => digit + digit).join('')
  return null
}

// ----- The triangle -----

export type Point = { x: number; y: number }

// The corners of the triangle inside a circle of this radius around (0, 0), turned to the hue: the pure color points
// at its hue on the ring, white is a third of a turn further, black two thirds. Angles go round as the hues on the
// ring do: red on the right, then up (the screen's y goes down)
export function triangleCorners(hue: number, radius: number) {
  const corner = (degrees: number) => {
    const angle = (degrees * Math.PI) / 180
    return { x: radius * Math.cos(angle), y: -radius * Math.sin(angle) }
  }
  return { pure: corner(hue), white: corner(hue + 120), black: corner(hue + 240) }
}

// Where a saturation and a value are in the triangle: as much of each corner as the color has of it. The pure color's
// share is s × v, white's the rest of v, black's what v leaves
export function trianglePoint(hue: number, s: number, v: number, radius: number): Point {
  const { pure, white, black } = triangleCorners(hue, radius)
  const a = s * v
  const b = v - a
  const c = 1 - v
  return { x: a * pure.x + b * white.x + c * black.x, y: a * pure.y + b * white.y + c * black.y }
}

// The saturation and value at a point, the other way round. A point outside the triangle counts as the nearest point
// of its edge, so dragging past it keeps going along the edge
export function triangleColor(hue: number, point: Point, radius: number) {
  const { pure, white, black } = triangleCorners(hue, radius)
  const inside = shares(point, pure, white, black)
  const [a, b] = inside.some(share => share < 0)
    ? shares(nearestOnEdge(point, [pure, white, black]), pure, white, black).map(share => Math.max(0, share))
    : inside
  const v = Math.min(1, a + b)
  return { s: v > 0 ? Math.min(1, a / (a + b)) : 0, v }
}

// How much of each corner a point is made of (its "barycentric" coordinates): they add up to 1, all of them at least 0
// inside the triangle
function shares(p: Point, a: Point, b: Point, c: Point): [number, number, number] {
  const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
  const first = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / area
  const second = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / area
  return [first, second, 1 - first - second]
}

// The point of the triangle's edges nearest to p
function nearestOnEdge(p: Point, corners: Point[]) {
  let best = corners[0]
  let bestDistance = Infinity
  for (let i = 0; i < 3; i++) {
    const from = corners[i]
    const to = corners[(i + 1) % 3]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const along = Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy) / (dx * dx + dy * dy)))
    const point = { x: from.x + along * dx, y: from.y + along * dy }
    const distance = Math.hypot(p.x - point.x, p.y - point.y)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  return best
}
