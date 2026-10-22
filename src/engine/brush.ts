import { CanvasSource, Container, Sprite, Texture } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import { createDabPath, type Dab, type DabPath, type StrokePoint } from './dabs'
import type { GpuTiles } from './gpuTiles'
import type { History } from './history'
import type { LayerStack } from './layers'
import type { Projection } from './projection'
import { parseTileKey, TILE_SIZE, tileKey, tilesInRect, type Grid } from './tiles'

export type Tool = 'brush' | 'eraser'

export type BrushSettings = {
  tool: Tool
  color: string
  size: number // the tip's longer side, in pixels of the paper, at full pressure
}

// The tip on the graphics card, with smaller copies of itself (mipmaps), so that a big tip full of detail still looks
// smooth when the brush is small. Every dab is this picture, tinted, resized and turned
function createTipTexture(tip: BrushTip) {
  return new Texture({ source: new CanvasSource({ resource: tip.image, resolution: 1, autoGenerateMipmaps: true }) })
}

export function createBrush(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
  startTip: BrushTip,
  startShape: BrushShape,
) {
  const settings: BrushSettings = { tool: 'brush', color: '#000000', size: 20 }
  let tip = startTip
  let shape = startShape
  let texture = createTipTexture(tip)

  // The dabs that touch a tile are put in "stamp" and rendered into that tile at once
  const stampRoot = new Container()
  const stamp = new Container()
  stampRoot.addChild(stamp)
  const dabSprites: Sprite[] = [] // reused between tiles instead of creating new sprites every time

  // Paint with another brush from now on
  function setTip(newTip: BrushTip, newShape: BrushShape) {
    const oldTexture = texture
    tip = newTip
    shape = newShape
    texture = createTipTexture(tip)
    for (const sprite of dabSprites) sprite.texture = texture
    oldTexture.destroy(true)
  }

  function paintDabs(dabs: Dab[]) {
    // Which dabs touch each tile ("column,row" -> its dabs, in the order they were placed)
    const dabsByTile = new Map<string, Dab[]>()
    for (const dab of dabs) {
      const radius = (dab.size / 2) * tip.reach
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
    const tipSide = Math.max(tip.image.width, tip.image.height)
    for (const [key, tileDabs] of dabsByTile) {
      const { column, row } = parseTileKey(key)
      history.backUpTile(key)
      stamp.removeChildren()
      tileDabs.forEach((dab, i) => {
        let sprite = dabSprites[i]
        if (!sprite) {
          sprite = new Sprite(texture)
          sprite.anchor.set(0.5) // position and turn the dab around its center
          dabSprites[i] = sprite
        }
        sprite.position.set(dab.x, dab.y)
        sprite.rotation = dab.angle
        sprite.scale.set(dab.size / tipSide)
        sprite.alpha = dab.alpha
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

  // Where the dabs of the stroke being painted go, or null when not painting
  let path: DabPath | null = null

  // Start a stroke at this point of the paper. The pen's pressure goes from 0 to 1
  function startStroke(x: number, y: number, pressure: number) {
    history.begin(stack.active)
    path = createDabPath(shape, settings.size)
    paintDabs(path.start({ x, y, pressure }))
  }

  // Continue the stroke through these points
  function continueStroke(points: StrokePoint[]) {
    if (path) paintDabs(path.moveTo(points))
  }

  // Finish the stroke. Returns whether it changed anything (and so was added to the undo history)
  function endStroke() {
    if (path) paintDabs(path.end())
    path = null
    return history.end()
  }

  // How far from the pointer the brush can paint, in pixels of the paper
  const reach = () => (settings.size / 2) * tip.reach + shape.scatter * settings.size

  function destroy() {
    stampRoot.destroy({ children: true })
    for (const sprite of dabSprites) sprite.destroy()
    texture.destroy(true)
  }

  return {
    settings,
    setTip,
    startStroke,
    continueStroke,
    endStroke,
    reach,
    isPainting: () => path !== null,
    destroy,
  }
}

export type Brush = ReturnType<typeof createBrush>
