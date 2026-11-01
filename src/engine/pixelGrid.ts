import {
  GlProgram,
  Matrix,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  Texture,
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
// its filters still point at it. That picture also serves other lines that take their color from the screen (see
// contrastLines.ts), so it stays on while they show, at any zoom

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
uniform mat3 uToPaper; // from a point of the screen to a point of the paper (the view may be turned and flipped)
uniform vec2 uPaperSize; // in pixels of the paper
uniform float uPixelRatio; // pixels of the display for each pixel of the screen
uniform float uStrength;

void main(void) {
  vec4 color = texture(uTexture, vUV);
  // This pixel of the display, where its four corners are on the paper, and the box around them
  vec2 pixel = floor(vScreen * uPixelRatio);
  vec2 a = (uToPaper * vec3(pixel / uPixelRatio, 1.0)).xy;
  vec2 b = (uToPaper * vec3((pixel + vec2(1.0, 0.0)) / uPixelRatio, 1.0)).xy;
  vec2 c = (uToPaper * vec3((pixel + vec2(0.0, 1.0)) / uPixelRatio, 1.0)).xy;
  vec2 d = (uToPaper * vec3((pixel + 1.0) / uPixelRatio, 1.0)).xy;
  vec2 from = min(min(a, b), min(c, d));
  vec2 to = max(max(a, b), max(c, d));
  // A line between pixels of the paper goes through this pixel of the display when a whole number lies within that
  // box, so each line is one pixel of the display wide (a little more when the view is turned). Only the lines inside
  // the paper are drawn
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
  const toPaper = new Matrix()
  const uniforms = new UniformGroup({
    uToPaper: { value: toPaper, type: 'mat3x3<f32>' },
    uPaperSize: { value: new Float32Array([grid.width, grid.height]), type: 'vec2<f32>' },
    uPixelRatio: { value: 1, type: 'f32' },
    uStrength: { value: STRENGTH, type: 'f32' },
  })
  const shader = new Shader({
    // Full precision: far into a big drawing, the positions are too big numbers for less
    glProgram: GlProgram.from({ vertex, fragment, name: 'pixel-grid', preferredFragmentPrecision: 'highp' }),
    resources: { gridUniforms: uniforms, uTexture: picture.source },
  })
  const shaders = [shader] // those that read the picture
  // A square of 1×1, stretched over the whole screen
  const square = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const geometry = new MeshGeometry({ positions: square, uvs: square, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) })
  const mesh = new Mesh({ geometry, shader })

  let isOn = true // chosen by the user
  let isKept = false // whether something else needs the picture now
  let isShown = false

  // The picture of the drawing, as big as the screen, edges smoothed like the screen's own
  function createPicture() {
    return RenderTexture.create({
      width: screen.width,
      height: screen.height,
      resolution: renderer.resolution,
      antialias: true,
    })
  }

  // Every frame, before the screen is drawn: the grid shows when it is on and the view is zoomed in enough (the zoom
  // is the world's scale down; across, it is negative when the view is flipped)
  function update() {
    const isGrid = isOn && world.scale.y >= PIXEL_GRID_ZOOM
    const show = isGrid || isKept
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
      for (const each of shaders) each.resources.uTexture = picture.source
      old.destroy(true)
    }
    mesh.scale.set(screen.width, screen.height)
    // The world is on the screen as it is (nothing around it moves), so its own transform takes the paper to the screen
    world.updateLocalTransform()
    toPaper.copyFrom(world.localTransform).invert()
    uniforms.uniforms.uPixelRatio = renderer.resolution
    uniforms.uniforms.uStrength = isGrid ? STRENGTH : 0
    // Around the paper, the color the screen has there
    renderer.render({ container: scene, target: picture, clear: true, clearColor: renderer.background.colorRgba })
  }
  // After everything else that changes the drawing in a frame, just before PixiJS draws the screen
  ticker.add(update, undefined, UPDATE_PRIORITY.LOW + 1)

  function setOn(on: boolean) {
    isOn = on
  }

  // Keep the picture on or not, whatever the zoom
  function keepPicture(on: boolean) {
    isKept = on
  }

  // Give this shader the picture, now and whenever it is made again
  function sharePicture(other: Shader) {
    shaders.push(other)
    other.resources.uTexture = picture.source
  }

  function destroy() {
    ticker.remove(update)
    if (isShown) {
      const index = stage.getChildIndex(mesh)
      stage.removeChildAt(index)
      stage.addChildAt(scene, index)
    }
    for (const each of shaders) each.resources.uTexture = Texture.WHITE.source // the lines may outlast the picture
    mesh.destroy()
    geometry.destroy()
    shader.destroy()
    picture.destroy(true)
  }

  return { update, setOn, keepPicture, sharePicture, isShown: () => isShown, destroy }
}

export type PixelGrid = ReturnType<typeof createPixelGrid>
