// Cursors drawn from Lucide's icons (the ones on the tools' buttons), black with a white edge so they show on any
// color

// A cursor from an icon's paths, on a grid of 24×24, that points at (x, y). Browsers that can't show it use "fallback"
function iconCursor(paths: string[], x: number, y: number, fallback: string) {
  const draw = (color: string, width: number) =>
    `<g stroke="${color}" stroke-width="${width}">${paths.map(d => `<path d="${d}"/>`).join('')}</g>`
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke-linecap="round" ' +
    `stroke-linejoin="round">${draw('#fff', 4)}${draw('#000', 2)}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`
}

// The eyedropper picks the color under its tip
export const EYEDROPPER_CURSOR = iconCursor(
  [
    'm12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12',
    'm18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z',
    'm2 22 .414-.414',
  ],
  2,
  22,
  'crosshair',
)

// The fill bucket fills where its drop falls
export const FILL_CURSOR = iconCursor(
  [
    'M11 7 6 2',
    'M18.992 12H2.041',
    'M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595',
    'm8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33',
  ],
  20,
  21,
  'crosshair',
)

// Turning the view: an arrow going round
export const ROTATE_CURSOR = iconCursor(
  ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  12,
  12,
  'grab',
)
