import type { Engine } from '../engine/engine'
import { useViewState } from './engineHooks'

// The zoom as people read it: 25%, 1600%, 3.5%
function percent(zoom: number) {
  const value = zoom * 100
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}%`
}

// How the drawing is shown: its zoom and rotation, with buttons to turn it straight again, flip it like in a mirror
// and show all of it
export function ViewControls({ engine }: { engine: Engine | null }) {
  const view = useViewState(engine)
  return (
    <span className="view-controls">
      <span className="view-value" title="Zoom (Ctrl + mouse wheel, or the zoom tool: Z)">
        {percent(view.zoom)}
      </span>
      <span className="view-value" title="How far the view is turned (the rotate tool: R, or Shift + Space + drag)">
        {Math.round(view.rotation)}°
      </span>
      <button
        onClick={() => engine?.straightenView()}
        disabled={!engine || view.rotation === 0}
        title="Turn the view straight again"
      >
        Straighten
      </button>
      <button
        aria-pressed={view.flipped}
        onClick={() => engine?.flipView()}
        disabled={!engine}
        title="Flip the view like in a mirror; the drawing itself doesn't change (M)"
      >
        Flip
      </button>
      <button onClick={() => engine?.fitToScreen()} disabled={!engine} title="Show the whole drawing (Ctrl+0)">
        Fit
      </button>
    </span>
  )
}
