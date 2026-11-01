import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { desktop, type Update } from '../desktop'
import { useLanguage } from '../i18n'

// A new version of the desktop app, in a corner: it never gets in the way of a drawing, and goes away with its ×
export function UpdateNotice() {
  const { t } = useLanguage()
  const [update, setUpdate] = useState<Update | null>(null)
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    desktop?.onUpdate(setUpdate)
    desktop?.takeUpdate().then(found => found && setUpdate(current => current ?? found))
  }, [])

  if (!desktop || !update || isDismissed) return null
  const { version, isReady } = update
  return (
    <aside className="update-notice">
      <p>
        {isReady
          ? t('Lydia {version} is ready. It installs when you close Lydia.', { version })
          : t('Lydia {version} is out.', { version })}
      </p>
      {isReady ? (
        <button onClick={() => desktop!.installUpdate()}>{t('Restart now')}</button>
      ) : (
        <button onClick={() => desktop!.openDownloadPage()}>{t('Download')}</button>
      )}
      <button className="icon-button" aria-label={t('Close')} title={t('Close')} onClick={() => setIsDismissed(true)}>
        <X size={14} aria-hidden />
      </button>
    </aside>
  )
}
