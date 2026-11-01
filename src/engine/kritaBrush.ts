import { LydiaError } from '../errors'
import type { BrushShape } from './brushFile'
import { pixelsOfPng, roundTip, tipOfPng, type BrushPicture, type ForeignBrush, type LeftOut } from './foreignBrush'
import { readGbr, readGih } from './gimpBrush'
import { inflate, readZip } from './zipFile'

// Krita's brushes. A .kpp is a PNG image, the brush's picture in the list, with a text in it: an XML file with a long list
// of settings, each a <param> with a name. What it paints with is another file, which a .bundle (a ZIP file of presets,
// tips and patterns) has next to it, and which a preset of Krita 5 has inside itself. A preset of Krita 4 on its own
// doesn't have it. Only the "paintbrush" engine paints with copies of a tip, as Lydia does

const PNG_SIGNATURE_SIZE = 8
const CHUNK_OVERHEAD = 12
const PAINTBRUSH = 'paintbrush'
const WASH = '2' // the "PaintOpAction" of a stroke that doesn't pile up over itself
const LINEAR_CURVE = '0,0;1,1;'

type Settings = Map<string, string>
type Files = Map<string, Uint8Array> // by file name, with no folder

// The texts in a PNG image: "preset" is what matters here. Some are compressed
async function textsOfPng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const texts = new Map<string, string>()
  const decoder = new TextDecoder()
  let at = PNG_SIGNATURE_SIZE
  while (at + CHUNK_OVERHEAD <= bytes.length) {
    const size = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + size)
    const nameEnd = data.indexOf(0)
    if (type === 'tEXt')
      texts.set(decoder.decode(data.subarray(0, nameEnd)), decoder.decode(data.subarray(nameEnd + 1)))
    if (type === 'zTXt') {
      const text = await inflate(data.subarray(nameEnd + 2), 'deflate')
      texts.set(decoder.decode(data.subarray(0, nameEnd)), decoder.decode(text))
    }
    if (type === 'iTXt') {
      const isCompressed = data[nameEnd + 1] === 1
      const languageEnd = data.indexOf(0, nameEnd + 3)
      const translatedEnd = data.indexOf(0, languageEnd + 1)
      const text = data.subarray(translatedEnd + 1)
      const plain = isCompressed ? await inflate(text, 'deflate') : text
      texts.set(decoder.decode(data.subarray(0, nameEnd)), decoder.decode(plain))
    }
    if (type === 'IEND') break
    at += CHUNK_OVERHEAD + size
  }
  return texts
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text.replace(/\s+/g, '')), char => char.charCodeAt(0))
const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

// What a setting that can follow the pen is doing: whether it is on, what changes it, and whether its curve is its own
function sensorOf(settings: Settings, name: string) {
  const isOn = settings.get(`Pressure${name}`) !== 'false' && settings.get(`${name}UseCurve`) !== 'false'
  const text = settings.get(`${name}Sensor`) ?? ''
  const ids = [...text.matchAll(/\bid="(\w+)"/g)].map(match => match[1]).filter(id => id !== 'sensorslist')
  const curves = [...text.matchAll(/<curve>([^<]*)<\/curve>/g)].map(match => match[1].trim())
  return { isOn, ids, hasOwnCurve: curves.some(curve => curve !== LINEAR_CURVE) }
}

// Read one of the numbers of a setting, or of an attribute of the tip
const numberOf = (text: string | null | undefined, fallback: number) => {
  const value = Number(text)
  return text === null || text === undefined || text === '' || !Number.isFinite(value) ? fallback : value
}

// A tip Krita works out by itself. Its fades go in from the edge, as a part of the radius
function automaticTip(element: Element | null) {
  if (!element) return roundTip(0.5)
  const fade = Math.min(numberOf(element.getAttribute('hfade'), 0.5), numberOf(element.getAttribute('vfade'), 0.5))
  return roundTip(
    Math.max(0, 1 - fade),
    numberOf(element.getAttribute('ratio'), 1),
    numberOf(element.getAttribute('spikes'), 2),
    element.getAttribute('type') === 'rect',
  )
}

// A tip from a file. A .gih has many pictures, and a picture may have colors of its own
async function tipFromFile(name: string, files: Files, colorAsMask: boolean, leftOut: LeftOut[]) {
  const file = files.get(name)
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  try {
    if (file && extension === '.png') {
      const { picture, hasColors } = await tipOfPng(file)
      if (hasColors && !colorAsMask) leftOut.push('tipColors')
      return picture
    }
    if (file && (extension === '.gbr' || extension === '.gih')) {
      const tip = extension === '.gih' ? readGih(file) : { ...readGbr(file), frames: 1 }
      if (tip.hasColors && !colorAsMask) leftOut.push('tipColors')
      if (tip.frames > 1) leftOut.push('tipFrames')
      return tip.picture
    }
  } catch {
    // a file that can't be read is the same as one that isn't there
  }
  leftOut.push('tipMissing')
  return roundTip(0.5)
}

// The paper's grain from Krita's pattern. In Krita a light pixel lets the paint through and a dark one holds it, unless it
// is inverted. So where it lets the paint through, the paper is high
async function grainOf(settings: Settings, files: Files): Promise<BrushPicture | null> {
  const inside = settings.get('Texture/Pattern/Pattern')
  const name = baseName(settings.get('Texture/Pattern/PatternFileName') ?? settings.get('Texture/Pattern/Name') ?? '')
  let png: Uint8Array | undefined
  if (inside) {
    try {
      png = fromBase64(new TextDecoder().decode(fromBase64(inside))) // Krita writes it in base 64 twice
    } catch {
      png = undefined
    }
  }
  png ??= name.toLowerCase().endsWith('.png') ? files.get(name) : undefined
  if (!png) return null
  try {
    const { width, height, data } = await pixelsOfPng(png)
    const isInverted = settings.get('Texture/Pattern/Invert') === 'true'
    const values = new Uint8Array(width * height)
    for (let i = 0; i < values.length; i++) {
      const alpha = data[i * 4 + 3] / 255
      const gray = (data[i * 4] * 11 + data[i * 4 + 1] * 16 + data[i * 4 + 2] * 5) / 32
      const lets = gray * alpha + 255 * (1 - alpha)
      values[i] = isInverted ? 255 - lets : lets
    }
    return { width, height, values }
  } catch {
    return null
  }
}

function shapeOf(settings: Settings, brush: Element | null, leftOut: LeftOut[]) {
  const shape: Partial<BrushShape> = {}
  if (brush) {
    shape.spacing = numberOf(brush.getAttribute('spacing'), 0.1)
    if (brush.getAttribute('useAutoSpacing') === '1') {
      shape.rootSpacing = numberOf(brush.getAttribute('autoSpacingCoeff'), 1)
    }
    // In radians, and the other way round from Lydia's
    const angle = (numberOf(brush.getAttribute('angle'), 0) * 180) / Math.PI
    shape.angle = (((360 - angle) % 360) + 360) % 360
  }
  shape.flow = numberOf(settings.get('FlowValue'), 1) * numberOf(settings.get('OpacityValue'), 1)
  shape.wash = settings.get('PaintOpAction') === WASH

  const size = sensorOf(settings, 'Size')
  const opacity = sensorOf(settings, 'Opacity')
  const flow = sensorOf(settings, 'Flow')
  const rotation = sensorOf(settings, 'Rotation')
  const scatter = sensorOf(settings, 'Scatter')
  shape.pressureSize = size.isOn && size.ids.includes('pressure')
  shape.pressureFlow = [opacity, flow].some(({ isOn, ids }) => isOn && ids.includes('pressure'))
  if (rotation.isOn) {
    shape.followStroke = rotation.ids.includes('drawingangle')
    if (rotation.ids.some(id => id.startsWith('fuzzy'))) shape.angleJitter = numberOf(settings.get('RotationValue'), 1)
  }
  if (settings.get('PressureScatter') === 'true') {
    shape.scatter = numberOf(settings.get('ScatterValue') ?? settings.get('Scattering/Amount'), 0)
  }

  const known = ['pressure', 'drawingangle', 'fuzzy', 'fuzzystroke']
  const inUse = [size, opacity, flow, rotation, ...(settings.get('PressureScatter') === 'true' ? [scatter] : [])]
  if (inUse.some(({ isOn, ids }) => isOn && ids.some(id => !known.includes(id)))) leftOut.push('sensors')
  if (rotation.isOn && rotation.ids.includes('pressure')) leftOut.push('sensors')
  if (inUse.some(({ isOn, hasOwnCurve }) => isOn && hasOwnCurve)) leftOut.push('curves')
  return shape
}

async function readPreset(bytes: Uint8Array, fileName: string, outer: Files): Promise<ForeignBrush> {
  const xml = (await textsOfPng(bytes)).get('preset')
  if (!xml) throw new LydiaError('LYD-218')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const root = document.documentElement
  if (root.nodeName !== 'Preset') throw new LydiaError('LYD-218')

  const settings: Settings = new Map()
  for (const param of root.querySelectorAll(':scope > param')) {
    settings.set(param.getAttribute('name') ?? '', param.textContent ?? '')
  }
  // Krita 5 keeps what a preset needs inside it
  const files = new Map(outer)
  for (const resource of root.querySelectorAll(':scope > resources > resource')) {
    const name = baseName(resource.getAttribute('filename') ?? '')
    try {
      if (name) files.set(name, fromBase64(resource.textContent ?? ''))
    } catch {
      // read as if it weren't there
    }
  }

  const leftOut: LeftOut[] = []
  const engine = root.getAttribute('paintopid')
  if (engine !== PAINTBRUSH) leftOut.push('engine')

  const definition = settings.get('brush_definition')
  const parsed = definition ? new DOMParser().parseFromString(definition, 'application/xml') : null
  const brush = parsed?.documentElement.nodeName === 'Brush' ? parsed.documentElement : null
  const kind = brush?.getAttribute('type')

  let tip: BrushPicture
  if (kind === 'auto_brush') {
    tip = automaticTip(brush!.querySelector('MaskGenerator'))
    if (numberOf(brush!.getAttribute('density'), 1) < 1 || numberOf(brush!.getAttribute('randomness'), 0) > 0) {
      leftOut.push('effects')
    }
  } else if (brush) {
    const colorAsMask = brush.getAttribute('ColorAsMask') !== '0'
    tip = await tipFromFile(baseName(brush.getAttribute('filename') ?? ''), files, colorAsMask, leftOut)
  } else {
    if (engine === PAINTBRUSH) leftOut.push('tipMissing')
    tip = roundTip(0.5)
  }

  const shape = shapeOf(settings, brush, leftOut)
  if (settings.get('MaskingBrush/Enabled') === 'true') leftOut.push('secondTip')
  const mixing = settings.get('CompositeOp')
  if ((mixing && mixing !== 'normal') || settings.get('EraserMode') === 'true') leftOut.push('effects')

  let grain: BrushPicture | undefined
  if (settings.get('Texture/Pattern/Enabled') === 'true') {
    grain = (await grainOf(settings, files)) ?? undefined
    if (grain) {
      shape.grainDepth = numberOf(settings.get('Texture/Strength/Value'), 1)
      shape.grainScale = numberOf(settings.get('Texture/Pattern/Scale'), 1)
    } else leftOut.push('texture')
  }

  const name = root.getAttribute('name')?.trim() || fileName
  return { name, shape, tip, ...(grain && { grain }), leftOut: [...new Set(leftOut)] }
}

export const readKritaPreset = (fileName: string, bytes: Uint8Array) => readPreset(bytes, fileName, new Map())

// All the presets of a bundle, which may be more than a hundred. One that can't be read is left out, with its name
export async function readKritaBundle(bytes: Uint8Array) {
  const entries = readZip(bytes)
  const files: Files = new Map()
  for (const { name, read } of entries) {
    if (/^(brushes|patterns)\/[^/]+\.(png|gbr|gih)$/i.test(name)) files.set(baseName(name), await read())
  }
  const brushes: ForeignBrush[] = []
  const problems: { name: string; error: unknown }[] = []
  for (const { name, read } of entries) {
    if (!/^paintoppresets\/[^/]+\.kpp$/i.test(name)) continue
    try {
      brushes.push(await readPreset(await read(), baseName(name).slice(0, -'.kpp'.length), files))
    } catch (error) {
      problems.push({ name: baseName(name), error })
    }
  }
  return { brushes, problems }
}
