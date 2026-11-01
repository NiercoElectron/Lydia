import { isFolder, type Layer } from './layers'
import type { StoredTile, TileMemory } from './memory'
import { parseTileKey, TILE_SIZE, type Grid } from './tiles'

// The small pictures of the layers in the layers panel. They are worked out from the tiles in RAM, on the processor, and
// not on the graphics card, where a big layer would have to be sent again for each change. Tiles never change (see
// memory.ts), so a tile that is a different object is one to look at again, and only those are: a stroke costs a few
// tiles. A little of it is done every frame, while nothing is being painted.

const SIDE = 64 // the longer side of a picture, in pixels
const SAMPLES = 4 // how many pixels of the tile are read each way, for each pixel of the picture

type Thumbnail = {
  context: CanvasRenderingContext2D
  image: ImageData
  seen: Map<string, StoredTile> // the tiles it shows
  isChanged: boolean
}

export function createThumbnails(grid: Grid, memory: TileMemory) {
  const scale = Math.min(SIDE / grid.width, SIDE / grid.height)
  const width = Math.max(1, Math.round(grid.width * scale))
  const height = Math.max(1, Math.round(grid.height * scale))
  const thumbnails = new WeakMap<Layer, Thumbnail>()
  const waiting: { layer: Layer; key: string }[] = []

  function thumbnailOf(layer: Layer) {
    let thumbnail = thumbnails.get(layer)
    if (!thumbnail) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      thumbnail = { context, image: context.createImageData(width, height), seen: new Map(), isChanged: false }
      thumbnails.set(layer, thumbnail)
    }
    return thumbnail
  }

  // Note which tiles changed since they were last looked at
  function look(layers: Layer[]) {
    waiting.length = 0
    for (const layer of layers) {
      if (isFolder(layer)) continue
      const { seen } = thumbnailOf(layer)
      for (const [key, tile] of layer.tiles) if (seen.get(key) !== tile) waiting.push({ layer, key })
      for (const key of seen.keys()) if (!layer.tiles.has(key)) waiting.push({ layer, key })
    }
  }

  // Draw the part of a picture a tile shows: the pixels whose middle is in it. A tile that is gone draws nothing there
  function drawTile({ image }: Thumbnail, key: string, tile: StoredTile | undefined) {
    const { column, row } = parseTileKey(key)
    const firstOf = (tiles: number) => Math.ceil(tiles * TILE_SIZE * scale - 0.5)
    const lastX = Math.min(width, firstOf(column + 1))
    const lastY = Math.min(height, firstOf(row + 1))
    const pixels = tile && memory.unpack(tile, TILE_SIZE, TILE_SIZE)
    for (let y = Math.max(0, firstOf(row)); y < lastY; y++) {
      for (let x = Math.max(0, firstOf(column)); x < lastX; x++) {
        const sums = [0, 0, 0, 0]
        let count = 0
        for (let sampleY = 0; pixels && sampleY < SAMPLES; sampleY++) {
          for (let sampleX = 0; sampleX < SAMPLES; sampleX++) {
            const tileX = Math.floor((x + (sampleX + 0.5) / SAMPLES) / scale) - column * TILE_SIZE
            const tileY = Math.floor((y + (sampleY + 0.5) / SAMPLES) / scale) - row * TILE_SIZE
            if (tileX < 0 || tileY < 0 || tileX >= TILE_SIZE || tileY >= TILE_SIZE) continue
            const at = (tileY * TILE_SIZE + tileX) * 4
            for (let channel = 0; channel < 4; channel++) sums[channel] += pixels[at + channel]
            count++
          }
        }
        // A tile's colors are multiplied by their alpha, and an image's aren't
        const alpha = count > 0 ? sums[3] / count : 0
        const at = (y * width + x) * 4
        for (let channel = 0; channel < 3; channel++) {
          image.data[at + channel] = alpha > 0 ? (sums[channel] / count / alpha) * 255 : 0
        }
        image.data[at + 3] = alpha
      }
    }
  }

  // Work on the pictures for at most this many milliseconds
  function work(budget: number) {
    if (waiting.length === 0) return
    const deadline = performance.now() + budget
    const touched = new Set<Thumbnail>()
    while (waiting.length > 0 && performance.now() < deadline) {
      const { layer, key } = waiting.pop()!
      const thumbnail = thumbnailOf(layer)
      const tile = layer.tiles.get(key)
      if (thumbnail.seen.get(key) === tile) continue
      drawTile(thumbnail, key, tile)
      if (tile) thumbnail.seen.set(key, tile)
      else thumbnail.seen.delete(key)
      touched.add(thumbnail)
    }
    for (const { context, image } of touched) context.putImageData(image, 0, 0)
  }

  return { canvasOf: (layer: Layer) => thumbnailOf(layer).context.canvas, look, work }
}
