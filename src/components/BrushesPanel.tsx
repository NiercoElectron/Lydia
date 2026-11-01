import { useLanguage } from '../i18n'
import { Search, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BRUSH_FILE_TYPES, categoryOf, tipOf, type LibraryBrush } from '../brushLibrary'
import { BRUSH_CATEGORIES, BRUSH_EXTENSION, type BrushCategory } from '../engine/brushFile'
import {
  loadFavoriteBrushes,
  loadRecentBrushes,
  MAX_RECENT_BRUSHES,
  saveFavoriteBrushes,
  saveRecentBrushes,
} from '../settings'
import { BrushPreview } from './BrushPreview'

type Props = {
  brushes: LibraryBrush[]
  selectedId: string
  onSelect: (brush: LibraryBrush) => void
  onImport: (files: File[]) => void
  onExport: (brush: LibraryBrush) => void
  onDelete: (brush: LibraryBrush) => void
  onClose: () => void
}

type BrushTab = 'all' | 'favorites' | 'recent'

// The brushes, found by their name, by a list (all, the favorite ones, the ones used last) and by their category. Those
// that don't show are only hidden, so each keeps its preview
export function BrushesPanel({ brushes, selectedId, onSelect, onImport, onExport, onDelete, onClose }: Props) {
  const { t } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selected = brushes.find(brush => brush.id === selectedId)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<BrushTab>('all')
  const [category, setCategory] = useState<BrushCategory | null>(null)
  const [favorites, setFavorites] = useState(loadFavoriteBrushes)
  const [recent, setRecent] = useState(loadRecentBrushes)

  const categoryNames: Record<BrushCategory, string> = {
    basic: t('Basic'),
    pen: t('Pen'),
    watercolor: t('Watercolor'),
    artistic: t('Artistic brush'),
    texture: t('Texture'),
    special: t('Special'),
    materials: t('Materials'),
  }
  const tabs: [BrushTab, string][] = [
    ['all', t('All')],
    ['favorites', t('Favorites')],
    ['recent', t('Recent')],
  ]

  // The brush chosen goes to the top of the ones used last
  if (selected && recent[0] !== selected.id) {
    setRecent([selected.id, ...recent.filter(id => id !== selected.id)].slice(0, MAX_RECENT_BRUSHES))
  }
  useEffect(() => saveRecentBrushes(recent), [recent])

  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(each => each !== id) : [...favorites, id]
    setFavorites(next)
    saveFavoriteBrushes(next)
  }

  const nameOf = (brush: LibraryBrush) => (brush.isBuiltIn ? t(brush.preset.name, {}, 'brush') : brush.preset.name)
  const inTab = (brush: LibraryBrush) => tab === 'all' || (tab === 'favorites' ? favorites : recent).includes(brush.id)
  const found = search.trim().toLocaleLowerCase()
  const isShown = (brush: LibraryBrush) =>
    inTab(brush) &&
    (category === null || categoryOf(brush) === category) &&
    nameOf(brush).toLocaleLowerCase().includes(found)

  const counts = useMemo(() => {
    const count = new Map<BrushCategory, number>()
    for (const brush of brushes) count.set(categoryOf(brush), (count.get(categoryOf(brush)) ?? 0) + 1)
    return count
  }, [brushes])

  // The ones used last, in that order
  const listed = tab === 'recent' ? [...brushes].sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)) : brushes

  function handleFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // reset the input so choosing the same file again still triggers onChange
    onImport(files)
  }

  return (
    <aside className="brushes-panel">
      <div className="panel-title">
        <h2>{t('Brushes')}</h2>
        <button className="top-icon" aria-label={t('Close')} title={t('Close')} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <label className="brush-search">
        <Search size={16} aria-hidden />
        <input
          type="text"
          value={search}
          placeholder={t('Search brushes')}
          aria-label={t('Search brushes')}
          onChange={e => setSearch(e.target.value)}
        />
      </label>
      <div className="brush-tabs">
        {tabs.map(([each, name]) => (
          <button key={each} aria-pressed={tab === each} onClick={() => setTab(each)}>
            {name}
          </button>
        ))}
      </div>
      <div className="brushes-columns">
        <div className="brush-categories">
          {BRUSH_CATEGORIES.map(each => (
            <button
              key={each}
              aria-pressed={category === each}
              onClick={() => setCategory(current => (current === each ? null : each))}
            >
              <span>{categoryNames[each]}</span>
              <span className="brush-count">{counts.get(each) ?? 0}</span>
            </button>
          ))}
        </div>
        <ul className="brushes-list">
          {listed.map(brush => (
            <li key={brush.id} hidden={!isShown(brush)}>
              <button
                className="brush"
                aria-pressed={brush.id === selectedId}
                title={nameOf(brush)}
                onClick={() => onSelect(brush)}
              >
                <BrushPreview tip={tipOf(brush)} shape={brush.preset} />
                <span className="brush-name">{nameOf(brush)}</span>
              </button>
              <button
                className="brush-favorite"
                aria-pressed={favorites.includes(brush.id)}
                aria-label={t('Favorite')}
                title={t('Keep it in the favorites')}
                onClick={() => toggleFavorite(brush.id)}
              >
                <Star size={14} aria-hidden fill={favorites.includes(brush.id) ? 'currentColor' : 'none'} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="brushes-actions">
        <button
          onClick={() => fileInputRef.current?.click()}
          title={t('Add brushes from {extension} files (or drop the files on the window)', {
            extension: BRUSH_FILE_TYPES.join(', '),
          })}
        >
          {t('Import…')}
        </button>
        <button
          onClick={() => selected && onExport(selected)}
          disabled={!selected}
          title={t('Save the chosen brush as a {extension} file', { extension: BRUSH_EXTENSION })}
        >
          {t('Export')}
        </button>
        <button
          onClick={() => selected && onDelete(selected)}
          disabled={!selected || selected.isBuiltIn}
          title={t('Delete the chosen brush from Lydia (the brushes that come with Lydia stay)')}
        >
          {t('Delete')}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={BRUSH_FILE_TYPES.join(',')}
        multiple
        hidden
        onChange={handleFilesChosen}
      />
    </aside>
  )
}
