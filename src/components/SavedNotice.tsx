import { Check, X } from 'lucide-react'
import { useEffect } from 'react'
import { useLanguage } from '../i18n'

// What was just saved, and when: the same text saved twice in a row shows again, for as long again
export type Saved = { text: string; at: number }

const SHOWN_MS = 6000 // long enough to read a file's name

// A notice at the bottom of the window saying what was saved (a drawing, an image, a brush), which goes away by
// itself (decision 93). It doesn't stop the drawing: the pointer and the keys go on working while it shows
export function SavedNotice({ saved, onDone }: { saved: Saved | null; onDone: () => void }) {
  const { t } = useLanguage()

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(onDone, SHOWN_MS)
    return () => clearTimeout(timer)
  }, [saved, onDone])

  // Always in the page, so screen readers hear each notice put in it
  return (
    <div className="saved-notice" role="status" hidden={!saved}>
      {saved && (
        <>
          <Check size={16} aria-hidden />
          <span>{saved.text}</span>
          <button className="icon-button" aria-label={t('Close')} title={t('Close')} onClick={onDone}>
            <X size={14} aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}
