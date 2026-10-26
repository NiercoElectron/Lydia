import { Container, Geometry, GlProgram, Mesh, RenderTexture, Shader, Sprite, Texture, UniformGroup } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
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
// The layers panel offers them grouped as Photoshop does (see LayersPanel.tsx)

// Each mode's number in the shader below
const MODE_NUMBERS: Record<BlendMode, number> = {
  normal: 0,
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

// The graphics card keeps colors multiplied by their alpha: the formulas need them as they are, so that is undone
// first, and done again in the result
const fragment = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uBackdrop;
uniform sampler2D uPaint;
uniform float uOpacity;
uniform float uMode;

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
vec3 blended(vec3 under, vec3 over) {
  int mode = int(uMode + 0.5);
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

void main(void) {
  vec4 under = texture(uBackdrop, vUV);
  vec4 over = texture(uPaint, vUV) * uOpacity;
  vec3 underColor = under.a > 0.0 ? min(under.rgb / under.a, 1.0) : vec3(0.0);
  vec3 overColor = over.a > 0.0 ? min(over.rgb / over.a, 1.0) : vec3(0.0);
  vec3 mixed = clamp(blended(underColor, overColor), 0.0, 1.0);
  // Each one alone where the other has no paint, and the mix as much as both cover
  vec3 color = over.rgb * (1.0 - under.a) + under.rgb * (1.0 - over.a) + mixed * over.a * under.a;
  finalColor = vec4(color, over.a + under.a * (1.0 - over.a));
}
`

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
    resources: { blendUniforms: uniforms, uBackdrop: Texture.EMPTY.source, uPaint: Texture.EMPTY.source },
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

  // Put "paint" (a layer's tile) at this opacity onto "backdrop" (what is under it) with this mode, into "target".
  // All three are whole tiles; "target" must be neither of the other two
  function blend(backdrop: Texture, paint: Texture, opacity: number, mode: BlendMode, target: RenderTexture) {
    shader.resources.uBackdrop = backdrop.source
    shader.resources.uPaint = paint.source
    uniforms.uniforms.uOpacity = opacity
    uniforms.uniforms.uMode = MODE_NUMBERS[mode]
    renderer.render({ container: root, target, clear: false })
  }

  // The same, with the result in "target" itself (merging a layer down onto the one under it)
  function blendOnto(target: RenderTexture, paint: Texture, opacity: number, mode: BlendMode) {
    scratch ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    blend(target, paint, opacity, mode, scratch)
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

  return { blend, blendOnto, destroy }
}

export type LayerBlender = ReturnType<typeof createLayerBlender>
