import type { Tool } from '../engine/tools'
import { ALL_TOOLS, TOOLS } from './toolList'

type Props = {
  tool: Tool
  onToolChange: (tool: Tool) => void
}

// The tools, in a narrow column at the left edge of the editor, like in Photoshop and Krita
export function ToolColumn({ tool, onToolChange }: Props) {
  return (
    <nav className="tool-column" aria-label="Tools">
      {ALL_TOOLS.map(each => {
        const { Icon, name, key, also } = TOOLS[each]
        return (
          <button
            key={each}
            aria-pressed={tool === each}
            aria-label={name}
            title={`${name} (${key.toUpperCase()}${also ? `, ${also}` : ''})`}
            onClick={() => onToolChange(each)}
          >
            <Icon size={20} aria-hidden />
          </button>
        )
      })}
    </nav>
  )
}
