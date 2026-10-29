import {
  BindGroup,
  BufferImageSource,
  Container,
  Geometry,
  GlProgram,
  Matrix,
  Mesh,
  RenderContainer,
  RenderTexture,
  Shader,
  Sprite,
  State,
  Texture,
  UniformGroup,
} from 'pixi.js'
import type { TextureSource, WebGLRenderer } from 'pixi.js'
import type { LiveStep } from './composer'
import type { BlendMode } from './layers'
import { TILE_SIZE } from './tiles'

// A layer's blend mode is how its paint goes onto what is under it. The graphics card's own blending can only add and
// multiply what it has, so most modes can't be done with it: the layer's tile and a picture of what is under it go
// into a small program of our own instead (a shader), which works out each pixel with the mode's formula and writes
// the result into another tile.
//
// The formulas are the ones browsers use for CSS and SVG (the W3C "Compositing and Blending" standard), which are
// Photoshop's and Krita's too. Each pixel of the layer, at the layer's opacity, goes onto the one under it like this:
// - where only one of them has paint, that one shows, as with Normal
// - where both have paint, the mode mixes their colors, and the mix shows as much as both cover
// So a layer with a blend mode over a transparent part of the picture shows its paint as it is. The modes:
// - Multiply: darkens, like layers of ink (white changes nothing). Screen: the opposite, lightens (black changes nothing)
// - Overlay: multiply in the dark parts of what is under, screen in the light ones, so the contrast grows
// - Add (Linear Dodge): adds the colors, for glows. Darken and Lighten: the darker, or the lighter, of the two
// - Color Dodge and Color Burn: brighten or darken what is under, strongly, by the layer's color
// - Soft Light and Hard Light: like Overlay, softly or strongly, led by the layer's colors instead
// - Difference: how far apart the colors are (the same color gives black)
// - Hue, Saturation, Color, Luminosity: take that much of the layer's color (its hue; its saturation; both; or its
//   brightness), and the rest from what is under
// The layers panel offers them grouped as Photoshop does (see LayersPanel.tsx).
//
// The same program clips a layer to its base (see isClipped in layers.ts): the layer's paint is then taken as much as
// the base's paint covers, before the rest. And it mixes two pictures of the same place, for a folder that lets what
// is in it pass through (see isFolder in layers.ts) at less than full opacity

// Each mode's number in the shader below. "pass-through" is only a folder's, which is never blended as a layer
const MODE_NUMBERS: Record<BlendMode, number> = {
  normal: 0,
  'pass-through': 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  add: 4,
  darken: 5,
  lighten: 6,
  'color-dodge': 7,
  'color-burn': 8,
  'soft-light': 9,
  'hard-light': 10,
  difference: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
}
const MIX = 16

// A square the size of a tile, drawn over the whole target tile
const vertex = `#version 300 es
in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vUV;

void main(void) {
  vec3 position = vec3(aPosition * ${TILE_SIZE}.0, 1.0);
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * position).xy, 0.0, 1.0);
  vUV = aPosition;
}
`

// The formulas, shared by the program that blends tiles and the ones that show tiles on the screen (see
// createTileMixer and createTileMover). The
// graphics card keeps colors multiplied by their alpha: the formulas need them as they are, so that is undone first,
// and done again in the result
const FORMULAS = `
vec3 screen(vec3 under, vec3 over) {
  return under + over - under * over;
}

vec3 hardLight(vec3 under, vec3 over) {
  return mix(under * 2.0 * over, screen(under, 2.0 * over - 1.0), step(0.5, over));
}

float colorDodge(float under, float over) {
  if (under <= 0.0) return 0.0;
  if (over >= 1.0) return 1.0;
  return min(1.0, under / (1.0 - over));
}

float colorBurn(float under, float over) {
  if (under >= 1.0) return 1.0;
  if (over <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - under) / over);
}

float softLight(float under, float over) {
  if (over <= 0.5) return under - (1.0 - 2.0 * over) * under * (1.0 - under);
  float lifted = under <= 0.25 ? ((16.0 * under - 12.0) * under + 4.0) * under : sqrt(under);
  return under + (2.0 * over - 1.0) * (lifted - under);
}

// Hue, saturation and luminosity, as the standard defines them
float luminosity(vec3 color) {
  return dot(color, vec3(0.3, 0.59, 0.11));
}

// Bring a color back between 0 and 1, keeping its luminosity
vec3 clipColor(vec3 color) {
  float light = luminosity(color);
  float low = min(min(color.r, color.g), color.b);
  float high = max(max(color.r, color.g), color.b);
  if (low < 0.0) color = light + (color - light) * light / (light - low);
  if (high > 1.0) color = light + (color - light) * (1.0 - light) / (high - light);
  return color;
}

vec3 withLuminosity(vec3 color, float light) {
  return clipColor(color + (light - luminosity(color)));
}

float saturation(vec3 color) {
  return max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
}

vec3 withSaturation(vec3 color, float amount) {
  float low = min(min(color.r, color.g), color.b);
  float range = max(max(color.r, color.g), color.b) - low;
  return range > 0.0 ? (color - low) * amount / range : vec3(0.0);
}

// The mode's mix of the color under and the layer's color
vec3 blended(vec3 under, vec3 over, int mode) {
  if (mode == 1) return under * over;
  if (mode == 2) return screen(under, over);
  if (mode == 3) return hardLight(over, under); // Overlay is Hard Light with the two swapped
  if (mode == 4) return min(vec3(1.0), under + over);
  if (mode == 5) return min(under, over);
  if (mode == 6) return max(under, over);
  if (mode == 7) return vec3(colorDodge(under.r, over.r), colorDodge(under.g, over.g), colorDodge(under.b, over.b));
  if (mode == 8) return vec3(colorBurn(under.r, over.r), colorBurn(under.g, over.g), colorBurn(under.b, over.b));
  if (mode == 9) return vec3(softLight(under.r, over.r), softLight(under.g, over.g), softLight(under.b, over.b));
  if (mode == 10) return hardLight(under, over);
  if (mode == 11) return abs(under - over);
  if (mode == 12) return withLuminosity(withSaturation(over, saturation(under)), luminosity(under));
  if (mode == 13) return withLuminosity(withSaturation(under, saturation(over)), luminosity(under));
  if (mode == 14) return withLuminosity(over, luminosity(under));
  if (mode == 15) return withLuminosity(under, luminosity(over));
  return over;
}

// "over" (already at its opacity) onto "under" with this mode: each one alone where the other has no paint, and the
// mix as much as both cover
vec4 blendOnto(vec4 under, vec4 over, int mode) {
  vec3 underColor = under.a > 0.0 ? min(under.rgb / under.a, 1.0) : vec3(0.0);
  vec3 overColor = over.a > 0.0 ? min(over.rgb / over.a, 1.0) : vec3(0.0);
  vec3 mixed = clamp(blended(underColor, overColor, mode), 0.0, 1.0);
  vec3 color = over.rgb * (1.0 - under.a) + under.rgb * (1.0 - over.a) + mixed * over.a * under.a;
  return vec4(color, over.a + under.a * (1.0 - over.a));
}
`

const fragment = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uBackdrop;
uniform sampler2D uPaint;
uniform sampler2D uMask;
uniform float uOpacity;
uniform float uMode;
${FORMULAS}
void main(void) {
  float amount = uOpacity * texture(uMask, vUV).a;
  int mode = int(uMode + 0.5);
  if (mode == 16) {
    // Mixing two pictures: as much of the second as the opacity, where the mask covers
    finalColor = mix(texture(uBackdrop, vUV), texture(uPaint, vUV), amount);
    return;
  }
  finalColor = blendOnto(texture(uBackdrop, vUV), texture(uPaint, vUV) * amount, mode);
}
`

// One pixel of no paint at all, and one white pixel that covers fully, which stand for a whole tile of each
const pixelTexture = (value: number) =>
  new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4).fill(value), width: 1, height: 1 }) })
const NO_PAINT = pixelTexture(0)
const NO_MASK = pixelTexture(255)

export function createLayerBlender(renderer: WebGLRenderer) {
  const geometry = new Geometry({
    attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  const uniforms = new UniformGroup({
    uOpacity: { value: 1, type: 'f32' },
    uMode: { value: 0, type: 'f32' },
  })
  const shader = new Shader({
    glProgram: GlProgram.from({ vertex, fragment, name: 'layer-blend', preferredFragmentPrecision: 'highp' }),
    resources: { blendUniforms: uniforms, uBackdrop: NO_PAINT.source, uPaint: NO_PAINT.source, uMask: NO_MASK.source },
  })
  const mesh = new Mesh({ geometry, shader })
  mesh.blendMode = 'none' // the result replaces what the target had
  const root = new Container() // PixiJS ignores the blend mode of what it is asked to render
  root.addChild(mesh)

  // For blendOnto: the result is worked out here, then copied back
  let scratch: RenderTexture | null = null
  const copyRoot = new Container()
  const copySprite = new Sprite()
  copySprite.blendMode = 'none'
  copyRoot.addChild(copySprite)

  let passCount = 0 // how many times it has drawn into a tile (see passes in composer.ts)

  // Draw into "target", then let go of the tiles read: one of them may be deleted later, which PixiJS warns about while
  // a program still holds it
  function draw(target: RenderTexture) {
    passCount++
    renderer.render({ container: root, target, clear: false })
    shader.resources.uBackdrop = NO_PAINT.source
    shader.resources.uPaint = NO_PAINT.source
    shader.resources.uMask = NO_MASK.source
  }

  // Put "paint" (a layer's tile) at this opacity onto "backdrop" (what is under it) with this mode, into "target",
  // only as much as "mask" covers (the tile of the layer's base, when it is clipped). All are whole tiles; "target"
  // must be none of the others
  function blend(
    backdrop: Texture,
    paint: Texture,
    opacity: number,
    mode: BlendMode,
    target: RenderTexture,
    mask: Texture = NO_MASK,
  ) {
    shader.resources.uBackdrop = backdrop.source
    shader.resources.uPaint = paint.source
    shader.resources.uMask = mask.source
    uniforms.uniforms.uOpacity = opacity
    uniforms.uniforms.uMode = MODE_NUMBERS[mode]
    draw(target)
  }

  // "before" and "after" mixed into "target": as much of "after" as the opacity, where "mask" covers
  function mix(before: Texture, after: Texture, opacity: number, target: RenderTexture, mask: Texture = NO_MASK) {
    shader.resources.uBackdrop = before.source
    shader.resources.uPaint = after.source
    shader.resources.uMask = mask.source
    uniforms.uniforms.uOpacity = opacity
    uniforms.uniforms.uMode = MIX
    draw(target)
  }

  // The same, with the result in "target" itself (merging a layer down onto the one under it)
  function blendOnto(target: RenderTexture, paint: Texture, opacity: number, mode: BlendMode, mask?: Texture) {
    scratch ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    blend(target, paint, opacity, mode, scratch, mask)
    copySprite.texture = scratch
    passCount++
    renderer.render({ container: copyRoot, target, clear: false })
  }

  function destroy() {
    root.destroy({ children: true })
    copyRoot.destroy({ children: true })
    geometry.destroy()
    shader.destroy()
    scratch?.destroy(true)
  }

  // Only the part of "paint" that "mask" covers, into "target", or all of it without a mask (a copy)
  function clip(paint: Texture, target: RenderTexture, mask?: Texture) {
    blend(NO_PAINT, paint, 1, 'normal', target, mask)
  }

  compileNow(renderer, root)
  return { blend, blendOnto, mix, clip, passes: () => passCount, destroy }
}

export type LayerBlender = ReturnType<typeof createLayerBlender>

// How the programs below tell the steps apart (see LiveStep in composer.ts): none, onto, into, mixed with a picture,
// keep, mixed with the picture kept
const STEP_KINDS = { none: 0, onto: 1, into: 2, mix: 3, keep: 4, mixKept: 5 }

// A program showing a tile on the screen that ends with steps (see LiveStep in composer.ts), up to "count" of them:
// "start" works out the picture they start from ("picture"), and the paint of the layer that moves ("own"), which the
// steps clipped to it take.
// For each step in "uSteps": "x" its kind, "y" its mode, "z" its opacity, "w" 1 when it has a mask (its second tile),
// 2 when it is clipped to the layer that moves. The tiles are read first, each by its own name (a program can't
// choose a tile by a number it works out), and the steps then go in a loop, so the formulas are in the program once:
// the graphics card's driver turns the program into its own code the first time it is used, and with the formulas
// written out for every step, that took seconds. Only the tiles of the steps there are ("uCount") are read, and the
// masks there are. Two pictures can be kept at once, which is enough for a folder letting what is in it pass through
// inside another one. With no steps ("count" 0), the program only works out the picture
function stepsFragment(count: number, header: string, start: string) {
  const numbers = Array.from({ length: count }, (_, i) => i)
  const declarations = `uniform vec4 uSteps[${count}];
uniform float uCount;
${numbers.map(i => `uniform sampler2D uFirst${i};\nuniform sampler2D uSecond${i};`).join('\n')}`
  const steps = `  int stepCount = int(uCount + 0.5);
${numbers
  .map(
    i => `  vec4 first${i} = vec4(0.0);
  float mask${i} = 1.0;
  if (stepCount > ${i}) {
    first${i} = texture(uFirst${i}, vUV);
    if (uSteps[${i}].w > 1.5) mask${i} = own.a;
    else if (uSteps[${i}].w > 0.5) mask${i} = texture(uSecond${i}, vUV).a;
  }`,
  )
  .join('\n')}
  vec4 kept = vec4(0.0);
  vec4 keptBefore = vec4(0.0);
  for (int i = 0; i < ${count}; i++) {
    if (i >= stepCount) break;
    vec4 first = ${numbers
      .slice(0, -1)
      .map(i => `i == ${i} ? first${i} : `)
      .join('')}first${count - 1};
    float mask = ${numbers
      .slice(0, -1)
      .map(i => `i == ${i} ? mask${i} : `)
      .join('')}mask${count - 1};
    int kind = int(uSteps[i].x + 0.5);
    float amount = uSteps[i].z * mask;
    if (kind == 4) {
      keptBefore = kept;
      kept = picture;
    } else if (kind == 3 || kind == 5) {
      picture = mix(kind == 3 ? first : kept, picture, amount);
      if (kind == 5) kept = keptBefore;
    } else {
      // Onto the picture, or the picture onto the tile
      vec4 under = kind == 1 ? picture : first;
      vec4 over = (kind == 1 ? first : picture) * amount;
      picture = blendOnto(under, over, int(uSteps[i].y + 0.5));
    }
  }`
  return `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

${count > 0 ? declarations : ''}
${header}
${FORMULAS}
void main(void) {
${start}
${count > 0 ? steps : ''}
  finalColor = picture;
}
`
}

// What a program from stepsFragment needs for these steps: the numbers of the steps and the tiles they read, by name.
// Null when there are more than "count", or more pictures kept at once than it can keep
function stepsUniforms(steps: LiveStep[], count: number) {
  if (steps.length > count) return null
  const numbers = new Float32Array(count * 4)
  const tiles: Record<string, TextureSource> = {}
  let keptCount = 0
  for (let i = 0; i < count; i++) {
    const step = steps[i]
    let values = [STEP_KINDS.none, 0, 0, 0]
    let first: Texture = NO_PAINT
    let second: Texture | null = null
    if (step?.kind === 'onto') {
      values = [STEP_KINDS.onto, MODE_NUMBERS[step.mode], step.opacity, 0]
      first = step.paint
    } else if (step?.kind === 'into') {
      values = [STEP_KINDS.into, MODE_NUMBERS[step.mode], step.opacity, 0]
      first = step.under
      second = step.mask
    } else if (step?.kind === 'mix') {
      values = [step.before ? STEP_KINDS.mix : STEP_KINDS.mixKept, 0, step.opacity, 0]
      if (step.before) first = step.before
      else keptCount--
      second = step.mask
    } else if (step?.kind === 'keep') {
      values = [STEP_KINDS.keep, 0, 0, 0]
      if (++keptCount > 2) return null
    }
    if (second) values[3] = 1
    if ((step?.kind === 'onto' || step?.kind === 'mix') && step.ownMask) values[3] = 2
    numbers.set(values, i * 4)
    tiles[`uFirst${i}`] = first.source
    tiles[`uSecond${i}`] = (second ?? NO_MASK).source
  }
  return { numbers, tiles }
}

// The square of a tile whose corner is at "uCorner" on the paper, of which only "uPart" shows: a tile at the paper's
// edge only shows the part on the paper
const tileVertex = `#version 300 es
in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uCorner;
uniform vec2 uPart;

out vec2 vUV;

void main(void) {
  vUV = aPosition * uPart;
  vec3 position = vec3(uCorner + vUV * ${TILE_SIZE}.0, 1.0);
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * position).xy, 0.0, 1.0);
}
`

const squareGeometry = () =>
  new Geometry({
    attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })

// A program for a set of tiles (see createTileSet): the names of the tiles it reads, and of the numbers each tile
// has of its own
type TileProgram = { glProgram: GlProgram; samplers: string[]; uniforms: string[] }

// A tile of a set: its corner on the paper, the tiles it reads (as its program names them), and its own numbers
export type ShownTile = {
  visible: boolean
  program: TileProgram
  corner: Float32Array
  textures: TextureSource[]
  values: (number | Float32Array)[]
}

// Where a program's uniforms are, found once for each program
type Places = { corner: WebGLUniformLocation; samplers: WebGLUniformLocation[]; uniforms: WebGLUniformLocation[] }
const placesOf = new WeakMap<WebGLProgram, Places>()

// Tiles drawn on the screen by programs of our own, hundreds at once on every frame (see createTileMixer and
// createTileMover). Shown as one object each, PixiJS would go through all that a program needs for each of them, which
// took longer than all the rest of a frame with a big drawing on the screen. Here that is done once for each program
// on every frame, the way PixiJS does it for one object (see MeshPipe in PixiJS), and then each tile only gives its
// own tiles and numbers. "shared" holds the numbers that are the same for all the tiles
function createTileSet(shared: UniformGroup, programs: TileProgram[]) {
  const tiles = new Set<ShownTile>()
  const geometry = squareGeometry()
  const state = State.for2d()
  const local = new UniformGroup({ uTransformMatrix: { value: new Matrix(), type: 'mat3x3<f32>' } })
  const localGroup = new BindGroup({ 0: local })
  const shaders = new Map(
    programs.map(program => [program, new Shader({ glProgram: program.glProgram, resources: { shared } })]),
  )
  const container = new RenderContainer({ render: renderer => draw(renderer as WebGLRenderer) })

  function draw(renderer: WebGLRenderer) {
    local.uniforms.uTransformMatrix = container.groupTransform
    local.update()
    const gl = renderer.gl
    for (const program of programs) {
      let places: Places | null = null
      for (const tile of tiles) {
        if (!tile.visible || tile.program !== program) continue
        places ??= start(renderer, program)
        for (const [unit, source] of tile.textures.entries()) renderer.texture.bindSource(source, unit)
        gl.uniform2fv(places.corner, tile.corner)
        for (const [i, value] of tile.values.entries()) {
          const place = places.uniforms[i]
          if (typeof value === 'number') gl.uniform1f(place, value)
          else if (value.length === 2) gl.uniform2fv(place, value)
          else gl.uniform4fv(place, value)
        }
        renderer.geometry.draw('triangle-list', 6, 0)
      }
    }
  }

  // Get the graphics card ready to draw tiles with this program: the program with the numbers shared by all the
  // tiles, and the tiles it reads each on a texture unit of its own, in the order of its names
  function start(renderer: WebGLRenderer, program: TileProgram) {
    const shader = shaders.get(program)!
    shader.groups[100] = renderer.globalUniforms.bindGroup
    shader.groups[101] = localGroup
    renderer.shader.bind(shader)
    renderer.geometry.bind(geometry, program.glProgram)
    renderer.state.set(state)
    const gl = renderer.gl
    const glProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram
    let places = placesOf.get(glProgram)
    if (!places) {
      const find = (name: string) => gl.getUniformLocation(glProgram, name)!
      places = { corner: find('uCorner'), samplers: program.samplers.map(find), uniforms: program.uniforms.map(find) }
      placesOf.set(glProgram, places)
    }
    for (const [unit, place] of places.samplers.entries()) gl.uniform1i(place, unit)
    return places
  }

  // A tile of the set with this program, at this column and row, out of sight. "textures" are the tiles it reads by
  // name (a name left out: none), "values" its own numbers, in the order of the program's names
  function add(
    program: TileProgram,
    column: number,
    row: number,
    textures: Record<string, TextureSource>,
    values: (number | Float32Array)[],
  ): ShownTile {
    const tile = {
      visible: false,
      program,
      corner: new Float32Array([column * TILE_SIZE, row * TILE_SIZE]),
      textures: program.samplers.map(name => textures[name] ?? NO_PAINT.source),
      values,
    }
    tiles.add(tile)
    return tile
  }

  function remove(tile: ShownTile) {
    tiles.delete(tile)
  }

  // The programs stay: PixiJS keeps one for each source code, shared by every drawing opened
  function destroy() {
    tiles.clear()
    if (!container.destroyed) container.destroy() // already, with the projection's (see projection.ts)
    geometry.destroy()
    for (const shader of shaders.values()) shader.destroy()
  }

  return { container, add, remove, destroy }
}

// A program for createTileSet: its fragment program, the tiles it reads besides the steps' ("samplers"), and the
// numbers of its own each tile has besides "uPart" and the steps' (see stepsFragment)
function tileProgram(name: string, fragment: string, count: number, samplers: string[], uniforms: string[] = []) {
  const steps = Array.from({ length: count }, (_, i) => [`uFirst${i}`, `uSecond${i}`]).flat()
  return {
    glProgram: GlProgram.from({ vertex: tileVertex, fragment, name, preferredFragmentPrecision: 'highp' }),
    samplers: [...samplers, ...steps],
    uniforms: ['uPart', ...(count > 0 ? ['uSteps', 'uCount'] : []), ...uniforms],
  }
}

// The numbers of a tile for a program from tileProgram: "width" and "height" of it on the paper, and its steps
function tileValues(width: number, height: number, steps: LiveStep[], forSteps: { numbers: Float32Array }) {
  const part = new Float32Array([width / TILE_SIZE, height / TILE_SIZE])
  return forSteps.numbers.length > 0 ? [part, forSteps.numbers, steps.length] : [part]
}

// Draw a sample of each program into a tiny tile now (see compileNow), from a sample tile of each
function compileSet(renderer: WebGLRenderer, set: ReturnType<typeof createTileSet>, samples: ShownTile[]) {
  for (const tile of samples) tile.visible = true
  compileNow(renderer, set.container)
  for (const tile of samples) set.remove(tile)
}

// How many steps a tile shown live can do on the screen (see createTileMixer): each one reads up to two tiles, and with
// the two pictures mixed first that is 16, the fewest a graphics card with WebGL 2 can read at once. A tile with no
// steps has a program of its own, which reads only the two pictures
const MIXER_STEPS = 7

// Tiles shown on the screen as a mix of two pictures of the same place: as much of the second as "amount", the same
// for all of them, followed by the steps still to do (a layer's opacity changing live: see projection.ts and live in
// composer.ts). The graphics card works it all out on every frame, so a new amount costs nothing more. The pictures
// are whole tiles; a tile at the paper's edge only shows the part on the paper
export function createTileMixer(renderer: WebGLRenderer) {
  const program = (count: number) =>
    tileProgram(
      `tile-mix-${count}`,
      stepsFragment(
        count,
        `uniform sampler2D uZero;
uniform sampler2D uOne;
uniform float uAmount;`,
        `  vec4 picture = mix(texture(uZero, vUV), texture(uOne, vUV), uAmount);
  vec4 own = vec4(0.0);`,
      ),
      count,
      ['uZero', 'uOne'],
    )
  const programs = { none: program(0), some: program(MIXER_STEPS) }
  const amount = new UniformGroup({ uAmount: { value: 0, type: 'f32' } })
  const set = createTileSet(amount, [programs.none, programs.some])

  // A tile mixing these two pictures and doing these steps, at this column and row, "width" and "height" of it on the
  // paper, out of sight. Null when the steps are more than the program can do
  function show(
    zero: Texture,
    one: Texture,
    steps: LiveStep[],
    column: number,
    row: number,
    width: number,
    height: number,
  ) {
    const count = steps.length > 0 ? MIXER_STEPS : 0
    const forSteps = stepsUniforms(steps, count)
    if (!forSteps) return null
    const textures = { uZero: zero.source, uOne: one.source, ...forSteps.tiles }
    return set.add(
      count > 0 ? programs.some : programs.none,
      column,
      row,
      textures,
      tileValues(width, height, steps, forSteps),
    )
  }

  function setAmount(value: number) {
    amount.uniforms.uAmount = value
  }

  compileSet(renderer, set, [
    show(NO_PAINT, NO_PAINT, [], 0, 0, 1, 1)!,
    show(NO_PAINT, NO_PAINT, [{ kind: 'keep' }], 0, 0, 1, 1)!,
  ])
  return { container: set.container, show, setAmount, remove: set.remove, destroy: set.destroy }
}

export type TileMixer = ReturnType<typeof createTileMixer>

// How many steps a tile shown while a layer moves can do on the screen (see createTileMover): with the 8 tiles it
// reads first, 16 again. A tile with no steps has a program of its own, which reads only those 8
const MOVER_STEPS = 4

// How what a transform draws goes in, for the program of createTileMover: none, into the layer, into a new layer
// above it (Normal), that one clipped to the layer, or to the base the layer is clipped to
export const DRAWN = { none: 0, inLayer: 1, above: 2, aboveClippedToLayer: 3, aboveClippedToBase: 4 }

// The tiles a tile shown while a layer moves reads first, as the program of createTileMover names them
const MOVER_TILES = ['uUnder', 'uMask', 'uStays', 'uDrawn', 'uMoved0', 'uMoved1', 'uMoved2', 'uMoved3']

// Tiles shown on the screen while a layer or folder moves (see projection.ts and moveProgram in composer.ts): its
// paint where it is now goes onto the picture of what is under it, with its opacity, its blend mode and the base it
// is clipped to, followed by the steps above it, as they will be once it is let go. Its paint is what stays at the
// tile, with the pictures that move on top, at the same place in every tile for the same move ("uShift"): each pixel
// is in one of the four pictures of the tiles around its place before the move (only one when the move is a whole
// number of tiles). The graphics card works it all out on every frame, so a new place costs nothing more
export function createTileMover(renderer: WebGLRenderer) {
  const program = (count: number) =>
    tileProgram(
      `tile-move-${count}`,
      stepsFragment(
        count,
        `${MOVER_TILES.map(name => `uniform sampler2D ${name};`).join('\n')}
uniform vec2 uShift;
uniform vec3 uItem;`,
        `  vec2 before = vUV * ${TILE_SIZE}.0 - uShift;
  vec2 corner = step(0.0, before);
  vec2 movedUV = before / ${TILE_SIZE}.0 + 1.0 - corner;
  vec4 moved0 = texture(uMoved0, movedUV);
  vec4 moved1 = texture(uMoved1, movedUV);
  vec4 moved2 = texture(uMoved2, movedUV);
  vec4 moved3 = texture(uMoved3, movedUV);
  vec4 moved = corner.y < 0.5 ? (corner.x < 0.5 ? moved0 : moved1) : (corner.x < 0.5 ? moved2 : moved3);
  vec4 own = texture(uStays, vUV);
  own = moved + own * (1.0 - moved.a);
  vec4 drawn = texture(uDrawn, vUV);
  int drawnAs = int(uItem.z + 0.5);
  if (drawnAs == 1) own = drawn + own * (1.0 - drawn.a);
  float clip = texture(uMask, vUV).a;
  vec4 picture = blendOnto(texture(uUnder, vUV), own * uItem.y * clip, int(uItem.x + 0.5));
  if (drawnAs >= 2) picture = blendOnto(picture, drawn * (drawnAs == 3 ? own.a : drawnAs == 4 ? clip : 1.0), 0);`,
      ),
      count,
      MOVER_TILES,
    )
  const programs = { none: program(0), some: program(MOVER_STEPS) }
  // "uItem": the blend mode and the opacity of what moves, and how what a transform draws goes in (see DRAWN)
  const move = new UniformGroup({
    uShift: { value: new Float32Array(2), type: 'vec2<f32>' },
    uItem: { value: new Float32Array(3), type: 'vec3<f32>' },
  })
  const set = createTileSet(move, [programs.none, programs.some])

  // A tile showing the move with what it needs (see MovePicture in composer.ts), at this column and row, "width" and
  // "height" of it on the paper, out of sight, its paint still to be given (see setPaint). Null when the steps are
  // more than the program can do
  function show(
    picture: { under: Texture; mask: Texture | null; steps: LiveStep[] },
    column: number,
    row: number,
    width: number,
    height: number,
  ) {
    const count = picture.steps.length > 0 ? MOVER_STEPS : 0
    const forSteps = stepsUniforms(picture.steps, count)
    if (!forSteps) return null
    const textures = { uUnder: picture.under.source, uMask: (picture.mask ?? NO_MASK).source, ...forSteps.tiles }
    const values = tileValues(width, height, picture.steps, forSteps)
    return set.add(count > 0 ? programs.some : programs.none, column, row, textures, values)
  }

  // The paint of what moves at a tile: what stays there, the pictures that move from the four tiles around (above
  // left, above right, below left, below right of where "uShift" puts them), and what a transform draws there. Null:
  // nothing
  function setPaint(tile: ShownTile, stays: Texture | null, moved: (Texture | null)[], drawn: Texture | null) {
    const paint = [stays, drawn, ...moved]
    for (const [i, texture] of paint.entries()) tile.textures[2 + i] = (texture ?? NO_PAINT).source
  }

  // Where the pictures that move start in each tile, in pixels from its corner (from 0 to a tile's size)
  function setShift(x: number, y: number) {
    const shift = move.uniforms.uShift as Float32Array
    shift[0] = x
    shift[1] = y
  }

  // The blend mode and the opacity of what moves, and how what a transform draws goes in (see DRAWN)
  function setItem(mode: BlendMode, opacity: number, drawnAs: number) {
    const item = move.uniforms.uItem as Float32Array
    item[0] = MODE_NUMBERS[mode]
    item[1] = opacity
    item[2] = drawnAs
  }

  compileSet(renderer, set, [
    show({ under: NO_PAINT, mask: null, steps: [] }, 0, 0, 1, 1)!,
    show({ under: NO_PAINT, mask: null, steps: [{ kind: 'keep' }] }, 0, 0, 1, 1)!,
  ])
  return { container: set.container, show, setPaint, setShift, setItem, remove: set.remove, destroy: set.destroy }
}

export type TileMover = ReturnType<typeof createTileMover>

// Draw this once, into a tiny tile, so that the graphics card's driver turns its program into its own code now, while
// the drawing opens, and not the first time it is needed, which would freeze the screen for a moment (a tenth of a
// second for each program on Windows, where Chrome goes through Direct3D)
function compileNow(renderer: WebGLRenderer, container: Container) {
  const tiny = RenderTexture.create({ width: 1, height: 1 })
  renderer.render({ container, target: tiny, clear: true })
  tiny.destroy(true)
}
