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
// The noise forms the dab in one of three ways (the brush's "noiseMode"):
// - "mix": it takes paint away from the tip, softly, following the tip's own edge
// - "drops": whole drops of paint, one at most in each cell of the grid, there where the tip has paint. A drop is
//   painted whole or not at all, so the tip's edge never cuts one
// - "worn": the tip is worn away from its edge in, full in the middle with growing holes toward the edge, and a hard
//   edge everywhere
//
// All the dabs that touch a tile are drawn at once: one square, copied once for each dab ("instances"), with each
// dab's center, size, angle, flow and seed. Like the other dabs, they are painted white into the stroke's own tiles
// (see brush.ts)

const FLOATS_PER_DAB = 6 // x, y, size, angle, alpha, seed
const MODES = { mix: 0, drops: 1, worn: 2 }
// "worn" wears away a blurred copy of the tip, so that a hard tip has an edge to wear: read from its smaller copy of
// about this many pixels across, and blurred over this much of the tip around each point
const WORN_FIELD_SIZE = 32
const WORN_BLUR = 0.1

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
uniform float uMargin;

out vec2 vUV;
out float vAlpha;
flat out uint vSeed;

void main(void) {
  // A corner of the tip's picture, with a margin around it for drops that stick out, turned with the dab
  vec2 square = aPosition * (1.0 + 2.0 * uMargin);
  vec2 corner = square * uTipShape * aSize;
  float c = cos(aAngle);
  float s = sin(aAngle);
  vec2 position = aCenter + vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  vUV = square + 0.5;
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
uniform float uMode;
uniform float uAmount;
uniform float uGrain;
uniform float uLayers;
uniform float uStretch;
uniform float uContrast;
uniform float uFieldLod;
uniform float uFieldBlur;

// A random number for a corner of the grid, from 0 to 1: the same corner, seed and layer always give the same number
float randomAt(ivec2 cell, uint layer) {
  uint h = uint(cell.x) * 0x8da6b343u ^ uint(cell.y) * 0xd8163841u ^ (vSeed * 16u + layer) * 0xcb1ab31fu;
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

// The filtered noise at a point of the tip, with its contrast: each layer has grains half as big and counts half
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
  return clamp((sum / weight - 0.5) * uContrast + 0.5, 0.0, 1.0);
}

// How much of a pixel is inside a shape, from how far inside it is and how big a pixel is, in the same units: a hard
// edge, smoothed over one pixel
float inside(float distance, float pixel) {
  return clamp(distance / max(pixel, 1e-6) + 0.5, 0.0, 1.0);
}

// "drops": each cell of the grid may hold a drop, with a random center, size and ragged edge (rougher with more
// layers). A drop is there when a random number is under the tip's paint where the drop's center is, times the amount
float drops(vec2 uv) {
  vec2 scale = uGrain * vec2(1.0, uStretch);
  vec2 p = uv * scale;
  ivec2 home = ivec2(floor(p));
  // The size of a pixel on the grid. Measured on the grid itself, which changes smoothly everywhere: the distance to a
  // drop jumps where two neighboring pixels measure to different drops, which drew lines along the cells
  float pixel = length(fwidth(p)) * 0.5;
  float wobble = (valueNoise(p * 3.0, 8u) - 0.5) * 0.5 * clamp(uLayers - 1.0, 0.0, 1.0)
    + (valueNoise(p * 6.0, 9u) - 0.5) * 0.25 * clamp(uLayers - 2.0, 0.0, 1.0)
    + (valueNoise(p * 12.0, 10u) - 0.5) * 0.125 * clamp(uLayers - 3.0, 0.0, 1.0);
  float paint = 0.0;
  // A drop reaches less than a cell from its own cell, so only the neighboring cells can reach this point
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 cell = home + ivec2(dx, dy);
      vec2 center = vec2(cell) + 0.2 + 0.6 * vec2(randomAt(cell, 4u), randomAt(cell, 5u));
      float there = randomAt(cell, 6u) < textureLod(uTip, center / scale, 0.0).a * uAmount ? 1.0 : 0.0;
      float radius = 0.3 + 0.25 * randomAt(cell, 7u);
      paint = max(paint, there * inside(radius - length(p - center) + wobble, pixel));
    }
  }
  return paint;
}

// The tip's paint at a point of its smaller copy, with no paint outside its square (the smaller copy alone doesn't know
// that, and stays painted at the edge of a tip that touches its square)
float tipNear(vec2 at) {
  bool inSquare = all(greaterThanEqual(at, vec2(0.0))) && all(lessThanEqual(at, vec2(1.0)));
  return inSquare ? textureLod(uTip, at, uFieldLod).a : 0.0;
}

// The tip, blurred: the average of points on two rings around this one, so that it blurs the same way in every
// direction (blurring over a square flattens a round tip on four sides)
float blurredTip(vec2 uv) {
  float sum = tipNear(uv);
  for (int i = 0; i < 12; i++) {
    float angle = float(i) * 0.5235988; // 30°
    sum += tipNear(uv + vec2(cos(angle), sin(angle)) * uFieldBlur);
  }
  for (int i = 0; i < 6; i++) {
    float angle = float(i) * 1.0471976 + 0.5235988; // 60°, between the outer ones
    sum += tipNear(uv + vec2(cos(angle), sin(angle)) * uFieldBlur * 0.5);
  }
  return sum / 19.0;
}

// "worn": the tip, blurred, worn away by the noise: full in the middle, with growing holes toward the edge. Only the
// inner half of the blur is used (where it has more than half its paint), so the shape stays inside the tip's own edge
float worn(vec2 uv) {
  float field = clamp(blurredTip(uv) * 2.0 - 1.0, 0.0, 1.0);
  float distance = field - mix(0.5, 1.0 - filteredNoise(uv), uAmount);
  return inside(distance, fwidth(distance));
}

void main(void) {
  float paint;
  if (uMode > 1.5) {
    paint = worn(vUV);
  } else if (uMode > 0.5) {
    paint = drops(vUV);
  } else {
    // "mix"
    paint = texture(uTip, vUV).a;
    if (paint > 0.0) paint *= mix(1.0, filteredNoise(vUV), uAmount);
  }
  finalColor = vec4(paint * vAlpha); // white, with the paint in its alpha
}
`

// How much further than the tip's picture a dab with noise can paint, as a fraction of the dab's size: drops near the
// edge stick out by up to a cell of the grid
export function noiseReach(shape: BrushShape) {
  return shape.noiseAmount > 0 && shape.noiseMode === 'drops' ? Math.SQRT2 / shape.noiseGrain : 0
}

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
    uMargin: { value: 0, type: 'f32' },
    uMode: { value: 0, type: 'f32' },
    uAmount: { value: 0, type: 'f32' },
    uGrain: { value: 1, type: 'f32' },
    uLayers: { value: 1, type: 'f32' },
    uStretch: { value: 1, type: 'f32' },
    uContrast: { value: 1, type: 'f32' },
    uFieldLod: { value: 0, type: 'f32' },
    uFieldBlur: { value: WORN_BLUR, type: 'f32' },
  })
  const shader = new Shader({
    glProgram: GlProgram.from({ vertex, fragment, name: 'noise-dabs', preferredFragmentPrecision: 'highp' }),
    resources: { dabUniforms: uniforms, uTip: startTexture.source },
  })
  const mesh = new Mesh({ geometry, shader })
  const root = new Container() // the mesh is moved inside it, so that the tile's corner is at (0, 0)
  root.addChild(mesh)

  // Paint with another tip
  function setTip(texture: Texture, tip: BrushTip) {
    shader.resources.uTip = texture.source
    const side = Math.max(tip.image.width, tip.image.height)
    uniforms.uniforms.uTipShape[0] = tip.image.width / side
    uniforms.uniforms.uTipShape[1] = tip.image.height / side
    // The smaller copy of the tip (mipmap) that is about WORN_FIELD_SIZE pixels across
    uniforms.uniforms.uFieldLod = Math.max(0, Math.log2(side / WORN_FIELD_SIZE))
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
    values.uMode = MODES[shape.noiseMode]
    values.uMargin = shape.noiseMode === 'drops' ? 1 / shape.noiseGrain : 0 // one cell of the grid
    values.uAmount = shape.noiseAmount
    values.uGrain = shape.noiseGrain
    values.uLayers = shape.noiseLayers
    values.uStretch = shape.noiseStretch
    values.uContrast = shape.noiseContrast
    mesh.blendMode = blendMode
    mesh.position.set(-left, -top)
    renderer.render({ container: root, target, clear: false })
  }

  function destroy() {
    root.destroy({ children: true })
    geometry.destroy()
    shader.destroy()
  }

  return { setTip, paint, destroy }
}

export type NoiseDabs = ReturnType<typeof createNoiseDabs>
