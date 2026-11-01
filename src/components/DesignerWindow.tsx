import { useEffect, useState } from 'react'
import { loadBrushes, tipOf, type LibraryBrush } from '../brushLibrary'
import { DEFAULT_PIXEL_TIP_SIZE, DEFAULT_TIP_SIZE, MAX_TIP_SIZE, PIXEL_TIP_SIZES, TIP_SIZES } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
import { errorMessage } from '../errors'
import { useLanguage } from '../i18n'
import { ModalWindow } from './ModalWindow'

type Props = {
  isOpen: boolean
  onClose: () => void
  onOpenDesigner: (tipSize: number, pixel: boolean, brush?: LibraryBrush) => void
}

// Whether a brush's tip can be edited: the Pixel brush's is worked out for each size, so it has no picture to edit
const hasTipPicture = (brush: LibraryBrush) => brush.preset.pixel !== 'round'

// The smallest paper the Brush Designer offers that a tip fits on
function paperFor(tip: BrushTip, pixel: boolean) {
  const side = Math.max(tip.image.width, tip.image.height)
  return [...(pixel ? PIXEL_TIP_SIZES : []), ...TIP_SIZES].find(paper => paper >= side) ?? MAX_TIP_SIZE
}

// What the Brush Designer starts from, chosen before it opens: a brush to change, or a new one, its kind and its paper
export function DesignerWindow({ isOpen, onClose, onOpenDesigner }: Props) {
  const { t } = useLanguage()
  const [isPixelTip, setIsPixelTip] = useState(false) // the Brush Designer makes a pixel brush
  const [tipSize, setTipSize] = useState(DEFAULT_TIP_SIZE)
  const [brushes, setBrushes] = useState<LibraryBrush[]>([]) // the ones that can be opened in the Brush Designer
  const [startBrushId, setStartBrushId] = useState('') // the one it starts from; '': a new brush

  useEffect(() => {
    let cancelled = false
    loadBrushes().then(
      loaded => {
        if (!cancelled) setBrushes(loaded.filter(hasTipPicture))
      },
      error => console.warn('Could not read the brushes:', error),
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Open the Brush Designer on a new brush, or on the one to start from, on a paper it fits on
  async function handleOpen() {
    const brush = brushes.find(each => each.id === startBrushId)
    if (!brush) {
      onOpenDesigner(tipSize, isPixelTip)
      return
    }
    try {
      const pixel = brush.preset.pixel === 'drawn'
      onOpenDesigner(paperFor(await tipOf(brush), pixel), pixel, brush)
    } catch (error) {
      alert(errorMessage(error, 'LYD-210'))
    }
  }

  return (
    <ModalWindow className="designer-start" title={t('Brush Designer')} isOpen={isOpen} onClose={onClose}>
      <p className="hint">{t('Draw the tip of a new brush, try it, and save it to your brushes or as a file.')}</p>
      <label title={t('A new brush, or one of the brushes, to change it or make another from it')}>
        {t('Start from')}
        <select className="start-brush" value={startBrushId} onChange={e => setStartBrushId(e.target.value)}>
          <option value="">{t('A new brush')}</option>
          {brushes.map(brush => (
            <option key={brush.id} value={brush.id}>
              {brush.isBuiltIn ? t(brush.preset.name, {}, 'brush') : brush.preset.name}
            </option>
          ))}
        </select>
      </label>
      {!startBrushId && (
        <>
          <label>
            {t('Brush')}
            <span className="button-group">
              <button
                aria-pressed={!isPixelTip}
                onClick={() => {
                  setIsPixelTip(false)
                  setTipSize(DEFAULT_TIP_SIZE)
                }}
                title={t('A brush for painting: its tip is resized to any size, smoothly')}
              >
                {t('Smooth')}
              </button>
              <button
                aria-pressed={isPixelTip}
                onClick={() => {
                  setIsPixelTip(true)
                  setTipSize(DEFAULT_PIXEL_TIP_SIZE)
                }}
                title={t('A brush for pixel art: its tip is drawn pixel by pixel, and paints at 1×, 2×, 3×… its size')}
              >
                {t('Pixel')}
              </button>
            </span>
          </label>
          <label>
            {t('Tip paper')}
            <select className="tip-paper" value={tipSize} onChange={e => setTipSize(Number(e.target.value))}>
              {(isPixelTip ? PIXEL_TIP_SIZES : TIP_SIZES).map(tip => (
                <option key={tip} value={tip}>
                  {tip}×{tip}
                  {tip === (isPixelTip ? DEFAULT_PIXEL_TIP_SIZE : DEFAULT_TIP_SIZE) ? t(' (default)') : ''}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>{t('Cancel')}</button>
        <button onClick={() => void handleOpen()}>{t('Open Brush Designer')}</button>
      </div>
    </ModalWindow>
  )
}
