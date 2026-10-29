import { useLanguage } from '../i18n'
import { X } from 'lucide-react'
import { useRef } from 'react'
import { TRAY_DRAG_TYPE, type TrayImage } from '../tray'

type Props = {
  images: TrayImage[]
  onImport: (files: File[]) => void
  onRemove: (image: TrayImage) => void
}

// The tray (see tray.ts), floating over the drawing area while it is open: images to drag onto the drawing
export function TrayPanel({ images, onImport, onRemove }: Props) {
  const { t } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // reset the input so choosing the same file again still triggers onChange
    onImport(files)
  }

  function handleDragStart(e: React.DragEvent, image: TrayImage) {
    e.dataTransfer.setData(TRAY_DRAG_TYPE, String(image.id))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside className="tray-panel" aria-label={t('Tray')}>
      <div className="tray-header">
        <h2>{t('Tray')}</h2>
        <button onClick={() => fileInputRef.current?.click()} title={t('Add images (or drop them on the window)')}>
          {t('Import…')}
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFilesChosen} />
      {images.length === 0 ? (
        <p className="notice">
          {t(
            'Import images, then drag them onto the drawing as often as you like. They stay here while Lydia is open.',
          )}
        </p>
      ) : (
        <ul className="tray-images">
          {images.map(image => (
            <li
              key={image.id}
              draggable
              onDragStart={e => handleDragStart(e, image)}
              title={t('{name} ({width} × {height}): drag it onto the drawing', {
                name: image.name,
                width: image.width,
                height: image.height,
              })}
            >
              <img src={image.thumbnail} alt={image.name} draggable={false} />
              <button
                className="tray-remove"
                onClick={() => onRemove(image)}
                aria-label={t('Take {name} out of the tray', { name: image.name })}
                title={t('Take it out of the tray')}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
