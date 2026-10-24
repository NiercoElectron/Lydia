import { Graphics, type Application, type Container } from 'pixi.js'
import type { Brush } from './brush'
import { EYEDROPPER_CURSOR, FILL_CURSOR, ROTATE_CURSOR } from './cursors'
import type { GpuTiles } from './gpuTiles'
import type { Projection } from './projection'
import type { Point, SelectionMode } from './selection'
import { tilesInRect, type Grid } from './tiles'
import { isPaintTool, type Tool } from './tools'

const MIN_ZOOM = 0.01 // 1% (zoomed far out)
const MAX_ZOOM = 32 // 3200% (each pixel of the paper is 32 pixels of the screen)
const ZOOM_STEP = 2 // a click with the zoom tool zooms in this many times (out with Alt)
const SCRUB_ZOOM = 0.01 // dragging with the zoom tool: how fast it zooms, for each pixel of the screen
const CLICK_DISTANCE = 4 // pixels of the screen a click may move before it counts as dragging
const ROTATE_STEP = 15 // with the rotate tool, Shift turns the view in steps of this many degrees
const PREPARE_BUDGET_MS = 3 // at most this much of each frame is spent getting tiles ready under the brush

// The cursor of each tool over the drawing
const CURSORS: Record<Tool, string> = {
  brush: 'crosshair',
  eraser: 'crosshair',
  fill: FILL_CURSOR,
  eyedropper: EYEDROPPER_CURSOR,
  select: 'crosshair',
  lasso: 'crosshair',
  move: 'move',
  hand: 'grab',
  zoom: 'zoom-in',
  rotate: ROTATE_CURSOR,
}

// How the drawing is shown: its zoom (1 = 100%), how far it is turned (in degrees, clockwise, from -180 to 180) and
// whether it is flipped like in a mirror. A new object every time one of them changes
export type ViewState = { zoom: number; rotation: number; flipped: boolean }

// What a pointer that went down on the drawing does while it moves and when it comes up, depending on its tool
type Gesture = { move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }

// What the view asks of the rest of the engine
export type ViewActions = {
  onStrokeEnd: () => void
  onColorPick: (color: string) => void // a color picked with the eyedropper
  canPickColors: () => boolean // whether anyone wants those colors: if not, holding Alt doesn't pick them
  onFill: (x: number, y: number) => void // the fill bucket went down at this point of the paper
  onSelect: (points: Point[], mode: SelectionMode) => void // a polygon drawn with a selection tool (none: a click)
  // The move tool went down, was dragged this many pixels of the paper from there, and came up ("keep": false when the
  // browser took the pointer away)
  onMoveStart: () => void
  onMove: (dx: number, dy: number) => void
  onMoveEnd: (keep: boolean) => void
  isWorking: () => boolean // while a fill or Delete is worked out, the tools that change the drawing wait
}

// Inputs where the keyboard is used for typing: shortcuts must leave them alone
export function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')
}

// What the user does with the mouse, the pen and the keyboard on the drawing: zoom, move, turn and flip the view, and
// use the chosen tool (see tools.ts)
export function createView(
  app: Application,
  world: Container,
  grid: Grid,
  brush: Brush,
  projection: Projection,
  gpu: GpuTiles,
  actions: ViewActions,
) {
  const canvas = app.canvas

  // ----- The view: zoom, rotation and flip -----

  // "world" holds the drawing: the paper's top left corner is at its position on the screen, and the paper is zoomed,
  // flipped and turned around that corner. Its scale is negative across when the view is flipped
  const currentZoom = () => world.scale.y
  const isFlipped = () => world.scale.x < 0
  const middle = (): Point => ({ x: app.screen.width / 2, y: app.screen.height / 2 })

  let state: ViewState = { zoom: 1, rotation: 0, flipped: false }
  const listeners = new Set<() => void>()

  // Zoom, turn (in radians) and flip the drawing, and tell whoever is listening if that changed anything
  function setView(zoom: number, rotation: number, flipped: boolean) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
    rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation)) // from -180° to 180°
    world.scale.set(flipped ? -zoom : zoom, zoom)
    world.rotation = rotation
    projection.setZoom(zoom)
    const degrees = (rotation * 180) / Math.PI
    if (zoom === state.zoom && degrees === state.rotation && flipped === state.flipped) return
    state = { zoom, rotation: degrees, flipped }
    for (const listener of listeners) listener()
  }

  // Where a point of the screen is on the paper: turn it back, then undo the zoom and the flip
  function paperAt(screen: Point): Point {
    const cos = Math.cos(world.rotation)
    const sin = Math.sin(world.rotation)
    const dx = screen.x - world.position.x
    const dy = screen.y - world.position.y
    return { x: (cos * dx + sin * dy) / world.scale.x, y: (cos * dy - sin * dx) / world.scale.y }
  }

  // Move the view so that this point of the paper is at this point of the screen
  function placeAt(paper: Point, screen: Point) {
    const cos = Math.cos(world.rotation)
    const sin = Math.sin(world.rotation)
    const x = paper.x * world.scale.x
    const y = paper.y * world.scale.y
    world.position.set(screen.x - (cos * x - sin * y), screen.y - (sin * x + cos * y))
  }

  // Change the view keeping the point of the paper under this point of the screen where it is
  function setViewAround(screen: Point, zoom: number, rotation: number, flipped: boolean) {
    const paper = paperAt(screen)
    setView(zoom, rotation, flipped)
    placeAt(paper, screen)
  }

  function zoomAt(screen: Point, zoom: number) {
    setViewAround(screen, zoom, world.rotation, isFlipped())
  }

  // Show the whole paper in the middle of the screen, with a small margin around it, turned and flipped as it is
  function fitToScreen() {
    const cos = Math.abs(Math.cos(world.rotation))
    const sin = Math.abs(Math.sin(world.rotation))
    // The size of the turned paper on the screen at 100%
    const width = cos * grid.width + sin * grid.height
    const height = sin * grid.width + cos * grid.height
    setView(Math.min(app.screen.width / width, app.screen.height / height) * 0.9, world.rotation, isFlipped())
    placeAt({ x: grid.width / 2, y: grid.height / 2 }, middle())
  }

  // Turn the view back to 0°, around the middle of the screen
  function straighten() {
    setViewAround(middle(), currentZoom(), 0, isFlipped())
  }

  // Flip the view like in a mirror, around the middle of the screen; the drawing itself doesn't change. In a mirror a
  // view turned one way looks turned the other way, so the rotation changes sign
  function flip() {
    setViewAround(middle(), currentZoom(), -world.rotation, !isFlipped())
  }

  // ----- The pointer -----

  // Where the pointer is on the screen (on the canvas), and on the paper
  function onScreen(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const toPaper = (e: PointerEvent) => paperAt(onScreen(e))

  // The pen's pressure makes the brush smaller or bigger; the mouse always paints at full size
  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? e.pressure : 1)

  // Pick the color the screen shows under the pointer. Where there is none (outside the paper, or nothing painted on a
  // transparent paper), the color stays as it was
  function pickColor(e: PointerEvent) {
    const point = toPaper(e)
    const color = projection.colorAt(point.x, point.y)
    if (color) actions.onColorPick(color)
  }

  // ----- What each tool does with the pointer -----

  function paint(e: PointerEvent): Gesture {
    hoverPoint = null
    const point = toPaper(e)
    brush.startStroke(point.x, point.y, pressureOf(e))
    return {
      move(e) {
        // The browser groups fast movements into one event; get all the points in between
        const points = (e.getCoalescedEvents?.() ?? [e]).map(ev => ({ ...toPaper(ev), pressure: pressureOf(ev) }))
        brush.continueStroke(points)
      },
      up() {
        if (brush.endStroke()) actions.onStrokeEnd()
      },
    }
  }

  function pick(e: PointerEvent): Gesture {
    pickColor(e)
    return { move: pickColor, up() {} }
  }

  // The fill bucket fills around the point where the pointer goes down (see fill.ts)
  function fill(e: PointerEvent): Gesture {
    const point = toPaper(e)
    actions.onFill(point.x, point.y)
    return { move() {}, up() {} }
  }

  // The outline of a selection while it is drawn: white, with a black line inside, as wide at any zoom
  const outline = new Graphics()
  world.addChild(outline)

  function drawOutline(points: Point[], isClosed: boolean) {
    const width = 1 / currentZoom()
    outline.clear()
    if (points.length < 2) return
    outline.poly(points, isClosed).stroke({ width: 3 * width, color: 0xffffff })
    outline.poly(points, isClosed).stroke({ width, color: 0x000000 })
  }

  // Shift adds to the selection and Alt takes away from it, as in Photoshop and Krita (see selection.ts)
  const selectionMode = (e: PointerEvent): SelectionMode => (e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace')

  // A rectangle from where the pointer went down to where it is, along the sides of the paper, even with the view
  // turned. A click selects nothing
  function selectRectangle(e: PointerEvent): Gesture {
    const mode = selectionMode(e)
    const start = toPaper(e)
    const startOnScreen = onScreen(e)
    const corners = (e: PointerEvent) => {
      const end = toPaper(e)
      return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }]
    }
    return {
      move(e) {
        drawOutline(corners(e), true)
      },
      up(e) {
        outline.clear()
        if (e.type !== 'pointerup') return
        const end = onScreen(e)
        const isClick = Math.hypot(end.x - startOnScreen.x, end.y - startOnScreen.y) < CLICK_DISTANCE
        actions.onSelect(isClick ? [] : corners(e), mode)
      },
    }
  }

  // The lasso: the outline follows the pointer, and goes back to where it started when the pointer comes up
  function lasso(e: PointerEvent): Gesture {
    const mode = selectionMode(e)
    const points = [toPaper(e)]
    let last = onScreen(e)
    return {
      move(e) {
        for (const each of e.getCoalescedEvents?.() ?? [e]) {
          const here = onScreen(each)
          if (Math.hypot(here.x - last.x, here.y - last.y) < 1) continue // closer than a pixel of the screen
          last = here
          points.push(paperAt(here))
        }
        drawOutline(points, false)
      },
      up(e) {
        outline.clear()
        if (e.type === 'pointerup') actions.onSelect(points.length >= 3 ? points : [], mode)
      },
    }
  }

  // The move tool drags the selected part of the active layer, or all of it when nothing is selected, by whole pixels
  // of the paper. Shift keeps it level or upright: the direction is chosen once the pointer is far enough from where it
  // went down to tell, and kept until Shift is let go, so a path that wanders doesn't make it jump from one to the other
  function movePaint(e: PointerEvent): Gesture {
    const start = toPaper(e)
    const startOnScreen = onScreen(e)
    let axis: 'across' | 'down' | null = null
    actions.onMoveStart()
    return {
      move(e) {
        const now = toPaper(e)
        let dx = Math.round(now.x - start.x)
        let dy = Math.round(now.y - start.y)
        if (!e.shiftKey) axis = null
        else {
          const here = onScreen(e)
          if (!axis && Math.hypot(here.x - startOnScreen.x, here.y - startOnScreen.y) >= CLICK_DISTANCE) {
            axis = Math.abs(dx) >= Math.abs(dy) ? 'across' : 'down'
          }
          if (axis !== 'across') dx = 0
          if (axis !== 'down') dy = 0
        }
        actions.onMove(dx, dy)
      },
      up(e) {
        actions.onMoveEnd(e.type === 'pointerup')
      },
    }
  }

  // The view follows the pointer
  function pan(e: PointerEvent): Gesture {
    const grab = { x: e.clientX - world.position.x, y: e.clientY - world.position.y }
    return {
      move(e) {
        world.position.set(e.clientX - grab.x, e.clientY - grab.y)
      },
      up() {},
    }
  }

  // A click zooms in around the point clicked (out with Alt). Dragging zooms smoothly around the point where it
  // started, in to the right and out to the left, like Photoshop's "scrubby zoom"
  function zoom(e: PointerEvent): Gesture {
    const start = onScreen(e)
    const startZoom = currentZoom()
    let isDragging = false
    return {
      move(e) {
        const now = onScreen(e)
        isDragging ||= Math.hypot(now.x - start.x, now.y - start.y) >= CLICK_DISTANCE
        if (isDragging) zoomAt(start, startZoom * Math.exp((now.x - start.x) * SCRUB_ZOOM))
      },
      up(e) {
        if (!isDragging && e.type === 'pointerup')
          zoomAt(start, e.altKey ? startZoom / ZOOM_STEP : startZoom * ZOOM_STEP)
      },
    }
  }

  // The view turns around the middle of the screen as far as the pointer goes around it. With the rotate tool (not
  // with Shift + Space, which holds Shift down), Shift turns it in steps of 15°
  function rotate(e: PointerEvent, canSnap: boolean): Gesture {
    const center = middle()
    const angleOf = (e: PointerEvent) => {
      const point = onScreen(e)
      return Math.atan2(point.y - center.y, point.x - center.x)
    }
    const startAngle = angleOf(e)
    const startRotation = world.rotation
    return {
      move(e) {
        let rotation = startRotation + angleOf(e) - startAngle
        if (canSnap && e.shiftKey) {
          const step = (ROTATE_STEP * Math.PI) / 180
          rotation = Math.round(rotation / step) * step
        }
        setViewAround(center, currentZoom(), rotation, isFlipped())
      },
      up() {},
    }
  }

  const startGesture: Record<Tool, (e: PointerEvent) => Gesture> = {
    brush: paint,
    eraser: paint,
    fill,
    eyedropper: pick,
    select: selectRectangle,
    lasso,
    move: movePaint,
    hand: pan,
    zoom,
    rotate: e => rotate(e, !isSpaceDown),
  }

  // ----- The chosen tool, the keys held and the cursor -----

  let tool: Tool = 'brush'
  let isSpaceDown = false
  let isShiftDown = false // Shift and Alt as the last key or pointer event said
  let isAltDown = false
  let gesture: (Gesture & { pointerId: number; tool: Tool }) | null = null // the pointer that is down, if any
  let hoverPoint: Point | null = null // where the brush is waiting, or null when all is ready
  let shownCursor = ''

  // The tool the left button uses right now. Space moves the view and Shift + Space turns it, like in Krita; Alt picks
  // colors with the brush, the eraser or the fill bucket, like in Photoshop
  function currentTool(): Tool {
    if (isSpaceDown) return isShiftDown ? 'rotate' : 'hand'
    if (isAltDown && (isPaintTool(tool) || tool === 'fill') && actions.canPickColors()) return 'eyedropper'
    return tool
  }

  // Choose what the left button does from now on
  function setTool(newTool: Tool) {
    tool = newTool
    showCursor()
  }

  function showCursor() {
    const shown = gesture?.tool ?? currentTool()
    let cursor = CURSORS[shown]
    if (shown === 'hand' && gesture) cursor = 'grabbing'
    else if (shown === 'zoom' && isAltDown && !gesture) cursor = 'zoom-out'
    if (cursor === shownCursor) return
    shownCursor = cursor
    // PixiJS sets the canvas's cursor too, to its "default" style, when the pointer first moves over it
    app.renderer.events.cursorStyles.default = cursor
    canvas.style.cursor = cursor
  }

  // ----- Mouse, pen and keyboard -----

  // Mouse wheel / trackpad: Ctrl + wheel (or pinch on a trackpad) zooms, the wheel alone moves the view
  function handleWheel(e: WheelEvent) {
    e.preventDefault() // stop the browser from scrolling or zooming the page itself
    const pixels = e.deltaMode === 1 ? 16 : 1 // some browsers report the wheel in lines instead of pixels
    if (e.ctrlKey) {
      zoomAt({ x: e.offsetX, y: e.offsetY }, currentZoom() * Math.exp(-e.deltaY * pixels * 0.002))
    } else {
      world.position.x -= e.deltaX * pixels
      world.position.y -= e.deltaY * pixels
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (isTyping(e.target)) return
    if (e.code === 'Space') {
      e.preventDefault() // stop the page from scrolling, and a focused button from being pressed
      isSpaceDown = true
    }
    if (e.key === 'Alt') e.preventDefault() // in some browsers, Alt alone moves the keyboard to the browser's menu
    isShiftDown = e.shiftKey
    isAltDown = e.altKey
    showCursor()
    // Ctrl/Cmd + 0 shows the whole paper again, like in Photoshop
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault()
      fitToScreen()
    }
    // M flips the view, like in Krita
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) flip()
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') isSpaceDown = false
    if (e.key === 'Alt') e.preventDefault()
    isShiftDown = e.shiftKey
    isAltDown = e.altKey
    showCursor()
  }

  // Keys let go in another window never come here
  function handleBlur() {
    isSpaceDown = isShiftDown = isAltDown = false
    showCursor()
  }

  // The left button (or the pen tip) uses the tool; the middle button always moves the view
  function handlePointerDown(e: PointerEvent) {
    if (gesture) return // already busy with another pointer
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault() // the middle button would otherwise start the browser's auto-scroll
    // That also keeps the keyboard where it was, so take it away from a text field (like the brush name) as any other
    // click would: otherwise shortcuts like Ctrl+Z keep going to the field instead of the drawing
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    canvas.setPointerCapture(e.pointerId) // keep receiving the moves even if the pointer leaves the canvas
    // The keys may have changed while the window was in the background (Alt+Tab leaves Alt "down" here)
    isShiftDown = e.shiftKey
    isAltDown = e.altKey
    const used = e.button === 1 ? 'hand' : currentTool()
    // While a fill or Delete is worked out, only the tools that just look can be used
    const onlyLooks = used === 'hand' || used === 'zoom' || used === 'rotate' || used === 'eyedropper'
    if (actions.isWorking() && !onlyLooks) return
    gesture = { ...startGesture[used](e), pointerId: e.pointerId, tool: used }
    showCursor()
  }

  function handlePointerMove(e: PointerEvent) {
    if (gesture) {
      if (e.pointerId === gesture.pointerId) gesture.move(e)
      return
    }
    isShiftDown = e.shiftKey
    isAltDown = e.altKey
    showCursor()
    if (isPaintTool(currentTool())) hoverPoint = toPaper(e)
  }

  function handlePointerUp(e: PointerEvent) {
    if (!gesture || e.pointerId !== gesture.pointerId) return
    const ended = gesture
    gesture = null // first, so that what the gesture does at its end sees the pointer free
    ended.up(e)
    showCursor()
  }

  // The first dab of a stroke can cover dozens of tiles at once, and each of them needs every layer at that place on
  // the graphics card, which would freeze the screen for a moment. So while the pointer moves over the paper without
  // painting, the tiles under the brush are made ready, a few per frame
  function prepareUnderBrush() {
    if (!hoverPoint || gesture) return
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
  window.addEventListener('blur', handleBlur)
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
    window.removeEventListener('blur', handleBlur)
    app.ticker.remove(prepareUnderBrush)
    outline.destroy()
    listeners.clear()
  }

  return {
    fitToScreen,
    straighten,
    flip,
    setTool,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isPainting: () => gesture !== null && isPaintTool(gesture.tool),
    destroy,
  }
}

export type View = ReturnType<typeof createView>
