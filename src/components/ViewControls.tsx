import { useLanguage } from '../i18n'
import { ZoomIn, ZoomOut } from 'lucide-react'
import type { Engine } from '../engine/engine'
import { MAX_ZOOM, MIN_ZOOM } from '../engine/view'
import { useViewState } from './engineHooks'
import { SliderValue } from './SliderValue'

const SLIDER_STEPS = 1000
const ZOOM_STEP = 1.25 // how much a click on a magnifying glass zooms

// The zoom in percent, as people read it: 25, 1600, 3.5
function percent(zoom: number) {
  const value = zoom * 100
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
}

// The slider goes by how many times bigger the zoom gets, so that each part of it does as much
const RANGE = Math.log(MAX_ZOOM / MIN_ZOOM)
const sliderOf = (zoom: number) => Math.round((Math.log(zoom / MIN_ZOOM) / RANGE) * SLIDER_STEPS)
const zoomOf = (slider: number) => MIN_ZOOM * Math.exp((slider / SLIDER_STEPS) * RANGE)

// How the drawing is shown: how far it is turned, which can be typed in, with buttons to turn it straight again, flip it
// like in a mirror and show all of it, and its zoom, which can also be typed in, with a slider
export function ViewControls({ engine }: { engine: Engine | null }) {
  const { t } = useLanguage()
  const view = useViewState(engine)
  return (
    <span className="view-controls">
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
      <button
        className="top-icon"
        aria-label={t('Zoom out')}
        title={t('Zoom out')}
        disabled={!engine}
        onClick={() => engine?.zoomView(view.zoom / ZOOM_STEP)}
      >
        <ZoomOut size={18} aria-hidden />
      </button>
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
      <input
        className="zoom-slider"
        type="range"
        min={0}
        max={SLIDER_STEPS}
        value={sliderOf(view.zoom)}
        disabled={!engine}
        aria-label={t('Zoom')}
        onChange={e => engine?.zoomView(zoomOf(Number(e.target.value)))}
      />
      <button
        className="top-icon"
        aria-label={t('Zoom in')}
        title={t('Zoom in')}
        disabled={!engine}
        onClick={() => engine?.zoomView(view.zoom * ZOOM_STEP)}
      >
        <ZoomIn size={18} aria-hidden />
      </button>
    </span>
  )
}
