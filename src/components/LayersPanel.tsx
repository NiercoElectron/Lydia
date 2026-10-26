import { Box, Lock, LockOpen, ScanEye } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EngineSnapshot } from '../engine/engine'
import { SliderValue } from './SliderValue'

type Props = {
  layers: EngineSnapshot['layers'] // from the bottom to the top
  activeLayerId: number
  canMergeDown: boolean
  onAdd: () => void
  onDelete: () => void
  onDuplicate: () => void
  onMergeDown: () => void
  onSelect: (id: number) => void
  onMove: (id: number, index: number) => void // index from the bottom, 0 = the bottom layer
  onRename: (id: number, name: string) => void
  onVisibleChange: (id: number, visible: boolean) => void
  onOffPaperChange: (id: number, show: boolean) => void // show the layer's paint off the paper, or not
  onAlphaLockChange: (id: number, locked: boolean) => void // lock the layer's transparency, or unlock it
  onOpacityChange: (id: number, opacity: number) => void
  onOpacityChangeEnd: () => void
}

const DRAG_START_PX = 4 // how far a layer must be dragged before it starts moving, so a click stays a click
const MAX_NAME_LENGTH = 100

// A layer being dragged to another place in the list. "gap" is where it would go: before the shown row with this
// number (or after the last row when it equals the number of rows)
type Drag = { id: number; pointerId: number; startY: number; isMoving: boolean; gap: number }

export function LayersPanel({
  layers,
  activeLayerId,
  canMergeDown,
  onAdd,
  onDelete,
  onDuplicate,
  onMergeDown,
  onSelect,
  onMove,
  onRename,
  onVisibleChange,
  onOffPaperChange,
  onAlphaLockChange,
  onOpacityChange,
  onOpacityChangeEnd,
}: Props) {
  const active = layers.find(layer => layer.id === activeLayerId)
  const shown = [...layers].reverse() // from the top to the bottom, like in Photoshop and Krita
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const [drag, setDrag] = useState<Drag | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)

  // The gap between rows nearest to a height on the screen
  function gapAt(y: number) {
    let gap = 0
    for (const row of rows.current.slice(0, shown.length)) {
      const box = row?.getBoundingClientRect()
      if (box && y > box.top + box.height / 2) gap++
    }
    return gap
  }

  // Where the dragged layer would end up among the shown rows, once it is taken out of its own place
  function dropTarget({ id, gap }: Drag) {
    const from = shown.findIndex(layer => layer.id === id)
    return { from, to: gap > from ? gap - 1 : gap }
  }

  function handlePointerDown(e: React.PointerEvent, id: number) {
    if (e.button !== 0) return
    setDrag({ id, pointerId: e.pointerId, startY: e.clientY, isMoving: false, gap: 0 })
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    if (!drag.isMoving) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_START_PX) return
      e.currentTarget.setPointerCapture(e.pointerId) // keep getting the pointer's moves outside the row
    }
    setDrag({ ...drag, isMoving: true, gap: gapAt(e.clientY) })
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    if (drag.isMoving) {
      const { from, to } = dropTarget(drag)
      if (to !== from) onMove(drag.id, shown.length - 1 - to)
    }
    setDrag(null)
  }

  // The line that shows where a dragged layer would go
  function dropLineOf(index: number) {
    if (!drag?.isMoving) return undefined
    const { from, to } = dropTarget(drag)
    if (to === from) return undefined
    if (drag.gap === index) return 'drop-before'
    if (drag.gap === shown.length && index === shown.length - 1) return 'drop-after'
    return undefined
  }

  return (
    <aside className="layers-panel">
      <h2>Layers</h2>
      <div className="layers-actions">
        <button onClick={onAdd}>New layer</button>
        <button onClick={onDelete} disabled={layers.length <= 1} title="Delete the active layer">
          Delete layer
        </button>
        <button onClick={onDuplicate} title="Copy the active layer above it (Ctrl+J)">
          Duplicate
        </button>
        <button
          onClick={onMergeDown}
          disabled={!canMergeDown}
          title="Merge the active layer into the one under it (Ctrl+E). Both must be shown"
        >
          Merge down
        </button>
      </div>
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
            >
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={e => onVisibleChange(layer.id, e.target.checked)}
                aria-label={`Show ${layer.name}`}
                title={layer.visible ? 'Hide' : 'Show'}
              />
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
                  title="Drag to move, double-click to rename"
                  onClick={() => onSelect(layer.id)}
                  onDoubleClick={() => setRenamingId(layer.id)}
                  onPointerDown={e => handlePointerDown(e, layer.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => setDrag(null)}
                >
                  {layer.isSmart && <Box className="smart-icon" size={14} aria-label="Smart object" />}
                  {layer.name}
                </button>
              )}
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
