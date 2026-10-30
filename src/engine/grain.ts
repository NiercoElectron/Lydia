import {
  CanvasSource,
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  Shader,
  Texture,
  UniformGroup,
  type RenderTexture,
  type WebGLRenderer,
} from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'

// The paper's grain (decision 67): a picture of how high the paper is at each point, repeated across the paper and
// fixed to it, so a stroke over the same place meets the same grooves, like a pencil on real paper. Light pressure
// only paints the higher places; more pressure reaches down into the grooves.
//
// It is put on a whole stroke at once, not on each dab: the stroke is painted as usual, and beside it, at each pixel,
// the most pressure any dab of the stroke had there (its pressure times how much paint its tip has there, so the soft
// edge of a tip presses less). Then the paint at each pixel keeps only as much as the grain lets through at that
// pressure. Going over a place again in the same stroke doesn't fill the grooves, only pressing harder does.
//
// How deep the grooves are ("depth", from 0 to 1) is how much of the paper light pressure leaves out: the paint
// reaches down to depth × (1 - pressure / 2) of the paper's height, so full pressure still leaves out half as much. The
// grains that come with Lydia have their heights spread evenly (see scripts/make-brushes.mjs), so at a depth of 50%,
// half of the paper is out of reach of the lightest touch

// How far below the reach of the paint it still paints a little, fading out, so the grain's edges are soft
const SOFTNESS = 0.2

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

const fragment = `in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uStroke;
uniform sampler2D uPressure;
uniform sampler2D uGrain;
uniform vec2 uSize; // of the stroke's picture, in pixels of the paper
uniform vec2 uCorner; // where its top left corner is on the paper
uniform vec2 uGrainSize; // of the grain's picture on the paper, in pixels of the paper
uniform float uDepth;

void main(void) {
  float paint = texture(uStroke, vUV).a;
  float pressure = texture(uPressure, vUV).r;
  vec2 paper = uCorner + vUV * uSize;
  float height = texture(uGrain, paper / uGrainSize).r;
  float reach = uDepth * (1.0 - pressure / 2.0);
  float through = clamp(1.0 + (height - reach) / ${SOFTNESS.toFixed(2)}, 0.0, 1.0);
  finalColor = vec4(paint * through);
}
`

export type GrainSettings = {
  picture: HTMLCanvasElement // the grain (see BrushTip in brushTip.ts)
  depth: number
  scale: number // how big its picture is on the paper: 1 = a pixel of the picture on each pixel of the paper
}

// The paper's grain a brush paints with, or null when it has none: only a smooth brush with a grain picture and some
// depth has one
export function grainOf(tip: BrushTip, shape: BrushShape): GrainSettings | null {
  if (!tip.grain || shape.grainDepth <= 0 || shape.pixel !== 'none') return null
  return { picture: tip.grain, depth: shape.grainDepth, scale: shape.grainScale }
}

// Puts the paper's grain on strokes, on the graphics card
export function createGrainPass(renderer: WebGLRenderer) {
  const uniforms = new UniformGroup({
    uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uCorner: { value: new Float32Array(2), type: 'vec2<f32>' },
    uGrainSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uDepth: { value: 0, type: 'f32' },
  })
  let picture: HTMLCanvasElement | null = null
  let grainTexture: Texture | null = null
  const shader = new Shader({
    // Full precision: far into a big drawing, the positions are too big numbers for less
    glProgram: GlProgram.from({ vertex, fragment, name: 'paper-grain', preferredFragmentPrecision: 'highp' }),
    resources: {
      grainUniforms: uniforms,
      uStroke: Texture.EMPTY.source,
      uPressure: Texture.EMPTY.source,
      uGrain: Texture.EMPTY.source,
    },
  })
  // A square of 1×1, stretched over the whole picture
  const square = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const geometry = new MeshGeometry({ positions: square, uvs: square, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) })
  const root = new Container()
  root.addChild(new Mesh({ geometry, shader }))

  // Let go of the grain's picture on the graphics card, unbound from the shader first
  function forgetGrain() {
    shader.resources.uGrain = Texture.EMPTY.source
    grainTexture?.destroy(true)
    grainTexture = null
  }

  // The grain's picture on the graphics card, repeating, with smaller copies of itself (mipmaps) for when it is made
  // smaller. It goes there again only when it changed
  function grainTextureOf(newPicture: HTMLCanvasElement) {
    if (newPicture !== picture || !grainTexture) {
      forgetGrain()
      picture = newPicture
      const source = new CanvasSource({ resource: picture, resolution: 1, autoGenerateMipmaps: true })
      source.style.addressMode = 'repeat'
      grainTexture = new Texture({ source })
    }
    return grainTexture
  }

  // Draw into "target" the stroke "stroke" with the grain on it: "pressure" has the most pressure at each of its
  // pixels in red, and their top left corner is at (left, top) on the paper. All three are the same size
  function apply(
    stroke: Texture,
    pressure: Texture,
    target: RenderTexture,
    left: number,
    top: number,
    grain: GrainSettings,
  ) {
    const grainSource = grainTextureOf(grain.picture).source
    uniforms.uniforms.uSize.set([target.width, target.height])
    uniforms.uniforms.uCorner.set([left, top])
    uniforms.uniforms.uGrainSize.set([grainSource.width * grain.scale, grainSource.height * grain.scale])
    uniforms.uniforms.uDepth = grain.depth
    uniforms.update()
    shader.resources.uStroke = stroke.source
    shader.resources.uPressure = pressure.source
    shader.resources.uGrain = grainSource
    renderer.render({ container: root, target, clear: true, clearColor: [0, 0, 0, 0] })
    // The stroke's tiles are let go of or used again elsewhere: the shader keeps none of them
    shader.resources.uStroke = Texture.EMPTY.source
    shader.resources.uPressure = Texture.EMPTY.source
  }

  function destroy() {
    forgetGrain()
    root.destroy({ children: true })
    shader.destroy()
    geometry.destroy()
  }

  return { apply, destroy }
}

export type GrainPass = ReturnType<typeof createGrainPass>
