import { useEffect, useCallback } from 'react'
import { useAppStore, type AppSettings } from '@/store/app.store'
import { mergeFormatModelDefaults } from '@/lib/format-models'

export function useSettings(): {
  settings: AppSettings | null
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
  applyTheme: (theme: 'dark' | 'light') => void
} {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const setSelectedScale = useAppStore((s) => s.setSelectedScale)
  const setOutputFormat = useAppStore((s) => s.setOutputFormat)
  const setJpegQuality = useAppStore((s) => s.setJpegQuality)

  const applyTheme = useCallback((theme: 'dark' | 'light') => {
    document.documentElement.classList.toggle('light', theme === 'light')
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [])

  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      setSettings({
        ...s,
        useFormatModelDefaults: !!s.useFormatModelDefaults,
        formatModelDefaults: mergeFormatModelDefaults(s.formatModelDefaults)
      })
      const page = useAppStore.getState().page
      if (page === 'video') {
        setSelectedModel(
          s.lastUsedVideoModel ?? 'realesr-animevideov3',
          s.lastUsedVideoModelPath
        )
      } else {
        setSelectedModel(
          s.lastUsedImageModel ?? s.lastUsedModel,
          s.lastUsedImageModel ? s.lastUsedImageModelPath : s.lastUsedModelPath
        )
      }
      setSelectedScale(page === 'video' ? (s.defaultVideoScale ?? s.defaultScale) : s.defaultScale)
      setOutputFormat(s.defaultOutputFormat)
      setJpegQuality(s.jpegQuality)
      applyTheme(s.theme)
    })
  }, [setSettings, setSelectedModel, setSelectedScale, setOutputFormat, setJpegQuality, applyTheme])

  const saveSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      const updated = await window.electronAPI.saveSettings(partial)
      setSettings({
        ...updated,
        useFormatModelDefaults: !!updated.useFormatModelDefaults,
        formatModelDefaults: mergeFormatModelDefaults(updated.formatModelDefaults)
      })
      if (partial.theme) applyTheme(partial.theme)
      // Keep the visible picker on the current page's model, not the global last-used.
      const touchedPageModel =
        partial.lastUsedModel !== undefined ||
        partial.lastUsedModelPath !== undefined ||
        partial.lastUsedImageModel !== undefined ||
        partial.lastUsedVideoModel !== undefined
      if (touchedPageModel) {
        const page = useAppStore.getState().page
        if (page === 'video') {
          setSelectedModel(
            updated.lastUsedVideoModel ?? 'realesr-animevideov3',
            updated.lastUsedVideoModelPath
          )
        } else {
          setSelectedModel(
            updated.lastUsedImageModel ?? updated.lastUsedModel,
            updated.lastUsedImageModelPath ?? updated.lastUsedModelPath
          )
        }
      }
      if (partial.defaultScale !== undefined || partial.defaultVideoScale !== undefined) {
        const page = useAppStore.getState().page
        setSelectedScale(page === 'video'
          ? (updated.defaultVideoScale ?? updated.defaultScale)
          : updated.defaultScale)
      }
      if (partial.defaultOutputFormat) setOutputFormat(partial.defaultOutputFormat)
      if (partial.jpegQuality) setJpegQuality(partial.jpegQuality)
    },
    [setSettings, applyTheme, setSelectedModel, setSelectedScale, setOutputFormat, setJpegQuality]
  )

  return { settings, saveSettings, applyTheme }
}
