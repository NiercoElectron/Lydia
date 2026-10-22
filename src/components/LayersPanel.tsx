import { useEffect, useRef } from 'react'
import type { EngineSnapshot } from '../engine/engine'

type Props = {
  layers: EngineSnapshot['layers'] // from the bottom to the top
  activeLayerId: number
  onAdd: () => void
  onSelect: (id: number) => void
  onVisibleChange: (id: number, visible: boolean) => void
  onOpacityChange: (id: number, opacity: number) => void
  onOpacityChangeEnd: () => void
}

export function LayersPanel({
  layers,
  activeLayerId,
  onAdd,
  onSelect,
  onVisibleChange,
  onOpacityChange,
  onOpacityChangeEnd,
}: Props) {
  const active = layers.find(layer => layer.id === activeLayerId)

  return (
    <aside className="layers-panel">
      <div className="layers-header">
        <h2>Layers</h2>
        <button onClick={onAdd}>New layer</button>
      </div>
      {active && (
        <OpacitySlider
          opacity={active.opacity}
          onChange={value => onOpacityChange(active.id, value)}
          onChangeEnd={onOpacityChangeEnd}
        />
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
      {percent}%
    </label>
  )
}
