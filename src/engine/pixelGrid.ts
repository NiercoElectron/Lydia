import {
  GlProgram,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  UniformGroup,
  UPDATE_PRIORITY,
  type Container,
  type Rectangle,
  type Ticker,
  type WebGLRenderer,
} from 'pixi.js'
import type { Grid } from './tiles'

// The pixel grid: lines between the pixels of the paper when zoomed in, like Photoshop's, to tell each pixel apart.
// Each line takes its color from what the screen shows under it, moved half the way across in red, green and blue:
// white and black become gray, gray becomes black or white, red becomes gray. So it shows on any color, always with
// the same contrast. Plain inverted colors would disappear on middle gray, whose opposite is the same gray
//
// While the grid shows, the drawing is drawn first into a picture the size of the screen, and the screen shows that
// picture through the grid's shader, which reads the color under each line from it. PixiJS's filters do the same,
// but in PixiJS 8.22 they warn when the window changes size: PixiJS throws away the picture of the last frame while
// its filters still point at it

export const PIXEL_GRID_ZOOM = 8 // shown from 800%, where each pixel of the paper is 8 pixels of the screen or more
const STRENGTH = 0.5 // how far the lines go toward that color: 1 = all the way, 0 = not at all

const vertex = `in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out vec2 vScreen;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  vec3 screen = uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  vScreen = screen.xy;
  gl_Position = vec4((uProjectionMatrix * screen).xy, 0.0, 1.0);
  vUV = aUV;
}
`

const fragment = `in vec2 vUV;
in vec2 vScreen;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uZoom; // pixels of the screen for each pixel of the paper
uniform vec2 uOrigin; // where the paper's top left corner is on the screen
uniform vec2 uPaperSize; // in pixels of the paper
uniform float uPixelRatio; // pixels of the display for each pixel of the screen
uniform float uStrength;

void main(void) {
  vec4 color = texture(uTexture, vUV);
  // This pixel of the display, and where its two edges are on the paper
  vec2 pixel = floor(vScreen * uPixelRatio);
  float scale = uZoom * uPixelRatio;
  vec2 from = (pixel - uOrigin * uPixelRatio) / scale;
  vec2 to = (pixel + 1.0 - uOrigin * uPixelRatio) / scale;
  // A line between pixels of the paper goes through this pixel of the display when a whole number lies between its
  // two edges, so each line is one pixel of the display wide. Only the lines inside the paper are drawn
  vec2 line = ceil(from);
  bool across = line.x < to.x && line.x > 0.0 && line.x < uPaperSize.x;
  bool down = line.y < to.y && line.y > 0.0 && line.y < uPaperSize.y;
  vec2 middle = (from + to) / 2.0;
  bool inside = all(greaterThan(middle, vec2(0.0))) && all(lessThan(middle, uPaperSize));
  if (inside && (across || down) && color.a > 0.0) {
    vec3 under = color.rgb / color.a;
    vec3 away = mod(under + 0.5, 1.0); // half the way across, in each of red, green and blue
    color.rgb = mix(under, away, uStrength) * color.a;
  }
  finalColor = color;
}
`

// The grid over "scene", everything the screen shows of the drawing (a child of "stage"). "world" is the part of it
// that zooms and moves
export function createPixelGrid(
  renderer: WebGLRenderer,
  ticker: Ticker,
  stage: Container,
  scene: Container,
  world: Container,
  grid: Grid,
  screen: Rectangle,
) {
  let picture = createPicture()
  const uniforms = new UniformGroup({
    uZoom: { value: 1, type: 'f32' },
    uOrigin: { value: new Float32Array(2), type: 'vec2<f32>' },
    uPaperSize: { value: new Float32Array([grid.width, grid.height]), type: 'vec2<f32>' },
    uPixelRatio: { value: 1, type: 'f32' },
    uStrength: { value: STRENGTH, type: 'f32' },
  })
  const shader = new Shader({
    // Full precision: far into a big drawing, the positions are too big numbers for less
    glProgram: GlProgram.from({ vertex, fragment, name: 'pixel-grid', preferredFragmentPrecision: 'highp' }),
    resources: { gridUniforms: uniforms, uTexture: picture.source },
  })
  // A square of 1×1, stretched over the whole screen
  const square = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const geometry = new MeshGeometry({ positions: square, uvs: square, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) })
  const mesh = new Mesh({ geometry, shader })

  let isOn = true // chosen by the user
  let isShown = false

  // The picture of the drawing, as big as the screen
  function createPicture() {
    return RenderTexture.create({ width: screen.width, height: screen.height, resolution: renderer.resolution })
  }

  // Every frame, before the screen is drawn: the grid shows when it is on and the view is zoomed in enough
  function update() {
    const show = isOn && world.scale.x >= PIXEL_GRID_ZOOM
    if (show !== isShown) {
      const index = stage.getChildIndex(show ? scene : mesh)
      stage.removeChildAt(index)
      stage.addChildAt(show ? mesh : scene, index)
      isShown = show
    }
    if (!show) return

    const { width, height } = picture
    if (width !== screen.width || height !== screen.height || picture.source.resolution !== renderer.resolution) {
      // The window changed size: a new picture, given to the shader before the old one is thrown away
      const old = picture
      picture = createPicture()
      shader.resources.uTexture = picture.source
      old.destroy(true)
    }
    mesh.scale.set(screen.width, screen.height)
    uniforms.uniforms.uZoom = world.scale.x
    uniforms.uniforms.uOrigin[0] = world.position.x
    uniforms.uniforms.uOrigin[1] = world.position.y
    uniforms.uniforms.uPixelRatio = renderer.resolution
    renderer.render({ container: scene, target: picture, clear: true, clearColor: [0, 0, 0, 0] })
  }
  // After everything else that changes the drawing in a frame, just before PixiJS draws the screen
  ticker.add(update, undefined, UPDATE_PRIORITY.LOW + 1)

  function setOn(on: boolean) {
    isOn = on
  }

  function destroy() {
    ticker.remove(update)
    if (isShown) {
      const index = stage.getChildIndex(mesh)
      stage.removeChildAt(index)
      stage.addChildAt(scene, index)
    }
    mesh.destroy()
    geometry.destroy()
    shader.destroy()
    picture.destroy(true)
  }

  return { update, setOn, isShown: () => isShown, destroy }
}

export type PixelGrid = ReturnType<typeof createPixelGrid>
