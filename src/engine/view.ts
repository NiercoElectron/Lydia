import type { Application, Container } from 'pixi.js'
import type { Brush } from './brush'
import type { GpuTiles } from './gpuTiles'
import type { Projection } from './projection'
import { tilesInRect, type Grid } from './tiles'
import { isPaintTool, type Tool } from './tools'

const MIN_ZOOM = 0.01 // 1% (zoomed far out)
const MAX_ZOOM = 32 // 3200% (each pixel of the paper is 32 pixels of the screen)
const PREPARE_BUDGET_MS = 3 // at most this much of each frame is spent getting tiles ready under the brush

// The eyedropper's cursor: Lucide's pipette icon (the one on its button), black with a white edge so it shows on any
// color. It picks the color under its tip, at (2, 22)
const PIPETTE_PATHS = [
  'm12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12',
  'm18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z',
  'm2 22 .414-.414',
]
const pipette = (color: string, width: number) =>
  `<g stroke="${color}" stroke-width="${width}">${PIPETTE_PATHS.map(d => `<path d="${d}"/>`).join('')}</g>`
const EYEDROPPER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke-linecap="round" ' +
  `stroke-linejoin="round">${pipette('#fff', 4)}${pipette('#000', 2)}</svg>`
const EYEDROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(EYEDROPPER_SVG)}") 2 22, crosshair`

// Inputs where the keyboard is used for typing: shortcuts must leave them alone
export function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')
}

// What the user does with the mouse, the pen and the keyboard on the drawing: zoom, move the view, and use the chosen
// tool (see tools.ts). "onColorPick" gets the colors picked with the eyedropper; "canPickColors" tells whether anyone
// wants them: if not, holding Alt doesn't turn the brush into an eyedropper
export function createView(
  app: Application,
  world: Container,
  grid: Grid,
  brush: Brush,
  projection: Projection,
  gpu: GpuTiles,
  onStrokeEnd: () => void,
  onColorPick: (color: string) => void,
  canPickColors: () => boolean,
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

  // ----- Tools -----

  let tool: Tool = 'brush'
  let isAltDown = false // as the last key or pointer event said
  let shownCursor = ''

  // The tool the left button uses right now: holding Alt picks colors with the brush or the eraser, like in Photoshop
  function currentTool(): Tool {
    return isAltDown && isPaintTool(tool) && canPickColors() ? 'eyedropper' : tool
  }

  // Choose what the left button does from now on
  function setTool(newTool: Tool) {
    tool = newTool
    showCursor()
  }

  function showCursor() {
    const cursor = currentTool() === 'eyedropper' ? EYEDROPPER_CURSOR : 'crosshair'
    if (cursor === shownCursor) return
    shownCursor = cursor
    // PixiJS sets the canvas's cursor too, to its "default" style, when the pointer first moves over it
    app.renderer.events.cursorStyles.default = cursor
    canvas.style.cursor = cursor
  }

  // Pick the color the screen shows under the pointer. Where there is none (outside the paper, or nothing painted on a
  // transparent paper), the color stays as it was
  function pickColor(e: PointerEvent) {
    const point = toPaper(e)
    const color = projection.colorAt(point.x, point.y)
    if (color) onColorPick(color)
  }

  // ----- Mouse, pen and keyboard -----

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
  let pickingPointerId: number | null = null // the pointer picking colors with the eyedropper, if any
  let hoverPoint: { x: number; y: number } | null = null // where the brush is waiting, or null when all is ready

  function handleKeyDown(e: KeyboardEvent) {
    if (isTyping(e.target)) return
    if (e.code === 'Space') {
      e.preventDefault() // stop the page from scrolling, and a focused button from being pressed
      isSpaceDown = true
    }
    if (e.key === 'Alt') {
      e.preventDefault() // in some browsers, Alt alone moves the keyboard to the browser's menu
      isAltDown = true
      showCursor()
    }
    // Ctrl/Cmd + 0 shows the whole paper again, like in Photoshop
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault()
      fitToScreen()
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') isSpaceDown = false
    if (e.key === 'Alt') {
      e.preventDefault()
      isAltDown = false
      showCursor()
    }
  }

  // Move the view by dragging with the middle mouse button, or with the left button while holding Space; use the tool
  // with the left button (or the pen tip)
  function handlePointerDown(e: PointerEvent) {
    if (drawingPointerId !== null || pickingPointerId !== null || panStart) return // already busy with another pointer
    const isPan = e.button === 1 || (e.button === 0 && isSpaceDown)
    if (!isPan && e.button !== 0) return
    e.preventDefault() // the middle button would otherwise start the browser's auto-scroll
    // That also keeps the keyboard where it was, so take it away from a text field (like the brush name) as any other
    // click would: otherwise shortcuts like Ctrl+Z keep going to the field instead of the drawing
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    canvas.setPointerCapture(e.pointerId) // keep receiving the moves even if the pointer leaves the canvas
    if (isPan) {
      panStart = { x: e.clientX - world.position.x, y: e.clientY - world.position.y }
      return
    }
    // The keys may have changed while the window was in the background (Alt+Tab leaves Alt "down" here)
    isAltDown = e.altKey
    showCursor()
    if (currentTool() === 'eyedropper') {
      pickingPointerId = e.pointerId
      pickColor(e)
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
    } else if (e.pointerId === pickingPointerId) {
      pickColor(e)
    } else if (drawingPointerId === null && pickingPointerId === null) {
      isAltDown = e.altKey
      showCursor()
      if (isPaintTool(currentTool())) hoverPoint = toPaper(e)
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (panStart) {
      panStart = null
    } else if (e.pointerId === drawingPointerId) {
      drawingPointerId = null
      if (brush.endStroke()) onStrokeEnd()
    } else if (e.pointerId === pickingPointerId) {
      pickingPointerId = null
    }
  }

  // The first dab of a stroke can cover dozens of tiles at once, and each of them needs every layer at that place on
  // the graphics card, which would freeze the screen for a moment. So while the pointer moves over the paper without
  // painting, the tiles under the brush are made ready, a few per frame
  function prepareUnderBrush() {
    if (!hoverPoint || drawingPointerId !== null) return
    const start = performance.now()
    const radius = brush.reach()
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
  showCursor()
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

  return { fitToScreen, setTool, isPainting: () => drawingPointerId !== null, destroy }
}

export type View = ReturnType<typeof createView>
