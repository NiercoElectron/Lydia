import {
  BufferImageSource,
  Container,
  Geometry,
  GlProgram,
  Mesh,
  RenderTexture,
  Shader,
  Sprite,
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

// The formulas, shared by the program that blends tiles and the one that shows tiles live (see createTileMixer). The
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

  // Draw into "target", then let go of the tiles read: one of them may be deleted later, which PixiJS warns about while
  // a program still holds it
  function draw(target: RenderTexture) {
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
  return { blend, blendOnto, mix, clip, destroy }
}

export type LayerBlender = ReturnType<typeof createLayerBlender>

// How many steps a tile shown live can do on the screen (see createTileMixer): each one reads up to two tiles, and with
// the two pictures mixed first that is 16, the fewest a graphics card with WebGL 2 can read at once
const MIXER_STEPS = 7
// How the mixer's program tells the steps apart (see LiveStep in composer.ts): none, onto, into, mixed with a picture,
// keep, mixed with the picture kept
const STEP_KINDS = { none: 0, onto: 1, into: 2, mix: 3, keep: 4, mixKept: 5 }
const STEP_NUMBERS = Array.from({ length: MIXER_STEPS }, (_, i) => i)

// For each step in "uSteps": "x" its kind, "y" its mode, "z" its opacity, "w" 1 when it has a mask (its second tile).
// The tiles are read first, each by its own name (a program can't choose a tile by a number it works out), and the
// steps then go in a loop, so the formulas are in the program once: the graphics card's driver turns the program
// into its own code the first time it is used, and with the formulas written out for every step, that took seconds.
// Only the tiles of the steps there are ("uCount") are read, and the masks there are.
// Two pictures can be kept at once, which is enough for a folder letting what is in it pass through inside another one
const mixerFragment = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uZero;
uniform sampler2D uOne;
uniform float uAmount;
uniform vec4 uSteps[${MIXER_STEPS}];
uniform float uCount;
${STEP_NUMBERS.map(i => `uniform sampler2D uFirst${i};\nuniform sampler2D uSecond${i};`).join('\n')}
${FORMULAS}
void main(void) {
  int count = int(uCount + 0.5);
${STEP_NUMBERS.map(
  i => `  vec4 first${i} = vec4(0.0);
  float mask${i} = 1.0;
  if (count > ${i}) {
    first${i} = texture(uFirst${i}, vUV);
    if (uSteps[${i}].w > 0.5) mask${i} = texture(uSecond${i}, vUV).a;
  }`,
).join('\n')}
  vec4 picture = mix(texture(uZero, vUV), texture(uOne, vUV), uAmount);
  vec4 kept = vec4(0.0);
  vec4 keptBefore = vec4(0.0);
  for (int i = 0; i < ${MIXER_STEPS}; i++) {
    if (i >= count) break;
    vec4 first = ${STEP_NUMBERS.slice(0, -1)
      .map(i => `i == ${i} ? first${i} : `)
      .join('')}first${MIXER_STEPS - 1};
    float mask = ${STEP_NUMBERS.slice(0, -1)
      .map(i => `i == ${i} ? mask${i} : `)
      .join('')}mask${MIXER_STEPS - 1};
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
  }
  finalColor = picture;
}
`

// What the mixer's program needs for these steps: the numbers of the steps and the tiles they read. Null when there
// are too many, or more pictures kept at once than it can keep
function mixerSteps(steps: LiveStep[]) {
  if (steps.length > MIXER_STEPS) return null
  const numbers = new Float32Array(MIXER_STEPS * 4)
  const tiles: Record<string, TextureSource> = {}
  let keptCount = 0
  for (const i of STEP_NUMBERS) {
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
    numbers.set(values, i * 4)
    tiles[`uFirst${i}`] = first.source
    tiles[`uSecond${i}`] = (second ?? NO_MASK).source
  }
  return { numbers, tiles }
}

// Tiles shown on the screen as a mix of two pictures of the same place: as much of the second as "amount", the same
// for all of them, followed by the steps still to do (a layer's opacity changing live: see projection.ts and live in
// composer.ts). The graphics card works it all out on every frame, so a new amount costs nothing more. The pictures
// are whole tiles; a tile at the paper's edge only shows the part on the paper
export function createTileMixer(renderer: WebGLRenderer) {
  const geometry = new Geometry({
    attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  const glProgram = GlProgram.from({
    vertex: `#version 300 es
in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uPart;

out vec2 vUV;

void main(void) {
  vUV = aPosition * uPart;
  vec3 position = vec3(vUV * ${TILE_SIZE}.0, 1.0);
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * position).xy, 0.0, 1.0);
}
`,
    fragment: mixerFragment,
    name: 'tile-mix',
    preferredFragmentPrecision: 'highp',
  })
  const amount = new UniformGroup({ uAmount: { value: 0, type: 'f32' } })

  // A tile mixing these two pictures and doing these steps, "width" and "height" of it on the paper. Null when the
  // steps are more than the program can do
  function show(zero: Texture, one: Texture, steps: LiveStep[], width: number, height: number) {
    const forSteps = mixerSteps(steps)
    if (!forSteps) return null
    const tile = new UniformGroup({
      uPart: { value: new Float32Array([width / TILE_SIZE, height / TILE_SIZE]), type: 'vec2<f32>' },
      uSteps: { value: forSteps.numbers, type: 'vec4<f32>', size: MIXER_STEPS },
      uCount: { value: steps.length, type: 'f32' },
    })
    const shader = new Shader({
      glProgram,
      resources: { mixAmount: amount, mixTile: tile, uZero: zero.source, uOne: one.source, ...forSteps.tiles },
    })
    return new Mesh({ geometry, shader })
  }

  function setAmount(value: number) {
    amount.uniforms.uAmount = value
  }

  // Take a tile off the screen
  function remove(tile: Mesh<Geometry, Shader>) {
    const shader = tile.shader!
    tile.destroy()
    shader.destroy()
  }

  // The program stays: PixiJS keeps one for each source code, shared by every drawing opened
  function destroy() {
    geometry.destroy()
  }

  const sample = new Container()
  sample.addChild(show(NO_PAINT, NO_PAINT, [], 1, 1)!)
  compileNow(renderer, sample)
  remove(sample.children[0] as Mesh<Geometry, Shader>)
  sample.destroy()
  return { show, setAmount, remove, destroy }
}

// Draw this once, into a tiny tile, so that the graphics card's driver turns its program into its own code now, while
// the drawing opens, and not the first time it is needed, which would freeze the screen for a moment (a tenth of a
// second for each program on Windows, where Chrome goes through Direct3D)
function compileNow(renderer: WebGLRenderer, container: Container) {
  const tiny = RenderTexture.create({ width: 1, height: 1 })
  renderer.render({ container, target: tiny, clear: true })
  tiny.destroy(true)
}

export type TileMixer = ReturnType<typeof createTileMixer>
