import {
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  Sprite,
  UniformGroup,
  type WebGLRenderer,
} from 'pixi.js'
import type { GpuTiles } from './gpuTiles'
import type { Layer } from './layers'
import { toStoredTile, type StoredTile, type TileMemory } from './memory'
import type { Point, SelectionTile } from './selection'
import { parseTileKey, TILE_SIZE, tileKey, tileSize, type Grid } from './tiles'

// Smart objects (decision 42): a layer that keeps its original pixels (its "source") and where the source's corners
// are on the paper. Its own tiles are the source drawn at those corners, worked out again from the source after every
// transform, so scaling, turning, skewing or distorting it again and again never loses anything. Like in Photoshop, it
// can't be painted on until it is turned into a normal layer

// A rectangle of the paper or of a source, in pixels
export type Rect = { x: number; y: number; width: number; height: number }

// Four corners: top left, top right, bottom right and bottom left
export type Quad = [Point, Point, Point, Point]

export type SmartObject = {
  // The original pixels, as a layer of their own that isn't in the drawing, so the graphics card can keep their tiles
  // like any layer's. They are on the paper's grid, where they were when the smart object was made
  source: Layer
  bounds: Rect // the part of the source with paint: what the corners show
  corners: Quad // where the corners of "bounds" are on the paper
  smooth: boolean // how the pixels are worked out: smoothly (bicubic), or as whole pixels (pixel art)
}

// ----- The maths: a homography maps a rectangle to any four corners -----

// A 3×3 matrix, row by row. Mapping (x, y) gives (X / W, Y / W), where (X, Y, W) is the matrix times (x, y, 1)
export type Matrix3 = number[]

export const rectQuad = ({ x, y, width, height }: Rect): Quad => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
]

// The matrix that maps the rectangle's corners to the quad's corners (Heckbert's square-to-quad, after the rectangle
// is made the unit square). With a parallelogram it is an affine map; otherwise a perspective one
export function homography(rect: Rect, quad: Quad): Matrix3 {
  const [p0, p1, p2, p3] = quad
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const dy3 = p0.y - p1.y + p2.y - p3.y
  const det = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / det
  const h = (dx1 * dy3 - dx3 * dy1) / det
  const square = [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ]
  const toSquare = [1 / rect.width, 0, -rect.x / rect.width, 0, 1 / rect.height, -rect.y / rect.height, 0, 0, 1]
  return multiply(square, toSquare)
}

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const result: Matrix3 = []
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k] * b[k * 3 + column]
      result.push(sum)
    }
  }
  return result
}

export function invert(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map(
    value => value / det,
  )
}

export function mapPoint(m: Matrix3, { x, y }: Point): Point {
  const w = m[6] * x + m[7] * y + m[8]
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w }
}

// Whether four corners make a shape a homography can map a rectangle to: convex, with every corner turning the same
// way (either way: a mirrored shape is fine), and not too thin
export function isValidQuad(quad: Quad) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const c = quad[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1) return false
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

// ----- Making one -----

// The rectangle where tiles have paint, to the pixel (null: no paint at all). Only the tiles on the outer rows and
// columns can hold the outermost pixels, and in each of them a side is only looked at until its first painted pixel
export function paintBounds(grid: Grid, tiles: Map<string, StoredTile>, memory: TileMemory): Rect | null {
  if (tiles.size === 0) return null
  const places = [...tiles.keys()].map(parseTileKey)
  const firstColumn = Math.min(...places.map(p => p.column))
  const lastColumn = Math.max(...places.map(p => p.column))
  const firstRow = Math.min(...places.map(p => p.row))
  const lastRow = Math.max(...places.map(p => p.row))
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const { column, row } of places) {
    const sides = {
      left: column === firstColumn,
      right: column === lastColumn,
      top: row === firstRow,
      bottom: row === lastRow,
    }
    if (!sides.left && !sides.right && !sides.top && !sides.bottom) continue
    const tile = tiles.get(tileKey(column, row))!
    const { width, height } = tileSize(grid, column, row)
    const x0 = column * TILE_SIZE
    const y0 = row * TILE_SIZE
    if (tile.color !== undefined) {
      left = Math.min(left, x0)
      top = Math.min(top, y0)
      right = Math.max(right, x0 + width)
      bottom = Math.max(bottom, y0 + height)
      continue
    }
    const pixels = memory.unpack(tile, width, height)
    const isColumnPainted = (x: number) => {
      for (let y = 0; y < height; y++) if (pixels[(y * width + x) * 4 + 3] > 0) return true
      return false
    }
    const isRowPainted = (y: number) => {
      for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 0) return true
      return false
    }
    if (sides.left) {
      for (let x = 0; x < width && x0 + x < left; x++) {
        if (isColumnPainted(x)) left = x0 + x
      }
    }
    if (sides.right) {
      for (let x = width - 1; x >= 0 && x0 + x + 1 > right; x--) {
        if (isColumnPainted(x)) right = x0 + x + 1
      }
    }
    if (sides.top) {
      for (let y = 0; y < height && y0 + y < top; y++) {
        if (isRowPainted(y)) top = y0 + y
      }
    }
    if (sides.bottom) {
      for (let y = height - 1; y >= 0 && y0 + y + 1 > bottom; y--) {
        if (isRowPainted(y)) bottom = y0 + y + 1
      }
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

// The selected part of a layer's tile, as much as each pixel is selected (null: nothing), for a smart object made from
// a selection
export function selectedPart(
  tile: StoredTile,
  selected: SelectionTile,
  width: number,
  height: number,
  memory: TileMemory,
) {
  if (selected === 'full') return tile
  const pixels = new Uint8ClampedArray(width * height * 4) // it rounds and keeps within 0–255
  pixels.set(memory.unpack(tile, width, height)) // a copy: stored pixels never change
  for (let i = 0; i < selected.length; i++) {
    if (selected[i] === 255) continue
    const keep = selected[i] / 255
    const j = i * 4
    pixels[j] *= keep
    pixels[j + 1] *= keep
    pixels[j + 2] *= keep
    pixels[j + 3] *= keep
  }
  return toStoredTile(pixels)
}

// ----- Drawing one on the graphics card -----

// The source is drawn in blocks of tiles (see BLOCK_TILES), each as the four-sided shape its rectangle becomes on the
// paper. For every pixel of that
// shape, the shader finds where it comes from in the source (with the inverse homography, which also gets perspective
// right) and works out its color there: from the 16 pixels around it (bicubic, Catmull-Rom), or from the one pixel
// there. Those pixels can be in the blocks next to it, so each block is copied with a border of PAD pixels from its
// neighbors first: the blocks then join without seams
const PAD = 2

// GLSL ES 3.0 (WebGL 2), for texelFetch: reading a pixel by its place, without any filtering
const vertex = `#version 300 es
in vec2 aPosition;
out vec2 vPaper;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  vec3 screen = uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4((uProjectionMatrix * screen).xy, 0.0, 1.0);
  vPaper = aPosition;
}
`

const fragment = `#version 300 es
in vec2 vPaper;
out vec4 finalColor;

uniform sampler2D uTexture; // the source's block, with its border
uniform mat3 uInverse; // from the paper to the source
uniform float uSmooth;
uniform vec2 uOrigin; // where the texture's first pixel is in the source
uniform vec2 uSize; // the texture's size

vec4 texel(vec2 at) {
  return texelFetch(uTexture, ivec2(clamp(at, vec2(0.0), uSize - 1.0)), 0);
}

// Catmull-Rom weights for the four pixels around a point, "t" of the way from the second to the third
vec4 weights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}

void main(void) {
  vec3 mapped = uInverse * vec3(vPaper, 1.0);
  vec2 at = mapped.xy / mapped.z - uOrigin; // in pixels of the texture
  if (uSmooth < 0.5) {
    finalColor = texel(floor(at));
    return;
  }
  vec2 centered = at - 0.5;
  vec2 first = floor(centered);
  vec2 t = centered - first;
  vec4 wx = weights(t.x);
  vec4 wy = weights(t.y);
  vec4 color = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    vec4 rowColor = wx.x * texel(first + vec2(-1.0, float(j) - 1.0)) + wx.y * texel(first + vec2(0.0, float(j) - 1.0))
      + wx.z * texel(first + vec2(1.0, float(j) - 1.0)) + wx.w * texel(first + vec2(2.0, float(j) - 1.0));
    color += wy[j] * rowColor;
  }
  // Catmull-Rom can overshoot a little at sharp edges: keep the color a valid one, multiplied by its alpha
  color.a = clamp(color.a, 0.0, 1.0);
  color.rgb = clamp(color.rgb, 0.0, color.a);
  finalColor = color;
}
`

// A block of the source, ready to draw: its texture with a border, the part of the source it draws, and two meshes
// sharing one shape, one for the screen and one for drawing into the layer's tiles
type SourceBlock = {
  texture: RenderTexture
  rect: Rect
  geometry: MeshGeometry
  shader: Shader
  shown: Mesh<MeshGeometry, Shader>
  drawn: Mesh<MeshGeometry, Shader>
  area: Rect
}

// The source is drawn in blocks of this many tiles each way: on a big drawing, 100 shapes to draw instead of 1600
const BLOCK_TILES = 4
const BLOCK_SIZE = BLOCK_TILES * TILE_SIZE

// Draws smart objects: on the screen while they are transformed, and into their layer's tiles
export function createSmartView(renderer: WebGLRenderer, grid: Grid, gpu: GpuTiles, object: SmartObject) {
  const glProgram = GlProgram.from({ vertex, fragment, name: 'smart-object', preferredFragmentPrecision: 'highp' })
  const shared = new UniformGroup({
    uInverse: { value: new Float32Array(9), type: 'mat3x3<f32>' },
    uSmooth: { value: object.smooth ? 1 : 0, type: 'f32' },
  })
  const blocks: SourceBlock[] = []
  const container = new Container() // what the screen shows, placed on the paper
  const drawRoot = new Container() // for drawing into one tile of the paper at a time
  const padRoot = new Container()
  const padSprites: Sprite[] = []
  const bounds = object.bounds // never changes for one object: only its corners and smoothness do
  let corners = object.corners

  // The blocks with paint, as "column,row" of blocks
  const blockKeys = new Set<string>()
  for (const key of object.source.tiles.keys()) {
    const { column, row } = parseTileKey(key)
    blockKeys.add(tileKey(Math.floor(column / BLOCK_TILES), Math.floor(row / BLOCK_TILES)))
  }

  // Get one block of the source ready (a few every frame: see engine.ts)
  function addBlock(key: string) {
    const { column: blockColumn, row: blockRow } = parseTileKey(key)
    const x0 = blockColumn * BLOCK_SIZE
    const y0 = blockRow * BLOCK_SIZE
    const width = Math.min(BLOCK_SIZE, grid.width - x0)
    const height = Math.min(BLOCK_SIZE, grid.height - y0)
    const texture = RenderTexture.create({ width: width + 2 * PAD, height: height + 2 * PAD })
    // The block's tiles, and the edges of the tiles around it
    padRoot.removeChildren()
    const firstColumn = blockColumn * BLOCK_TILES
    const firstRow = blockRow * BLOCK_TILES
    let count = 0
    for (let row = firstRow - 1; row <= firstRow + BLOCK_TILES; row++) {
      for (let column = firstColumn - 1; column <= firstColumn + BLOCK_TILES; column++) {
        const tile = gpu.getTexture(object.source, column, row, false)
        if (!tile) continue
        padSprites[count] ??= new Sprite()
        const sprite = padSprites[count++]
        sprite.texture = tile
        sprite.position.set(column * TILE_SIZE - x0 + PAD, row * TILE_SIZE - y0 + PAD)
        padRoot.addChild(sprite)
      }
    }
    renderer.render({ container: padRoot, target: texture, clear: true, clearColor: [0, 0, 0, 0] })

    // What it draws: the block, and the border on the sides where no block has paint, so the soft edge that the smooth
    // mode makes goes on past it. Never more than the paint's bounds with their border
    const hasNeighbor = (dc: number, dr: number) => blockKeys.has(tileKey(blockColumn + dc, blockRow + dr))
    const left = Math.max(x0 - (hasNeighbor(-1, 0) ? 0 : PAD), bounds.x - PAD)
    const top = Math.max(y0 - (hasNeighbor(0, -1) ? 0 : PAD), bounds.y - PAD)
    const right = Math.min(x0 + width + (hasNeighbor(1, 0) ? 0 : PAD), bounds.x + bounds.width + PAD)
    const bottom = Math.min(y0 + height + (hasNeighbor(0, 1) ? 0 : PAD), bounds.y + bounds.height + PAD)
    if (right <= left || bottom <= top) {
      texture.destroy(true)
      return
    }
    const rect = { x: left, y: top, width: right - left, height: bottom - top }

    const own = new UniformGroup({
      uOrigin: { value: new Float32Array([x0 - PAD, y0 - PAD]), type: 'vec2<f32>' },
      uSize: { value: new Float32Array([texture.width, texture.height]), type: 'vec2<f32>' },
    })
    const shader = new Shader({ glProgram, resources: { shared, own, uTexture: texture.source } })
    const geometry = new MeshGeometry({
      positions: new Float32Array(8),
      uvs: new Float32Array(8),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    })
    const shown = new Mesh({ geometry, shader })
    const drawn = new Mesh({ geometry, shader })
    container.addChild(shown)
    drawRoot.addChild(drawn)
    const block = { texture, rect, geometry, shader, shown, drawn, area: rect }
    blocks.push(block)
    place(block, homography(bounds, corners))
  }

  // Put a block's shape where the homography takes it, and remember the paper's rectangle around it
  function place(block: SourceBlock, matrix: Matrix3) {
    const points = rectQuad(block.rect).map(point => mapPoint(matrix, point))
    block.geometry.positions = new Float32Array(points.flatMap(({ x, y }) => [x, y]))
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    block.area = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }

  // Show the object at these corners
  function setCorners(newCorners: Quad) {
    corners = newCorners
    const matrix = homography(bounds, corners)
    const inverse = invert(matrix)
    // GLSL keeps matrices column by column
    const uniform = shared.uniforms.uInverse as Float32Array
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) uniform[column * 3 + row] = inverse[row * 3 + column]
    }
    shared.update()
    for (const block of blocks) place(block, matrix)
  }

  function setSmooth(smooth: boolean) {
    shared.uniforms.uSmooth = smooth ? 1 : 0
    shared.update()
  }

  // The tiles of the paper the object covers now
  function coveredKeys() {
    const keys = new Set<string>()
    for (const { area } of blocks) {
      const firstColumn = Math.max(0, Math.floor(area.x / TILE_SIZE))
      const lastColumn = Math.min(grid.columns - 1, Math.floor((area.x + area.width) / TILE_SIZE))
      const firstRow = Math.max(0, Math.floor(area.y / TILE_SIZE))
      const lastRow = Math.min(grid.rows - 1, Math.floor((area.y + area.height) / TILE_SIZE))
      for (let column = firstColumn; column <= lastColumn; column++) {
        for (let row = firstRow; row <= lastRow; row++) keys.add(tileKey(column, row))
      }
    }
    return keys
  }

  // Draw the object into one tile of the paper, in place of what the texture had
  function drawTile(column: number, row: number, target: RenderTexture) {
    const x = column * TILE_SIZE
    const y = row * TILE_SIZE
    for (const { drawn, area } of blocks) {
      drawn.visible =
        area.x < x + target.width && area.x + area.width > x && area.y < y + target.height && area.y + area.height > y
    }
    drawRoot.position.set(-x, -y)
    renderer.render({ container: drawRoot, target, clear: true, clearColor: [0, 0, 0, 0] })
  }

  function destroy() {
    for (const block of blocks) {
      block.shown.destroy()
      block.drawn.destroy()
      block.geometry.destroy()
      block.shader.destroy()
      block.texture.destroy(true)
    }
    blocks.length = 0
    container.destroy()
    drawRoot.destroy()
    padRoot.destroy()
    for (const sprite of padSprites) sprite.destroy()
    glProgram.destroy()
  }

  setCorners(corners)

  return { container, blocks: [...blockKeys], addBlock, setCorners, setSmooth, coveredKeys, drawTile, destroy }
}

export type SmartView = ReturnType<typeof createSmartView>
