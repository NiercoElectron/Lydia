import {
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  GlProgram,
  Mesh,
  Shader,
  UniformGroup,
  type BLEND_MODES,
  type Texture,
  type WebGLRenderer,
} from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import type { Dab } from './dabs'

// Dabs with "filtered noise": each dab gets its own random numbers (or each stroke, see dabs.ts), all filtered the
// same way, so no two are alike but all have the same character. The graphics card works the noise out for each pixel
// of each dab while painting it, from the dab's seed, so nothing has to be prepared and it is sharp at any size.
//
// The noise: random numbers at the corners of a grid (the sequence), blended smoothly between the corners (the
// filter). The size of the grid's cells is the size of the grain. Finer grids added on top ("layers") give a more
// natural texture, a grid longer one way than the other gives streaks, and a curve at the end sets the contrast.
//
// All the dabs that touch a tile are drawn at once: one square, copied once for each dab ("instances"), with each
// dab's center, size, angle, flow and seed. Like the other dabs, they are painted white into the stroke's own tiles
// (see brush.ts)

const FLOATS_PER_DAB = 6 // x, y, size, angle, alpha, seed

// WebGL 2's shading language ("300 es"), for whole numbers in the noise
const vertex = `#version 300 es
in vec2 aPosition;
in vec2 aCenter;
in float aSize;
in float aAngle;
in float aAlpha;
in float aSeed;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uTipShape;

out vec2 vUV;
out float vAlpha;
flat out uint vSeed;

void main(void) {
  // A corner of the tip's picture, turned with the dab
  vec2 corner = aPosition * uTipShape * aSize;
  float c = cos(aAngle);
  float s = sin(aAngle);
  vec2 position = aCenter + vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  vUV = aPosition + 0.5;
  vAlpha = aAlpha;
  vSeed = uint(aSeed);
}
`

const fragment = `#version 300 es
in vec2 vUV;
in float vAlpha;
flat in uint vSeed;
out vec4 finalColor;

uniform sampler2D uTip;
uniform float uAmount;
uniform float uGrain;
uniform float uLayers;
uniform float uStretch;
uniform float uContrast;
uniform float uComputedTip;

// A random number for a corner of the grid, from 0 to 1: the same corner, seed and layer always give the same number
float randomAt(ivec2 cell, uint layer) {
  uint h = uint(cell.x) * 0x8da6b343u ^ uint(cell.y) * 0xd8163841u ^ (vSeed * 4u + layer) * 0xcb1ab31fu;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return float(h >> 8u) / 16777216.0;
}

// The random numbers of the four corners around this point, blended smoothly
float valueNoise(vec2 p, uint layer) {
  vec2 corner = floor(p);
  vec2 f = p - corner;
  vec2 blend = f * f * (3.0 - 2.0 * f);
  ivec2 cell = ivec2(corner);
  float top = mix(randomAt(cell, layer), randomAt(cell + ivec2(1, 0), layer), blend.x);
  float bottom = mix(randomAt(cell + ivec2(0, 1), layer), randomAt(cell + ivec2(1, 1), layer), blend.x);
  return mix(top, bottom, blend.y);
}

// The filtered noise at a point of the tip: each layer has grains half as big and counts half as much
float filteredNoise(vec2 uv) {
  vec2 p = uv * uGrain * vec2(1.0, uStretch);
  float sum = 0.0;
  float weight = 0.0;
  float strength = 1.0;
  for (int layer = 0; layer < 4; layer++) {
    if (float(layer) >= uLayers) break;
    sum += valueNoise(p, uint(layer)) * strength;
    weight += strength;
    strength *= 0.5;
    p *= 2.0;
  }
  return sum / weight;
}

void main(void) {
  float tip = uComputedTip > 0.5
    ? clamp((1.0 - length(vUV - 0.5) * 2.0) * 2.0, 0.0, 1.0)
    : texture(uTip, vUV).a;
  float paint = tip;
  if (tip > 0.0 && uAmount > 0.0) {
    float noise = clamp((filteredNoise(vUV) - 0.5) * uContrast + 0.5, 0.0, 1.0);
    paint *= mix(1.0, noise, uAmount);
  }
  finalColor = vec4(paint * vAlpha); // white, with the paint in its alpha
}
`

export function createNoiseDabs(renderer: WebGLRenderer, startTexture: Texture, startTip: BrushTip) {
  let dabData = new Float32Array(FLOATS_PER_DAB * 256)
  const dabBuffer = new Buffer({ data: dabData, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST })
  const perDab = (format: 'float32' | 'float32x2', floatOffset: number) => ({
    buffer: dabBuffer,
    format,
    stride: FLOATS_PER_DAB * 4,
    offset: floatOffset * 4,
    instance: true,
  })
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), format: 'float32x2' },
      aCenter: perDab('float32x2', 0),
      aSize: perDab('float32', 2),
      aAngle: perDab('float32', 3),
      aAlpha: perDab('float32', 4),
      aSeed: perDab('float32', 5),
    },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  const uniforms = new UniformGroup({
    uTipShape: { value: new Float32Array(2), type: 'vec2<f32>' },
    uAmount: { value: 0, type: 'f32' },
    uGrain: { value: 1, type: 'f32' },
    uLayers: { value: 1, type: 'f32' },
    uStretch: { value: 1, type: 'f32' },
    uContrast: { value: 1, type: 'f32' },
    uComputedTip: { value: 0, type: 'f32' },
  })
  const shader = new Shader({
    glProgram: GlProgram.from({ vertex, fragment, name: 'noise-dabs', preferredFragmentPrecision: 'highp' }),
    resources: { dabUniforms: uniforms, uTip: startTexture.source },
  })
  const mesh = new Mesh({ geometry, shader })
  const root = new Container() // the mesh is moved inside it, so that the tile's corner is at (0, 0)
  root.addChild(mesh)

  // For measuring only, on the filtered-noise branch: paint a computed round tip instead of the tip's picture, or
  // leave the noise out, to see what each part costs
  const debug = { computedTip: false, noNoise: false }

  // Paint with another tip
  function setTip(texture: Texture, tip: BrushTip) {
    shader.resources.uTip = texture.source
    const side = Math.max(tip.image.width, tip.image.height)
    uniforms.uniforms.uTipShape[0] = tip.image.width / side
    uniforms.uniforms.uTipShape[1] = tip.image.height / side
  }
  setTip(startTexture, startTip)

  // Paint these dabs into a tile of the stroke, whose top left corner is at (left, top) on the paper
  function paint(target: Texture, dabs: Dab[], left: number, top: number, blendMode: BLEND_MODES, shape: BrushShape) {
    if (dabData.length < dabs.length * FLOATS_PER_DAB) {
      dabData = new Float32Array(dabs.length * FLOATS_PER_DAB * 2)
      dabBuffer.data = dabData
    }
    dabs.forEach((dab, i) => {
      const at = i * FLOATS_PER_DAB
      dabData[at] = dab.x
      dabData[at + 1] = dab.y
      dabData[at + 2] = dab.size
      dabData[at + 3] = dab.angle
      dabData[at + 4] = dab.alpha
      dabData[at + 5] = dab.seed
    })
    dabBuffer.update(dabs.length * FLOATS_PER_DAB * 4)
    geometry.instanceCount = dabs.length

    const values = uniforms.uniforms
    values.uAmount = debug.noNoise ? 0 : shape.noiseAmount
    values.uGrain = shape.noiseGrain
    values.uLayers = shape.noiseLayers
    values.uStretch = shape.noiseStretch
    values.uContrast = shape.noiseContrast
    values.uComputedTip = debug.computedTip ? 1 : 0
    mesh.blendMode = blendMode
    mesh.position.set(-left, -top)
    renderer.render({ container: root, target, clear: false })
  }

  function destroy() {
    root.destroy({ children: true })
    geometry.destroy()
    shader.destroy()
  }

  return { setTip, paint, debug, destroy }
}

export type NoiseDabs = ReturnType<typeof createNoiseDabs>
