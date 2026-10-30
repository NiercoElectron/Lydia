import {
  Point,
  RenderTexture,
  Sprite,
  UPDATE_PRIORITY,
  type Container,
  type Rectangle,
  type Ticker,
  type WebGLRenderer,
} from 'pixi.js'

// Zoomed in, the drawing's pixels are shown smoothed, like ibisPaint and Procreate do (decision 68), unless they are
// shown as sharp squares for pixel art (see setZoom in projection.ts). The drawing is in tiles, and each tile smoothed
// on its own can't blend its edge with the next tile's pixels: lines crossing from one tile to the next would show a
// step there. So in each frame the part of the drawing on the screen is first drawn into a picture, a pixel of it for
// each pixel of the paper, where the tiles meet exactly, and the screen shows that picture, smoothed, in their place.
// Zoomed in, the screen shows few pixels of the paper, so the picture is small
//
// "drawing" is the paper's tiles, in "world" (whose transform takes the paper to the screen), in "scene"; "others" are
// the other things in the world, left out of the picture and drawn as they are. "isSmooth" says whether the pixels
// are shown smoothed now

// The picture grows in steps of this many pixels, so it isn't made again at every little move
const STEP = 256

export function createSmoothZoom(
  renderer: WebGLRenderer,
  ticker: Ticker,
  scene: Container,
  world: Container,
  drawing: Container,
  others: Container[],
  screen: Rectangle,
  isSmooth: () => boolean,
) {
  let picture: RenderTexture | null = null
  const shown = new Sprite()
  shown.visible = false
  world.addChildAt(shown, world.getChildIndex(drawing) + 1)
  let isShown = false

  // The box of the paper the screen shows, in whole pixels, with a pixel more around it for the smoothing
  function visibleBox() {
    world.updateLocalTransform()
    const toPaper = world.localTransform.clone().invert()
    const corners = [
      [0, 0],
      [screen.width, 0],
      [0, screen.height],
      [screen.width, screen.height],
    ].map(([x, y]) => toPaper.apply(new Point(x, y)))
    const left = Math.floor(Math.min(...corners.map(p => p.x))) - 1
    const top = Math.floor(Math.min(...corners.map(p => p.y))) - 1
    const right = Math.ceil(Math.max(...corners.map(p => p.x))) + 1
    const bottom = Math.ceil(Math.max(...corners.map(p => p.y))) + 1
    return { left, top, width: right - left, height: bottom - top }
  }

  // Every frame, before the screen is drawn
  function update() {
    // At 100%, not turned, each pixel of the paper is a pixel of the screen: there is nothing to smooth
    const isAsItIs = world.scale.y === 1 && world.rotation === 0
    if (!isSmooth() || isAsItIs) return
    const box = visibleBox()
    if (!picture || picture.width < box.width || picture.height < box.height) {
      picture?.destroy(true)
      const width = Math.ceil(box.width / STEP) * STEP
      const height = Math.ceil(box.height / STEP) * STEP
      picture = RenderTexture.create({ width, height, resolution: 1, scaleMode: 'linear' })
    }

    // The drawing alone, at its own size, with the box's corner at the picture's corner: each pixel of the paper on
    // a pixel of the picture, where smoothing changes nothing
    const { x, y } = world.position
    const { x: scaleX, y: scaleY } = world.scale
    const rotation = world.rotation
    world.position.set(-box.left, -box.top)
    world.scale.set(1)
    world.rotation = 0
    const wasVisible = others.map(other => other.visible)
    for (const other of others) other.visible = false
    renderer.render({ container: scene, target: picture, clear: true, clearColor: [0, 0, 0, 0] })
    others.forEach((other, i) => (other.visible = wasVisible[i]))
    world.position.set(x, y)
    world.scale.set(scaleX, scaleY)
    world.rotation = rotation

    // On the screen, the picture in the drawing's place, until the frame is drawn
    shown.texture = picture
    shown.position.set(box.left, box.top)
    shown.visible = true
    drawing.visible = false
    isShown = true
  }

  // After the frame is drawn, everything as it was, for whatever else draws the drawing
  function restore() {
    if (!isShown) return
    shown.visible = false
    drawing.visible = true
    isShown = false
  }

  // After everything else that changes the drawing in a frame (like the pixel grid), and after the screen is drawn
  ticker.add(update, undefined, UPDATE_PRIORITY.LOW + 1)
  ticker.add(restore, undefined, UPDATE_PRIORITY.UTILITY)

  function destroy() {
    ticker.remove(update)
    ticker.remove(restore)
    restore()
    shown.destroy()
    picture?.destroy(true)
  }

  return { destroy }
}
