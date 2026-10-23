import { CanvasSource, Container, Sprite, Texture, type WebGLRenderer } from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import type { Dab } from './dabs'
import { createNoiseDabs } from './noiseDabs'
import { roundTipRows } from './pixelTip'

// Paints dabs into a texture, white with the paint in the alpha. The drawing (brush.ts, into the tiles of the stroke)
// and the brush previews (previewSurface.ts) share this code, so a preview is painted exactly like the drawing.
// A smooth tip is a sprite of the tip's picture for each dab, a pixel tip is worked out for each size, and dabs with
// noise are drawn by noiseDabs.ts. A brush that "washes" keeps, at each pixel, the most paint one dab gave it

// The tip on the graphics card, with smaller copies of itself (mipmaps), so that a big tip full of detail still looks
// smooth when the brush is small. Every dab is this picture, resized and turned
function createTipTexture(tip: BrushTip) {
  return new Texture({ source: new CanvasSource({ resource: tip.image, resolution: 1, autoGenerateMipmaps: true }) })
}

// The round tip of a pixel brush at one size (see pixelTip.ts). It is painted at its own size, each of its pixels on
// one pixel of the paper, and "nearest" keeps the graphics card from blending them with their neighbors
function createPixelTipTexture(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  roundTipRows(size).forEach((count, row) => ctx.fillRect((size - count) / 2, row, count, 1))
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: 1, scaleMode: 'nearest' }) })
}

// A pixel brush needs a tip for each size it paints at, as the pen's pressure changes it. They are made when first
// needed, and the ones unused for the longest time are forgotten once they add up to more than this many pixels
const PIXEL_TIPS_BUDGET = 4 * 1024 ** 2

export function createDabPainter(renderer: WebGLRenderer, startTip: BrushTip, startShape: BrushShape) {
  let tip = startTip
  let shape = startShape
  let texture = createTipTexture(tip)
  const noiseDabs = createNoiseDabs(renderer, texture, tip)

  // The dabs are put in "stamp" and rendered into the texture at once
  const stampRoot = new Container()
  const stamp = new Container()
  stampRoot.addChild(stamp)
  const dabSprites: Sprite[] = [] // reused instead of creating new sprites every time
  const pixelTips = new Map<number, Texture>() // by size, the most recently used last
  let pixelTipsArea = 0 // their pixels, added up

  function pixelTip(size: number) {
    let pixelTexture = pixelTips.get(size)
    if (pixelTexture) {
      pixelTips.delete(size) // to put it last again
    } else {
      pixelTexture = createPixelTipTexture(size)
      pixelTipsArea += size * size
    }
    pixelTips.set(size, pixelTexture)
    return pixelTexture
  }

  // Forget the pixel tips unused for the longest time, once there are too many. The sprites get the brush's own tip
  // first, so that none keeps a forgotten one
  function trimPixelTips() {
    if (pixelTipsArea <= PIXEL_TIPS_BUDGET) return
    for (const sprite of dabSprites) sprite.texture = texture
    for (const [size, pixelTexture] of pixelTips) {
      if (pixelTipsArea <= PIXEL_TIPS_BUDGET) break
      pixelTips.delete(size)
      pixelTipsArea -= size * size
      pixelTexture.destroy(true)
    }
  }

  // Paint with another brush from now on. The tip's picture goes to the graphics card again only when it changed
  function setTip(newTip: BrushTip, newShape: BrushShape) {
    shape = newShape
    if (newTip === tip) return
    const oldTexture = texture
    tip = newTip
    texture = createTipTexture(tip)
    for (const sprite of dabSprites) sprite.texture = texture
    noiseDabs.setTip(texture, tip)
    oldTexture.destroy(true)
  }

  // Paint these dabs into "target", whose top left corner is at (left, top) where the dabs are
  function paint(target: Texture, dabs: Dab[], left: number, top: number) {
    const isPixel = shape.pixel !== 'none'
    const blendMode = shape.wash ? 'max' : 'normal'
    if (!isPixel && shape.noiseAmount > 0) {
      noiseDabs.paint(target, dabs, left, top, blendMode, shape)
      return
    }
    const tipSide = Math.max(tip.image.width, tip.image.height)
    stamp.removeChildren()
    dabs.forEach((dab, i) => {
      let sprite = dabSprites[i]
      if (!sprite) {
        sprite = new Sprite(texture)
        sprite.anchor.set(0.5) // position and turn the dab around its center
        dabSprites[i] = sprite
      }
      sprite.position.set(dab.x, dab.y)
      sprite.rotation = dab.angle
      if (isPixel) {
        sprite.texture = pixelTip(dab.size)
        sprite.scale.set(1)
      } else {
        sprite.texture = texture
        sprite.scale.set(dab.size / tipSide)
      }
      sprite.alpha = dab.alpha
      sprite.blendMode = blendMode
      stamp.addChild(sprite)
    })
    stamp.position.set(-left, -top)
    renderer.render({ container: stampRoot, target, clear: false })
    if (isPixel) trimPixelTips()
  }

  function destroy() {
    stampRoot.destroy({ children: true })
    for (const sprite of dabSprites) sprite.destroy()
    noiseDabs.destroy()
    texture.destroy(true)
    for (const pixelTexture of pixelTips.values()) pixelTexture.destroy(true)
  }

  return { setTip, paint, destroy }
}

export type DabPainter = ReturnType<typeof createDabPainter>
