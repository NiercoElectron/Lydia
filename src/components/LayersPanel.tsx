import {
  Box,
  ChevronDown,
  ChevronRight,
  CornerLeftDown,
  Folder,
  FolderOpen,
  Lock,
  LockOpen,
  Paperclip,
  ScanEye,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EngineSnapshot } from '../engine/engine'
import type { BlendMode } from '../engine/layers'
import { SliderValue } from './SliderValue'

type Props = {
  layers: EngineSnapshot['layers'] // from the bottom to the top
  activeLayerId: number
  canDelete: boolean
  canMergeDown: boolean
  onAdd: () => void
  onAddFolder: () => void
  onAddOutside: () => void // a layer above the folder the active one is in, out of it
  onDelete: () => void
  onDuplicate: () => void
  onMergeDown: () => void
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

// The blend modes offered (see blendModes.ts), in groups as in Photoshop: those that darken, those that lighten, those
// that add contrast, the comparison, and those that take part of a color. A folder also offers Pass Through (see
// isFolder in layers.ts)
const BLEND_MODE_GROUPS: { label: string; modes: [BlendMode, string][] }[] = [
  { label: 'Normal', modes: [['normal', 'Normal']] },
  {
    label: 'Darken',
    modes: [
      ['darken', 'Darken'],
      ['multiply', 'Multiply'],
      ['color-burn', 'Color Burn'],
    ],
  },
  {
    label: 'Lighten',
    modes: [
      ['lighten', 'Lighten'],
      ['screen', 'Screen'],
      ['color-dodge', 'Color Dodge'],
      ['add', 'Add (Linear Dodge)'],
    ],
  },
  {
    label: 'Contrast',
    modes: [
      ['overlay', 'Overlay'],
      ['soft-light', 'Soft Light'],
      ['hard-light', 'Hard Light'],
    ],
  },
  { label: 'Comparison', modes: [['difference', 'Difference']] },
  {
    label: 'Color',
    modes: [
      ['hue', 'Hue'],
      ['saturation', 'Saturation'],
      ['color', 'Color'],
      ['luminosity', 'Luminosity'],
    ],
  },
]

const DRAG_START_PX = 4 // how far a layer must be dragged before it starts moving, so a click stays a click
const MAX_NAME_LENGTH = 100
const INDENT_PX = 14 // how far a row is moved in for each folder it is in, and for being clipped

type Row = EngineSnapshot['layers'][number]

// Where a dragged layer would go: into a folder (on top of what is in it), or into the gap before the shown row with
// this number (after the last row when it equals the number of rows)
type Drop = { into: number } | { gap: number }
type Drag = { id: number; pointerId: number; startY: number; isMoving: boolean; drop: Drop | null }

export function LayersPanel({
  layers,
  activeLayerId,
  canDelete,
  canMergeDown,
  onAdd,
  onAddFolder,
  onAddOutside,
  onDelete,
  onDuplicate,
  onMergeDown,
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

  // Where a layer dragged to this height on the screen would go: into a folder when over the middle of its row, or into
  // the gap between rows nearest to it. Null when it would go into itself, or stay where it is
  function dropAt(y: number, id: number): Drop | null {
    let gap = 0
    for (const [index, element] of rows.current.slice(0, shown.length).entries()) {
      const box = element?.getBoundingClientRect()
      if (!box) continue
      const row = shown[index]
      const isOver = y >= box.top + box.height / 4 && y <= box.bottom - box.height / 4
      if (row.isFolder && isOver) return isInDragged(row, id) ? null : { into: row.id }
      if (y > box.top + box.height / 2) gap++
    }
    const below = shown[gap]
    if (below && isInDragged(below, id)) return null // above itself, or inside itself
    if (shown[gap - 1]?.id === id) return null // right under itself: where it is
    return { gap }
  }

  // The folder and the layer or folder it would go right above, for a drop
  function placeOf(drop: Drop) {
    if ('into' in drop) {
      const top = layers.findLast(layer => layer.parentId === drop.into)
      return { parentId: drop.into, aboveId: top?.id ?? null }
    }
    const below = shown[drop.gap]
    return below ? { parentId: below.parentId, aboveId: below.id } : { parentId: null, aboveId: null }
  }

  function handlePointerDown(e: React.PointerEvent, id: number) {
    if (e.button !== 0) return
    setDrag({ id, pointerId: e.pointerId, startY: e.clientY, isMoving: false, drop: null })
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    if (!drag.isMoving) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_START_PX) return
      e.currentTarget.setPointerCapture(e.pointerId) // keep getting the pointer's moves outside the row
    }
    setDrag({ ...drag, isMoving: true, drop: dropAt(e.clientY, drag.id) })
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    if (drag.isMoving && drag.drop) {
      const { parentId, aboveId } = placeOf(drag.drop)
      onMove(drag.id, parentId, aboveId)
    }
    setDrag(null)
  }

  // How a row shows where a dragged layer would go: a line before or after it, or the row lit as the folder to go in
  function dropLineOf(index: number) {
    const drop = drag?.isMoving ? drag.drop : null
    if (!drop) return undefined
    if ('into' in drop) return drop.into === shown[index].id ? 'drop-into' : undefined
    if (drop.gap === index) return 'drop-before'
    if (drop.gap === shown.length && index === shown.length - 1) return 'drop-after'
    return undefined
  }

  const blendGroups = active?.isFolder
    ? [{ label: 'Folder', modes: [['pass-through', 'Pass Through']] as [BlendMode, string][] }, ...BLEND_MODE_GROUPS]
    : BLEND_MODE_GROUPS

  return (
    <aside className="layers-panel">
      <h2>Layers</h2>
      <div className="layers-actions">
        <button onClick={onAdd}>New layer</button>
        <button
          onClick={onAddFolder}
          title="Add a folder to keep layers in (Ctrl+G puts the active layer in a new one)"
        >
          New folder
        </button>
        <button
          onClick={onAddOutside}
          disabled={!active || (!active.isFolder && active.parentId === null)}
          title="Add a layer above the folder the active layer is in (or above the active folder), out of it"
        >
          New layer outside
        </button>
        <button onClick={onDuplicate} title="Copy the active layer or folder above it (Ctrl+J)">
          Duplicate
        </button>
        <button
          onClick={onMergeDown}
          disabled={!canMergeDown}
          title={
            active?.isFolder
              ? 'Merge all that is in the active folder into one layer (Ctrl+E)'
              : 'Merge the active layer into the one under it (Ctrl+E). Both must be shown'
          }
        >
          {active?.isFolder ? 'Merge folder' : 'Merge down'}
        </button>
        <button
          onClick={onDelete}
          disabled={!canDelete}
          title={active?.isFolder ? 'Delete the active folder with all that is in it' : 'Delete the active layer'}
        >
          {active?.isFolder ? 'Delete folder' : 'Delete layer'}
        </button>
      </div>
      {active && (
        <label className="layer-blend" title="How the active layer's paint goes onto what is under it">
          Blend
          <select value={active.blendMode} onChange={e => onBlendModeChange(active.id, e.target.value as BlendMode)}>
            {blendGroups.map(({ label, modes }) => (
              <optgroup key={label} label={label}>
                {modes.map(([mode, name]) => (
                  <option key={mode} value={mode}>
                    {name}
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
      <ul className="layers-list">
        {shown.map((layer, index) => {
          const classes = [
            layer.id === activeLayerId && 'active',
            layer.clipped && 'clipped',
            layer.isFolder && 'folder',
            drag?.isMoving && drag.id === layer.id && 'dragging',
            dropLineOf(index),
          ]
          return (
            <li
              key={layer.id}
              ref={row => {
                rows.current[index] = row
              }}
              className={classes.filter(Boolean).join(' ') || undefined}
              style={{ paddingLeft: (layer.depth + (layer.clipped ? 1 : 0)) * INDENT_PX }}
            >
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={e => onVisibleChange(layer.id, e.target.checked)}
                aria-label={`Show ${layer.name}`}
                title={layer.visible ? 'Hide' : 'Show'}
              />
              {layer.clipped && (
                <CornerLeftDown className="clip-arrow" size={14} aria-label="Clipped to the layers under it" />
              )}
              {layer.isFolder && (
                <button
                  className="icon-button folder-toggle"
                  aria-expanded={layer.isOpen}
                  onClick={() => onOpenChange(layer.id, !layer.isOpen)}
                  title={layer.isOpen ? 'Close the folder' : 'Open the folder'}
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
                  title={
                    layer.isFolder
                      ? 'Drag to move with all that is in it, or drop a layer on it to put it in; double-click to rename'
                      : 'Drag to move (onto a folder to put it in), double-click to rename'
                  }
                  onClick={() => onSelect(layer.id)}
                  onDoubleClick={() => setRenamingId(layer.id)}
                  onPointerDown={e => handlePointerDown(e, layer.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => setDrag(null)}
                >
                  {layer.isFolder &&
                    (layer.isOpen ? (
                      <FolderOpen className="smart-icon" size={14} aria-label="Folder" />
                    ) : (
                      <Folder className="smart-icon" size={14} aria-label="Folder" />
                    ))}
                  {layer.isSmart && <Box className="smart-icon" size={14} aria-label="Smart object" />}
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
                      ? 'Its transparency is locked: painting only colors the paint already there. Click to unlock'
                      : 'Lock its transparency: painting would only color the paint already there'
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
                    ? 'The bottom one, here, has nothing under it to be clipped to'
                    : layer.clipped
                      ? 'It is clipped: it shows only where the layer under it has paint. Click to unclip (Ctrl+Alt+G)'
                      : 'Clip it to the layer under it: it would show only where that layer has paint (Ctrl+Alt+G)'
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
                      ? 'Hide the paint of this layer that is off the paper'
                      : 'This layer has paint off the paper: show it, faded, around the paper'
                  }
                >
                  <ScanEye size={14} aria-hidden />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

type NameInputProps = {
  name: string
  onDone: (name: string) => void // with the new name, or the old one to keep it
}

// Typing a new name: Enter or clicking elsewhere keeps it, Escape keeps the old one
function NameInput({ name, onDone }: NameInputProps) {
  return (
    <input
      className="layer-name"
      type="text"
      defaultValue={name}
      maxLength={MAX_NAME_LENGTH}
      aria-label="Layer name"
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
      Opacity
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
