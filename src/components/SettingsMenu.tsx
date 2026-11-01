import { Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { desktop } from '../desktop'
import { useLanguage, type LanguageChoice } from '../i18n'
import { INTERFACE_SIZES, loadInterfaceSize, saveInterfaceSize } from '../settings'
import { setThemeChoice, THEME_CHOICES, useTheme } from '../theme'

// The interface's colors and language, in the editor's gear and in the start screen's
export function InterfaceSettings() {
  const { t, choice, setChoice } = useLanguage()
  const theme = useTheme()
  const [size, setSize] = useState(loadInterfaceSize)

  function chooseSize(chosen: number) {
    setSize(chosen)
    saveInterfaceSize(chosen)
    desktop?.setInterfaceSize(chosen)
  }

  return (
    <>
      <div
        className="button-group theme-choice"
        title={t(
          "The colors of Lydia's buttons and panels (System: as the computer is set). The drawing never changes",
        )}
      >
        {t('Interface')}
        {THEME_CHOICES.map(([value, label]) => (
          <button key={value} aria-pressed={theme.choice === value} onClick={() => setThemeChoice(value)}>
            {t(label)}
          </button>
        ))}
      </div>
      <label className="theme-choice">
        {t('Language')}
        <select value={choice} onChange={e => setChoice(e.target.value as LanguageChoice)}>
          <option value="system">{t('System')}</option>
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </label>
      {desktop && (
        <label className="theme-choice" title={t("How big Lydia's buttons and panels are. The drawing never changes")}>
          {t('Interface size')}
          <select value={size} onChange={e => chooseSize(Number(e.target.value))}>
            {INTERFACE_SIZES.map(each => (
              <option key={each} value={each}>
                {each}%
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}

// The gear on top of the editor
export function SettingsMenu() {
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  return (
    <div ref={boxRef} className="settings-menu">
      <button
        className="top-icon"
        aria-expanded={isOpen}
        aria-label={t('Settings')}
        title={t('Settings')}
        onClick={() => setIsOpen(open => !open)}
      >
        <Settings size={20} aria-hidden />
      </button>
      {isOpen && (
        <div className="settings-panel">
          <InterfaceSettings />
        </div>
      )}
    </div>
  )
}
