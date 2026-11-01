import {
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
  type WebGLRenderer,
} from 'pixi.js'
import type { GpuTiles } from './gpuTiles'
import { createLayer, type Layer } from './layers'
import type { History } from './history'
import type { Projection } from './projection'
import { createTileWriter, type LayerSelection } from './tileWriter'
import { isOnPaper, parseTileKey, TILE_SIZE, tileKey, tilesInRect, type Grid } from './tiles'

// Filters (decision 80): hue and saturation, levels and a Gaussian blur, on the active layer or what is selected in it.
//
// While the controls are open, the layer's tiles in RAM stay as they were, and a copy of the list of them (the "source")
// is what the filter reads. Only the tiles on the screen are worked out, and go in the layer's place on the graphics card,
// without being marked as painted: so saving, undo and the autosave still see the layer as it was. All of them are worked
// out and shown in the same frame: a few every frame would leave tiles of different values side by side while a slider
// moves, and showing them together once they are all ready would lag behind it. Most of the time a tile takes goes to the
// graphics card, which a frame of a big drawing uses up, so the slider's latest value is what shows next. Cancel lets those
// tiles go. Apply works out all the tiles from the source, as one step of undo.

export const FILTER_KINDS = ['hue', 'levels', 'blur'] as const
export type FilterKind = (typeof FILTER_KINDS)[number]

export type FilterSettings =
  | { kind: 'hue'; hue: number; saturation: number; lightness: number } // -180 to 180°, then -100 to 100 %
  | { kind: 'levels'; black: number; middle: number; white: number; outputBlack: number; outputWhite: number }
  | { kind: 'blur'; radius: number } // in pixels of the paper

// A change to the settings of the filter that is open
export type FilterChange = Partial<Record<string, number>>

export const MAX_BLUR_RADIUS = 250
export const MIN_MIDDLE = 0.1 // levels: below 1 the middle tones get darker, above it lighter
export const MAX_MIDDLE = 4

const STARTING_SETTINGS: Record<FilterKind, FilterSettings> = {
  hue: { kind: 'hue', hue: 0, saturation: 0, lightness: 0 },
  levels: { kind: 'levels', black: 0, middle: 1, white: 255, outputBlack: 0, outputWhite: 255 },
  blur: { kind: 'blur', radius: 8 },
}

// A blur is worked out on a picture of the layer made smaller, by a power of 2, until its radius there is below this: it
// looks the same, and costs about the same at any radius. The power of 2 keeps the tiles' pixels lined up, so no seam shows
const MAX_SMALL_RADIUS = 4
const MAX_BLUR_SCALE = TILE_SIZE / 4
const GAUSSIAN_REACH = 3 // how many radii a Gaussian blur goes on for: past that, it adds nothing that shows
const MAX_WIDE_BLUR = 4096 // the biggest picture the preview of a blur is worked out on, in pixels on each side

const vertex = `in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uSize;

void main(void) {
  vec3 position = vec3(aPosition * uSize, 1.0);
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * position).xy, 0.0, 1.0);
  vUV = aUV;
}
`

// The tiles' colors are multiplied by their alpha: a filter works on the color itself
const hueFragment = `in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uPicture;
uniform float uHue; // in turns
uniform float uSaturation; // from -1 to 1
uniform float uLightness; // from -1 to 1

vec3 toHsl(vec3 c) {
  float high = max(c.r, max(c.g, c.b));
  float low = min(c.r, min(c.g, c.b));
  float lightness = (high + low) / 2.0;
  float chroma = high - low;
  if (chroma == 0.0) return vec3(0.0, 0.0, lightness);
  float saturation = chroma / (1.0 - abs(2.0 * lightness - 1.0));
  float hue = high == c.r ? mod((c.g - c.b) / chroma, 6.0) : high == c.g ? (c.b - c.r) / chroma + 2.0 : (c.r - c.g) / chroma + 4.0;
  return vec3(hue / 6.0, saturation, lightness);
}

vec3 toRgb(vec3 hsl) {
  float chroma = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  vec3 channels = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hsl.z + chroma * (channels - 0.5);
}

void main(void) {
  vec4 picture = texture(uPicture, vUV);
  if (picture.a == 0.0) {
    finalColor = vec4(0.0);
    return;
  }
  vec3 hsl = toHsl(picture.rgb / picture.a);
  hsl.x = fract(hsl.x + uHue);
  hsl.y = clamp(uSaturation < 0.0 ? hsl.y * (1.0 + uSaturation) : hsl.y + (1.0 - hsl.y) * uSaturation * hsl.y, 0.0, 1.0);
  hsl.z = uLightness < 0.0 ? hsl.z * (1.0 + uLightness) : hsl.z + (1.0 - hsl.z) * uLightness;
  finalColor = vec4(toRgb(hsl) * picture.a, picture.a);
}
`

const levelsFragment = `in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uPicture;
uniform float uBlack;
uniform float uWhite;
uniform float uMiddle;
uniform float uOutputBlack;
uniform float uOutputWhite;

void main(void) {
  vec4 picture = texture(uPicture, vUV);
  if (picture.a == 0.0) {
    finalColor = vec4(0.0);
    return;
  }
  vec3 color = clamp((picture.rgb / picture.a - uBlack) / max(uWhite - uBlack, 0.001), 0.0, 1.0);
  color = pow(color, vec3(1.0 / uMiddle));
  finalColor = vec4(mix(vec3(uOutputBlack), vec3(uOutputWhite), color) * picture.a, picture.a);
}
`

const blurFragment = `in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uPicture;
uniform vec2 uStep; // from one pixel of the picture to the next, along the way it blurs
uniform float uRadius;
// Where the paper starts and ends along that way, as parts of the picture's size: outside it there is nothing to mix in,
// so the edge of a layer that covers the paper doesn't fade
uniform vec2 uAxis;
uniform float uPaperFirst;
uniform float uPaperEnd;

void main(void) {
  vec4 sum = vec4(0.0);
  float weights = 0.0;
  for (float i = -${MAX_SMALL_RADIUS * GAUSSIAN_REACH}.0; i <= ${MAX_SMALL_RADIUS * GAUSSIAN_REACH}.0; i += 1.0) {
    vec2 place = vUV + i * uStep;
    float along = dot(place, uAxis);
    if (along < uPaperFirst || along >= uPaperEnd) continue;
    float weight = exp(-0.5 * i * i / (uRadius * uRadius));
    sum += texture(uPicture, place) * weight;
    weights += weight;
  }
  finalColor = weights > 0.0 ? sum / weights : vec4(0.0);
}
`

type TileArea = NonNullable<ReturnType<typeof tilesInRect>>

type Session = {
  layer: Layer
  source: Layer // the layer's tiles as they were
  settings: FilterSettings
  keys: Set<string> // the tiles the filter can change, with these settings
  done: Set<string> // the tiles worked out with "doneWith"
  doneWith: FilterSettings | null
  shown: Set<string> // those that show something else than the layer in RAM
  small: Map<number, Map<string, RenderTexture>> // the source's tiles made smaller, by how many times (see smallTile)
}

export function createFilters(
  renderer: WebGLRenderer,
  grid: Grid,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
  selection: LayerSelection,
) {
  const writer = createTileWriter(renderer, gpu, projection, history, selection)
  const { clear, draw } = writer

  // ----- Drawing on the graphics card -----

  // A pass of a shader: a square of 1×1, stretched over the whole target
  const square = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const geometry = new MeshGeometry({ positions: square, uvs: square, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) })

  function createPass(name: string, fragment: string, values: Record<string, { value: unknown; type: string }>) {
    const size = new UniformGroup({ uSize: { value: new Float32Array(2), type: 'vec2<f32>' } })
    const uniforms = new UniformGroup(values as ConstructorParameters<typeof UniformGroup>[0])
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex, fragment, name, preferredFragmentPrecision: 'highp' }),
      resources: { filterSize: size, filterValues: uniforms, uPicture: Texture.EMPTY.source },
    })
    const root = new Container()
    root.addChild(new Mesh({ geometry, shader }))
    function run(picture: Texture, target: RenderTexture, change: (values: Record<string, unknown>) => void) {
      size.uniforms.uSize.set([target.width, target.height])
      size.update()
      change(uniforms.uniforms)
      uniforms.update()
      shader.resources.uPicture = picture.source
      renderer.render({ container: root, target, clear: true, clearColor: [0, 0, 0, 0] })
      shader.resources.uPicture = Texture.EMPTY.source // the shader keeps none of the tiles, which are let go of elsewhere
    }
    return { run, destroy: () => root.destroy({ children: true }) }
  }

  const float = (value: number) => ({ value, type: 'f32' })
  const huePass = createPass('filter-hue', hueFragment, {
    uHue: float(0),
    uSaturation: float(0),
    uLightness: float(0),
  })
  const levelsPass = createPass('filter-levels', levelsFragment, {
    uBlack: float(0),
    uWhite: float(1),
    uMiddle: float(1),
    uOutputBlack: float(0),
    uOutputWhite: float(1),
  })
  const blurPass = createPass('filter-blur', blurFragment, {
    uStep: { value: new Float32Array(2), type: 'vec2<f32>' },
    uRadius: float(1),
    uAxis: { value: new Float32Array(2), type: 'vec2<f32>' },
    uPaperFirst: float(0),
    uPaperEnd: float(1),
  })

  const newTile = () => RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
  const work = newTile() // the tile being worked out
  const blank = newTile() // for a tile the source has no paint in
  clear(blank)

  // PixiJS ignores the blend mode of what it is asked to render, so the sprite goes inside a container
  const scaledRoot = new Container()
  const scaledSprite = new Sprite()
  scaledSprite.blendMode = 'none'
  scaledRoot.addChild(scaledSprite)

  function drawScaled(from: Texture, target: RenderTexture, x: number, y: number, scale: number, isFresh: boolean) {
    scaledSprite.texture = from
    scaledSprite.position.set(x, y)
    scaledSprite.scale.set(scale)
    renderer.render({ container: scaledRoot, target, clear: isFresh, clearColor: [0, 0, 0, 0] })
  }

  // ----- The blur -----

  // A tile of the source made this many times smaller (a power of 2), or null where it has no paint. Each is half of the
  // one before: that way every pixel counts, where going down in one step would skip most of them
  function smallTile(session: Session, column: number, row: number, scale: number): Texture | null {
    if (scale === 1) return gpu.getTexture(session.source, column, row, false)
    const key = tileKey(column, row)
    let tiles = session.small.get(scale)
    if (!tiles) {
      tiles = new Map()
      session.small.set(scale, tiles)
    }
    const kept = tiles.get(key)
    if (kept) return kept
    const bigger = smallTile(session, column, row, scale / 2)
    if (!bigger) return null
    const side = TILE_SIZE / scale
    const small = RenderTexture.create({ width: side, height: side })
    drawScaled(bigger, small, 0, 0, 0.5, true)
    tiles.set(key, small)
    return small
  }

  // How many times smaller a blur of this radius is worked out
  function blurScale(radius: number) {
    let scale = 1
    while (radius / scale >= MAX_SMALL_RADIUS && scale < MAX_BLUR_SCALE) scale *= 2
    return scale
  }

  // How many tiles away from a tile a blur of this radius reaches
  const blurTiles = (radius: number) => Math.ceil((radius * GAUSSIAN_REACH) / TILE_SIZE)

  let blurA: RenderTexture | null = null
  let blurB: RenderTexture | null = null

  // A rectangle of tiles of the source, made smaller, put together and blurred
  function blurArea(
    session: Session,
    radius: number,
    scale: number,
    firstColumn: number,
    firstRow: number,
    columns: number,
    rows: number,
  ) {
    const side = TILE_SIZE / scale
    const width = columns * side
    const height = rows * side
    if (blurA?.width !== width || blurA.height !== height) {
      blurA?.destroy(true)
      blurB?.destroy(true)
      blurA = RenderTexture.create({ width, height })
      blurB = RenderTexture.create({ width, height })
    }
    const a = blurA
    const b = blurB!
    clear(a)
    for (let dx = 0; dx < columns; dx++) {
      for (let dy = 0; dy < rows; dy++) {
        const tile = smallTile(session, firstColumn + dx, firstRow + dy, scale)
        if (tile) draw(tile, a, dx * side, dy * side)
      }
    }
    const smallRadius = radius / scale
    // In whole pixels of the small picture: the last one may be only partly on the paper
    const along = (x: number, y: number, size: number, firstTile: number, paper: number) => {
      return (values: Record<string, unknown>) => {
        const first = -firstTile * side
        ;(values.uStep as Float32Array).set([x / width, y / height])
        ;(values.uAxis as Float32Array).set([x, y])
        values.uRadius = smallRadius
        values.uPaperFirst = first / size
        values.uPaperEnd = (first + Math.floor(paper / scale)) / size
      }
    }
    blurPass.run(a, b, along(1, 0, width, firstColumn, grid.width))
    blurPass.run(b, a, along(0, 1, height, firstRow, grid.height))
    return a
  }

  function blurTile(session: Session, radius: number, column: number, row: number) {
    const scale = blurScale(radius)
    const around = blurTiles(radius)
    const across = 2 * around + 1
    const picture = blurArea(session, radius, scale, column - around, row - around, across, across)
    drawScaled(picture, work, -around * TILE_SIZE, -around * TILE_SIZE, scale, true)
  }

  // The preview of a blur: everything on the screen is blurred once, no finer than the screen shows it, and the tiles take
  // their part of that. Blurring each with the tiles around it would take too long to follow a slider
  let wideBlur: { picture: RenderTexture; scale: number; firstColumn: number; firstRow: number } | null = null

  function blurOnScreen(session: Session, radius: number, area: TileArea, zoom: number) {
    let scale = blurScale(radius)
    while (scale * 2 <= 1 / zoom && scale < MAX_BLUR_SCALE) scale *= 2
    const around = blurTiles(radius)
    const firstColumn = Math.max(0, area.firstColumn - around)
    const firstRow = Math.max(0, area.firstRow - around)
    const columns = Math.min(grid.columns - 1, area.lastColumn + around) - firstColumn + 1
    const rows = Math.min(grid.rows - 1, area.lastRow + around) - firstRow + 1
    const side = TILE_SIZE / scale
    if (Math.max(columns, rows) * side > MAX_WIDE_BLUR) return null // tile by tile, then
    const picture = blurArea(session, radius, scale, firstColumn, firstRow, columns, rows)
    return { picture, scale, firstColumn, firstRow }
  }

  // Work out a tile of the source into "work". Returns whether it has anything
  function filterTile(session: Session, settings: FilterSettings, column: number, row: number) {
    if (settings.kind === 'blur') {
      if (wideBlur) {
        const x = -(column - wideBlur.firstColumn) * TILE_SIZE
        const y = -(row - wideBlur.firstRow) * TILE_SIZE
        drawScaled(wideBlur.picture, work, x, y, wideBlur.scale, true)
      } else {
        blurTile(session, settings.radius, column, row)
      }
      return true
    }
    const picture = gpu.getTexture(session.source, column, row, false)
    if (!picture) return false
    if (settings.kind === 'hue') {
      huePass.run(picture, work, values => {
        values.uHue = settings.hue / 360
        values.uSaturation = settings.saturation / 100
        values.uLightness = settings.lightness / 100
      })
    } else {
      levelsPass.run(picture, work, values => {
        values.uBlack = settings.black / 255
        values.uWhite = settings.white / 255
        values.uMiddle = settings.middle
        values.uOutputBlack = settings.outputBlack / 255
        values.uOutputWhite = settings.outputWhite / 255
      })
    }
    return true
  }

  // Work out a tile and put it into the layer's texture on the graphics card
  function showTile(session: Session, settings: FilterSettings, key: string) {
    const { layer, source } = session
    const { column, row } = parseTileKey(key)
    const before = gpu.getTexture(source, column, row, false) ?? blank
    const changed = filterTile(session, settings, column, row)
    const target = gpu.getTextureToReplace(layer, column, row)
    writer.compose(layer, key, changed ? work : before, before, target)
  }

  // ----- The session -----

  let session: Session | null = null

  // The tiles the filter can change: where the source has paint. A blur goes around that, and stays on the paper
  function keysOf({ source, settings }: Pick<Session, 'source' | 'settings'>) {
    const keys = new Set<string>()
    const around = settings.kind === 'blur' ? blurTiles(settings.radius) : 0
    for (const key of source.tiles.keys()) {
      const { column, row } = parseTileKey(key)
      if (settings.kind !== 'blur') keys.add(key)
      else {
        for (let dx = -around; dx <= around; dx++) {
          for (let dy = -around; dy <= around; dy++) {
            if (isOnPaper(grid, column + dx, row + dy)) keys.add(tileKey(column + dx, row + dy))
          }
        }
      }
    }
    return new Set([...keys].filter(key => selection.canPaint(key)))
  }

  // Start a filter on this layer. Its tiles must all be in RAM
  function open(layer: Layer, kind: FilterKind) {
    const settings = STARTING_SETTINGS[kind]
    const source = createLayer(`${layer.name} (filter)`, new Map(layer.tiles))
    session = {
      layer,
      source,
      settings,
      keys: keysOf({ source, settings }),
      done: new Set(),
      doneWith: settings,
      shown: new Set(),
      small: new Map(),
    }
  }

  // Let go of what a session keeps on the graphics card
  function letGo({ source, small }: Session) {
    gpu.dropLayer(source)
    for (const tiles of small.values()) for (const texture of tiles.values()) texture.destroy(true)
    blurA?.destroy(true)
    blurB?.destroy(true)
    blurA = blurB = null
  }

  // Show these tiles as they are in RAM again
  function hide({ layer }: Session, keys: Iterable<string>) {
    for (const key of keys) gpu.dropTile(layer, key)
    projection.composeLater(keys)
  }

  function change(values: FilterChange) {
    if (!session) return
    session.settings = { ...session.settings, ...values } as FilterSettings
    session.keys = keysOf(session)
  }

  // Show the latest values on the tiles of this rectangle of the paper that don't show them yet, all in this frame
  function showPreview(left: number, top: number, right: number, bottom: number, zoom: number) {
    if (!session) return
    const open = session
    const { settings, keys, done, shown } = open
    if (open.doneWith !== settings) {
      done.clear()
      open.doneWith = settings
    }
    const gone = [...shown].filter(key => !keys.has(key))
    hide(open, gone)
    for (const key of gone) shown.delete(key)
    const area = tilesInRect(grid, left, top, right, bottom)
    if (!area) return
    const waiting: string[] = []
    for (let column = area.firstColumn; column <= area.lastColumn; column++) {
      for (let row = area.firstRow; row <= area.lastRow; row++) {
        const key = tileKey(column, row)
        if (keys.has(key) && !done.has(key)) waiting.push(key)
      }
    }
    if (waiting.length === 0) return
    wideBlur = settings.kind === 'blur' ? blurOnScreen(open, settings.radius, area, zoom) : null
    for (const key of waiting) {
      showTile(open, settings, key)
      done.add(key)
      shown.add(key)
      const { column, row } = parseTileKey(key)
      projection.composeTile(column, row)
    }
    wideBlur = null // Apply works out each tile exactly
  }

  // Esc: everything stays as it was
  function cancel() {
    if (!session) return
    hide(session, session.shown)
    letGo(session)
    session = null
  }

  // Enter: the filter stops showing as a preview, and what it returns works out all the tiles, a few every frame, as one
  // step of undo. "pace" waits for the next frame when this one is used up, and "progress" says how far it is
  function finish() {
    const done = session
    if (!done) return null
    session = null
    return async (pace: () => Promise<void>, progress: (share: number) => void) => {
      const { layer, keys, shown, settings } = done
      const leftOut = [...shown].filter(key => !keys.has(key))
      history.begin(layer)
      let count = 0
      for (const key of keys) {
        await pace()
        history.backUpTile(key) // the layer's texture isn't marked as painted, so this keeps the tile in RAM
        showTile(done, settings, key)
        gpu.markDirty(layer, key)
        progress(++count / keys.size / 2)
      }
      hide(done, leftOut)
      history.end()
      projection.composeLater(keys)
      letGo(done)
    }
  }

  function destroy() {
    if (session) letGo(session)
    writer.destroy()
    for (const pass of [huePass, levelsPass, blurPass]) pass.destroy()
    geometry.destroy()
    scaledRoot.destroy({ children: true })
    for (const texture of [work, blank, blurA, blurB]) texture?.destroy(true)
  }

  return {
    open,
    change,
    showPreview,
    cancel,
    finish,
    isOpen: () => session !== null,
    settings: () => session?.settings ?? null,
    destroy,
  }
}

export type Filters = ReturnType<typeof createFilters>
