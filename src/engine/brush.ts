import { Container, Sprite, Texture } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { GpuTiles } from './gpuTiles'
import type { History } from './history'
import type { LayerStack } from './layers'
import type { Projection } from './projection'
import { parseTileKey, TILE_SIZE, tileKey, tilesInRect, type Grid } from './tiles'

export type Tool = 'brush' | 'eraser'

export type BrushSettings = {
  tool: Tool
  color: string
  size: number // diameter in pixels of the paper, at full pressure
}

const HARDNESS = 0.5 // 0 = very soft edge, 1 = hard edge
const SPACING = 0.1 // distance between dabs, as a fraction of the brush size

// A brush stroke is a row of "dabs": copies of the brush tip, close enough to look like a continuous line
type Dab = { x: number; y: number; size: number }

// The brush tip: a white circle that fades out at the edge. Every dab is this image, tinted and resized
function createBrushTip(hardness: number) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(hardness, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return Texture.from(canvas)
}

export function createBrush(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
) {
  const settings: BrushSettings = { tool: 'brush', color: '#000000', size: 20 }
  const tip = createBrushTip(HARDNESS)

  // The dabs that touch a tile are put in "stamp" and rendered into that tile at once
  const stampRoot = new Container()
  const stamp = new Container()
  stampRoot.addChild(stamp)
  const dabSprites: Sprite[] = [] // reused between tiles instead of creating new sprites every time

  function paintDabs(dabs: Dab[]) {
    // Which dabs touch each tile ("column,row" -> its dabs, in the order they were placed)
    const dabsByTile = new Map<string, Dab[]>()
    for (const dab of dabs) {
      const radius = dab.size / 2
      const area = tilesInRect(grid, dab.x - radius, dab.y - radius, dab.x + radius, dab.y + radius)
      if (!area) continue // the dab is entirely outside the paper
      for (let column = area.firstColumn; column <= area.lastColumn; column++) {
        for (let row = area.firstRow; row <= area.lastRow; row++) {
          const key = tileKey(column, row)
          let tileDabs = dabsByTile.get(key)
          if (!tileDabs) {
            tileDabs = []
            dabsByTile.set(key, tileDabs)
          }
          tileDabs.push(dab)
        }
      }
    }

    // Render into each touched tile only the dabs that touch it, shifted so that the tile's corner is at (0, 0)
    const layer = stack.active
    for (const [key, tileDabs] of dabsByTile) {
      const { column, row } = parseTileKey(key)
      history.backUpTile(key)
      stamp.removeChildren()
      tileDabs.forEach((dab, i) => {
        let sprite = dabSprites[i]
        if (!sprite) {
          sprite = new Sprite(tip)
          sprite.anchor.set(0.5) // position the dab by its center
          dabSprites[i] = sprite
        }
        sprite.position.set(dab.x, dab.y)
        sprite.width = dab.size
        sprite.height = dab.size
        sprite.tint = settings.color
        // The eraser removes paint from the tile instead of adding it
        sprite.blendMode = settings.tool === 'eraser' ? 'erase' : 'normal'
        stamp.addChild(sprite)
      })
      stamp.position.set(-column * TILE_SIZE, -row * TILE_SIZE)
      const target = gpu.getTexture(layer, column, row, true)!
      renderer.render({ container: stampRoot, target, clear: false })
      gpu.markDirty(layer, key)
      projection.composeTile(column, row)
    }
  }

  // Where the last dab was placed, and how far the pointer moved since then
  let lastPoint: { x: number; y: number } | null = null
  let distanceSinceLastDab = 0

  // The pen's pressure (from 0 to 1) makes the brush smaller or bigger
  const sizeFor = (pressure: number) => settings.size * pressure

  // Start a stroke at this point of the paper
  function startStroke(x: number, y: number, pressure: number) {
    history.begin(stack.active)
    lastPoint = { x, y }
    distanceSinceLastDab = 0
    paintDabs([{ x, y, size: sizeFor(pressure) }])
  }

  // Continue the stroke through these points, placing dabs along the lines between them, one every "spacing" pixels
  function continueStroke(points: { x: number; y: number; pressure: number }[]) {
    if (!lastPoint) return
    const dabs: Dab[] = []
    for (const { x, y, pressure } of points) {
      const size = sizeFor(pressure)
      const spacing = Math.max(1, size * SPACING)
      const dx = x - lastPoint.x
      const dy = y - lastPoint.y
      const distance = Math.hypot(dx, dy)
      if (distance === 0) continue

      let along = spacing - distanceSinceLastDab // how far along the line the next dab goes
      while (along <= distance) {
        dabs.push({ x: lastPoint.x + (dx * along) / distance, y: lastPoint.y + (dy * along) / distance, size })
        along += spacing
      }
      distanceSinceLastDab = distance - (along - spacing)
      lastPoint = { x, y }
    }
    if (dabs.length > 0) paintDabs(dabs)
  }

  // Finish the stroke. Returns whether it changed anything (and so was added to the undo history)
  function endStroke() {
    lastPoint = null
    return history.end()
  }

  function destroy() {
    stampRoot.destroy({ children: true })
    for (const sprite of dabSprites) sprite.destroy()
    tip.destroy(true)
  }

  return { settings, startStroke, continueStroke, endStroke, isPainting: () => lastPoint !== null, destroy }
}

export type Brush = ReturnType<typeof createBrush>
