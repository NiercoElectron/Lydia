import type { Application, Container } from 'pixi.js'
import type { Brush } from './brush'
import type { GpuTiles } from './gpuTiles'
import type { Projection } from './projection'
import { tilesInRect, type Grid } from './tiles'

const MIN_ZOOM = 0.01 // 1% (zoomed far out)
const MAX_ZOOM = 32 // 3200% (each pixel of the paper is 32 pixels of the screen)
const PREPARE_BUDGET_MS = 3 // at most this much of each frame is spent getting tiles ready under the brush

// Inputs where the keyboard is used for typing: shortcuts must leave them alone
export function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')
}

// What the user does with the mouse, the pen and the keyboard on the drawing: zoom, move the view, paint
export function createView(
  app: Application,
  world: Container,
  grid: Grid,
  brush: Brush,
  projection: Projection,
  gpu: GpuTiles,
  onStrokeEnd: () => void,
) {
  const canvas = app.canvas

  function setZoom(zoom: number) {
    world.scale.set(zoom)
    projection.setZoom(zoom)
  }

  // Show the whole paper, centered, with a small margin around it
  function fitToScreen() {
    const zoom = Math.min(app.screen.width / grid.width, app.screen.height / grid.height) * 0.9
    setZoom(zoom)
    world.position.set((app.screen.width - grid.width * zoom) / 2, (app.screen.height - grid.height * zoom) / 2)
  }

  // Zoom keeping the point under the cursor in the same place on the screen
  function zoomAt(screenX: number, screenY: number, factor: number) {
    const oldZoom = world.scale.x
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor))
    // Which point of the paper is under the cursor right now
    const paperX = (screenX - world.position.x) / oldZoom
    const paperY = (screenY - world.position.y) / oldZoom
    // After zooming, move the paper so that the same point is under the cursor again
    setZoom(newZoom)
    world.position.set(screenX - paperX * newZoom, screenY - paperY * newZoom)
  }

  // Convert a position on the screen into a position on the paper, taking zoom and pan into account
  function toPaper(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    return world.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  // The pen's pressure makes the brush smaller or bigger; the mouse always paints at full size
  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? e.pressure : 1)

  // Mouse wheel / trackpad: Ctrl + wheel (or pinch on a trackpad) zooms, the wheel alone moves the view
  function handleWheel(e: WheelEvent) {
    e.preventDefault() // stop the browser from scrolling or zooming the page itself
    const pixels = e.deltaMode === 1 ? 16 : 1 // some browsers report the wheel in lines instead of pixels
    if (e.ctrlKey) {
      zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * pixels * 0.002))
    } else {
      world.position.x -= e.deltaX * pixels
      world.position.y -= e.deltaY * pixels
    }
  }

  let isSpaceDown = false
  let panStart: { x: number; y: number } | null = null // where the view was grabbed, while moving it
  let drawingPointerId: number | null = null // the pointer that is painting, if any
  let hoverPoint: { x: number; y: number } | null = null // where the brush is waiting, or null when all is ready

  function handleKeyDown(e: KeyboardEvent) {
    if (isTyping(e.target)) return
    if (e.code === 'Space') {
      e.preventDefault() // stop the page from scrolling, and a focused button from being pressed
      isSpaceDown = true
    }
    // Ctrl/Cmd + 0 shows the whole paper again, like in Photoshop
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault()
      fitToScreen()
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') isSpaceDown = false
  }

  // Move the view by dragging with the middle mouse button, or with the left button while holding Space; paint with
  // the left button (or the pen tip)
  function handlePointerDown(e: PointerEvent) {
    if (drawingPointerId !== null || panStart) return // already busy with another pointer
    const isPan = e.button === 1 || (e.button === 0 && isSpaceDown)
    if (!isPan && e.button !== 0) return
    e.preventDefault() // the middle button would otherwise start the browser's auto-scroll
    canvas.setPointerCapture(e.pointerId) // keep receiving the moves even if the pointer leaves the canvas
    if (isPan) {
      panStart = { x: e.clientX - world.position.x, y: e.clientY - world.position.y }
      return
    }
    drawingPointerId = e.pointerId
    hoverPoint = null
    const point = toPaper(e)
    brush.startStroke(point.x, point.y, pressureOf(e))
  }

  function handlePointerMove(e: PointerEvent) {
    if (panStart) {
      world.position.set(e.clientX - panStart.x, e.clientY - panStart.y)
    } else if (e.pointerId === drawingPointerId) {
      // The browser groups fast movements into one event; get all the points in between
      const points = (e.getCoalescedEvents?.() ?? [e]).map(ev => ({ ...toPaper(ev), pressure: pressureOf(ev) }))
      brush.continueStroke(points)
    } else if (drawingPointerId === null) {
      hoverPoint = toPaper(e)
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (panStart) {
      panStart = null
    } else if (e.pointerId === drawingPointerId) {
      drawingPointerId = null
      if (brush.endStroke()) onStrokeEnd()
    }
  }

  // The first dab of a stroke can cover dozens of tiles at once, and each of them needs every layer at that place on
  // the graphics card, which would freeze the screen for a moment. So while the pointer moves over the paper without
  // painting, the tiles under the brush are made ready, a few per frame
  function prepareUnderBrush() {
    if (!hoverPoint || drawingPointerId !== null) return
    const start = performance.now()
    const radius = brush.settings.size / 2
    const area = tilesInRect(
      grid,
      hoverPoint.x - radius,
      hoverPoint.y - radius,
      hoverPoint.x + radius,
      hoverPoint.y + radius,
    )
    if (area) {
      for (let column = area.firstColumn; column <= area.lastColumn; column++) {
        for (let row = area.firstRow; row <= area.lastRow; row++) {
          projection.prepareTile(column, row)
          if (performance.now() - start > PREPARE_BUDGET_MS) return // continue in the next frame
        }
      }
    }
    hoverPoint = null // everything under the brush is ready
    gpu.trim()
  }

  canvas.addEventListener('wheel', handleWheel, { passive: false })
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerUp)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  app.ticker.add(prepareUnderBrush)
  fitToScreen()

  function destroy() {
    canvas.removeEventListener('wheel', handleWheel)
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('pointercancel', handlePointerUp)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    app.ticker.remove(prepareUnderBrush)
  }

  return { fitToScreen, isPainting: () => drawingPointerId !== null, destroy }
}

export type View = ReturnType<typeof createView>
