import { GlProgram, Mesh, MeshGeometry, Shader, Texture, type Container } from 'pixi.js'
import type { PixelGrid } from './pixelGrid'
import type { Point } from './selection'

// Thin lines over the drawing, in pixels of the screen, that take their color from what the screen shows under them,
// so they show on any color: each of red, green and blue goes to the far end from where it is, all or nothing. White
// becomes black, black white, red cyan. Plain inverted colors would disappear on middle gray, and the softer color of
// the pixel grid is too faint for a line this thin on white
//
// Each piece of a line is a long box, and the shader paints the middle of the box, with an edge one pixel of the
// display wide so the line doesn't show steps. The color comes from the pixel grid's picture of the screen (see
// pixelGrid.ts), which stays on while these lines show

const LINE_WIDTH = 1 // in pixels of the screen
const REACH = LINE_WIDTH / 2 + 1 // how far the box goes from the middle of the line, with room for the edge

const vertex = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out float vAcross;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  vec3 place = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(place.xy, 0.0, 1.0);
  vUV = vec2(place.x + 1.0, 1.0 - place.y) / 2.0;
  vAcross = aUV.x;
}
`

const fragment = `#version 300 es
in vec2 vUV;
in float vAcross;
out vec4 finalColor;

uniform sampler2D uTexture;

const float HALF_WIDTH = ${LINE_WIDTH / 2};

void main(void) {
  vec3 under = texture(uTexture, vUV).rgb;
  vec3 color = 1.0 - round(under);
  float covered = clamp((HALF_WIDTH - abs(vAcross)) / fwidth(vAcross) + 0.5, 0.0, 1.0);
  finalColor = vec4(color, 1.0) * covered;
}
`

export function createContrastLines(stage: Container, pixelGrid: PixelGrid) {
  const shader = new Shader({
    glProgram: GlProgram.from({ vertex, fragment, name: 'contrast-lines' }),
    // PixiJS only binds a texture the shader starts with: one set later would be silently left out, and the shader would
    // read whatever texture was bound last
    resources: { uTexture: Texture.WHITE.source },
  })
  pixelGrid.sharePicture(shader)
  const geometry = new MeshGeometry({
    positions: new Float32Array(8),
    uvs: new Float32Array(8),
    indices: new Uint32Array(0),
  })
  const mesh = new Mesh({ geometry, shader })
  mesh.visible = false
  stage.addChild(mesh)

  // Each piece, from its first point to its second, on the screen
  function draw(pieces: [Point, Point][]) {
    const shown = pieces.filter(([from, to]) => from.x !== to.x || from.y !== to.y)
    const positions = new Float32Array(shown.length * 8)
    const uvs = new Float32Array(shown.length * 8)
    const indices = new Uint32Array(shown.length * 6)
    shown.forEach(([from, to], i) => {
      const length = Math.hypot(to.x - from.x, to.y - from.y)
      const x = (to.x - from.x) / length
      const y = (to.y - from.y) / length
      // A little past both ends, so that two pieces meet without a gap at a corner
      const start = { x: from.x - (x * LINE_WIDTH) / 2, y: from.y - (y * LINE_WIDTH) / 2 }
      const end = { x: to.x + (x * LINE_WIDTH) / 2, y: to.y + (y * LINE_WIDTH) / 2 }
      positions.set(
        [
          start.x - y * REACH,
          start.y + x * REACH,
          start.x + y * REACH,
          start.y - x * REACH,
          end.x + y * REACH,
          end.y - x * REACH,
          end.x - y * REACH,
          end.y + x * REACH,
        ],
        i * 8,
      )
      uvs.set([REACH, 0, -REACH, 0, -REACH, 0, REACH, 0], i * 8)
      const first = i * 4
      indices.set([first, first + 1, first + 2, first, first + 2, first + 3], i * 6)
    })
    geometry.positions = positions
    geometry.uvs = uvs
    geometry.indices = indices
  }

  function show(on: boolean) {
    mesh.visible = on
    pixelGrid.keepPicture(on)
  }

  function destroy() {
    mesh.destroy()
    geometry.destroy()
    shader.destroy()
  }

  return { draw, show, destroy }
}
