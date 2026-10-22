import { useEffect, useRef, useState } from 'react'
import type { EngineSnapshot } from '../engine/engine'

type Props = {
  layers: EngineSnapshot['layers'] // from the bottom to the top
  activeLayerId: number
  onAdd: () => void
  onSelect: (id: number) => void
  onVisibleChange: (id: number, visible: boolean) => void
  onOpacityChange: (id: number, opacity: number) => void
}

export function LayersPanel({ layers, activeLayerId, onAdd, onSelect, onVisibleChange, onOpacityChange }: Props) {
  const active = layers.find(layer => layer.id === activeLayerId)

  return (
    <aside className="layers-panel">
      <div className="layers-header">
        <h2>Layers</h2>
        <button onClick={onAdd}>New layer</button>
      </div>
      {active && (
        <OpacitySlider key={active.id} opacity={active.opacity} onChange={value => onOpacityChange(active.id, value)} />
      )}
      {/* Shown from the top to the bottom, like in Photoshop and Krita */}
      <ul className="layers-list">
        {[...layers].reverse().map(layer => (
          <li key={layer.id} className={layer.id === activeLayerId ? 'active' : undefined}>
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={e => onVisibleChange(layer.id, e.target.checked)}
              aria-label={`Show ${layer.name}`}
              title={layer.visible ? 'Hide' : 'Show'}
            />
            <button aria-pressed={layer.id === activeLayerId} onClick={() => onSelect(layer.id)}>
              {layer.name}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

type OpacitySliderProps = {
  opacity: number // from 0 to 1
  onChange: (opacity: number) => void
}

const APPLY_DELAY_MS = 150

// Changing the opacity puts every tile of the layer together again, which takes a moment on a big layer. So the slider
// shows the new value while it is dragged, and the layer changes once the slider stops moving for a moment
function OpacitySlider({ opacity, onChange }: OpacitySliderProps) {
  const [percent, setPercent] = useState(Math.round(opacity * 100))
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), []) // don't apply after the slider is gone

  function handleChange(value: number) {
    setPercent(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(value / 100), APPLY_DELAY_MS)
  }

  return (
    <label className="opacity">
      Opacity
      <input type="range" min={0} max={100} value={percent} onChange={e => handleChange(Number(e.target.value))} />
      {percent}%
    </label>
  )
}
