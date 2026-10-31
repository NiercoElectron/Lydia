import {
  CanvasSource,
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
import type { Brush, StrokeCutter } from './brush'
import { DEFAULT_SHAPE } from './brushFile'
import type { BrushTip } from './brushTip'
import { createDabPath, type Dab, type DabPath, type StrokePoint } from './dabs'
import type { GpuTiles } from './gpuTiles'
import type { History } from './history'
import { LOCKED_ALPHA, type Layer, type LayerStack } from './layers'
import type { Projection } from './projection'
import { parseTileKey, TILE_SIZE, tileKey, tilesInRect, type Grid } from './tiles'
import type { MixTool } from './tools'

// Smudge and blur (decision 71): tools that paint with the paint already on the active layer, through the chosen
// brush's tip. Unlike the brush, whose stroke is kept apart and put on the layer at its end, each dab depends on what
// the dabs before it left, so each one works on the pixels themselves:
//
// - Smudge carries a picture of the paint, as big as the dab, along the stroke. At each dab, the paint under it is
//   mixed with the picture through the tip, and the picture takes on some of the paint under it.
// - Blur mixes the paint under each dab with a blurred copy of it, through the tip.
//
// The dabs work on copies of the layer's tiles ("work tiles"), and after each batch of dabs the tiles they touched go
// to the layer, kept to the selection and to the layer's transparency when it is locked: the dabs never lose paint
// that is left out, so a soft edge of a selection isn't cut again at each dab. Each pixel moves by whole pixels, with
// the dab's box, so the picture carried is never resampled, and doesn't get blurrier along the stroke.

// How far apart dabs are, as a fraction of the size, close enough for smudge's fade to show no steps
const SPACING: Record<MixTool, number> = { smudge: 0.03, blur: 0.25 }
// How far blur reaches, as a fraction of the size, and its limits in pixels of the paper. Going over a place blurs more
const BLUR_SHARE = 0.04
const MIN_BLUR = 1
const MAX_BLUR = 12

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

// As much of "uOver" over "uBase" as "uAmount", through the tip when "uThroughTip" says so
const mixFragment = `in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uBase;
uniform sampler2D uOver;
uniform sampler2D uTip;
uniform vec2 uSize; // of the dab's box, in pixels
uniform vec2 uCenter; // the dab's center in its box
uniform vec2 uTurn; // the cosine and sine of its angle
uniform vec2 uTipSize; // the tip's picture on the paper, in pixels
uniform float uAmount;
uniform float uThroughTip;

void main(void) {
  float amount = uAmount;
  if (uThroughTip > 0.5) {
    vec2 point = vUV * uSize - uCenter;
    vec2 turned = vec2(uTurn.x * point.x + uTurn.y * point.y, uTurn.x * point.y - uTurn.y * point.x);
    vec2 tipUV = turned / uTipSize + 0.5;
    vec2 inside = step(vec2(0.0), tipUV) * step(tipUV, vec2(1.0));
    amount *= texture(uTip, tipUV).a * inside.x * inside.y;
  }
  finalColor = mix(texture(uBase, vUV), texture(uOver, vUV), amount);
}
`

// One way of a blur: nine samples, "uStep" apart, with the weights of a bell curve
const blurFragment = `in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uBase;
uniform vec2 uStep;

void main(void) {
  vec4 sum = texture(uBase, vUV) * 0.2042;
  sum += (texture(uBase, vUV - uStep) + texture(uBase, vUV + uStep)) * 0.1802;
  sum += (texture(uBase, vUV - 2.0 * uStep) + texture(uBase, vUV + 2.0 * uStep)) * 0.1238;
  sum += (texture(uBase, vUV - 3.0 * uStep) + texture(uBase, vUV + 3.0 * uStep)) * 0.0663;
  sum += (texture(uBase, vUV - 4.0 * uStep) + texture(uBase, vUV + 4.0 * uStep)) * 0.0276;
  finalColor = sum;
}
`

export function createMixTools(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
  brush: Brush,
  selection: StrokeCutter & { cutAway: (texture: RenderTexture, key: string) => void },
) {
  const settings: { tool: MixTool; strength: number } = { tool: 'smudge', strength: 0.5 }

  // ----- Drawing on the graphics card -----

  const square = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const geometry = new MeshGeometry({ positions: square, uvs: square, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) })
  const mixUniforms = new UniformGroup({
    uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uCenter: { value: new Float32Array(2), type: 'vec2<f32>' },
    uTurn: { value: new Float32Array(2), type: 'vec2<f32>' },
    uTipSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uAmount: { value: 0, type: 'f32' },
    uThroughTip: { value: 0, type: 'f32' },
  })
  const mixShader = new Shader({
    glProgram: GlProgram.from({ vertex, fragment: mixFragment, name: 'mix-dab', preferredFragmentPrecision: 'highp' }),
    resources: {
      mixUniforms,
      uBase: Texture.EMPTY.source,
      uOver: Texture.EMPTY.source,
      uTip: Texture.EMPTY.source,
    },
  })
  const blurUniforms = new UniformGroup({
    uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uStep: { value: new Float32Array(2), type: 'vec2<f32>' },
  })
  const blurShader = new Shader({
    glProgram: GlProgram.from({
      vertex,
      fragment: blurFragment,
      name: 'blur-dab',
      preferredFragmentPrecision: 'highp',
    }),
    resources: { blurUniforms, uBase: Texture.EMPTY.source },
  })
  const mixRoot = new Container()
  mixRoot.addChild(new Mesh({ geometry, shader: mixShader }))
  const blurRoot = new Container()
  blurRoot.addChild(new Mesh({ geometry, shader: blurShader }))

  // PixiJS ignores the blend mode of what it is asked to render, so the sprite goes inside a container
  const copyRoot = new Container()
  const copySprite = new Sprite()
  copyRoot.addChild(copySprite)
  const nothing = new Container()
  // The tiles under a dab, put together
  const readRoot = new Container()
  const readSprites: Sprite[] = []

  const clear = (target: RenderTexture) =>
    renderer.render({ container: nothing, target, clear: true, clearColor: [0, 0, 0, 0] })

  // Draw "from" into "target" at (x, y). "none": in place of what is there
  function draw(from: Texture, target: RenderTexture, x = 0, y = 0, blendMode: string = 'none') {
    copySprite.texture = from
    copySprite.position.set(x, y)
    copySprite.blendMode = blendMode as Sprite['blendMode']
    renderer.render({ container: copyRoot, target, clear: false })
  }

  // ----- The stroke -----

  let layer: Layer | null = null
  let path: DabPath | null = null
  let tool: MixTool = 'smudge'
  let size = 1
  let reachOfBlur = MIN_BLUR
  let side = 0 // of a dab's box, in pixels
  let hasCarried = false // smudge has picked up the paint under its first dab
  let shownTip: BrushTip | null = null
  let tipTexture: Texture | null = null

  // The pictures as big as a dab's box: the paint under it, what smudge carries (or the blur's first way), the same
  // about to replace it (or the blur), and the mix that goes on the layer
  let boxes: { under: RenderTexture; carried: RenderTexture; next: RenderTexture; mixed: RenderTexture } | null = null

  const workTiles = new Map<string, RenderTexture>()
  // As they were before the stroke, in the tiles where what the dabs did can't all go on the layer
  const beforeTiles = new Map<string, RenderTexture>()
  const spareTiles: RenderTexture[] = []
  const spareTile = () => spareTiles.pop() ?? RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
  let kept: RenderTexture | null = null // a tile for working out what goes on the layer

  function setBoxes(newSide: number) {
    if (boxes && newSide === side) return
    forgetBoxes()
    side = newSide
    const box = () => RenderTexture.create({ width: side, height: side })
    boxes = { under: box(), carried: box(), next: box(), mixed: box() }
  }

  function forgetBoxes() {
    // The shaders keep none of them
    mixShader.resources.uBase = Texture.EMPTY.source
    mixShader.resources.uOver = Texture.EMPTY.source
    blurShader.resources.uBase = Texture.EMPTY.source
    if (boxes) for (const box of Object.values(boxes)) box.destroy(true)
    boxes = null
  }

  // The tip on the graphics card, with smaller copies of itself (mipmaps), since it is usually made smaller
  function setTip(tip: BrushTip) {
    if (tip === shownTip) return
    mixShader.resources.uTip = Texture.EMPTY.source
    tipTexture?.destroy(true)
    shownTip = tip
    tipTexture = new Texture({
      source: new CanvasSource({ resource: tip.image, resolution: 1, autoGenerateMipmaps: true }),
    })
    mixShader.resources.uTip = tipTexture.source
  }

  // The copy of the layer's tile at this place that the dabs work on
  function workTile(column: number, row: number) {
    const key = tileKey(column, row)
    let work = workTiles.get(key)
    if (work) return work
    work = spareTile()
    const painted = gpu.getTexture(layer!, column, row, false)
    if (painted) draw(painted, work)
    else clear(work)
    workTiles.set(key, work)
    if (layer!.alphaLocked || selection.isCut(key)) {
      const before = spareTile()
      draw(work, before)
      beforeTiles.set(key, before)
    }
    return work
  }

  // Call "each" for each tile on the paper under the box whose corner is at (left, top)
  function forTilesInBox(left: number, top: number, each: (column: number, row: number) => void) {
    const area = tilesInRect(grid, left, top, left + side, top + side)
    if (!area) return
    for (let column = area.firstColumn; column <= area.lastColumn; column++) {
      for (let row = area.firstRow; row <= area.lastRow; row++) each(column, row)
    }
  }

  // The paint under the box, into "under"
  function readBox(left: number, top: number) {
    readRoot.removeChildren()
    let count = 0
    forTilesInBox(left, top, (column, row) => {
      const sprite = (readSprites[count] ??= new Sprite())
      sprite.texture = workTile(column, row)
      sprite.position.set(column * TILE_SIZE - left, row * TILE_SIZE - top)
      readRoot.addChild(sprite)
      count++
    })
    renderer.render({ container: readRoot, target: boxes!.under, clear: true, clearColor: [0, 0, 0, 0] })
  }

  // The "mixed" picture back into the tiles under the box
  function writeBox(left: number, top: number, touched: Set<string>) {
    forTilesInBox(left, top, (column, row) => {
      draw(boxes!.mixed, workTile(column, row), left - column * TILE_SIZE, top - row * TILE_SIZE)
      touched.add(tileKey(column, row))
    })
  }

  // As much of "over" over "base" as "amount" into "target", through the tip of this dab, or everywhere without one
  function mix(target: RenderTexture, base: RenderTexture, over: RenderTexture, amount: number, dab: Dab | null) {
    const values = mixUniforms.uniforms
    values.uSize.set([side, side])
    values.uAmount = amount
    values.uThroughTip = dab ? 1 : 0
    if (dab) {
      const { image } = shownTip!
      const scale = dab.size / Math.max(image.width, image.height)
      values.uCenter.set([dab.x - Math.floor(dab.x - side / 2), dab.y - Math.floor(dab.y - side / 2)])
      values.uTurn.set([Math.cos(dab.angle), Math.sin(dab.angle)])
      values.uTipSize.set([image.width * scale, image.height * scale])
    }
    mixUniforms.update()
    mixShader.resources.uBase = base.source
    mixShader.resources.uOver = over.source
    renderer.render({ container: mixRoot, target, clear: true, clearColor: [0, 0, 0, 0] })
  }

  function blurWay(target: RenderTexture, from: RenderTexture, x: number, y: number) {
    const values = blurUniforms.uniforms
    values.uSize.set([side, side])
    values.uStep.set([x, y])
    blurUniforms.update()
    blurShader.resources.uBase = from.source
    renderer.render({ container: blurRoot, target, clear: true, clearColor: [0, 0, 0, 0] })
  }

  // One dab of smudge. Its first one only picks up the paint under it
  function smudgeDab(dab: Dab, left: number, top: number, touched: Set<string>) {
    const box = boxes!
    readBox(left, top)
    if (!hasCarried) {
      draw(box.under, box.carried)
      hasCarried = true
      return
    }
    // How much of the picture stays at each dab. Each dab overlaps what the last one left, so only what comes in at
    // the front of the dab thins the picture: at 50%, the paint fades away over a little more than a brush size
    const keep = settings.strength * dab.pressure
    mix(box.mixed, box.under, box.carried, keep, dab)
    writeBox(left, top, touched)
    mix(box.next, box.under, box.carried, keep, null)
    ;[box.carried, box.next] = [box.next, box.carried]
  }

  function blurDab(dab: Dab, left: number, top: number, touched: Set<string>) {
    const box = boxes!
    readBox(left, top)
    const step = reachOfBlur / 4 / side
    blurWay(box.carried, box.under, step, 0)
    blurWay(box.next, box.carried, 0, step)
    mix(box.mixed, box.under, box.next, settings.strength * dab.pressure, dab)
    writeBox(left, top, touched)
  }

  // What the work tile gives the layer's tile: only the paint of the layer's tile when its transparency is locked,
  // and only what is selected
  function publish(key: string) {
    if (!selection.canPaint(key)) return
    const { column, row } = parseTileKey(key)
    history.backUpTile(key) // before the tile changes: the graphics card works in order
    const target = gpu.getTexture(layer!, column, row, true)!
    const work = workTiles.get(key)!
    const before = beforeTiles.get(key)
    if (!before) {
      draw(work, target)
    } else {
      kept ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
      if (layer!.alphaLocked) {
        draw(before, kept)
        draw(work, kept, 0, 0, LOCKED_ALPHA)
      } else {
        draw(work, kept)
      }
      if (selection.isCut(key)) {
        selection.cut(kept, key)
        draw(before, target)
        selection.cutAway(target, key)
        draw(kept, target, 0, 0, 'add')
      } else {
        draw(kept, target)
      }
    }
    gpu.markDirty(layer!, key)
    projection.composeTile(column, row)
  }

  function workDabs(dabs: Dab[]) {
    const touched = new Set<string>()
    const workDab = tool === 'smudge' ? smudgeDab : blurDab
    for (const dab of dabs) workDab(dab, Math.floor(dab.x - side / 2), Math.floor(dab.y - side / 2), touched)
    for (const key of touched) publish(key)
  }

  // Start a stroke at this point of the paper, with the brush's tip, at the size of the brush. The pen's pressure goes
  // from 0 to 1, and changes the strength
  function startStroke(x: number, y: number, pressure: number) {
    tool = settings.tool
    layer = stack.active
    history.begin(layer)
    size = brush.settings.size
    const tip = brush.getTip()
    setTip(tip)
    reachOfBlur = Math.min(MAX_BLUR, Math.max(MIN_BLUR, size * BLUR_SHARE))
    setBoxes(Math.ceil(size * tip.reach) + 2 * Math.ceil(reachOfBlur) + 4)
    hasCarried = false
    const { angle, followStroke } = brush.getShape()
    const spacing = Math.max(SPACING[tool], 1 / size) // at least a pixel apart
    const shape = { ...DEFAULT_SHAPE, angle, followStroke, spacing, pressureSize: false }
    path = createDabPath(shape, size, { tip: tip.image })
    workDabs(path.start({ x, y, pressure }))
  }

  function continueStroke(points: StrokePoint[]) {
    if (path) workDabs(path.moveTo(points))
  }

  // Finish the stroke. Returns whether it changed anything (and so was added to the undo history)
  function endStroke() {
    if (path) workDabs(path.end())
    path = null
    for (const tiles of [workTiles, beforeTiles]) {
      spareTiles.push(...tiles.values())
      tiles.clear()
    }
    return history.end()
  }

  function destroy() {
    forgetBoxes()
    mixShader.resources.uTip = Texture.EMPTY.source
    tipTexture?.destroy(true)
    for (const root of [mixRoot, blurRoot, copyRoot, readRoot]) root.destroy({ children: true })
    for (const sprite of readSprites) if (!sprite.destroyed) sprite.destroy()
    mixShader.destroy()
    blurShader.destroy()
    geometry.destroy()
    kept?.destroy(true)
    for (const texture of [...workTiles.values(), ...beforeTiles.values(), ...spareTiles]) texture.destroy(true)
  }

  return { settings, startStroke, continueStroke, endStroke, destroy }
}

export type MixTools = ReturnType<typeof createMixTools>
