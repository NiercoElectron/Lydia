import type { BrushNote } from '../brushLibrary'
import type { LeftOut } from '../engine/foreignBrush'
import { errorMessage, type ImportProblem } from '../errors'
import { useLanguage } from '../i18n'
import { ModalWindow } from './ModalWindow'

type Props = {
  added: number
  notes: BrushNote[]
  problems: ImportProblem[]
  onClose: () => void
}

// What was added from another app's brushes, and what each one had that Lydia doesn't, so a brush that paints differently
// from its original says why
export function BrushImportReport({ added, notes, problems, onClose }: Props) {
  const { t } = useLanguage()
  const names: Record<LeftOut, string> = {
    engine: t('its own way of painting'),
    tipColors: t('the colors of its tip'),
    tipFrames: t('the other pictures of its tip'),
    tipMissing: t('its tip (it is not in the file)'),
    curves: t('its own pressure curves'),
    sensors: t('what changes it besides pressure'),
    secondTip: t('its second tip'),
    texture: t('its texture'),
    effects: t('its way of mixing or effects'),
  }
  return (
    <ModalWindow className="brush-report" title={t('Brushes added')} isOpen onClose={onClose}>
      <p>{t('{count} brushes added.', { count: added })}</p>
      {notes.length > 0 && (
        <>
          <p className="hint">{t('These may paint differently from their original. Left out:')}</p>
          <ul>
            {notes.map(({ name, leftOut }, i) => (
              <li key={i}>
                <strong>{name}:</strong> {leftOut.map(each => names[each]).join(', ')}
              </li>
            ))}
          </ul>
        </>
      )}
      {problems.length > 0 && (
        <>
          <p className="hint">{t('Not added:')}</p>
          <ul>
            {problems.map(({ name, error }, i) => (
              <li key={i}>
                <strong>{name}:</strong> {errorMessage(error, 'LYD-209')}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>{t('Close')}</button>
      </div>
    </ModalWindow>
  )
}
