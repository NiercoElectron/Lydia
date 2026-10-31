import { Graphics, type Application, type Container } from 'pixi.js'
import type { Brush } from './brush'
import type { MixTools } from './mixTools'
import { pixelBrushOutline, tipOutline } from './brushOutline'
import type { BrushTip } from './brushTip'
import { EYEDROPPER_CURSOR, FILL_CURSOR, ROTATE_CURSOR, WAND_CURSOR } from './cursors'
import type { GpuTiles } from './gpuTiles'
import { MIN_LIQUIFY_SIZE, type Liquify } from './liquify'
import type { ViewData } from './projectFile'
import type { Projection } from './projection'
import type { Point, SelectionMode } from './selection'
import type { Quad } from './smartObject'
import { createStabilizer, DEFAULT_STABILIZER, type Stabilizer, type StabilizerSettings } from './stabilizer'
import { straightLineEnd } from './straightLine'
import { tilesInRect, type Grid } from './tiles'
import { hasStrength, isPaintTool, usesTip, type Tool } from './tools'
import { cursorFor, drawHandles, handleAt, movedWarp, transformed, type TransformTarget } from './transformHandles'
import type { Warp } from './warp'

export const MIN_ZOOM = 0.01 // 1% (zoomed far out)
export const MAX_ZOOM = 32 // 3200% (each pixel of the paper is 32 pixels of the screen)
const ZOOM_STEP = 2 // a click with the zoom tool zooms in this many times (out with Alt)
const SCRUB_ZOOM = 0.01 // dragging with the zoom tool: how fast it zooms, for each pixel of the screen
const CLICK_DISTANCE = 4 // pixels of the screen a click may move before it counts as dragging
const ROTATE_STEP = 15 // with the rotate tool, Shift turns the view in steps of this many degrees
const PREPARE_BUDGET_MS = 3 // at most this much of each frame is spent getting tiles ready under the brush
const MIN_OUTLINE = 8 // a brush smaller than this many pixels of the screen shows the cursor's cross, not its outline

// The cursor of each tool over the drawing
const CURSORS: Record<Tool, string> = {
  brush: 'crosshair',
  eraser: 'crosshair',
  smudge: 'crosshair',
  blur: 'crosshair',
  liquify: 'crosshair',
  fill: FILL_CURSOR,
  eyedropper: EYEDROPPER_CURSOR,
  select: 'crosshair',
  lasso: 'crosshair',
  wand: WAND_CURSOR,
  move: 'move',
  hand: 'grab',
  zoom: 'zoom-in',
  rotate: ROTATE_CURSOR,
}

// How the drawing is shown: its zoom (1 = 100%), how far it is turned (in degrees, clockwise, from -180 to 180) and
// whether it is flipped like in a mirror. A new object every time one of them changes
export type ViewState = { zoom: number; rotation: number; flipped: boolean }

// What a pointer that went down on the drawing does while it moves and when it comes up, depending on its tool, and
// the cursor it shows if not its tool's
type Gesture = { move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cursor?: string }

// What the view asks of the rest of the engine
export type ViewActions = {
  onStrokeEnd: () => void
  onMixEnd: () => void
  onColorPick: (color: string) => void // a color picked with the eyedropper
  canPickColors: () => boolean // whether anyone wants those colors: if not, holding Alt doesn't pick them
  onFill: (x: number, y: number) => void // the fill bucket went down at this point of the paper
  onSelect: (points: Point[], mode: SelectionMode) => void // a polygon drawn with a selection tool (none: a click)
  onWand: (x: number, y: number, mode: SelectionMode) => void // the magic wand went down at this point of the paper
  // The move tool went down, was dragged this many pixels of the paper from there, and came up ("keep": false when the
  // browser took the pointer away)
  onMoveStart: () => void
  onMove: (dx: number, dy: number) => void
  onMoveEnd: (keep: boolean) => void
  isWorking: () => boolean // while a fill or Delete is worked out, the tools that change the drawing wait
  canUse: (tool: Tool) => boolean // whether a tool can change the active layer (a smart object can't be painted on)
  // The transform being made, if any, and its handles dragged to new corners (see transformHandles.ts)
  getTransform: () => TransformTarget | null
  onTransform: (corners: Quad) => void
  onWarp: (warp: Warp) => void
  onTransformStep: () => void // a handle was let go
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
  mixTools: MixTools,
  liquify: Liquify,
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

  // The view as it is now, to save it with the drawing (see ViewData)
  function getSaved(): ViewData {
    return { zoom: currentZoom(), rotation: state.rotation, flipped: isFlipped(), center: paperAt(middle()) }
  }

  // Show the drawing as it was saved: the same zoom, angle and flip, with the same point of the paper in the middle
  function showSaved({ zoom, rotation, flipped, center }: ViewData) {
    setView(zoom, (rotation * Math.PI) / 180, flipped)
    placeAt(center, middle())
  }

  // Zoom to this much (1 = 100%), around the middle of the screen: a zoom typed in
  function zoomTo(zoom: number) {
    setViewAround(middle(), zoom, world.rotation, isFlipped())
  }

  // Turn the view to this angle, in degrees, around the middle of the screen: an angle typed in
  function turnTo(degrees: number) {
    setViewAround(middle(), currentZoom(), (degrees * Math.PI) / 180, isFlipped())
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

  // Where a point of the window is on the paper (an image dropped there), or null when it isn't over the drawing area
  function paperAtWindow(x: number, y: number): Point | null {
    const rect = canvas.getBoundingClientRect()
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null
    return paperAt({ x: x - rect.left, y: y - rect.top })
  }

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

  // The brush paints where the pen goes, or, with the stabilizer on, where the stabilizer lets it follow the pen. With
  // Shift, a click paints a straight line from where the last stroke ended instead (see straightLineTo)
  function paint(e: PointerEvent): Gesture {
    hoverPoint = null
    const line = e.shiftKey ? straightLineTo(onScreen(e)) : null
    if (line) {
      const changed = brush.paintLine(line.from, line.to, pressureOf(e))
      return {
        move() {},
        up() {
          if (changed) actions.onStrokeEnd()
        },
      }
    }
    const point = { ...toPaper(e), pressure: pressureOf(e) }
    brush.startStroke(point.x, point.y, point.pressure)
    if (stabilizerSettings.strength > 0) {
      stabilizer = createStabilizer(stabilizerSettings, point, currentZoom(), performance.now())
    }
    return {
      move(e) {
        // The browser groups fast movements into one event; get all the points in between
        const points = (e.getCoalescedEvents?.() ?? [e]).map(ev => ({ ...toPaper(ev), pressure: pressureOf(ev) }))
        brush.continueStroke(stabilizer ? stabilizer.follow(points, performance.now()) : points)
      },
      up(e) {
        // A stroke the browser took away ends where the brush is, not where the pen was
        if (stabilizer && e.type === 'pointerup') brush.continueStroke(stabilizer.finish())
        stabilizer = null
        if (brush.endStroke()) actions.onStrokeEnd()
      },
    }
  }

  // Smudge, blur and liquify go along the pointer like the brush, stabilizer included (see mixTools.ts and liquify.ts)
  function layerStroke(e: PointerEvent, worker: MixTools | Liquify): Gesture {
    hoverPoint = null
    const point = { ...toPaper(e), pressure: pressureOf(e) }
    worker.startStroke(point.x, point.y, point.pressure)
    if (stabilizerSettings.strength > 0) {
      stabilizer = createStabilizer(stabilizerSettings, point, currentZoom(), performance.now())
    }
    return {
      move(e) {
        const points = (e.getCoalescedEvents?.() ?? [e]).map(ev => ({ ...toPaper(ev), pressure: pressureOf(ev) }))
        worker.continueStroke(stabilizer ? stabilizer.follow(points, performance.now()) : points)
      },
      up(e) {
        if (stabilizer && e.type === 'pointerup') worker.continueStroke(stabilizer.finish())
        stabilizer = null
        if (worker.endStroke()) actions.onMixEnd()
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

  // The handles of a transform, over the drawing, drawn again every frame while it is made
  const handles = new Graphics()
  world.addChild(handles)

  function showHandles() {
    const target = actions.getTransform()
    handles.visible = target !== null
    if (target) drawHandles(handles, target, currentZoom())
  }

  const toScreen = (paper: Point) => world.toGlobal(paper)

  // While a transform is made, the left button drags its handles
  function transform(e: PointerEvent, target: TransformTarget): Gesture {
    const from = toPaper(e)
    const handle = handleAt(target, onScreen(e), from, toScreen)
    return {
      move(e) {
        if (handle.kind === 'mesh') {
          actions.onWarp(movedWarp(target, handle.index, from, toPaper(e)))
          return
        }
        const keys = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }
        actions.onTransform(transformed(target, handle, from, toPaper(e), keys))
      },
      up() {
        actions.onTransformStep()
      },
      cursor: cursorFor(handle, target, toScreen, e.ctrlKey || e.metaKey),
    }
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

  // The magic wand selects around the point where the pointer goes down (see selection.ts)
  function wand(e: PointerEvent): Gesture {
    const point = toPaper(e)
    actions.onWand(point.x, point.y, selectionMode(e))
    return { move() {}, up() {} }
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
    smudge: e => layerStroke(e, mixTools),
    blur: e => layerStroke(e, mixTools),
    liquify: e => layerStroke(e, liquify),
    fill,
    eyedropper: pick,
    select: selectRectangle,
    lasso,
    wand,
    move: movePaint,
    hand: pan,
    zoom,
    rotate: e => rotate(e, !isSpaceDown),
  }

  // ----- The chosen tool, the keys held and the cursor -----

  let tool: Tool = 'brush'
  let isSpaceDown = false
  let isShiftDown = false // Shift, Alt and Ctrl (Cmd on a Mac) as the last key or pointer event said
  let isAltDown = false
  let isCtrlDown = false
  let gesture: (Gesture & { pointerId: number; tool: Tool }) | null = null // the pointer that is down, if any
  let hoverPoint: Point | null = null // where the brush is waiting, or null when all is ready
  let transformCursor: string | null = null // the cursor over a transform's handles, where the pointer is
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
    if (gesture?.cursor) cursor = gesture.cursor
    else if (!gesture && !isSpaceDown && transformCursor && actions.getTransform()) cursor = transformCursor
    else if (shown === 'hand' && gesture) cursor = 'grabbing'
    else if (shown === 'zoom' && isAltDown && !gesture) cursor = 'zoom-out'
    else if (isOutlineShown) cursor = 'none'
    if (cursor === shownCursor) return
    shownCursor = cursor
    // PixiJS sets the canvas's cursor too, to its "default" style, when the pointer first moves over it
    app.renderer.events.cursorStyles.default = cursor
    canvas.style.cursor = cursor
  }

  // ----- The brush's outline -----

  // With the brush or the eraser, the outline of the brush's tip follows the pointer, over everything, as big as the
  // brush paints and turned as its tip is, so the size and the shape of the brush show before painting. It takes the
  // cursor's place, unless it would be too small to see. White with a black line inside, like a selection's outline,
  // and drawn again only when what it shows changes.
  //
  // With the mouse, it is as big as the brush paints at full pressure. With a pen and a brush whose size follows the
  // pressure, it is as big as the pen paints now: while painting, at the pen's pressure, and while the pen is in the
  // air, at the last pressure it painted with, so the outline is the size the next stroke will likely be (decision 69)
  const brushOutline = new Graphics()
  app.stage.addChild(brushOutline)
  let isOutlineOn = true
  let isOutlineShown = false
  let pointer: Point | null = null // where the pointer is on the canvas, or null when it isn't over it
  let outlineKey = '' // what the outline was last drawn for: where, how big, how turned, and the view
  let outlineTip: BrushTip | null = null
  // The pen's latest pressure while it touched the drawing, kept while it is in the air; null with the mouse, or a pen
  // that hasn't touched the drawing yet
  let penPressure: number | null = null

  function notePressure(e: PointerEvent) {
    if (e.pointerType !== 'pen') penPressure = null
    else if (e.buttons & 1 && e.pressure > 0) penPressure = e.pressure
  }

  function showBrushOutline() {
    const at = pointer
    const used = gesture?.tool ?? currentTool()
    // Smudge, blur and liquify keep their size: the pen's pressure changes their strength
    const pressure = penPressure !== null && brush.getShape().pressureSize && !hasStrength(used) ? penPressure : 1
    const isCircle = used === 'liquify' // it doesn't work through the brush's tip
    const size = isCircle ? Math.max(brush.settings.size, MIN_LIQUIFY_SIZE) : brush.settings.size * pressure
    const isShown =
      isOutlineOn &&
      at !== null &&
      usesTip(used) &&
      actions.canUse(used) &&
      !actions.getTransform() &&
      size * currentZoom() >= MIN_OUTLINE
    if (isShown !== isOutlineShown) {
      isOutlineShown = isShown
      showCursor()
    }
    // While the stabilizer holds the brush back, the outline is where the brush is, and a line joins it to the pen.
    // With Shift held, the straight line a click would paint shows, and the outline at its end. The lines show even
    // when the outline doesn't
    const isLagging = stabilizer !== null && usesTip(used)
    const canLine = isShiftDown && !gesture && at !== null && isPaintTool(used) && actions.canUse(used)
    const line = canLine && !actions.getTransform() ? straightLineTo(at) : null
    brushOutline.visible = isShown || (at !== null && (isLagging || line !== null))
    if (!at || !brushOutline.visible) return

    const center = line ? line.to : stabilizer ? stabilizer.brushAt() : paperAt(at)
    const tip = brush.getTip()
    const pixelTip = brush.getShape().pixel
    const isPixel = pixelTip !== 'none'
    const angle = brush.tipAngle()
    const { position, scale, rotation } = world
    const key = [at.x, at.y, center.x, center.y, isShown, size, isPixel, angle, line?.from.x, line?.from.y]
      .concat([position.x, position.y, scale.x, scale.y, rotation, isCircle])
      .join()
    if (key === outlineKey && tip === outlineTip) return
    outlineKey = key
    outlineTip = tip

    let loops: Point[][] = []
    if (!isShown) {
      // only the line
    } else if (isCircle) {
      const points = Math.max(32, Math.ceil(size * currentZoom()))
      const circle = Array.from({ length: Math.min(points, 256) }, (_, i) => (i * 2 * Math.PI) / Math.min(points, 256))
      loops = [
        circle.map(turn => ({ x: center.x + (Math.cos(turn) * size) / 2, y: center.y + (Math.sin(turn) * size) / 2 })),
      ]
    } else if (isPixel) {
      loops = pixelBrushOutline(tip, pixelTip === 'drawn', size, center)
    } else {
      const cos = Math.cos(angle) * size
      const sin = Math.sin(angle) * size
      loops = tipOutline(tip).map(loop =>
        loop.map(p => ({ x: center.x + p.x * cos - p.y * sin, y: center.y + p.x * sin + p.y * cos })),
      )
    }
    const onScreenLoops = loops.map(loop => loop.map(toScreen))
    const brushOnScreen = toScreen(center)
    const hasLine = isLagging && Math.hypot(brushOnScreen.x - at.x, brushOnScreen.y - at.y) >= 1
    brushOutline.clear()
    for (const [width, color] of [
      [3, 0xffffff],
      [1, 0x000000],
    ]) {
      for (const loop of onScreenLoops) brushOutline.poly(loop, true)
      if (hasLine) brushOutline.poly([brushOnScreen, at], false)
      if (line) brushOutline.poly([toScreen(line.from), brushOnScreen], false)
      brushOutline.stroke({ width, color })
    }
  }

  // ----- Straight lines -----

  // A straight line from where the last stroke ended to this point of the screen, kept to a few angles while Ctrl is
  // held (see straightLine.ts); null before the first stroke
  function straightLineTo(screen: Point) {
    const from = brush.getLastEnd()
    if (!from) return null
    const to = straightLineEnd(from, paperAt(screen), isCtrlDown, brush.getShape().pixel !== 'none')
    return { from, to }
  }

  // Turn the brush's outline on or off. When off, the brush shows the cursor's cross
  function setBrushOutline(on: boolean) {
    isOutlineOn = on
  }

  // ----- The stabilizer -----

  let stabilizerSettings = DEFAULT_STABILIZER
  let stabilizer: Stabilizer | null = null // the stroke's, while painting with it on (see stabilizer.ts)

  // While painting with the stabilizer, the brush goes on toward the pen every frame, even when the pen holds still, and
  // liquify goes on working where it is
  function keepStabilizing() {
    const stroke = gesture?.tool
    if (stabilizer) {
      const worker = stroke === 'liquify' ? liquify : stroke === 'smudge' || stroke === 'blur' ? mixTools : brush
      worker.continueStroke(stabilizer.wait(performance.now()))
    }
    if (stroke === 'liquify') liquify.hold()
  }

  // How strokes are smoothed from the next one on
  function setStabilizer(settings: StabilizerSettings) {
    stabilizerSettings = settings
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
    isCtrlDown = e.ctrlKey || e.metaKey
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
    isCtrlDown = e.ctrlKey || e.metaKey
    showCursor()
  }

  // Keys let go in another window never come here
  function handleBlur() {
    isSpaceDown = isShiftDown = isAltDown = isCtrlDown = false
    showCursor()
  }

  // The left button (or the pen tip) uses the tool; the middle button always moves the view
  function handlePointerDown(e: PointerEvent) {
    if (gesture) return // already busy with another pointer
    pointer = onScreen(e) // a pen can touch the drawing without hovering over it first
    notePressure(e)
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault() // the middle button would otherwise start the browser's auto-scroll
    // That also keeps the keyboard where it was, so take it away from a text field (like the brush name) as any other
    // click would: otherwise shortcuts like Ctrl+Z keep going to the field instead of the drawing
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    canvas.setPointerCapture(e.pointerId) // keep receiving the moves even if the pointer leaves the canvas
    // The keys may have changed while the window was in the background (Alt+Tab leaves Alt "down" here)
    isShiftDown = e.shiftKey
    isAltDown = e.altKey
    isCtrlDown = e.ctrlKey || e.metaKey
    const target = actions.getTransform()
    if (target && e.button === 0 && !isSpaceDown) {
      gesture = { ...transform(e, target), pointerId: e.pointerId, tool: 'move' }
      showCursor()
      return
    }
    const used = e.button === 1 ? 'hand' : currentTool()
    // While a fill or Delete is worked out, only the tools that just look can be used
    const onlyLooks = used === 'hand' || used === 'zoom' || used === 'rotate' || used === 'eyedropper'
    if ((actions.isWorking() && !onlyLooks) || !actions.canUse(used)) return
    gesture = { ...startGesture[used](e), pointerId: e.pointerId, tool: used }
    showCursor()
  }

  function handlePointerMove(e: PointerEvent) {
    pointer = onScreen(e)
    notePressure(e)
    if (gesture) {
      if (e.pointerId === gesture.pointerId) gesture.move(e)
      return
    }
    isShiftDown = e.shiftKey
    isAltDown = e.altKey
    isCtrlDown = e.ctrlKey || e.metaKey
    const target = actions.getTransform()
    transformCursor = target
      ? cursorFor(handleAt(target, onScreen(e), toPaper(e), toScreen), target, toScreen, e.ctrlKey || e.metaKey)
      : null
    showCursor()
    if (usesTip(currentTool())) hoverPoint = toPaper(e)
  }

  function handlePointerUp(e: PointerEvent) {
    if (!gesture || e.pointerId !== gesture.pointerId) return
    const ended = gesture
    gesture = null // first, so that what the gesture does at its end sees the pointer free
    ended.up(e)
    showCursor()
  }

  // The pointer went off the drawing (or a pen away from the tablet). While a tool is used it stays the drawing's
  // until it comes up, and only then does this come
  function handlePointerLeave() {
    pointer = null
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
  canvas.addEventListener('pointerleave', handlePointerLeave)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleBlur)
  app.ticker.add(prepareUnderBrush)
  app.ticker.add(showHandles)
  app.ticker.add(keepStabilizing)
  app.ticker.add(showBrushOutline)
  showCursor()
  fitToScreen()

  function destroy() {
    canvas.removeEventListener('wheel', handleWheel)
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('pointercancel', handlePointerUp)
    canvas.removeEventListener('pointerleave', handlePointerLeave)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    window.removeEventListener('blur', handleBlur)
    app.ticker.remove(prepareUnderBrush)
    app.ticker.remove(showHandles)
    app.ticker.remove(keepStabilizing)
    app.ticker.remove(showBrushOutline)
    outline.destroy()
    handles.destroy()
    brushOutline.destroy()
    listeners.clear()
  }

  return {
    fitToScreen,
    zoomTo,
    turnTo,
    straighten,
    flip,
    setTool,
    setBrushOutline,
    setStabilizer,
    getState: () => state,
    getSaved,
    showSaved,
    paperAtWindow,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isPainting: () => gesture !== null && usesTip(gesture.tool),
    isDragging: () => gesture !== null,
    destroy,
  }
}

export type View = ReturnType<typeof createView>
