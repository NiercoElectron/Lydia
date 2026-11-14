import { useLanguage } from '../i18n'
import { Blend, Contrast, Droplet, Images, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FilterKind } from '../engine/filters'
import { isBrushMode, type BrushMode, type Tool } from '../engine/tools'
import { TOOL_ROWS, TOOLS } from './toolList'

type Props = {
  tool: Tool
  onToolChange: (tool: Tool) => void
  canFilter: boolean
  onFilter: (kind: FilterKind) => void
  isTrayOpen: boolean
  onTrayToggle: () => void
}

const FILTERS: [FilterKind, string, typeof Blend][] = [
  ['hue', 'Hue and saturation', Blend],
  ['levels', 'Levels', Contrast],
  ['blur', 'Gaussian blur', Droplet],
]

// The tools, each with its name, in a column at the left edge. "Filter" opens the filters in a list beside them. The
// Brush stays chosen in all of its modes (see BRUSH_MODES in tools.ts), and goes back to the last one used. At its foot,
// the button that opens and closes the tray (see TrayPanel)
export function ToolColumn({ tool, onToolChange, canFilter, onFilter, isTrayOpen, onTrayToggle }: Props) {
  const { t } = useLanguage()
  const [openList, setOpenList] = useState<'filter' | null>(null)
  const lastBrushMode = useRef<BrushMode>('brush')

  useEffect(() => {
    if (isBrushMode(tool)) lastBrushMode.current = tool
  }, [tool])

  const toolButton = (each: Tool) => {
    const { Icon, name, key, also } = TOOLS[each]
    const isBrush = each === 'brush'
    return (
      <button
        key={each}
        aria-pressed={isBrush ? isBrushMode(tool) : tool === each}
        aria-label={t(name)}
        title={`${t(name)} (${key.toUpperCase()}${also ? `, ${t(also)}` : ''})`}
        onClick={() => {
          onToolChange(isBrush && !isBrushMode(tool) ? lastBrushMode.current : isBrush ? tool : each)
          setOpenList(null)
        }}
      >
        <Icon size={20} aria-hidden />
        <span>{t(name)}</span>
      </button>
    )
  }

  return (
    <nav className="tool-column" aria-label={t('Tools')}>
      {TOOL_ROWS.map(row => {
        if (row === 'filter') {
          return (
            <div key={row} className="tool-group">
              <button
                aria-expanded={openList === 'filter'}
                aria-label={t('Filter')}
                title={t(
                  'Change the colors of the active layer or blur it. A smart object, a shape or a text is turned into pixels first',
                )}
                onClick={() => setOpenList(open => (open === 'filter' ? null : 'filter'))}
              >
                <Sparkles size={20} aria-hidden />
                <span>{t('Filter')}</span>
              </button>
              <div className={openList === 'filter' ? 'tool-list open' : 'tool-list'}>
                {FILTERS.map(([kind, name, Icon]) => (
                  <button
                    key={kind}
                    aria-label={t(name)}
                    disabled={!canFilter}
                    onClick={() => {
                      onFilter(kind)
                      setOpenList(null)
                    }}
                  >
                    <Icon size={20} aria-hidden />
                    <span>{t(name)}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        }
        return toolButton(row)
      })}
      <button
        className="tray-button"
        aria-pressed={isTrayOpen}
        aria-label={t('Tray')}
        title={t('Tray: images to drag onto the drawing')}
        onClick={onTrayToggle}
      >
        <Images size={20} aria-hidden />
        <span>{t('Tray')}</span>
      </button>
    </nav>
  )
}
