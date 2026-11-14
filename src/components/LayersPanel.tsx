import { useLanguage } from '../i18n'
import {
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerLeftDown,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Lock,
  LockOpen,
  Paperclip,
  PenTool,
  Plus,
  ScanEye,
  Shapes,
  Trash2,
  Type,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EngineSnapshot } from '../engine/engine'
import type { BlendMode } from '../engine/layers'
import { BLEND_MODE_GROUPS } from './blendModeList'
import { SliderValue } from './SliderValue'

type Props = {
  layers: EngineSnapshot['layers'] // from the bottom to the top
  activeLayerId: number
  canDelete: boolean
  paperColor: string | null // null: a transparent paper
  isPaperShown: boolean
  thumbnailOf: (id: number) => HTMLCanvasElement | null // a layer's small picture, which keeps itself up to date
  onAdd: () => void
  onAddFolder: () => void
  onDelete: () => void
  onDuplicate: () => void
  onPaperShownChange: (shown: boolean) => void
  onSelect: (id: number) => void
  // Move a layer or folder into the folder "parentId" (null: none), right above "aboveId" in it, or at its bottom
  onMove: (id: number, parentId: number | null, aboveId: number | null) => void
  onRename: (id: number, name: string) => void
  onVisibleChange: (id: number, visible: boolean) => void
  onOpenChange: (id: number, open: boolean) => void // show what is in a folder, or not
  onOffPaperChange: (id: number, show: boolean) => void // show the layer's paint off the paper, or not
  onAlphaLockChange: (id: number, locked: boolean) => void // lock the layer's transparency, or unlock it
  onClipChange: (id: number, clipped: boolean) => void // clip the layer to the layers under it, or unclip it
  onBlendModeChange: (id: number, mode: BlendMode) => void
  onOpacityChange: (id: number, opacity: number) => void
  onOpacityChangeEnd: () => void
}

const DRAG_START_PX = 4 // how far a layer must be dragged before it starts moving, so a click stays a click
const MAX_NAME_LENGTH = 100
const INDENT_PX = 14 // how far a row is moved in for each folder it is in, and for being clipped

type Row = EngineSnapshot['layers'][number]

// Where a dragged layer would go: into a folder (on top of what is in it), or into the gap before the shown row with
// this number (after the last row when it equals the number of rows), in the folder "parentId", right above "aboveId"
// in it or at its bottom. "depth": how many folders that puts it in
type Gap = { gap: number; parentId: number | null; aboveId: number | null; depth: number }
type Drop = { into: number } | Gap
// Where a row is on the screen when nothing is moving. While rows step aside these places are what counts: going by
// where they are at that moment, a drop would change as they slide, and move them again
type Home = { top: number; height: number }
// "moved": how far the rows in hand have gone from their places
type Drag = {
  id: number
  pointerId: number
  startX: number
  startY: number
  isMoving: boolean
  moved: number
  homes: Home[]
  drop: Drop | null
}

export function LayersPanel({
  layers,
  activeLayerId,
  canDelete,
  paperColor,
  isPaperShown,
  thumbnailOf,
  onAdd,
  onAddFolder,
  onDelete,
  onDuplicate,
  onPaperShownChange,
  onSelect,
  onMove,
  onRename,
  onVisibleChange,
  onOpenChange,
  onOffPaperChange,
  onAlphaLockChange,
  onClipChange,
  onBlendModeChange,
  onOpacityChange,
  onOpacityChangeEnd,
}: Props) {
  const { t } = useLanguage()
  const byId = new Map(layers.map(layer => [layer.id, layer]))
  const active = byId.get(activeLayerId)
  // From the top to the bottom, like in Photoshop and Krita, without what is in closed folders
  const isRowShown = (row: Row) => {
    for (let id = row.parentId; id !== null; id = byId.get(id)!.parentId) if (!byId.get(id)!.isOpen) return false
    return true
  }
  const shown = [...layers].reverse().filter(isRowShown)
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const [drag, setDrag] = useState<Drag | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)

  // Whether a row is the dragged layer or folder, or in it
  const isInDragged = (row: Row | undefined, id: number) => {
    for (let at = row; at; at = at.parentId === null ? undefined : byId.get(at.parentId)) if (at.id === id) return true
    return false
  }

  // The drag under way. A list that changed meanwhile (a key can add or delete a layer) ends it: its places are gone
  const moving =
    drag?.isMoving && drag.homes.length === shown.length && shown.some(row => row.id === drag.id) ? drag : null

  const homesOfRows = () => rows.current.slice(0, shown.length).map(element => element!.getBoundingClientRect())

  // The first and last of the rows in hand, and how tall they are together
  function inHandOf({ id, homes }: Drag) {
    const first = shown.findIndex(row => isInDragged(row, id))
    const last = shown.findLastIndex(row => isInDragged(row, id))
    return { first, last, height: homes[last].top + homes[last].height - homes[first].top }
  }

  // The rows in hand go with the pointer, without leaving the list
  function movedTo(y: number, current: Drag) {
    const { homes } = current
    const { first, height } = inHandOf(current)
    const end = homes.at(-1)!
    const lowest = end.top + end.height - height - homes[first].top
    return Math.min(lowest, Math.max(homes[0].top - homes[first].top, y - current.startY))
  }

  // Where the rows in hand are, going from them towards where they are headed: a row is passed once their leading edge
  // gets to its middle, the same way up and down and wherever the dots were grabbed. A folder is passed by their middle,
  // over its own: until then they are over it, to go in
  function spotAt(current: Drag, moved: number): { into: number } | { gap: number } {
    const { homes } = current
    const { first, last, height } = inHandOf(current)
    const isDown = moved > 0
    const top = homes[first].top + moved
    const bottom = top + height
    const middle = top + homes[first].height / 2
    let gap = isDown ? last + 1 : first
    for (let index = isDown ? last + 1 : first - 1; shown[index]; index += isDown ? 1 : -1) {
      const center = homes[index].top + homes[index].height / 2
      if (shown[index].isFolder) {
        if (Math.abs(middle - center) <= homes[index].height / 4) return { into: shown[index].id }
        if (isDown ? middle < center : middle > center) break
      } else if (isDown ? bottom <= center : top >= center) break
      gap = isDown ? index + 1 : index
    }
    return { gap }
  }

  // Where the rows in hand would go. A gap under the end of a folder is in that folder and out of it at once: they stay
  // as deep as they were, as far as the gap allows, and going sideways takes them a folder in or out. Null when it is
  // where they are
  function dropAt(current: Drag, moved: number, x: number): Drop | null {
    const spot = spotAt(current, moved)
    if ('into' in spot) return spot
    const dragged = byId.get(current.id)!
    const { first, last } = inHandOf(current)
    const isSameGap = spot.gap >= first && spot.gap <= last + 1
    const above: Row | undefined = shown[isSameGap ? first - 1 : spot.gap - 1]
    const below: Row | undefined = shown[isSameGap ? last + 1 : spot.gap]
    const deepest = above ? above.depth + (above.isFolder && above.isOpen ? 1 : 0) : 0
    const shallowest = below?.depth ?? 0
    const wanted = dragged.depth + Math.round((x - current.startX) / INDENT_PX)
    const depth = Math.min(deepest, Math.max(shallowest, wanted))

    let inFolder: Row | undefined = above
    while (inFolder && inFolder.depth >= depth) {
      inFolder = inFolder.parentId === null ? undefined : byId.get(inFolder.parentId)
    }
    const parentId = inFolder?.id ?? null
    if (isSameGap && parentId === dragged.parentId) return null
    return { gap: spot.gap, parentId, aboveId: below?.parentId === parentId ? below.id : null, depth }
  }

  // The folder and the layer or folder it would go right above, for a drop
  function placeOf(drop: Drop) {
    if (!('into' in drop)) return drop
    const top = layers.findLast(layer => layer.parentId === drop.into)
    return { parentId: drop.into, aboveId: top?.id ?? null }
  }

  function handlePointerDown(e: React.PointerEvent, id: number) {
    if (e.button !== 0) return
    const start = { startX: e.clientX, startY: e.clientY }
    setDrag({ id, pointerId: e.pointerId, ...start, isMoving: false, moved: 0, homes: [], drop: null })
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    if (!drag.isMoving) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_START_PX) return
      e.currentTarget.setPointerCapture(e.pointerId) // keep getting the pointer's moves outside the row
    }
    if (drag.isMoving && !moving) {
      setDrag(null)
      return
    }
    const current = moving ?? { ...drag, isMoving: true, homes: homesOfRows() }
    const moved = movedTo(e.clientY, current)
    setDrag({ ...current, moved, drop: dropAt(current, moved, e.clientX) })
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    // From where the pointer is now: the last move may not have reached the screen yet
    const drop = moving && dropAt(moving, movedTo(e.clientY, moving), e.clientX)
    if (moving && drop) {
      const { parentId, aboveId } = placeOf(drop)
      onMove(moving.id, parentId, aboveId)
    }
    onSelect(drag.id) // the one in hand becomes the active one, moved or not
    setDrag(null)
  }

  // How far a row is from its place while something is dragged: the rows in hand go with the pointer, and the ones
  // between them and the gap they would go into step aside
  function offsetOf(index: number) {
    if (!moving) return 0
    const { first, last, height } = inHandOf(moving)
    if (index >= first && index <= last) return moving.moved
    const gap = moving.drop && 'gap' in moving.drop ? moving.drop.gap : null
    if (gap === null) return 0
    if (index >= gap && index < first) return height
    return index > last && index < gap ? -height : 0
  }

  // How far the rows in hand go sideways, to show how many folders they would be in
  function sidewaysOf(index: number) {
    if (!moving?.drop || 'into' in moving.drop) return 0
    const { first, last } = inHandOf(moving)
    return index >= first && index <= last ? (moving.drop.depth - byId.get(moving.id)!.depth) * INDENT_PX : 0
  }

  const blendGroups = active?.isFolder
    ? [{ label: 'Folder', modes: [['pass-through', 'Pass Through']] as [BlendMode, string][] }, ...BLEND_MODE_GROUPS]
    : BLEND_MODE_GROUPS

  return (
    <aside className="layers-panel">
      <div className="panel-title">
        <h2>{t('Layers')}</h2>
        <span className="panel-icons">
          <button className="top-icon" aria-label={t('New layer')} title={t('New layer')} onClick={onAdd}>
            <Plus size={18} aria-hidden />
          </button>
          <button
            className="top-icon"
            aria-label={t('Duplicate')}
            title={t('Duplicate')}
            disabled={!active}
            onClick={onDuplicate}
          >
            <Copy size={16} aria-hidden />
          </button>
        </span>
      </div>
      {active && (
        <label className="layer-blend" title={t("How the active layer's paint goes onto what is under it")}>
          {t('Blend')}
          <select value={active.blendMode} onChange={e => onBlendModeChange(active.id, e.target.value as BlendMode)}>
            {blendGroups.map(({ label, modes }) => (
              <optgroup key={label} label={t(label)}>
                {modes.map(([mode, name]) => (
                  <option key={mode} value={mode}>
                    {t(name, {}, 'blend')}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {active && (
        <OpacitySlider
          opacity={active.opacity}
          onChange={value => onOpacityChange(active.id, value)}
          onChangeEnd={onOpacityChangeEnd}
        />
      )}
      <ul className={moving ? 'layers-list sorting' : 'layers-list'}>
        {shown.map((layer, index) => {
          const isInHand = moving !== null && isInDragged(layer, moving.id)
          const isDropInto = moving?.drop && 'into' in moving.drop && moving.drop.into === layer.id
          const offset = offsetOf(index)
          const sideways = sidewaysOf(index)
          const classes = [
            layer.id === activeLayerId && 'active',
            layer.clipped && 'clipped',
            layer.isFolder && 'folder',
            isInHand && 'dragging',
            isDropInto && 'drop-into',
          ]
          return (
            <li
              key={layer.id}
              ref={row => {
                rows.current[index] = row
              }}
              className={classes.filter(Boolean).join(' ') || undefined}
              style={{
                paddingLeft: (layer.depth + (layer.clipped ? 1 : 0)) * INDENT_PX,
                transform: offset !== 0 || sideways !== 0 ? `translate(${sideways}px, ${offset}px)` : undefined,
              }}
            >
              <span
                className="layer-grip"
                title={
                  layer.isFolder
                    ? t('Drag to move with all that is in it')
                    : t('Drag to move (onto a folder to put it in)')
                }
                onPointerDown={e => handlePointerDown(e, layer.id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => setDrag(null)}
              >
                <GripVertical size={14} aria-hidden />
              </span>
              <label className="layer-eye">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={e => onVisibleChange(layer.id, e.target.checked)}
                  aria-label={t('Show {name}', { name: layer.name })}
                  title={layer.visible ? t('Hide') : t('Show')}
                />
                {layer.visible ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
              </label>
              {!layer.isFolder && <LayerThumbnail id={layer.id} thumbnailOf={thumbnailOf} />}
              {layer.clipped && (
                <CornerLeftDown className="clip-arrow" size={14} aria-label={t('Clipped to the layers under it')} />
              )}
              {layer.isFolder && (
                <button
                  className="icon-button folder-toggle"
                  aria-expanded={layer.isOpen}
                  onClick={() => onOpenChange(layer.id, !layer.isOpen)}
                  title={layer.isOpen ? t('Close the folder') : t('Open the folder')}
                >
                  {layer.isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                </button>
              )}
              {renamingId === layer.id ? (
                <NameInput
                  name={layer.name}
                  onDone={name => {
                    onRename(layer.id, name)
                    setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  className="layer-name"
                  aria-pressed={layer.id === activeLayerId}
                  title={t('Double-click to rename')}
                  onClick={() => onSelect(layer.id)}
                  onDoubleClick={() => setRenamingId(layer.id)}
                >
                  {layer.isFolder &&
                    (layer.isOpen ? (
                      <FolderOpen className="smart-icon" size={14} aria-label={t('Folder')} />
                    ) : (
                      <Folder className="smart-icon" size={14} aria-label={t('Folder')} />
                    ))}
                  {layer.isSmart && !layer.isText && (
                    <Box className="smart-icon" size={14} aria-label={t('Smart object')} />
                  )}
                  {layer.isText && <Type className="smart-icon" size={14} aria-label={t('Text')} />}
                  {layer.isShape && !layer.isCurve && (
                    <Shapes className="smart-icon" size={14} aria-label={t('Shape')} />
                  )}
                  {layer.isCurve && <PenTool className="smart-icon" size={14} aria-label={t('Curve')} />}
                  {layer.name}
                </button>
              )}
              {!layer.isFolder && (
                <button
                  className="icon-button"
                  aria-pressed={layer.alphaLocked}
                  onClick={() => onAlphaLockChange(layer.id, !layer.alphaLocked)}
                  title={
                    layer.alphaLocked
                      ? t('Its transparency is locked: painting only colors the paint already there. Click to unlock')
                      : t('Lock its transparency: painting would only color the paint already there')
                  }
                >
                  {layer.alphaLocked ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
                </button>
              )}
              <button
                className="icon-button"
                aria-pressed={layer.clipped}
                disabled={!layer.canClip}
                onClick={() => onClipChange(layer.id, !layer.clipped)}
                title={
                  !layer.canClip
                    ? t('The bottom one, here, has nothing under it to be clipped to')
                    : layer.clipped
                      ? t(
                          'It is clipped: it shows only where the layer under it has paint. Click to unclip (Ctrl+Alt+G)',
                        )
                      : t('Clip it to the layer under it: it would show only where that layer has paint (Ctrl+Alt+G)')
                }
              >
                <Paperclip size={14} aria-hidden />
              </button>
              {layer.hasOffPaper && (
                <button
                  className="icon-button"
                  aria-pressed={layer.showsOffPaper}
                  onClick={() => onOffPaperChange(layer.id, !layer.showsOffPaper)}
                  title={
                    layer.showsOffPaper
                      ? t('Hide the paint of this layer that is off the paper')
                      : t('This layer has paint off the paper: show it, faded, around the paper')
                  }
                >
                  <ScanEye size={14} aria-hidden />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="paper-row">
        <label className="layer-eye">
          <input
            type="checkbox"
            checked={isPaperShown}
            disabled={paperColor === null}
            onChange={e => onPaperShownChange(e.target.checked)}
            aria-label={t('Show the paper')}
            title={
              paperColor === null
                ? t('This drawing has a transparent paper')
                : t('Without its color, the drawing shows and exports as if the paper were transparent')
            }
          />
          {isPaperShown ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
        </label>
        <span className="layer-thumbnail" style={paperColor ? { background: paperColor } : undefined} />
        <span className="paper-name">{t('Paper')}</span>
      </div>
      <div className="layers-footer">
        <button
          className="top-icon"
          aria-label={t('New folder')}
          title={t('Add a folder to keep layers in (Ctrl+G puts the active layer in a new one)')}
          onClick={onAddFolder}
        >
          <FolderPlus size={18} aria-hidden />
        </button>
        <button
          className="top-icon"
          aria-label={t(active?.isFolder ? 'Delete folder' : 'Delete layer')}
          title={active?.isFolder ? t('Delete the active folder with all that is in it') : t('Delete the active layer')}
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 size={18} aria-hidden />
        </button>
      </div>
    </aside>
  )
}

// A layer's small picture. The engine keeps it up to date by itself, so it only has to be put here
function LayerThumbnail({ id, thumbnailOf }: { id: number; thumbnailOf: (id: number) => HTMLCanvasElement | null }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const canvas = thumbnailOf(id)
    if (canvas) boxRef.current!.replaceChildren(canvas)
  }, [id, thumbnailOf])
  return <span ref={boxRef} className="layer-thumbnail" />
}

type NameInputProps = {
  name: string
  onDone: (name: string) => void // with the new name, or the old one to keep it
}

// Typing a new name: Enter or clicking elsewhere keeps it, Escape keeps the old one
function NameInput({ name, onDone }: NameInputProps) {
  const { t } = useLanguage()
  return (
    <input
      className="layer-name"
      type="text"
      defaultValue={name}
      maxLength={MAX_NAME_LENGTH}
      aria-label={t('Layer name')}
      autoFocus
      onFocus={e => e.currentTarget.select()}
      onBlur={e => onDone(e.currentTarget.value)}
      onKeyDown={e => {
        if (e.key === 'Escape') e.currentTarget.value = name
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}

type OpacitySliderProps = {
  opacity: number // from 0 to 1
  onChange: (opacity: number) => void // on every step, while the slider moves
  onChangeEnd: () => void // once the slider is let go
}

function OpacitySlider({ opacity, onChange, onChangeEnd }: OpacitySliderProps) {
  const { t } = useLanguage()
  const percent = Math.round(opacity * 100)
  const input = useRef<HTMLInputElement>(null)

  // React's onChange runs on every step; the browser's own "change" event runs once the slider is let go (and after
  // each arrow key), which React doesn't offer
  useEffect(() => {
    const element = input.current!
    element.addEventListener('change', onChangeEnd)
    return () => element.removeEventListener('change', onChangeEnd)
  }, [onChangeEnd])

  return (
    <label className="opacity">
      {t('Opacity')}
      <input
        ref={input}
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={e => onChange(Number(e.target.value) / 100)}
      />
      <SliderValue
        value={percent}
        min={0}
        max={100}
        unit="%"
        onChange={value => onChange(value / 100)}
        onDone={onChangeEnd}
      />
    </label>
  )
}
