import { Graphics, type Container } from 'pixi.js'
import { cornerAt, curveLine, mirrored, movedPoint, withHandle, type Curve, type CurvePoint } from './curves'
import type { Point } from './selection'
import { straightLineEnd } from './straightLine'

// The curves tool (see curves.ts), like Photoshop's pen: a click puts down a corner, and a click and a drag puts down a
// smooth point and pulls out its handles, with Alt pulling only the handle after it. Clicking the first point closes
// the curve, and clicking the last one again (a double click) or Enter ends it open. Esc throws it away, and Backspace
// takes back its last point. Shift keeps a new point, or a handle, to steps of 45°. Until it ends, the curve is only
// on the screen.
//
// While the active layer's curve is edited (see "Edit shape" in engine.ts), its points and handles can be dragged.

const CLICK_DISTANCE = 4 // pixels of the screen a click may move before it counts as dragging
const REACH = 8 // how close to a point or a handle the pointer has to go, in pixels of the screen
const POINT = 4 // half the side of a point's square
const HANDLE = 3.5 // a handle's radius
const BLUE = 0x2e9bff

type Gesture = { move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cursor?: string }
type Grip = { index: number; part: 'at' | 'before' | 'after' }

export type CurveToolActions = {
  onScreen: (e: PointerEvent) => Point
  paperAt: (screen: Point) => Point
  toScreen: (paper: Point) => Point
  drawOutline: (points: Point[], isClosed: boolean) => void // the line that shows the curve, on the paper
  onCurve: (curve: Curve) => void // a curve ended
  onDrawing: (isDrawing: boolean) => void // a curve started, or ended or was thrown away
  getEdited: () => Curve | null // the active layer's curve on the paper, while it is edited
  onEdit: (curve: Curve) => void
}

export function createCurveTool(stage: Container, actions: CurveToolActions) {
  const { onScreen, paperAt, toScreen } = actions
  const toPaper = (e: PointerEvent) => paperAt(onScreen(e))
  const isNear = (paper: Point, screen: Point) => {
    const { x, y } = toScreen(paper)
    return Math.hypot(screen.x - x, screen.y - y) <= REACH
  }
  const isClick = (from: Point, e: PointerEvent) => {
    const { x, y } = onScreen(e)
    return Math.hypot(x - from.x, y - from.y) < CLICK_DISTANCE
  }

  let draft: CurvePoint[] | null = null // the points of the curve being drawn
  let editing: Curve | null = null // the edited curve, while one of its points or handles is dragged

  const handles = new Graphics()
  stage.addChild(handles)
  let shownKey = ''

  function setDraft(points: CurvePoint[] | null) {
    const wasDrawing = draft !== null
    draft = points
    if (wasDrawing !== (draft !== null)) actions.onDrawing(draft !== null)
  }

  function finish(isClosed = false) {
    const points = draft
    setDraft(null)
    if (points && points.length >= 2) actions.onCurve({ points, isClosed })
  }

  const cancel = () => setDraft(null)

  // Take back the last point; false when no curve is being drawn
  function removeLast() {
    if (!draft) return false
    setDraft(draft.length > 1 ? draft.slice(0, -1) : null)
    return true
  }

  // Pull out the handles of the draft's point at "index" while the pointer drags: the one after it to the pointer,
  // and the one before to the other side, unless Alt holds it where it was
  function pullHandles(e: PointerEvent, index: number, then: () => void): Gesture {
    const start = onScreen(e)
    let isDragging = false
    let heldBefore: Point | null = null
    return {
      move(e) {
        if (!draft) return
        isDragging ||= !isClick(start, e)
        if (!isDragging) return
        const point = draft[index]
        let pull = toPaper(e)
        if (e.shiftKey) pull = straightLineEnd(point.at, pull, true, false)
        if (e.altKey) heldBefore ??= point.before
        else heldBefore = null
        const before = heldBefore ?? mirrored(point.at, pull)
        draft = draft.with(index, { ...point, after: pull, before, isSmooth: heldBefore === null })
      },
      up(e) {
        if (e.type === 'pointerup') then()
      },
    }
  }

  // A point of the draft, or of the edited curve, with its handles, closest first
  function gripAt(curve: Curve, screen: Point, withEnds: boolean): Grip | null {
    const { points, isClosed } = curve
    for (let index = points.length - 1; index >= 0; index--) {
      const point = points[index]
      for (const part of ['after', 'before'] as const) {
        const isUsed = isClosed || withEnds || (part === 'before' ? index > 0 : index < points.length - 1)
        const isOut = point[part].x !== point.at.x || point[part].y !== point.at.y
        if (isUsed && isOut && isNear(point[part], screen)) return { index, part }
      }
      if (isNear(point.at, screen)) return { index, part: 'at' }
    }
    return null
  }

  // Drag a point of the edited curve, or one of its handles. Shift keeps a handle to steps of 45°, and Alt turns it
  // alone, so the point becomes a corner
  function edit(e: PointerEvent, curve: Curve): Gesture {
    const grip = gripAt(curve, onScreen(e), false)
    if (!grip) return { move() {}, up() {} }
    const from = toPaper(e)
    const { index, part } = grip
    const point = curve.points[index]
    return {
      move(e) {
        let to = toPaper(e)
        let moved: CurvePoint
        if (part === 'at') moved = movedPoint(point, to.x - from.x, to.y - from.y)
        else {
          if (e.shiftKey) to = straightLineEnd(point.at, to, true, false)
          moved = withHandle(point, part, to, e.altKey)
        }
        editing = { ...curve, points: curve.points.with(index, moved) }
      },
      up(e) {
        const edited = editing
        editing = null
        if (e.type === 'pointerup' && edited) actions.onEdit(edited)
      },
      cursor: 'move',
    }
  }

  // The left button went down with the curves tool
  function start(e: PointerEvent): Gesture {
    const here = onScreen(e)
    const edited = actions.getEdited()
    if (edited && !draft) return edit(e, edited)
    if (draft && draft.length >= 2 && isNear(draft[0].at, here)) {
      // Close the curve, with the first point's handles pulled out by a drag
      return pullHandles(e, 0, () => finish(true))
    }
    const last = draft?.at(-1)
    if (draft && last && isNear(last.at, here)) {
      if (e.altKey) {
        // Turn the handle after the last point alone
        const index = draft.length - 1
        return {
          move(e) {
            let to = toPaper(e)
            if (e.shiftKey) to = straightLineEnd(last.at, to, true, false)
            if (draft) draft = draft.with(index, withHandle(draft[index], 'after', to, true))
          },
          up() {},
        }
      }
      // A click on it ends the curve open: the second click of a double click lands there
      const pulled = pullHandles(e, draft.length - 1, () => {})
      return {
        move: pulled.move,
        up(e) {
          if (e.type === 'pointerup' && isClick(here, e)) finish()
        },
      }
    }
    let at = toPaper(e)
    if (last && e.shiftKey) at = straightLineEnd(last.at, at, true, false)
    setDraft([...(draft ?? []), cornerAt(at)])
    return pullHandles(e, draft!.length - 1, () => {})
  }

  // Draw the curve being drawn, with the part to the pointer, or the edited curve's handles. Again only when what
  // they show changes on the screen
  function show(pointer: Point | null, isChosen: boolean, isDragging: boolean) {
    const edited = editing ?? (isChosen && !draft ? actions.getEdited() : null)
    const curve: Curve | null = draft ? { points: draft, isClosed: false } : edited
    const points = curve?.points ?? []
    const onScreenPoints = points.flatMap(({ at, before, after }) => [at, before, after].map(toScreen))
    const pointerKey = draft && pointer && !isDragging ? `${pointer.x},${pointer.y}` : ''
    const key = curve
      ? [curve.isClosed, editing !== null, ...onScreenPoints.map(({ x, y }) => `${x},${y}`), pointerKey].join()
      : ''
    if (key === shownKey) return
    const wasShown = shownKey !== ''
    shownKey = key
    handles.clear()
    if (!curve) {
      if (wasShown) actions.drawOutline([], false)
      return
    }
    // The line, while it is drawn or dragged: the layer shows the edited curve itself
    if (draft || editing) {
      const line = curveLine(curve)
      const last = draft?.at(-1)
      if (last && pointer && !isDragging) {
        const to = paperAt(pointer)
        line.push(...curveLine({ points: [last, cornerAt(to)], isClosed: false }).slice(1))
      }
      actions.drawOutline(line, curve.isClosed)
    } else if (wasShown) {
      actions.drawOutline([], false)
    }
    const closes = draft && draft.length >= 2 && pointer && isNear(draft[0].at, pointer)
    points.forEach((point, index) => {
      const at = toScreen(point.at)
      for (const part of ['before', 'after'] as const) {
        const isUsed = curve.isClosed || draft || (part === 'before' ? index > 0 : index < points.length - 1)
        const handle = toScreen(point[part])
        if (!isUsed || (handle.x === at.x && handle.y === at.y)) continue
        handles.moveTo(at.x, at.y).lineTo(handle.x, handle.y).stroke({ width: 1, color: BLUE })
        handles.circle(handle.x, handle.y, HANDLE).fill({ color: BLUE })
      }
      const isFilled = closes && index === 0
      handles
        .rect(at.x - POINT, at.y - POINT, POINT * 2, POINT * 2)
        .fill({ color: isFilled ? BLUE : 0xffffff })
        .stroke({ width: 1.5, color: BLUE })
    })
  }

  function destroy() {
    handles.destroy()
  }

  return { start, show, finish, cancel, removeLast, isDrawing: () => draft !== null, destroy }
}

export type CurveTool = ReturnType<typeof createCurveTool>
