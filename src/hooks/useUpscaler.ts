import { useCallback, useRef } from 'react'
import { useAppStore } from '@/store/app.store'
import { resolveModelForFile } from '@/lib/format-models'
import { calcEta } from '@/lib/utils'

function resolveUpscaleModel(
  filePath: string,
  selectedModel: string,
  selectedModelPath: string | undefined
): { modelName: string; modelPath?: string } {
  const state = useAppStore.getState()
  const fallbackPath =
    selectedModelPath ??
    state.models.find((m) => m.id === selectedModel && m.modelPath)?.modelPath ??
    state.settings?.lastUsedModelPath

  if (state.settings?.useFormatModelDefaults && state.settings.formatModelDefaults) {
    const choice = resolveModelForFile(filePath, state.settings.formatModelDefaults, {
      modelId: selectedModel,
      modelPath: fallbackPath
    })
    return { modelName: choice.modelId, modelPath: choice.modelPath }
  }

  return { modelName: selectedModel, modelPath: fallbackPath }
}

export function useUpscaler(): {
  upscaleSingle: () => Promise<void>
  startBatch: (inputFolder: string, outputFolder: string) => Promise<{ success: number; failed: number }>
  pauseBatch: () => void
  resumeBatch: () => void
  cancelBatch: () => void
  getEta: () => number
} {
  const startTimeRef = useRef<number>(0)
  const {
    selectedModel,
    selectedModelPath,
    selectedScale,
    outputFormat,
    jpegQuality,
    settings,
    setProcessing,
    setProgress,
    setOutputFile,
    setBatchStatus,
    setBatchOverallPercent,
    setBatchDoneCount,
    updateBatchFile
  } = useAppStore()

  const getEta = useCallback(() => {
    const progress = useAppStore.getState().progress
    return calcEta(startTimeRef.current, progress / 100)
  }, [])

  const upscaleSingle = useCallback(async () => {
    const state = useAppStore.getState()
    if (!state.inputFile) return

    const { modelName, modelPath } = resolveUpscaleModel(
      state.inputFile.path,
      state.selectedModel,
      state.selectedModelPath
    )

    let resolvedOutput = state.outputPath
    if (!resolvedOutput) {
      const dir = state.inputFile.path.replace(/[/\\][^/\\]+$/, '')
      resolvedOutput = await window.electronAPI.buildOutputPath(
        state.inputFile.path,
        dir,
        state.selectedScale,
        modelName,
        state.outputFormat,
        state.settings?.outputNamingPattern
      )
      useAppStore.getState().setOutputPath(resolvedOutput)
    }

    if (
      state.inputFile.path.replace(/\\/g, '/').toLowerCase() ===
      resolvedOutput.replace(/\\/g, '/').toLowerCase()
    ) {
      const dir = state.inputFile.path.replace(/[/\\][^/\\]+$/, '')
      resolvedOutput = await window.electronAPI.buildOutputPath(
        state.inputFile.path,
        dir,
        state.selectedScale,
        modelName,
        state.outputFormat,
        state.settings?.outputNamingPattern
      )
      useAppStore.getState().setOutputPath(resolvedOutput)
    }

    setProcessing(true)
    setProgress(0, 'Starting...')
    startTimeRef.current = Date.now()

    window.electronAPI.onProgress((data) => {
      setProgress(data.percent, data.message)
    })

    try {
      const result = await window.electronAPI.upscaleSingle({
        inputPath: state.inputFile.path,
        outputPath: resolvedOutput,
        modelName,
        modelPath,
        scale: state.selectedScale,
        gpuIndex: state.settings?.gpuIndex ?? 0,
        tileSize: state.settings?.tileSize ?? 0,
        threads: state.settings?.threads ?? '1:2:2',
        outputFormat: state.outputFormat,
        jpegQuality: state.jpegQuality
      })

      const previewUrl = await window.electronAPI.getImageUrl(result.outputPath)
      setOutputFile({
        path: result.outputPath,
        width: result.width,
        height: result.height,
        size: 0,
        format: state.outputFormat,
        previewUrl
      })
      useAppStore.getState().setOutputPath(result.outputPath)
    } finally {
      window.electronAPI.offProgress()
      setProcessing(false)
    }
  }, [setProcessing, setProgress, setOutputFile])

  const startBatch = useCallback(
    async (inputFolder: string, outputFolder: string) => {
      const selected = useAppStore.getState().batchFiles.filter((f) => f.selected)
      if (selected.length === 0) return { success: 0, failed: 0 }

      const runPaths = selected.map((f) => f.path)

      setBatchStatus('running')
      setBatchDoneCount(0)
      setBatchOverallPercent(0)

      let lastUiUpdate = 0
      let lastPercent = -1

      window.electronAPI.onBatchProgress((data) => {
        const now = Date.now()
        const statusChanged = data.status !== 'processing'
        const percentJump = Math.abs(data.filePercent - lastPercent) >= 2
        const timeOk = now - lastUiUpdate >= 100

        if (statusChanged || percentJump || timeOk || data.filePercent >= 100) {
          lastUiUpdate = now
          lastPercent = data.filePercent
          const path = runPaths[data.fileIndex]
          const target = useAppStore.getState().batchFiles.find((f) => f.path === path)
          if (target) {
            updateBatchFile(target.index, {
              filePercent: data.filePercent,
              status: data.status,
              error: data.error
            })
          }
          setBatchOverallPercent(data.overallPercent)
          if (data.status === 'done') {
            const done = useAppStore.getState().batchFiles.filter((f) => f.status === 'done').length
            setBatchDoneCount(done)
          }
        }
      })

      try {
        const state = useAppStore.getState()
        const { modelName, modelPath } = resolveUpscaleModel(
          runPaths[0] ?? '',
          selectedModel,
          selectedModelPath
        )

        const result = await window.electronAPI.upscaleBatch({
          inputFolder,
          outputFolder,
          files: runPaths,
          modelName,
          modelPath,
          scale: selectedScale,
          gpuIndex: settings?.gpuIndex ?? 0,
          tileSize: settings?.tileSize ?? 0,
          threads: settings?.threads ?? '1:2:2',
          outputFormat,
          jpegQuality,
          namingPattern: settings?.outputNamingPattern ?? '{filename}_upscaled_{scale}x',
          useFormatModelDefaults: !!state.settings?.useFormatModelDefaults,
          formatModelDefaults: state.settings?.formatModelDefaults
        })
        setBatchStatus('done')
        return result
      } catch {
        setBatchStatus('idle')
        return { success: 0, failed: 0 }
      } finally {
        window.electronAPI.offBatchProgress()
      }
    },
    [
      selectedModel,
      selectedModelPath,
      selectedScale,
      outputFormat,
      jpegQuality,
      settings,
      setBatchStatus,
      setBatchDoneCount,
      setBatchOverallPercent,
      updateBatchFile
    ]
  )

  return {
    upscaleSingle,
    startBatch,
    pauseBatch: () => {
      useAppStore.getState().setBatchStatus('paused')
      void window.electronAPI.pauseBatch()
    },
    resumeBatch: () => {
      useAppStore.getState().setBatchStatus('running')
      void window.electronAPI.resumeBatch()
    },
    cancelBatch: () => {
      useAppStore.getState().setBatchStatus('idle')
      void window.electronAPI.cancelBatch()
    },
    getEta
  }
}
