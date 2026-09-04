import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useAppStore, type ModelInfo } from '@/store/app.store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { resolveModelForFile } from '@/lib/format-models'
import { findModel, parseSelectValue, toSelectValue } from '@/lib/model-select'

const CUSTOM_FILE_OPTION = '__custom_file__'
const CUSTOM_FOLDER_OPTION = '__custom_folder__'
const MANAGE_CUSTOM_OPTION = '__manage_custom__'
const FALLBACK_MODEL_ID = 'realesrgan-x4plus'

async function refreshModels(): Promise<ModelInfo[]> {
  const updated = await window.electronAPI.getAvailableModels()
  useAppStore.getState().setModels(updated)
  return updated
}

async function persistSelectedModel(id: string, modelPath?: string): Promise<void> {
  const page = useAppStore.getState().page
  const payload: {
    lastUsedModel: string
    lastUsedModelPath?: string
    lastUsedImageModel?: string
    lastUsedImageModelPath?: string
    lastUsedVideoModel?: string
    lastUsedVideoModelPath?: string
  } = {
    lastUsedModel: id,
    lastUsedModelPath: modelPath
  }
  if (page === 'image') {
    payload.lastUsedImageModel = id
    payload.lastUsedImageModelPath = modelPath
  } else if (page === 'video') {
    payload.lastUsedVideoModel = id
    payload.lastUsedVideoModelPath = modelPath
  }
  const updated = await window.electronAPI.saveSettings(payload)
  useAppStore.getState().setSettings(updated)
}

/** If a custom model is selected without a path, recover it from settings or the models list. */
function reconcileSelectedModelPath(models: ModelInfo[]): void {
  const state = useAppStore.getState()
  if (state.selectedModelPath) return

  const savedPath =
    state.page === 'video'
      ? state.settings?.lastUsedVideoModelPath ?? state.settings?.lastUsedModelPath
      : state.settings?.lastUsedImageModelPath ?? state.settings?.lastUsedModelPath
  if (savedPath) {
    const match = findModel(models, state.selectedModel, savedPath)
    if (match?.modelPath) {
      state.setSelectedModel(state.selectedModel, match.modelPath)
      return
    }
  }

  const custom = models.find((m) => m.id === state.selectedModel && m.modelPath)
  if (custom?.modelPath) {
    state.setSelectedModel(state.selectedModel, custom.modelPath)
  }
}

interface ModelSelectorProps {
  /** Optional active file path (e.g. video page). Falls back to store input/batch file. */
  activeFilePath?: string
}

export function ModelSelector({ activeFilePath }: ModelSelectorProps): JSX.Element {
  const models = useAppStore((s) => s.models)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const selectedModelPath = useAppStore((s) => s.selectedModelPath)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const settings = useAppStore((s) => s.settings)
  const inputFile = useAppStore((s) => s.inputFile)
  const batchFiles = useAppStore((s) => s.batchFiles)
  const batchStatus = useAppStore((s) => s.batchStatus)

  const [manageOpen, setManageOpen] = useState(false)

  const locked = !!settings?.useFormatModelDefaults
  const customModels = models.filter((m) => m.isCustom)
  const selectedIsCustom = models.some(
    (m) =>
      m.isCustom &&
      m.id === selectedModel &&
      (m.modelPath ?? '') === (selectedModelPath ?? '')
  )

  const resolvedActivePath =
    activeFilePath ||
    ((batchStatus === 'running' || batchStatus === 'paused'
      ? batchFiles.find((f) => f.status === 'processing')?.path
      : undefined) ??
      inputFile?.path)

  useEffect(() => {
    void refreshModels().then((updated) => {
      reconcileSelectedModelPath(updated)
    })
  }, [])

  // When format defaults are on, keep the visible selection in sync with the active file.
  useEffect(() => {
    if (!locked || !resolvedActivePath || !settings?.formatModelDefaults) return
    const choice = resolveModelForFile(resolvedActivePath, settings.formatModelDefaults, {
      modelId: selectedModel,
      modelPath: selectedModelPath
    })
    if (choice.modelId !== selectedModel || choice.modelPath !== selectedModelPath) {
      setSelectedModel(choice.modelId, choice.modelPath)
    }
  }, [
    locked,
    resolvedActivePath,
    settings?.formatModelDefaults,
    selectedModel,
    selectedModelPath,
    setSelectedModel
  ])

  const selectFallbackModel = async (remaining: ModelInfo[]): Promise<void> => {
    const fallback =
      remaining.find((m) => m.id === FALLBACK_MODEL_ID && !m.isCustom) ??
      remaining.find((m) => !m.isCustom) ??
      remaining[0]
    if (fallback) {
      setSelectedModel(fallback.id, fallback.modelPath)
      await persistSelectedModel(fallback.id, fallback.modelPath)
    } else {
      setSelectedModel(FALLBACK_MODEL_ID, undefined)
      await persistSelectedModel(FALLBACK_MODEL_ID, undefined)
    }
  }

  const removeCustom = async (id: string, modelPath: string): Promise<void> => {
    try {
      await window.electronAPI.removeCustomModel(id, modelPath)
      const updated = await refreshModels()
      const stillSelected =
        selectedModel === id && (selectedModelPath ?? '') === (modelPath ?? '')
      if (stillSelected) {
        await selectFallbackModel(updated)
      }
      toast({ title: 'Custom model removed', description: id })
    } catch (err) {
      toast({
        title: 'Remove failed',
        description: (err as Error).message,
        variant: 'destructive' as never
      })
    }
  }

  const handleChange = async (value: string): Promise<void> => {
    if (locked) return

    if (value === MANAGE_CUSTOM_OPTION) {
      setManageOpen(true)
      return
    }

    if (value === CUSTOM_FILE_OPTION) {
      try {
        const custom = await window.electronAPI.loadCustomModel()
        if (custom) {
          await refreshModels()
          setSelectedModel(custom.id, custom.modelPath)
          await persistSelectedModel(custom.id, custom.modelPath)
          toast({ title: 'Custom model loaded', description: custom.label })
        }
      } catch (err) {
        toast({
          title: 'Model load failed',
          description: (err as Error).message,
          variant: 'destructive' as never
        })
      }
      return
    }

    if (value === CUSTOM_FOLDER_OPTION) {
      try {
        const result = await window.electronAPI.loadCustomModelFolder()
        if (result) {
          await refreshModels()
          const first = result.models[0]
          setSelectedModel(first.id, first.modelPath)
          await persistSelectedModel(first.id, first.modelPath)
          toast({
            title: 'Models loaded from folder',
            description: `${result.imported} model${result.imported === 1 ? '' : 's'} from ${result.folderPath.split(/[/\\]/).pop()}`
          })
        }
      } catch (err) {
        toast({
          title: 'Folder load failed',
          description: (err as Error).message,
          variant: 'destructive' as never
        })
      }
      return
    }

    const { id, modelPath } = parseSelectValue(value)
    const model = findModel(models, id, modelPath)
    const resolvedPath = model?.modelPath ?? modelPath
    setSelectedModel(id, resolvedPath)
    await persistSelectedModel(id, resolvedPath)
  }

  const selectValue = toSelectValue(selectedModel, selectedModelPath)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-[var(--text-muted)]">
        {locked ? 'Model (by file format)' : 'Model'}
      </label>
      <div className="flex items-center gap-1.5">
        <Select value={selectValue} onValueChange={handleChange} disabled={locked}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={toSelectValue(m.id, m.modelPath)} value={toSelectValue(m.id, m.modelPath)}>
                {m.isCustom ? `${m.label} (custom)` : m.label}
              </SelectItem>
            ))}
            {!locked && (
              <>
                <SelectItem value={CUSTOM_FILE_OPTION}>Load custom model file…</SelectItem>
                <SelectItem value={CUSTOM_FOLDER_OPTION}>Browse model folder…</SelectItem>
                {customModels.length > 0 && (
                  <SelectItem value={MANAGE_CUSTOM_OPTION}>Manage custom models…</SelectItem>
                )}
              </>
            )}
          </SelectContent>
        </Select>
        {!locked && selectedIsCustom && selectedModelPath && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 text-[var(--text-muted)] hover:text-[var(--error)]"
            title="Remove this custom model"
            onClick={() => void removeCustom(selectedModel, selectedModelPath)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {locked && (
        <p className="text-[11px] text-[var(--text-muted)] max-w-[260px]">
          Controlled by Settings → Default model for file formats
        </p>
      )}

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Custom models</DialogTitle>
            <DialogDescription>
              Remove models you loaded from files or folders. Built-in models are not listed here.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-2 py-1">
            {customModels.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">No custom models loaded</p>
            ) : (
              customModels.map((m) => (
                <div
                  key={toSelectValue(m.id, m.modelPath)}
                  className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{m.label}</p>
                    <p className="text-[11px] text-[var(--text-muted)] font-mono-path truncate" title={m.modelPath}>
                      {m.modelPath}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0 text-[var(--error)] hover:text-[var(--error)]"
                    onClick={() => {
                      if (!m.modelPath) return
                      void removeCustom(m.id, m.modelPath)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManageOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
