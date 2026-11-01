import { useState } from 'react'
import { useLanguage } from '../i18n'
import { tilesInGigabytes } from '../engine/tiles'
import {
  AUTOSAVE_CHOICES,
  DEFAULT_GPU_MEMORY,
  GPU_MEMORY_CHOICES,
  loadAutosaveMinutes,
  saveAutosaveMinutes,
} from '../settings'
import { ModalWindow } from './ModalWindow'
import { InterfaceSettings } from './SettingsMenu'

type Props = {
  isOpen: boolean
  onClose: () => void
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onGpuMemoryChange: (gigabytes: number) => void
}

// The gear of the start screen: the interface, how often Lydia autosaves, and how much of the graphics card's memory it
// may use, with the warning about that next to the choice
export function SettingsWindow({ isOpen, onClose, gpuMemory, onGpuMemoryChange }: Props) {
  const { t, locale } = useLanguage()
  const [autosaveMinutes, setAutosaveMinutes] = useState(loadAutosaveMinutes)

  return (
    <ModalWindow className="settings-window" title={t('Settings')} isOpen={isOpen} onClose={onClose}>
      <InterfaceSettings />
      <label
        className="theme-choice"
        title={t('How often Lydia keeps a copy of the drawing in this browser, for when it closes without saving')}
      >
        {t('Autosave')}
        <select
          value={autosaveMinutes}
          onChange={e => {
            const minutes = Number(e.target.value)
            setAutosaveMinutes(minutes)
            saveAutosaveMinutes(minutes)
          }}
        >
          {AUTOSAVE_CHOICES.map(minutes => (
            <option key={minutes} value={minutes}>
              {minutes === 0 ? t('Off') : t('Every {minutes} min', { minutes })}
            </option>
          ))}
        </select>
      </label>

      <section className="gpu-memory">
        <h3>{t('Graphics card memory')}</h3>
        <label>
          {t('Memory Lydia may use to keep layers ready')}
          <select value={gpuMemory} onChange={e => onGpuMemoryChange(Number(e.target.value))}>
            {GPU_MEMORY_CHOICES.map(gigabytes => (
              <option key={gigabytes} value={gigabytes}>
                {gigabytes.toLocaleString(locale)} GB ({tilesInGigabytes(gigabytes).toLocaleString(locale)} {t('tiles')}
                {gigabytes === DEFAULT_GPU_MEMORY ? t(', default') : ''})
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          {t('A tile is a square of 256×256 pixels of a layer. A full layer of 10000×10000 has 1,600 tiles.')}
        </p>
        <div className="danger">
          <p className="danger-title">
            <span aria-hidden="true">⚠️</span> {t('Too much can crash Lydia or slow down your whole computer')}
          </p>
          <p>
            {t(
              "Lydia uses this much on top of about 1 GB for the drawing itself. If your graphics card doesn't have that much free memory, the computer starts using its RAM instead and everything becomes very slow, or the browser loses the graphics card: the drawing stops working and changes that weren't saved are lost.",
            )}
          </p>
          <p>
            <strong>{t("Choose at most half of your graphics card's memory.")}</strong>{' '}
            {t(
              'To see it on Windows: Task Manager → Performance → GPU → Dedicated GPU memory. If you are unsure, keep',
            )}{' '}
            {DEFAULT_GPU_MEMORY} GB.
          </p>
        </div>
      </section>
    </ModalWindow>
  )
}
