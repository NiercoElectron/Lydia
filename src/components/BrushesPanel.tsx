import { useRef } from 'react'
import { tipOf, type LibraryBrush } from '../brushLibrary'
import { BRUSH_EXTENSION } from '../engine/brushFile'
import { BrushPreview } from './BrushPreview'

type Props = {
  brushes: LibraryBrush[]
  selectedId: string
  onSelect: (brush: LibraryBrush) => void
  onImport: (files: File[]) => void
  onExport: (brush: LibraryBrush) => void
  onDelete: (brush: LibraryBrush) => void
}

export function BrushesPanel({ brushes, selectedId, onSelect, onImport, onExport, onDelete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selected = brushes.find(brush => brush.id === selectedId)

  function handleFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // reset the input so choosing the same file again still triggers onChange
    onImport(files)
  }

  return (
    <aside className="brushes-panel">
      <h2>Brushes</h2>
      <div className="brushes-actions">
        <button
          onClick={() => fileInputRef.current?.click()}
          title={`Add brushes from ${BRUSH_EXTENSION} files (or drop the files on the window)`}
        >
          Import…
        </button>
        <button
          onClick={() => selected && onExport(selected)}
          disabled={!selected}
          title={`Save the chosen brush as a ${BRUSH_EXTENSION} file`}
        >
          Export
        </button>
        <button
          onClick={() => selected && onDelete(selected)}
          disabled={!selected || selected.isBuiltIn}
          title="Delete the chosen brush from Lydia (the brushes that come with Lydia stay)"
        >
          Delete
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept={BRUSH_EXTENSION} multiple hidden onChange={handleFilesChosen} />
      <ul className="brushes-list">
        {brushes.map(brush => (
          <li key={brush.id}>
            <button className="brush" aria-pressed={brush.id === selectedId} onClick={() => onSelect(brush)}>
              <BrushPreview tip={tipOf(brush)} shape={brush.preset} />
              <span className="brush-name">{brush.preset.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
