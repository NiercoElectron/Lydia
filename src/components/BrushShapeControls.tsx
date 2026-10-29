import { useLanguage } from '../i18n'
import type { BrushShape, NoiseMode } from '../engine/brushFile'
import { SliderValue } from './SliderValue'

// How the noise can form each copy of the tip (see noiseDabs.ts)
const NOISE_MODES: [NoiseMode, string, string][] = [
  ['mix', 'Mix', 'The noise takes paint away from the tip, softly, following its edge'],
  ['drops', 'Drops', "Whole drops of paint where the tip has paint: the tip's edge never cuts one"],
  ['worn', 'Worn', 'The tip worn away from its edge in: full in the middle, with growing holes toward the edge'],
]

type Props = {
  shape: BrushShape
  onChange: (shape: BrushShape) => void
}

// The settings of a brush, in the Brush Designer. Fractions in the file are shown as percents. A pixel brush's tip is
// never turned and has no noise, so those settings are left out for it
export function BrushShapeControls({ shape, onChange }: Props) {
  const { t } = useLanguage()
  const change = (changes: Partial<BrushShape>) => onChange({ ...shape, ...changes })
  const hasNoise = shape.noiseAmount > 0
  const isPixel = shape.pixel !== 'none'
  return (
    <div className="shape-controls">
      <Slider
        label={t('Spacing')}
        hint={t('The distance between copies of the tip, compared with the brush size')}
        min={1}
        max={300}
        value={percent(shape.spacing)}
        unit="%"
        onChange={value => change({ spacing: value / 100 })}
      />
      {!isPixel && (
        <>
          <Slider
            label={t('Angle')}
            hint={t('How much the tip is turned, clockwise')}
            min={0}
            max={359}
            value={Math.round(shape.angle)}
            unit="°"
            onChange={value => change({ angle: value })}
          />
          <Check
            label={t('Turn with the stroke')}
            checked={shape.followStroke}
            onChange={checked => change({ followStroke: checked })}
          />
          <Slider
            label={t('Random angle')}
            hint={t('Each copy is turned by a random amount: up to a full turn at 100%')}
            min={0}
            max={100}
            value={percent(shape.angleJitter)}
            unit="%"
            onChange={value => change({ angleJitter: value / 100 })}
          />
        </>
      )}
      <Slider
        label={t('Scatter')}
        hint={t('Each copy is moved by a random amount, up to this much of the brush size')}
        min={0}
        max={300}
        step={5}
        value={percent(shape.scatter)}
        unit="%"
        onChange={value => change({ scatter: value / 100 })}
      />
      <Slider
        label={t('Flow')}
        hint={t('How much paint each copy puts down')}
        min={1}
        max={100}
        value={percent(shape.flow)}
        unit="%"
        onChange={value => change({ flow: value / 100 })}
      />
      {!isPixel && (
        <Check
          label={t('Wash')}
          hint={t(
            "The stroke doesn't pile up over itself: each place keeps the most paint one copy gave it, so the texture of the tip shows inside the stroke too",
          )}
          checked={shape.wash}
          onChange={checked => change({ wash: checked })}
        />
      )}
      <Check
        label={t('Pen pressure changes the size')}
        checked={shape.pressureSize}
        onChange={checked => change({ pressureSize: checked })}
      />
      <Check
        label={t('Pen pressure changes the flow')}
        checked={shape.pressureFlow}
        onChange={checked => change({ pressureFlow: checked })}
      />
      {!isPixel && (
        <>
          <h3>{t('Noise')}</h3>
          <Slider
            label={t('Amount')}
            hint={t(
              'How much of the paint the noise decides (with Drops: how many drops there are). At 0% there is no noise',
            )}
            min={0}
            max={100}
            value={percent(shape.noiseAmount)}
            unit="%"
            onChange={value => change({ noiseAmount: value / 100 })}
          />
          <div className="slider-row" title={t('How the noise forms each copy of the tip')}>
            <span>{t('Kind')}</span>
            <span className="button-group">
              {NOISE_MODES.map(([mode, label, hint]) => (
                <button
                  key={mode}
                  title={t(hint ?? '')}
                  aria-pressed={shape.noiseMode === mode}
                  disabled={!hasNoise}
                  onClick={() => change({ noiseMode: mode })}
                >
                  {t(label)}
                </button>
              ))}
            </span>
          </div>
          <Slider
            label={t('Grain')}
            hint={t('How many grains fit across the tip: fewer are bigger')}
            min={1}
            max={64}
            value={shape.noiseGrain}
            unit=""
            disabled={!hasNoise}
            onChange={value => change({ noiseGrain: value })}
          />
          <Slider
            label={t('Layers')}
            hint={t('Layers of finer grains added on top, for a more natural texture (with Drops: rougher edges)')}
            min={1}
            max={4}
            value={shape.noiseLayers}
            unit=""
            disabled={!hasNoise}
            onChange={value => change({ noiseLayers: value })}
          />
          <Slider
            label={t('Stretch')}
            hint={t('How many times longer than tall the grains are: streaks across the tip')}
            min={1}
            max={16}
            value={shape.noiseStretch}
            unit="×"
            disabled={!hasNoise}
            onChange={value => change({ noiseStretch: value })}
          />
          <Slider
            label={t('Contrast')}
            hint={t('Low keeps the noise soft, high turns it into sharp specks')}
            min={10}
            max={1000}
            step={10}
            value={percent(shape.noiseContrast)}
            unit="%"
            disabled={!hasNoise || shape.noiseMode === 'drops'}
            onChange={value => change({ noiseContrast: value / 100 })}
          />
          <Check
            label={t('New noise for each stroke, not each copy')}
            hint={t(
              'The same noise all along a stroke, so its streaks run along it, like bristles (with Wash, they show inside the stroke)',
            )}
            checked={shape.noisePerStroke}
            disabled={!hasNoise}
            onChange={checked => change({ noisePerStroke: checked })}
          />
        </>
      )}
    </div>
  )
}

const percent = (fraction: number) => Math.round(fraction * 100)

type SliderProps = {
  label: string
  hint: string
  min: number
  max: number
  step?: number
  value: number
  unit: string
  disabled?: boolean
  onChange: (value: number) => void
}

function Slider({ label, hint, min, max, step = 1, value, unit, disabled = false, onChange }: SliderProps) {
  const { t } = useLanguage()
  return (
    <label className="slider-row" title={t(hint ?? '')}>
      <span>{t(label)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
      />
      <SliderValue value={value} min={min} max={max} step={step} unit={unit} disabled={disabled} onChange={onChange} />
    </label>
  )
}

type CheckProps = {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

function Check({ label, hint, checked, disabled = false, onChange }: CheckProps) {
  const { t } = useLanguage()
  return (
    <label className="check-row" title={t(hint ?? '')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {t(label)}
    </label>
  )
}
