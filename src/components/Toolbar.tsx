import { useLanguage } from '../i18n'
import { MAX_TAPER, type TaperSettings, type TaperThins } from '../engine/dabs'
import { MAX_FILL_EXPAND, type FillSettings } from '../engine/fill'
import { PIXEL_GRID_ZOOM } from '../engine/pixelGrid'
import type { WandSettings } from '../engine/selection'
import { MAX_STABILIZER, type StabilizerSettings } from '../engine/stabilizer'
import {
  hasStrength,
  isPaintTool,
  LIQUIFY_MODES,
  usesTip,
  type LiquifyMode,
  type Tool,
  type TransformMode,
} from '../engine/tools'
import { WARP_SIDES } from '../engine/warp'
import { AdvancedMenu } from './AdvancedMenu'
import { SliderValue } from './SliderValue'

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 500

// The selection's settings and commands, shown with the selection tools
export type SelectionControls = {
  hasSelection: boolean
  hardEdges: boolean // whether new selections get hard edges (whole pixels) instead of soft ones
  onHardEdgesChange: (hard: boolean) => void
  onSelectAll: () => void
  onDeselect: () => void
  onInvert: () => void
}

// Transforms and smart objects (see smartObject.ts): the transform being made, if any, and whether the active layer is
// a smart object
export type TransformControls = {
  transform: { smooth: boolean; mode: TransformMode; warpSide: number } | null
  isSmartLayer: boolean
  onStart: () => void
  onSmoothChange: (smooth: boolean) => void
  onModeChange: (mode: TransformMode) => void
  onWarpSideChange: (side: number) => void
  onApply: () => void
  onCancel: () => void
  onConvertToPixels: () => void
}

type Props = {
  tool: Tool
  size: number
  opacity: number // in percent
  strength: number // of smudge, blur or liquify, in percent
  liquifyMode: LiquifyMode
  fill: FillSettings
  wand: WandSettings
  selection: SelectionControls
  transform: TransformControls
  stabilizer: StabilizerSettings
  taper: TaperSettings
  isGridOn: boolean
  isOutlineOn: boolean
  isSharpOn: boolean
  isAlphaLocked: boolean // the active layer's transparency is locked: the eraser can't be used
  isFolder: boolean // the active one is a folder, which can't be painted on (see isFolder in layers.ts)
  isPixelBrush: boolean
  isPixelPerfectOn: boolean
  onSizeChange: (size: number) => void
  onOpacityChange: (opacity: number) => void
  onStrengthChange: (strength: number) => void
  onLiquifyModeChange: (mode: LiquifyMode) => void
  onFillChange: (change: Partial<FillSettings>) => void
  onWandChange: (change: Partial<WandSettings>) => void
  onStabilizerChange: (change: Partial<StabilizerSettings>) => void
  onTaperChange: (change: Partial<TaperSettings>) => void
  onGridToggle: () => void
  onOutlineToggle: () => void
  onSharpToggle: () => void
  onPixelPerfectToggle: () => void
}

// The settings of the chosen tool (the color is in the color panel, see ColorPanel.tsx): the brush's size and opacity, with its stabilizer and taper under
// Advanced and, for a pixel brush, Pixel-perfect; the size and strength of smudge, blur or liquify, with the stabilizer
// and liquify's modes; the fill bucket's settings, or the selection's, with the magic wand's. The move tool has none. While a transform is made,
// its own settings instead
export function Toolbar({
  tool,
  size,
  opacity,
  strength,
  liquifyMode,
  fill,
  wand,
  selection,
  transform,
  stabilizer,
  taper,
  isGridOn,
  isOutlineOn,
  isSharpOn,
  isAlphaLocked,
  isFolder,
  isPixelBrush,
  isPixelPerfectOn,
  onSizeChange,
  onOpacityChange,
  onStrengthChange,
  onLiquifyModeChange,
  onFillChange,
  onWandChange,
  onStabilizerChange,
  onTaperChange,
  onGridToggle,
  onOutlineToggle,
  onSharpToggle,
  onPixelPerfectToggle,
}: Props) {
  const { t } = useLanguage()
  const isSelecting = tool === 'select' || tool === 'lasso' || tool === 'wand'
  const isMoving = tool === 'move'
  if (transform.transform) {
    return (
      <div className="toolbar">
        <TransformButtons controls={transform} {...transform.transform} />
        <GridButton isOn={isGridOn} onToggle={onGridToggle} />
      </div>
    )
  }
  const paintsLayer = usesTip(tool) || tool === 'fill'
  const isBlocked = transform.isSmartLayer && paintsLayer
  return (
    <div className="toolbar">
      {tool === 'fill' && <FillControls fill={fill} onFillChange={onFillChange} />}
      {tool === 'wand' && <WandControls wand={wand} onWandChange={onWandChange} />}
      {isSelecting && <SelectionButtons selection={selection} hasEdges={tool !== 'wand'} />}
      {(isSelecting || isMoving) && (
        <button
          onClick={transform.onStart}
          title={t('Scale, turn, skew or distort what is selected, or the layer (Ctrl+T)')}
        >
          {t('Transform')}
        </button>
      )}
      {isBlocked && (
        <>
          <span className="notice">{t("This layer is a smart object: it can't be painted on.")}</span>
          <button onClick={transform.onConvertToPixels} title={t('It keeps its pixels, but no longer its original')}>
            {t('Convert to pixels')}
          </button>
        </>
      )}
      {isFolder && paintsLayer && (
        <span className="notice">{t('This is a folder: choose a layer in it to paint on.')}</span>
      )}
      {tool === 'eraser' && isAlphaLocked && !isBlocked && (
        <span className="notice">{t("This layer's transparency is locked: the eraser can't take paint away.")}</span>
      )}
      {tool === 'liquify' && <LiquifyModes mode={liquifyMode} onChange={onLiquifyModeChange} />}
      {tool !== 'fill' && !isSelecting && !isMoving && (
        <label title={t('Brush size ([ and ])')}>
          {t('Size')}
          <input
            type="range"
            min={MIN_BRUSH_SIZE}
            max={MAX_BRUSH_SIZE}
            value={size}
            onChange={e => onSizeChange(Number(e.target.value))}
          />
          <SliderValue value={size} min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} onChange={onSizeChange} />
        </label>
      )}
      {hasStrength(tool) && (
        <label title={t('How much it moves or softens the paint. With a pen, the pressure changes it too')}>
          {t('Strength')}
          <input
            type="range"
            min={1}
            max={100}
            value={strength}
            onChange={e => onStrengthChange(Number(e.target.value))}
          />
          <SliderValue value={strength} min={1} max={100} unit="%" onChange={onStrengthChange} />
        </label>
      )}
      {!isSelecting && !isMoving && !hasStrength(tool) && (
        <label title={t('How much a stroke or a fill covers, however many times a stroke passes over a place')}>
          {t('Opacity')}
          <input
            type="range"
            min={1}
            max={100}
            value={opacity}
            onChange={e => onOpacityChange(Number(e.target.value))}
          />
          <SliderValue value={opacity} min={1} max={100} unit="%" onChange={onOpacityChange} />
        </label>
      )}
      {usesTip(tool) && (
        <AdvancedMenu>
          <StabilizerControls stabilizer={stabilizer} onChange={onStabilizerChange} />
          {isPaintTool(tool) && <TaperControls taper={taper} onChange={onTaperChange} />}
        </AdvancedMenu>
      )}
      {(tool === 'brush' || tool === 'eraser') && isPixelBrush && (
        <button
          aria-pressed={isPixelPerfectOn}
          onClick={onPixelPerfectToggle}
          title={t('Lines without doubled corners: each step of a line is a single pixel')}
        >
          {t('Pixel-perfect')}
        </button>
      )}
      <GridButton isOn={isGridOn} onToggle={onGridToggle} />
      <SharpButton isOn={isSharpOn} onToggle={onSharpToggle} />
      <OutlineButton isOn={isOutlineOn} onToggle={onOutlineToggle} />
    </div>
  )
}

// What liquify does to the picture (see liquify.ts)
function LiquifyModes({ mode, onChange }: { mode: LiquifyMode; onChange: (mode: LiquifyMode) => void }) {
  const { t } = useLanguage()
  const buttons: Record<LiquifyMode, { label: string; title: string }> = {
    push: { label: t('Push'), title: t('Pushes the picture along the stroke') },
    bloat: { label: t('Bloat'), title: t('Makes the middle of the brush bigger, more the longer it stays') },
    pucker: { label: t('Pucker'), title: t('Makes the middle of the brush smaller, pulling in what is around it') },
    twirl: { label: t('Twirl'), title: t('Turns the picture around the middle of the brush') },
    reconstruct: { label: t('Reconstruct'), title: t('Brushes the picture back to how it was') },
  }
  return (
    <span className="button-group">
      {LIQUIFY_MODES.map(each => (
        <button key={each} aria-pressed={mode === each} onClick={() => onChange(each)} title={buttons[each].title}>
          {buttons[each].label}
        </button>
      ))}
    </span>
  )
}

function FillControls({
  fill,
  onFillChange,
}: {
  fill: FillSettings
  onFillChange: (change: Partial<FillSettings>) => void
}) {
  const { t } = useLanguage()
  return (
    <>
      <label title={t('How far a color can be from the one clicked and still be filled, from 0 to 255')}>
        {t('Tolerance')}
        <input
          type="range"
          min={0}
          max={255}
          value={fill.tolerance}
          onChange={e => onFillChange({ tolerance: Number(e.target.value) })}
        />
        <SliderValue value={fill.tolerance} min={0} max={255} onChange={tolerance => onFillChange({ tolerance })} />
      </label>
      <span className="button-group" title={t('What the fill looks at to find where to stop')}>
        {t('Look at')}
        <button aria-pressed={fill.reference === 'all'} onClick={() => onFillChange({ reference: 'all' })}>
          {t('All layers')}
        </button>
        <button aria-pressed={fill.reference === 'layer'} onClick={() => onFillChange({ reference: 'layer' })}>
          {t('This layer')}
        </button>
      </span>
      <label
        title={t(
          'At most how many pixels the fill goes past its edge, behind the soft edge of the lines around it, up to where they are darkest',
        )}
      >
        {t('Expand')}
        <input
          type="range"
          min={0}
          max={MAX_FILL_EXPAND}
          value={fill.expand}
          onChange={e => onFillChange({ expand: Number(e.target.value) })}
        />
        <SliderValue
          value={fill.expand}
          min={0}
          max={MAX_FILL_EXPAND}
          unit=" px"
          onChange={expand => onFillChange({ expand })}
        />
      </label>
    </>
  )
}

// The magic wand's settings (see selection.ts): like the fill bucket's, and whether it selects only the pixels
// connected to the one clicked
function WandControls({
  wand,
  onWandChange,
}: {
  wand: WandSettings
  onWandChange: (change: Partial<WandSettings>) => void
}) {
  const { t } = useLanguage()
  return (
    <>
      <label title={t('How far a color can be from the one clicked and still be selected, from 0 to 255')}>
        {t('Tolerance')}
        <input
          type="range"
          min={0}
          max={255}
          value={wand.tolerance}
          onChange={e => onWandChange({ tolerance: Number(e.target.value) })}
        />
        <SliderValue value={wand.tolerance} min={0} max={255} onChange={tolerance => onWandChange({ tolerance })} />
      </label>
      <span className="button-group" title={t('What the magic wand looks at to find where to stop')}>
        {t('Look at')}
        <button aria-pressed={wand.reference === 'all'} onClick={() => onWandChange({ reference: 'all' })}>
          {t('All layers')}
        </button>
        <button aria-pressed={wand.reference === 'layer'} onClick={() => onWandChange({ reference: 'layer' })}>
          {t('This layer')}
        </button>
      </span>
      <label
        title={t(
          'At most how many pixels the selection goes past its edge, into the soft edge of the lines around it, up to where they are darkest',
        )}
      >
        {t('Expand')}
        <input
          type="range"
          min={0}
          max={MAX_FILL_EXPAND}
          value={wand.expand}
          onChange={e => onWandChange({ expand: Number(e.target.value) })}
        />
        <SliderValue
          value={wand.expand}
          min={0}
          max={MAX_FILL_EXPAND}
          unit=" px"
          onChange={expand => onWandChange({ expand })}
        />
      </label>
      <button
        aria-pressed={wand.contiguous}
        onClick={() => onWandChange({ contiguous: !wand.contiguous })}
        title={t('Only the pixels connected to the one clicked; off, every pixel of a close color in the drawing')}
      >
        {t('Contiguous')}
      </button>
    </>
  )
}

// The selection's commands, with the edges of new selections for the tools that draw a shape (the magic wand's
// follow the pixels)
function SelectionButtons({ selection, hasEdges }: { selection: SelectionControls; hasEdges: boolean }) {
  const { t } = useLanguage()
  return (
    <>
      {hasEdges && (
        <span className="button-group" title={t('Edges of new selections: soft, or whole pixels for pixel art')}>
          {t('Edges')}
          <button aria-pressed={!selection.hardEdges} onClick={() => selection.onHardEdgesChange(false)}>
            {t('Soft')}
          </button>
          <button aria-pressed={selection.hardEdges} onClick={() => selection.onHardEdgesChange(true)}>
            {t('Hard')}
          </button>
        </span>
      )}
      <button onClick={selection.onSelectAll} title={t('Select everything (Ctrl+A)')}>
        {t('Select all')}
      </button>
      <button onClick={selection.onDeselect} disabled={!selection.hasSelection} title={t('Select nothing (Ctrl+D)')}>
        {t('Deselect')}
      </button>
      <button
        onClick={selection.onInvert}
        title={t("Select what isn't selected, and the other way round (Ctrl+Shift+I)")}
      >
        {t('Invert')}
      </button>
    </>
  )
}

type TransformButtonsProps = NonNullable<TransformControls['transform']> & { controls: TransformControls }

function TransformButtons({ controls, smooth, mode, warpSide }: TransformButtonsProps) {
  const { t } = useLanguage()
  return (
    <>
      <span className="notice">
        {mode === 'mesh'
          ? t('Drag the points to bend it, inside to move it, outside to turn it')
          : t(
              'Drag the corners or the sides to scale (Shift changes the proportions, Alt from the middle), outside to turn, with Ctrl to distort or skew',
            )}
      </span>
      <span className="button-group" title={t('Scale, turn and skew it, or bend it with a mesh of points')}>
        <button aria-pressed={mode === 'free'} onClick={() => controls.onModeChange('free')}>
          {t('Free')}
        </button>
        <button aria-pressed={mode === 'mesh'} onClick={() => controls.onModeChange('mesh')}>
          {t('Mesh')}
        </button>
      </span>
      {mode === 'mesh' && (
        <label title={t('How many points the mesh has each way: fewer bend wide areas, more bend details')}>
          {t('Points')}
          <select value={warpSide} onChange={e => controls.onWarpSideChange(Number(e.target.value))}>
            {WARP_SIDES.map(side => (
              <option key={side} value={side}>
                {side}×{side}
              </option>
            ))}
          </select>
        </label>
      )}
      <span
        className="button-group"
        title={t('How the pixels are worked out: smoothly, or as whole pixels for pixel art')}
      >
        {t('Pixels')}
        <button aria-pressed={smooth} onClick={() => controls.onSmoothChange(true)}>
          {t('Smooth')}
        </button>
        <button aria-pressed={!smooth} onClick={() => controls.onSmoothChange(false)}>
          {t('Whole')}
        </button>
      </span>
      <button onClick={controls.onApply} title={t('Apply (Enter)')}>
        {t('Apply')}
      </button>
      <button onClick={controls.onCancel} title={t('Cancel (Esc)')}>
        {t('Cancel')}
      </button>
    </>
  )
}

// The stabilizer's strength (0 is off) and the way it smooths (see stabilizer.ts). Also used by the Brush Designer
export function StabilizerControls({
  stabilizer,
  onChange,
}: {
  stabilizer: StabilizerSettings
  onChange: (change: Partial<StabilizerSettings>) => void
}) {
  const { t } = useLanguage()
  const { mode, strength } = stabilizer
  return (
    <>
      <label title={t('Smoother strokes: the brush follows the pen instead of being exactly where it is. 0 is off')}>
        {t('Stabilizer')}
        <input
          type="range"
          min={0}
          max={MAX_STABILIZER}
          value={strength}
          onChange={e => onChange({ strength: Number(e.target.value) })}
        />
        <SliderValue value={strength} min={0} max={MAX_STABILIZER} onChange={strength => onChange({ strength })} />
      </label>
      <span className="button-group">
        <button
          aria-pressed={mode === 'smooth'}
          onClick={() => onChange({ mode: 'smooth' })}
          title={t('The brush chases the pen, lagging behind it, and keeps going when the pen holds still')}
        >
          {t('Smooth')}
        </button>
        <button
          aria-pressed={mode === 'string'}
          onClick={() => onChange({ mode: 'string' })}
          title={t(
            'The pen pulls the brush on a string: the brush only moves when the pen goes further than the string',
          )}
        >
          {t('String')}
        </button>
      </span>
    </>
  )
}

const THINS: { value: TaperThins; label: string }[] = [
  { value: 'size', label: 'Size' },
  { value: 'opacity', label: 'Opacity' },
  { value: 'both', label: 'Both' },
]

// How long the stroke's ends thin out (0 is not at all), and what thins (see dabs.ts). Also used by the Brush Designer
export function TaperControls({
  taper,
  onChange,
}: {
  taper: TaperSettings
  onChange: (change: Partial<TaperSettings>) => void
}) {
  const { t } = useLanguage()
  return (
    <>
      <label title={t("Over how many pixels of the paper the stroke's start thins out. 0 is not at all")}>
        {t('Taper start')}
        <input
          type="range"
          min={0}
          max={MAX_TAPER}
          value={taper.start}
          onChange={e => onChange({ start: Number(e.target.value) })}
        />
        <SliderValue value={taper.start} min={0} max={MAX_TAPER} unit=" px" onChange={start => onChange({ start })} />
      </label>
      <label
        title={t(
          "Over how many pixels of the paper the stroke's end thins out, once the pen comes up. 0 is not at all",
        )}
      >
        {t('Taper end')}
        <input
          type="range"
          min={0}
          max={MAX_TAPER}
          value={taper.end}
          onChange={e => onChange({ end: Number(e.target.value) })}
        />
        <SliderValue value={taper.end} min={0} max={MAX_TAPER} unit=" px" onChange={end => onChange({ end })} />
      </label>
      <span className="button-group" title={t("What thins out toward the stroke's ends")}>
        {t('Thins')}
        {THINS.map(({ value, label }) => (
          <button key={value} aria-pressed={taper.thins === value} onClick={() => onChange({ thins: value })}>
            {t(label)}
          </button>
        ))}
      </span>
    </>
  )
}

// Turns the pixel grid on and off. Also used by the Brush Designer
export function GridButton({ isOn, onToggle }: { isOn: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      aria-pressed={isOn}
      onClick={onToggle}
      title={t('Pixel grid, shown from {zoom}% zoom (G)', { zoom: PIXEL_GRID_ZOOM * 100 })}
    >
      {t('Grid')}
    </button>
  )
}

// Shows the pixels as sharp squares at every zoom from 100%, instead of smoothing them. Also used by the Brush Designer
export function SharpButton({ isOn, onToggle }: { isOn: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      aria-pressed={isOn}
      onClick={onToggle}
      title={t('Show the pixels as sharp squares when zoomed in, instead of smoothing them')}
    >
      {t('Sharp')}
    </button>
  )
}

// Shows the outline of the brush's tip under the pointer, or the cursor's cross. Also used by the Brush Designer
export function OutlineButton({ isOn, onToggle }: { isOn: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button aria-pressed={isOn} onClick={onToggle} title={t('The outline of the brush under the pointer')}>
      {t('Outline')}
    </button>
  )
}
