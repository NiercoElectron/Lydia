import { useLanguage } from '../i18n'
import { Images } from 'lucide-react'
import type { Tool } from '../engine/tools'
import { ALL_TOOLS, TOOLS } from './toolList'

type Props = {
  tool: Tool
  onToolChange: (tool: Tool) => void
  isTrayOpen: boolean
  onTrayToggle: () => void
}

// The tools, in a narrow column at the left edge of the editor, like in Photoshop and Krita. At its foot, the button
// that opens and closes the tray (see TrayPanel)
export function ToolColumn({ tool, onToolChange, isTrayOpen, onTrayToggle }: Props) {
  const { t } = useLanguage()
  return (
    <nav className="tool-column" aria-label={t('Tools')}>
      {ALL_TOOLS.map(each => {
        const { Icon, name, key, also } = TOOLS[each]
        return (
          <button
            key={each}
            aria-pressed={tool === each}
            aria-label={t(name)}
            title={`${t(name)} (${key.toUpperCase()}${also ? `, ${t(also)}` : ''})`}
            onClick={() => onToolChange(each)}
          >
            <Icon size={20} aria-hidden />
          </button>
        )
      })}
      <button
        className="tray-button"
        aria-pressed={isTrayOpen}
        aria-label={t('Tray')}
        title={t('Tray: images to drag onto the drawing')}
        onClick={onTrayToggle}
      >
        <Images size={20} aria-hidden />
      </button>
    </nav>
  )
}
