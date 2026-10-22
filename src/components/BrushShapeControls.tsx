import type { BrushShape } from '../engine/brushFile'

type Props = {
  shape: BrushShape
  onChange: (shape: BrushShape) => void
}

// The settings of a brush, in the Brush Designer. Fractions in the file are shown as percents
export function BrushShapeControls({ shape, onChange }: Props) {
  const change = (changes: Partial<BrushShape>) => onChange({ ...shape, ...changes })
  return (
    <div className="shape-controls">
      <Slider
        label="Spacing"
        hint="The distance between copies of the tip, compared with the brush size"
        min={1}
        max={300}
        value={percent(shape.spacing)}
        unit="%"
        onChange={value => change({ spacing: value / 100 })}
      />
      <Slider
        label="Angle"
        hint="How much the tip is turned, clockwise"
        min={0}
        max={359}
        value={Math.round(shape.angle)}
        unit="°"
        onChange={value => change({ angle: value })}
      />
      <Check
        label="Turn with the stroke"
        checked={shape.followStroke}
        onChange={checked => change({ followStroke: checked })}
      />
      <Slider
        label="Random angle"
        hint="Each copy is turned by a random amount: up to a full turn at 100%"
        min={0}
        max={100}
        value={percent(shape.angleJitter)}
        unit="%"
        onChange={value => change({ angleJitter: value / 100 })}
      />
      <Slider
        label="Scatter"
        hint="Each copy is moved by a random amount, up to this much of the brush size"
        min={0}
        max={300}
        step={5}
        value={percent(shape.scatter)}
        unit="%"
        onChange={value => change({ scatter: value / 100 })}
      />
      <Slider
        label="Flow"
        hint="How much paint each copy puts down"
        min={1}
        max={100}
        value={percent(shape.flow)}
        unit="%"
        onChange={value => change({ flow: value / 100 })}
      />
      <Check
        label="Pen pressure changes the size"
        checked={shape.pressureSize}
        onChange={checked => change({ pressureSize: checked })}
      />
      <Check
        label="Pen pressure changes the flow"
        checked={shape.pressureFlow}
        onChange={checked => change({ pressureFlow: checked })}
      />
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
  onChange: (value: number) => void
}

function Slider({ label, hint, min, max, step = 1, value, unit, onChange }: SliderProps) {
  return (
    <label className="slider-row" title={hint}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span className="slider-value">
        {value}
        {unit}
      </span>
    </label>
  )
}

type CheckProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function Check({ label, checked, onChange }: CheckProps) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
