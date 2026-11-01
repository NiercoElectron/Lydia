import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useLanguage } from '../i18n'

type Props = {
  title: string
  className: string
  isOpen: boolean
  onClose: () => void
  children: ReactNode
}

// A window over the page, with its title and an X. Esc closes it too. It is always on the page, only closed, like the
// items of a menu, so what is chosen in it stays while it is closed
export function ModalWindow({ title, className, isOpen, onClose, children }: Props) {
  const { t } = useLanguage()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current!
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
  }, [isOpen])

  return (
    <dialog ref={dialogRef} className={`window ${className}`} onClose={onClose}>
      <div className="window-title">
        <h2>{title}</h2>
        <button className="top-icon" aria-label={t('Close')} title={t('Close')} onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
      </div>
      {children}
    </dialog>
  )
}
