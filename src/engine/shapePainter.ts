import { BufferImageSource, Container, RenderTexture, Sprite, Texture, type WebGLRenderer } from 'pixi.js'
import { parseBrushFile, type BrushPreset } from './brushFile'
import { decodeTip, type BrushTip } from './brushTip'
import { createDabPainter } from './dabPainter'
import { createDabPath, withoutCorners, type Dab } from './dabs'
import { createGrainPass, grainOf } from './grain'
import { noiseReach } from './noiseDabs'
import { polygonTiles, type Selection } from './selection'
import { canFill, shapePath, type Shape } from './shapes'
import { TILE_SIZE, tileKey, tilesInRect, wholeTileMask, type Grid } from './tiles'

// Paints a shape (see shapes.ts) into a layer's tiles: its fill, and over it its outline, with the brush it keeps along
// its points, the way a stroke is painted (see brush.ts), so that it looks like one.

// A stroke's random numbers come from a seed, so a shape's outline is the same every time it is painted again
const OUTLINE_SEED = 1

const toRgb = (color: string) => [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16))

export function createShapePainter(renderer: WebGLRenderer, grid: Grid) {
  // The brushes of the shapes, ready to paint with, by their file
  const brushes = new Map<string, Promise<{ preset: BrushPreset; tip: BrushTip }>>()

  function brushOf(file: string) {
    let brush = brushes.get(file)
    if (!brush) {
      const preset = parseBrushFile(file, '')
      brush = decodeTip(preset.tip, preset.grain).then(tip => ({ preset, tip }))
      brushes.set(file, brush)
    }
    return brush
  }

  // The brush painting now is already decoded
  function knowBrush(file: string, preset: BrushPreset, tip: BrushTip) {
    brushes.set(file, Promise.resolve({ preset, tip }))
  }

  const nothing = new Container()
  const clear = (target: RenderTexture) =>
    renderer.render({ container: nothing, target, clear: true, clearColor: [0, 0, 0, 0] })

  let painter: ReturnType<typeof createDabPainter> | null = null
  const grainPass = createGrainPass(renderer)
  const newTile = () => RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
  const outlineTile = newTile()
  const rawTile = newTile()
  const pressureTile = newTile()

  const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE * 4)
  const fillTexture = new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: TILE_SIZE,
      height: TILE_SIZE,
      format: 'rgba8unorm',
      alphaMode: 'premultiplied-alpha',
    }),
  })
  // PixiJS ignores the blend mode of what it is asked to render, so the sprite goes inside a container
  const root = new Container()
  const sprite = new Sprite()
  root.addChild(sprite)

  function drawInto(target: RenderTexture, texture: Texture, tint: string | number) {
    sprite.texture = texture
    sprite.tint = tint
    renderer.render({ container: root, target, clear: false })
  }

  // Work out where a shape paints. Its tiles are then painted one by one, so a big one doesn't stop the screen
  async function planShape(shape: Shape) {
    const { preset, tip } = await brushOf(shape.outline.brush)
    const { points, isClosed } = shapePath(shape)
    const isPixel = preset.pixel !== 'none'
    const fill: Selection | null = shape.fill.isOn && canFill(shape.kind) ? polygonTiles(grid, points, isPixel) : null
    const byTile = new Map<string, Dab[]>()
    if (shape.outline.isOn) {
      const path = createDabPath(preset, shape.outline.size, { seed: OUTLINE_SEED, tip: tip.image })
      const along = (isClosed ? [...points, points[0]] : points).map(point => ({ ...point, pressure: 1 }))
      const placedDabs = [...path.start(along[0]), ...path.moveTo(along.slice(1)), ...path.end()]
      const dabs = isPixel ? withoutCorners(placedDabs) : placedDabs
      for (const dab of dabs) {
        const radius = isPixel ? dab.size / 2 : dab.size * (tip.reach / 2 + noiseReach(preset))
        const area = tilesInRect(grid, dab.x - radius, dab.y - radius, dab.x + radius, dab.y + radius)
        if (!area) continue // the dab is entirely outside the paper
        for (let column = area.firstColumn; column <= area.lastColumn; column++) {
          for (let row = area.firstRow; row <= area.lastRow; row++) {
            const key = tileKey(column, row)
            const tileDabs = byTile.get(key)
            if (tileDabs) tileDabs.push(dab)
            else byTile.set(key, [dab])
          }
        }
      }
    }
    if (painter) painter.setTip(tip, preset)
    else painter = createDabPainter(renderer, tip, preset)
    const grain = grainOf(tip, preset)
    return { shape, fill, byTile, grain, covered: new Set([...(fill?.keys() ?? []), ...byTile.keys()]) }
  }

  type ShapePlan = Awaited<ReturnType<typeof planShape>>

  function paintFill(mask: Uint8Array | 'full', color: string, target: RenderTexture) {
    const [red, green, blue] = toRgb(color)
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
      const alpha = mask === 'full' ? 255 : mask[i]
      pixels[i * 4] = (red * alpha) / 255
      pixels[i * 4 + 1] = (green * alpha) / 255
      pixels[i * 4 + 2] = (blue * alpha) / 255
      pixels[i * 4 + 3] = alpha
    }
    fillTexture.source.update()
    drawInto(target, fillTexture, 0xffffff)
  }

  // Paint a tile of the shape into this texture, in place of what it has
  function paintTile({ shape, fill, byTile, grain }: ShapePlan, column: number, row: number, target: RenderTexture) {
    clear(target)
    const key = tileKey(column, row)
    const mask = fill?.get(key)
    if (mask) paintFill(wholeTileMask(grid, key, mask, 255), shape.fill.color, target)
    const dabs = byTile.get(key)
    if (!dabs) return
    const left = column * TILE_SIZE
    const top = row * TILE_SIZE
    clear(outlineTile)
    if (grain) {
      clear(rawTile)
      clear(pressureTile)
      painter!.paint(rawTile, dabs, left, top)
      painter!.paintPressure(pressureTile, dabs, left, top)
      grainPass.apply(rawTile, pressureTile, outlineTile, left, top, grain)
    } else {
      painter!.paint(outlineTile, dabs, left, top)
    }
    drawInto(target, outlineTile, shape.outline.color)
  }

  function destroy() {
    painter?.destroy()
    grainPass.destroy()
    root.destroy({ children: true })
    fillTexture.destroy(true)
    for (const texture of [outlineTile, rawTile, pressureTile]) texture.destroy(true)
  }

  return { planShape, paintTile, knowBrush, destroy }
}

export type ShapePainter = ReturnType<typeof createShapePainter>
