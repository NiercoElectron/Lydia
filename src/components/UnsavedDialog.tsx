import { useLanguage } from '../i18n'
import { ModalWindow } from './ModalWindow'

export type UnsavedAnswer = 'save' | 'discard' | 'cancel'

type Props = {
  name: string | null // the drawing's file, without its extension; null when it has none yet
  onAnswer: (answer: UnsavedAnswer) => void
}

// The question before a drawing with changes not saved gives way to another drawing or to the start screen, as Photoshop
// asks it: save the changes first, leave them, or stay. Esc and the X stay too
export function UnsavedDialog({ name, onAnswer }: Props) {
  const { t } = useLanguage()
  return (
    <ModalWindow className="unsaved" title={t('Changes not saved')} isOpen onClose={() => onAnswer('cancel')}>
      <p>{name === null ? t('Save the changes to this drawing?') : t('Save the changes to "{name}"?', { name })}</p>
      <p className="hint">{t('If you discard them, the last autosaved copy stays in Recover, on the start screen.')}</p>
      <div className="dialog-actions">
        <button onClick={() => onAnswer('save')}>{t('Save')}</button>
        <button onClick={() => onAnswer('discard')}>{t('Discard')}</button>
        <button onClick={() => onAnswer('cancel')}>{t('Cancel')}</button>
      </div>
    </ModalWindow>
  )
}
