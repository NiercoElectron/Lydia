// The fonts of text (see text.ts): the open ones that come with Lydia, the same on any computer, and the computer's own

export const INCLUDED_FONTS = [
  'Inter',
  'Lora',
  'Roboto Mono',
  'Oswald',
  'Comic Neue',
  'Bangers',
  'Caveat',
  'Pacifico',
  'Press Start 2P',
]

// Each font's letters come in two files: the browser fetches the second only for a letter from it
const LETTERS: Record<string, string> = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,' +
    'U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext':
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,' +
    'U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
}

const FILES = import.meta.glob(
  [
    '../../node_modules/@fontsource/*/files/*-latin{,-ext}-{400,700}-{normal,italic}.woff2',
    '!../../node_modules/@fontsource/ibm-plex-sans/**', // the interface's font, not one for text
  ],
  {
    query: '?url',
    import: 'default',
    eager: true,
  },
) as Record<string, string>

const familyOf = new Map(INCLUDED_FONTS.map(font => [font.toLowerCase().replaceAll(' ', '-'), font]))

for (const [path, url] of Object.entries(FILES)) {
  const [, name, letters, weight, style] = path.match(/([^/]+)-(latin(?:-ext)?)-(\d+)-(\w+)\.woff2$/)!
  const family = familyOf.get(name)
  if (family) document.fonts.add(new FontFace(family, `url(${url})`, { weight, style, unicodeRange: LETTERS[letters] }))
}

// Whether a font can be used here. A browser doesn't say, but a font it doesn't have falls back on the next one, so the
// same words come out as wide as in that one
const ruler = new OffscreenCanvas(1, 1).getContext('2d')!
const PROBE = 'mmmmmmmmmmlli WQ@ 0123'

export function isFontHere(font: string) {
  if (INCLUDED_FONTS.includes(font)) return true
  return ['serif', 'monospace'].some(fallback => {
    ruler.font = `72px ${fallback}`
    const width = ruler.measureText(PROBE).width
    ruler.font = `72px "${font}", ${fallback}`
    return ruler.measureText(PROBE).width !== width
  })
}

// The names of the computer's fonts, in browsers that can list them. Chrome asks for permission the first time, so
// "ask" comes from a click; a browser with the permission already given just lists them. null: it can't, or wasn't let
type FontLister = { queryLocalFonts?: () => Promise<{ family: string }[]> }

export const canListFonts = () => (window as FontLister).queryLocalFonts !== undefined

export async function computerFonts(ask: boolean) {
  try {
    if (!canListFonts()) return null
    if (!ask) {
      const { state } = await navigator.permissions.query({ name: 'local-fonts' as PermissionName })
      if (state !== 'granted') return null
    }
    const fonts = await (window as FontLister).queryLocalFonts!()
    return [...new Set(fonts.map(font => font.family))].sort((a, b) => a.localeCompare(b))
  } catch {
    return null
  }
}
