import {
  BufferImageSource,
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
  UPDATE_PRIORITY,
  type Rectangle,
  type Ticker,
  type WebGLRenderer,
} from 'pixi.js'
import type { Selection } from './selection'
import { TILE_SIZE, tileKey, tileSize, type Grid } from './tiles'

// The selection on the graphics card (decision 40): its edge shown as "marching ants", a line of black and white dashes
// that move, and the strokes cut to it.
// To show the edge, the selected tiles are drawn into a picture the size of the screen, placed like the drawing, and a
// shader draws the dashes where a pixel is selected and the one beside it isn't. That works the same at any zoom, and
// with the view turned or flipped, like the pixel grid (see pixelGrid.ts)

const DASH = 4 // pixels of the display for each dash
const MARCH_MS = 150 // the dashes move one pixel this often

const vertex = `in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  vec3 screen = uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4((uProjectionMatrix * screen).xy, 0.0, 1.0);
  vUV = aUV;
}
`

const fragment = `in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uTexture; // how much each pixel of the screen is selected, in its alpha
uniform vec2 uPixel; // one pixel of the display, in the picture
uniform float uPhase; // moves the dashes along

bool isSelected(vec2 at) {
  return texture(uTexture, at).a >= 0.5;
}

void main(void) {
  bool here = isSelected(vUV);
  bool isEdge = here != isSelected(vUV + vec2(uPixel.x, 0.0)) || here != isSelected(vUV + vec2(0.0, uPixel.y));
  if (!isEdge) {
    finalColor = vec4(0.0);
    return;
  }
  float dash = mod(floor((gl_FragCoord.x + gl_FragCoord.y + uPhase) / ${DASH.toFixed(1)}), 2.0);
  finalColor = dash < 1.0 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
}
`

// Shows "selection" (read every frame) over everything on "stage", placed like "world"
export function createSelectionView(
  renderer: WebGLRenderer,
  ticker: Ticker,
  stage: Container,
  world: Container,
  grid: Grid,
  screen: Rectangle,
  getSelection: () => Selection | null,
) {
  // ----- The selection's tiles on the graphics card -----

  // A tile selected in part, as a texture: white, with how much each pixel is selected in its alpha
  const selectedTextures = new Map<Uint8Array, Texture>()
  // The same tile turned around: what isn't selected, to cut strokes with (made from the one above, on the graphics card)
  const outsideTextures = new Map<Uint8Array, RenderTexture>()

  function selectedTexture(mask: Uint8Array, width: number, height: number) {
    let texture = selectedTextures.get(mask)
    if (!texture) {
      const pixels = new Uint8Array(mask.length * 4)
      // White, multiplied by its alpha: the same value in all four bytes, written as one number
      const colors = new Uint32Array(pixels.buffer)
      for (let i = 0; i < mask.length; i++) colors[i] = mask[i] * 0x01010101
      const source = new BufferImageSource({
        resource: pixels,
        width,
        height,
        format: 'rgba8unorm',
        alphaMode: 'premultiplied-alpha',
      })
      texture = new Texture({ source })
      selectedTextures.set(mask, texture)
    }
    return texture
  }

  // PixiJS ignores the blend mode of what it is asked to render, so the sprites go inside a container
  const cutRoot = new Container()
  const whole = new Sprite(Texture.WHITE)
  const cutter = new Sprite()
  cutter.blendMode = 'erase'
  cutRoot.addChild(whole, cutter)

  function outsideTexture(mask: Uint8Array, width: number, height: number) {
    let texture = outsideTextures.get(mask)
    if (!texture) {
      texture = RenderTexture.create({ width, height })
      // All white, then the selected part taken out
      whole.visible = true
      whole.width = width
      whole.height = height
      cutter.texture = selectedTexture(mask, width, height)
      renderer.render({ container: cutRoot, target: texture, clear: true, clearColor: [0, 0, 0, 0] })
      outsideTextures.set(mask, texture)
    }
    return texture
  }

  // Whether a stroke can paint in this tile at all
  function canPaint(key: string) {
    const selection = getSelection()
    return !selection || selection.has(key)
  }

  // Keep only the selected part of a stroke's tile (white, with the paint in its alpha: see brush.ts)
  function cut(strokeTexture: RenderTexture, key: string) {
    const tile = getSelection()?.get(key)
    if (!tile || tile === 'full') return
    // First, since making it the first time shows "whole"
    const outside = outsideTexture(tile, strokeTexture.width, strokeTexture.height)
    whole.visible = false
    cutter.texture = outside
    renderer.render({ container: cutRoot, target: strokeTexture, clear: false })
  }

  // The other way round: take the selected part out of a layer's tile partly selected, keeping what isn't selected
  // (for what is left of a layer while the move tool drags its selected part away)
  function cutAway(texture: RenderTexture, key: string) {
    const tile = getSelection()?.get(key)
    if (!tile || tile === 'full') return
    whole.visible = false
    cutter.texture = selectedTexture(tile, texture.width, texture.height)
    renderer.render({ container: cutRoot, target: texture, clear: false })
  }

  // ----- Showing it -----

  const shownRoot = new Container() // drawn at the screen's corner, like the stage
  const shown = new Container() // placed like the drawing
  const shownTiles = new Container() // the selected tiles, moved along while the move tool drags them (see setOffset)
  shownRoot.addChild(shown)
  shown.addChild(shownTiles)
  const sprites: Sprite[] = [] // reused between selections

  let picture = createPicture()
  const uniforms = new UniformGroup({
    uPixel: { value: new Float32Array(2), type: 'vec2<f32>' },
    uPhase: { value: 0, type: 'f32' },
  })
  const shader = new Shader({
    glProgram: GlProgram.from({ vertex, fragment, name: 'selection-ants' }),
    resources: { antUniforms: uniforms, uTexture: picture.source },
  })
  const square = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) // stretched over the whole screen
  const geometry = new MeshGeometry({ positions: square, uvs: square, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) })
  const mesh = new Mesh({ geometry, shader })
  mesh.visible = false
  stage.addChild(mesh)

  function createPicture() {
    return RenderTexture.create({ width: screen.width, height: screen.height, resolution: renderer.resolution })
  }

  // What the picture shows now, to draw it again only when something changed
  let drawnSelection: Selection | null = null
  let drawnView = ''

  // Put sprites for the selected tiles into "shown", and let go of the textures of tiles no longer selected. Tiles
  // selected whole side by side in a row are one white rectangle: with everything selected, 40 instead of 1600 sprites
  function placeTiles(selection: Selection) {
    shownTiles.removeChildren()
    let count = 0
    const place = (texture: Texture, x: number, y: number, width: number, height: number) => {
      let sprite = sprites[count]
      if (!sprite) {
        sprite = new Sprite()
        sprites[count] = sprite
      }
      sprite.texture = texture
      sprite.width = width
      sprite.height = height
      sprite.position.set(x, y)
      shownTiles.addChild(sprite)
      count++
    }
    for (let row = 0; row < grid.rows; row++) {
      const top = row * TILE_SIZE
      let wholeFrom = -1 // the first column of the tiles selected whole just before, if any
      for (let column = 0; column <= grid.columns; column++) {
        const tile = column < grid.columns ? selection.get(tileKey(column, row)) : undefined
        if (tile === 'full') {
          if (wholeFrom < 0) wholeFrom = column
          continue
        }
        const { width, height } = tileSize(grid, Math.min(column, grid.columns - 1), row)
        if (wholeFrom >= 0) {
          const left = wholeFrom * TILE_SIZE
          place(Texture.WHITE, left, top, Math.min(grid.width, column * TILE_SIZE) - left, height)
          wholeFrom = -1
        }
        if (tile) place(selectedTexture(tile, width, height), column * TILE_SIZE, top, width, height)
      }
    }
    const inUse = new Set([...selection.values()].filter(tile => tile !== 'full'))
    for (const [mask, texture] of selectedTextures) {
      if (inUse.has(mask)) continue
      texture.destroy(true)
      selectedTextures.delete(mask)
    }
    for (const [mask, texture] of outsideTextures) {
      if (inUse.has(mask)) continue
      texture.destroy(true)
      outsideTextures.delete(mask)
    }
  }

  // Every frame, before the screen is drawn
  function update() {
    const selection = getSelection()
    mesh.visible = selection !== null
    if (!selection) return
    if (selection !== drawnSelection) placeTiles(selection)

    const { width, height } = picture
    if (width !== screen.width || height !== screen.height || picture.source.resolution !== renderer.resolution) {
      // The window changed size: a new picture, given to the shader before the old one is thrown away
      const old = picture
      picture = createPicture()
      shader.resources.uTexture = picture.source
      old.destroy(true)
      drawnView = ''
    }
    const { x, y } = shownTiles.position
    const view = [world.position.x, world.position.y, world.scale.x, world.scale.y, world.rotation, x, y].join()
    if (selection !== drawnSelection || view !== drawnView) {
      shown.position.copyFrom(world.position)
      shown.scale.copyFrom(world.scale)
      shown.rotation = world.rotation
      renderer.render({ container: shownRoot, target: picture, clear: true, clearColor: [0, 0, 0, 0] })
      drawnSelection = selection
      drawnView = view
    }
    mesh.scale.set(screen.width, screen.height)
    uniforms.uniforms.uPixel[0] = 1 / (screen.width * renderer.resolution)
    uniforms.uniforms.uPixel[1] = 1 / (screen.height * renderer.resolution)
    uniforms.uniforms.uPhase = Math.floor(performance.now() / MARCH_MS) % (DASH * 2)
  }
  // After everything else that changes the drawing in a frame, just before PixiJS draws the screen
  ticker.add(update, undefined, UPDATE_PRIORITY.LOW + 1)

  // Show the edge this far from where the selection is, on the paper, while the move tool drags what is selected
  function setOffset(x: number, y: number) {
    shownTiles.position.set(x, y)
  }

  function destroy() {
    ticker.remove(update)
    stage.removeChild(mesh)
    mesh.destroy()
    geometry.destroy()
    shader.destroy()
    picture.destroy(true)
    for (const texture of selectedTextures.values()) texture.destroy(true)
    for (const texture of outsideTextures.values()) texture.destroy(true)
    shownTiles.removeChildren()
    shownRoot.destroy({ children: true })
    for (const sprite of sprites) sprite.destroy()
    cutRoot.destroy({ children: true })
  }

  return { canPaint, cut, cutAway, setOffset, update, destroy }
}

export type SelectionView = ReturnType<typeof createSelectionView>
