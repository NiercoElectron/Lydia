import { useLanguage } from '../i18n'
import type { Engine } from '../engine/engine'
import { MAX_ZOOM, MIN_ZOOM } from '../engine/view'
import { useViewState } from './engineHooks'
import { SliderValue } from './SliderValue'

// The zoom in percent, as people read it: 25, 1600, 3.5
function percent(zoom: number) {
  const value = zoom * 100
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
}

// How the drawing is shown: its zoom and rotation, which can be typed in, with buttons to turn it straight again, flip
// it like in a mirror and show all of it
export function ViewControls({ engine }: { engine: Engine | null }) {
  const { t } = useLanguage()
  const view = useViewState(engine)
  return (
    <span className="view-controls">
      <SliderValue
        value={percent(view.zoom)}
        min={MIN_ZOOM * 100}
        max={MAX_ZOOM * 100}
        step={0}
        unit="%"
        hint={t('Zoom (Ctrl + mouse wheel, or the zoom tool: Z)')}
        disabled={!engine}
        onChange={value => engine?.zoomView(value / 100)}
      />
      <SliderValue
        value={Math.round(view.rotation)}
        min={-360}
        max={360}
        step={0}
        unit="°"
        hint={t('How far the view is turned (the rotate tool: R, or Shift + Space + drag)')}
        disabled={!engine}
        onChange={degrees => engine?.turnView(degrees)}
      />
      <button
        onClick={() => engine?.straightenView()}
        disabled={!engine || view.rotation === 0}
        title={t('Turn the view straight again')}
      >
        {t('Straighten')}
      </button>
      <button
        aria-pressed={view.flipped}
        onClick={() => engine?.flipView()}
        disabled={!engine}
        title={t("Flip the view like in a mirror; the drawing itself doesn't change (M)")}
      >
        {t('Flip')}
      </button>
      <button onClick={() => engine?.fitToScreen()} disabled={!engine} title={t('Show the whole drawing (Ctrl+0)')}>
        {t('Fit')}
      </button>
    </span>
  )
}
