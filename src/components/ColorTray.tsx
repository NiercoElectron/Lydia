import { useLanguage } from '../i18n'
import { Plus, X } from 'lucide-react'
import { MAX_TRAY_COLORS } from '../engine/projectFile'

type Props = {
  color: string // the brush's color, which + keeps
  general: string[] // the colors for all drawings, kept by the browser
  drawing: string[] // this drawing's own, kept in its file
  onPick: (color: string) => void
  onGeneralChange: (colors: string[]) => void
  onDrawingChange: (colors: string[]) => void
}

// The color tray (decision 66): colors kept on purpose, to pick again quickly, which stay until taken out, unlike the
// colors painted with lately. Floating over the drawing next to the color panel, opened with its button. Two lists:
// one for all drawings, kept by the browser, and one for this drawing, kept in its file
export function ColorTray({ color, general, drawing, onPick, onGeneralChange, onDrawingChange }: Props) {
  const { t } = useLanguage()
  return (
    <aside className="color-tray" aria-label={t('Color tray')}>
      <h2>{t('Color tray')}</h2>
      <ColorList
        title={t('All drawings')}
        hint={t('Kept by this browser, the same in every drawing')}
        colors={general}
        color={color}
        onPick={onPick}
        onChange={onGeneralChange}
      />
      <ColorList
        title={t('This drawing')}
        hint={t('Kept in the drawing, saved with it')}
        colors={drawing}
        color={color}
        onPick={onPick}
        onChange={onDrawingChange}
      />
    </aside>
  )
}

// One list: a click on a color makes it the brush's, × takes it out, and + keeps the brush's color at the end
function ColorList({
  title,
  hint,
  colors,
  color,
  onPick,
  onChange,
}: {
  title: string
  hint: string
  colors: string[]
  color: string
  onPick: (color: string) => void
  onChange: (colors: string[]) => void
}) {
  const { t } = useLanguage()
  const isKept = colors.includes(color)
  const isFull = colors.length >= MAX_TRAY_COLORS
  return (
    <section className="color-list" aria-label={title}>
      <h3 title={hint}>{title}</h3>
      <ul>
        {colors.map(each => (
          <li key={each}>
            <button
              className="tray-color"
              style={{ background: each }}
              aria-pressed={each === color}
              aria-label={each}
              title={each}
              onClick={() => onPick(each)}
            />
            <button
              className="tray-color-remove"
              aria-label={t('Take {color} out', { color: each })}
              title={t('Take it out')}
              onClick={() => onChange(colors.filter(other => other !== each))}
            >
              <X size={10} aria-hidden />
            </button>
          </li>
        ))}
        <li>
          <button
            className="tray-color-add"
            disabled={isKept || isFull}
            aria-label={t('Keep the brush color here')}
            title={isKept ? t('The brush color is already here') : t('Keep the brush color here')}
            onClick={() => onChange([...colors, color])}
          >
            <Plus size={14} aria-hidden />
          </button>
        </li>
      </ul>
    </section>
  )
}
