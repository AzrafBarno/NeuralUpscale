import { useCallback, useEffect, useRef, useState } from 'react'
import { Film, FolderOpen, Layers, Play, Sparkles, Upload, X } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import { ModelSelector } from '@/components/ModelSelector'
import { ScaleSelector } from '@/components/ScaleSelector'
import { VideoBeforeAfterPreview } from '@/components/VideoBeforeAfterPreview'
import {
  VideoBatchFileList,
  type BatchViewMode,
  type VideoBatchItem
} from '@/components/VideoBatchFileList'
import { BatchProgressOverlay } from '@/components/BatchProgressOverlay'
import { GstSetupOverlay } from '@/components/GstSetupOverlay'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { ToastAction as ToastActionEl } from '@/components/Toaster'
import {
  buildVideoComboBatchOutputDir,
  cn,
  formatBytes,
  isVideoComboBatchOutputDir,
  resolveVideoComboTargetFps
} from '@/lib/utils'
import { resolveModelForFile } from '@/lib/format-models'
import { playCompletionSound } from '@/lib/sfx'
import type { GstStatus, VideoInfo } from '@/types/electron'

const WITH_INTERP_KEY = 'neuralupscale-video-with-interp'
const BATCH_MODE_KEY = 'neuralupscale-video-batch-mode'
const VIEW_STORAGE_KEY = 'neuralupscale-video-batch-view'

function loadViewMode(): BatchViewMode {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'list' || saved === 'compact' || saved === 'tiles') return saved
  } catch {
    // ignore
  }
  return 'compact'
}

function loadWithInterp(): boolean {
  try {
    return localStorage.getItem(WITH_INTERP_KEY) === '1'
  } catch {
    return false
  }
}

function loadBatchMode(): boolean {
  try {
    return localStorage.getItem(BATCH_MODE_KEY) === '1'
  } catch {
    return false
  }
}

function buildVideoOutputName(filePath: string, scale: number, withInterp: boolean): string {
  const base = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'video'
  const tag = withInterp ? `upscaled_${scale}x_interp` : `upscaled_${scale}x`
  return `${base}_${tag}.mp4`
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return `${dir.replace(/[/\\]$/, '')}${sep}${name}`
}

function firstBatchSourceFps(files: VideoBatchItem[]): number | undefined {
  return (
    files.find((f) => f.selected && f.fps && f.fps > 0)?.fps ??
    files.find((f) => f.fps && f.fps > 0)?.fps
  )
}

export function VideoUpscalePage(): JSX.Element {
  const {
    selectedScale,
    selectedModel,
    selectedModelPath,
    settings,
    setSettings
  } = useAppStore()

  const [batchMode, setBatchMode] = useState(loadBatchMode)
  const [viewMode, setViewMode] = useState<BatchViewMode>(loadViewMode)
  const [inputPath, setInputPath] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [outputUrl, setOutputUrl] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [withInterpolation, setWithInterpolation] = useState(loadWithInterp)
  const [rifeReady, setRifeReady] = useState(true)
  const [gstStatus, setGstStatus] = useState<GstStatus | null>(null)
  const [gstSetup, setGstSetup] = useState(false)
  const [gstPercent, setGstPercent] = useState(0)
  const [gstMessage, setGstMessage] = useState('')

  const [inputFolder, setInputFolder] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [batchFiles, setBatchFiles] = useState<VideoBatchItem[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchDone, setBatchDone] = useState(0)
  const [batchTotal, setBatchTotal] = useState(0)
  const [activeBatchPath, setActiveBatchPath] = useState('')
  const cancelBatchRef = useRef(false)

  const busy = isProcessing || batchRunning || gstSetup
  const selectedCount = batchFiles.filter((f) => f.selected).length
  const fileCount = batchFiles.length

  useEffect(() => {
    void window.electronAPI.checkRifeExists().then(setRifeReady)
  }, [])

  const refreshGstStatus = useCallback(async (): Promise<void> => {
    const status = await window.electronAPI.getGstStatus({
      modelName: selectedModel,
      scale: selectedScale,
      modelPath: selectedModelPath
    })
    setGstStatus(status)
  }, [selectedModel, selectedScale, selectedModelPath])

  useEffect(() => {
    void refreshGstStatus()
  }, [refreshGstStatus, settings?.greenSparkleEnabled])

  const refreshSettings = useCallback(async (): Promise<void> => {
    const next = await window.electronAPI.getSettings()
    setSettings(next)
  }, [setSettings])

  const setWithInterpPersisted = (on: boolean): void => {
    setWithInterpolation(on)
    try {
      localStorage.setItem(WITH_INTERP_KEY, on ? '1' : '0')
    } catch {
      // ignore
    }
  }

  const handleGstToggle = async (on: boolean): Promise<void> => {
    if (busy) return
    if (!on) {
      await window.electronAPI.disableGst()
      await refreshSettings()
      await refreshGstStatus()
      return
    }
    if (!gstStatus?.platformSupported) {
      toast({
        title: 'NVIDIA GPU required',
        description:
          gstStatus?.message ||
          'Green Sparkle Technology is NVIDIA-only. Video upscale stays on Vulkan.',
        variant: 'destructive' as never
      })
      return
    }
    if (!gstStatus.modelSupported) {
      toast({
        title: 'Model not supported',
        description:
          'Green Sparkle Technology needs a Real-ESRGAN family model (Anime Video, x4plus, etc.). This model stays on Vulkan.',
        variant: 'destructive' as never
      })
      return
    }

    setGstSetup(true)
    setGstPercent(1)
    setGstMessage('Starting TensorRT setup…')
    window.electronAPI.onGstProgress((ev) => {
      setGstPercent(ev.percent)
      setGstMessage(ev.message)
    })
    try {
      await window.electronAPI.enableGst({
        modelName: selectedModel,
        scale: selectedScale,
        modelPath: selectedModelPath
      })
      await refreshSettings()
      await refreshGstStatus()
      toast({
        title: 'Green Sparkle Technology ready',
        description: 'Video upscale will use TensorRT on this GPU.'
      })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('__CANCELLED__')) {
        toast({ title: 'Cancelled', description: 'TensorRT setup was cancelled.' })
      } else {
        toast({
          title: 'Green Sparkle setup failed',
          description: msg,
          variant: 'destructive' as never
        })
      }
    } finally {
      window.electronAPI.offGstProgress()
      setGstSetup(false)
      setGstPercent(0)
      setGstMessage('')
    }
  }

  const setBatchModePersisted = (on: boolean): void => {
    setBatchMode(on)
    try {
      localStorage.setItem(BATCH_MODE_KEY, on ? '1' : '0')
    } catch {
      // ignore
    }
  }

  const suggestOutputPath = useCallback(
    (filePath: string) => {
      const dir = filePath.replace(/[/\\][^/\\]+$/, '')
      setOutputPath(joinPath(dir, buildVideoOutputName(filePath, selectedScale, withInterpolation)))
      setOutputUrl('')
    },
    [selectedScale, withInterpolation]
  )

  useEffect(() => {
    if (!batchMode && inputPath) suggestOutputPath(inputPath)
  }, [batchMode, inputPath, selectedScale, withInterpolation, suggestOutputPath])

  const comboSourceFps = firstBatchSourceFps(batchFiles)

  const defaultComboOutputFolder = useCallback(
    (folder: string, sourceFps?: number) =>
      buildVideoComboBatchOutputDir(
        folder,
        selectedModel,
        selectedScale,
        resolveVideoComboTargetFps(settings, sourceFps)
      ),
    [selectedModel, selectedScale, settings]
  )

  // Keep auto combo output folder in sync with model/scale/fps unless the user picked a custom path
  useEffect(() => {
    if (!batchMode || !inputFolder) return
    setOutputFolder((current) => {
      if (!withInterpolation) {
        if (
          !current ||
          current === inputFolder ||
          isVideoComboBatchOutputDir(current, inputFolder)
        ) {
          return inputFolder
        }
        return current
      }
      if (
        current &&
        current !== inputFolder &&
        !isVideoComboBatchOutputDir(current, inputFolder)
      ) {
        return current
      }
      return defaultComboOutputFolder(inputFolder, comboSourceFps)
    })
  }, [
    batchMode,
    inputFolder,
    withInterpolation,
    comboSourceFps,
    defaultComboOutputFolder
  ])

  const loadVideo = useCallback(
    async (filePath: string) => {
      if (!/\.mp4$/i.test(filePath)) {
        toast({
          title: 'Unsupported file',
          description: 'Please select an MP4 video.',
          variant: 'destructive' as never
        })
        return
      }
      const info = await window.electronAPI.getVideoInfo(filePath)
      const url = await window.electronAPI.getImageUrl(filePath)
      setInputPath(filePath)
      setInputUrl(url)
      setVideoInfo(info)
      setOutputUrl('')
      suggestOutputPath(filePath)
    },
    [suggestOutputPath]
  )

  const clearVideo = (): void => {
    if (busy) return
    setInputPath('')
    setInputUrl('')
    setOutputPath('')
    setOutputUrl('')
    setVideoInfo(null)
    setProgress(0)
    setProgressMessage('')
  }

  const resetBatchFolders = (): void => {
    setInputFolder('')
    setOutputFolder('')
  }

  const clearBatch = (): void => {
    if (busy) return
    setBatchFiles([])
    resetBatchFolders()
    setBatchDone(0)
    setBatchTotal(0)
  }

  const scanFolder = useCallback(async (folder: string) => {
    const paths = await window.electronAPI.scanVideoFolder(folder)

    const applyFolders = (items: VideoBatchItem[]): void => {
      setInputFolder(folder)
      setOutputFolder(
        withInterpolation
          ? defaultComboOutputFolder(folder, firstBatchSourceFps(items))
          : folder
      )
    }

    if (paths.length === 0) {
      toast({
        title: 'No MP4 files found',
        description: 'Drop a folder that contains .mp4 files.',
        variant: 'destructive' as never
      })
      setBatchFiles([])
      applyFolders([])
      return
    }

    const items: VideoBatchItem[] = []
    for (const p of paths) {
      try {
        const info = await window.electronAPI.getVideoInfo(p)
        items.push({
          path: p,
          size: info.size,
          fps: info.fps,
          status: 'queued',
          selected: true
        })
      } catch {
        items.push({
          path: p,
          size: 0,
          status: 'queued',
          selected: true
        })
      }
    }

    setBatchFiles(items)
    applyFolders(items)
    toast({
      title: 'Folder scanned',
      description: `${items.length} video${items.length === 1 ? '' : 's'} ready`
    })
  }, [withInterpolation, defaultComboOutputFolder])

  const toggleBatchMode = (): void => {
    if (busy) return
    const next = !batchMode
    setBatchModePersisted(next)
    if (next) {
      clearVideo()
    } else {
      setBatchFiles([])
      resetBatchFolders()
    }
  }

  const handleBrowse = async (): Promise<void> => {
    if (busy) return
    if (batchMode) {
      const folder = await window.electronAPI.openFolderDialog()
      if (folder) await scanFolder(folder)
    } else {
      const path = await window.electronAPI.openVideoDialog()
      if (path) await loadVideo(path)
    }
  }

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    if (busy) return

    const file = e.dataTransfer.files[0] as File & { path?: string }
    const droppedPath = file?.path
    if (!droppedPath) return

    if (batchMode) {
      try {
        await scanFolder(droppedPath)
      } catch {
        toast({
          title: 'Could not open folder',
          description: 'Drop a folder, or use Browse to select one.',
          variant: 'destructive' as never
        })
      }
      return
    }

    await loadVideo(droppedPath)
  }

  const handleUpscale = async (): Promise<void> => {
    if (!inputPath || !outputPath || busy) return
    if (withInterpolation && !rifeReady) {
      toast({
        title: 'RIFE not installed',
        description: 'Run npm run setup, or turn off Upscale with Interpolation.',
        variant: 'destructive' as never
      })
      return
    }

    setIsProcessing(true)
    setProgress(0)
    setProgressMessage('Starting…')
    setOutputUrl('')

    window.electronAPI.onVideoProgress((ev) => {
      setProgress((prev) => Math.max(prev, Math.round(ev.percent)))
      setProgressMessage(ev.message)
    })

    try {
      const state = useAppStore.getState()
      const fallbackPath =
        selectedModelPath ??
        state.models.find((m) => m.id === selectedModel && m.modelPath)?.modelPath ??
        state.settings?.lastUsedModelPath
      const choice =
        state.settings?.useFormatModelDefaults && state.settings.formatModelDefaults
          ? resolveModelForFile(inputPath, state.settings.formatModelDefaults, {
              modelId: selectedModel,
              modelPath: fallbackPath
            })
          : { modelId: selectedModel, modelPath: fallbackPath }

      const result = await window.electronAPI.upscaleVideo({
        inputPath,
        outputPath,
        modelName: choice.modelId,
        modelPath: choice.modelPath,
        scale: selectedScale,
        gpuIndex: settings?.gpuIndex ?? 0,
        tileSize: settings?.tileSize ?? 0,
        threads: settings?.threads ?? '1:2:2',
        withInterpolation,
        greenSparkleEnabled: Boolean(settings?.greenSparkleEnabled)
      })

      const url = await window.electronAPI.getImageUrl(result.outputPath)
      setOutputPath(result.outputPath)
      setOutputUrl(url)
      playCompletionSound()
      toast({
        title: withInterpolation ? 'Upscale + interpolation complete' : 'Video upscale complete',
        description: `${result.width} × ${result.height} · ${result.frameCount} frames`,
        action: (
          <div className="flex gap-2">
            <ToastActionEl
              altText="Open file"
              onClick={() => window.electronAPI.openInExplorer(result.outputPath)}
            >
              Open File
            </ToastActionEl>
            <ToastActionEl
              altText="Open folder"
              onClick={() =>
                window.electronAPI.openInExplorer(result.outputPath.replace(/[/\\][^/\\]+$/, ''))
              }
            >
              Open Folder
            </ToastActionEl>
          </div>
        ) as never
      })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('__CANCELLED__')) {
        toast({ title: 'Cancelled', description: 'Video processing was cancelled.' })
      } else {
        toast({
          title: withInterpolation ? 'Upscale + interpolation failed' : 'Video upscale failed',
          description: msg,
          variant: 'destructive' as never
        })
      }
    } finally {
      window.electronAPI.offVideoProgress()
      setIsProcessing(false)
      setProgress(0)
      setProgressMessage('')
    }
  }

  const patchBatchFile = (index: number, update: Partial<VideoBatchItem>): void => {
    setBatchFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...update } : f)))
  }

  const handleBatchStart = async (): Promise<void> => {
    if (busy || !outputFolder) return
    if (withInterpolation && !rifeReady) {
      toast({
        title: 'RIFE not installed',
        description: 'Run npm run setup, or turn off Upscale with Interpolation.',
        variant: 'destructive' as never
      })
      return
    }

    const targets = batchFiles
      .map((f, index) => ({ f, index }))
      .filter(({ f }) => f.selected && f.status !== 'done')

    if (targets.length === 0) {
      toast({
        title: 'Nothing to process',
        description: 'Select one or more videos in the queue.',
        variant: 'destructive' as never
      })
      return
    }

    cancelBatchRef.current = false
    setBatchRunning(true)
    setBatchDone(0)
    setBatchTotal(targets.length)

    setBatchFiles((prev) =>
      prev.map((f) =>
        f.selected && f.status !== 'done'
          ? { ...f, status: 'queued', progress: 0, message: undefined, error: undefined }
          : f
      )
    )

    let success = 0
    let failed = 0
    let cancelled = false

    try {
      for (let t = 0; t < targets.length; t++) {
        if (cancelBatchRef.current) {
          cancelled = true
          break
        }

        const { index } = targets[t]
        const input = targets[t].f.path
        const outName = buildVideoOutputName(input, selectedScale, withInterpolation)
        const outPath = joinPath(outputFolder, outName)

        setActiveBatchPath(input)
        patchBatchFile(index, {
          status: 'processing',
          progress: 0,
          message: 'Starting…',
          error: undefined
        })

        window.electronAPI.onVideoProgress((ev) => {
          patchBatchFile(index, {
            progress: ev.percent,
            message: ev.message
          })
        })

        try {
          const state = useAppStore.getState()
          const fallbackPath =
            selectedModelPath ??
            state.models.find((m) => m.id === selectedModel && m.modelPath)?.modelPath ??
            state.settings?.lastUsedModelPath
          const choice =
            state.settings?.useFormatModelDefaults && state.settings.formatModelDefaults
              ? resolveModelForFile(input, state.settings.formatModelDefaults, {
                  modelId: selectedModel,
                  modelPath: fallbackPath
                })
              : { modelId: selectedModel, modelPath: fallbackPath }

          await window.electronAPI.upscaleVideo({
            inputPath: input,
            outputPath: outPath,
            modelName: choice.modelId,
            modelPath: choice.modelPath,
            scale: selectedScale,
            gpuIndex: settings?.gpuIndex ?? 0,
            tileSize: settings?.tileSize ?? 0,
            threads: settings?.threads ?? '1:2:2',
            withInterpolation,
            greenSparkleEnabled: Boolean(settings?.greenSparkleEnabled)
          })

          if (cancelBatchRef.current) {
            cancelled = true
            patchBatchFile(index, {
              status: 'queued',
              progress: 0,
              message: 'Cancelled'
            })
            break
          }

          patchBatchFile(index, {
            status: 'done',
            progress: 100,
            message: 'Done'
          })
          success++
          setBatchDone(t + 1)
        } catch (err) {
          const msg = (err as Error).message
          if (msg.includes('__CANCELLED__') || cancelBatchRef.current) {
            cancelled = true
            patchBatchFile(index, {
              status: 'queued',
              progress: 0,
              message: 'Cancelled'
            })
            break
          }
          patchBatchFile(index, {
            status: 'error',
            progress: 0,
            error: msg,
            message: undefined
          })
          failed++
          setBatchDone(t + 1)
        }
      }
    } finally {
      window.electronAPI.offVideoProgress()
      setBatchRunning(false)
      setActiveBatchPath('')
    }

    if (cancelled) {
      toast({ title: 'Batch cancelled', description: `${success} completed before cancel.` })
    } else {
      playCompletionSound()
      toast({
        title: 'Batch complete',
        description: `${success} succeeded${failed ? `, ${failed} failed` : ''}`,
        action: (
          <ToastActionEl
            altText="Open folder"
            onClick={() => window.electronAPI.openInExplorer(outputFolder)}
          >
            Open Folder
          </ToastActionEl>
        ) as never
      })
    }
  }

  const handleCancel = (): void => {
    if (batchRunning) {
      cancelBatchRef.current = true
      setProgressMessage('Cancelling…')
    } else {
      setProgressMessage('Cancelling…')
    }
    void window.electronAPI.cancelVideo()
  }

  const handleViewModeChange = (mode: BatchViewMode): void => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode)
    } catch {
      // ignore
    }
  }

  const interpHint =
    settings?.defaultInterpolationMode === 'targetFps'
      ? `→ ${settings.defaultInterpolationTargetFps ?? 60} fps`
      : `→ ${settings?.defaultInterpolationMultiplier ?? 2}×`

  const targetWidth = videoInfo ? videoInfo.width * selectedScale : undefined
  const targetHeight = videoInfo ? videoInfo.height * selectedScale : undefined
  const targetFps = (() => {
    if (!videoInfo) return undefined
    if (!withInterpolation) return videoInfo.fps
    if (settings?.defaultInterpolationMode === 'targetFps') {
      return settings.defaultInterpolationTargetFps ?? 60
    }
    const mult = settings?.defaultInterpolationMultiplier === 4 ? 4 : 2
    return videoInfo.fps * mult
  })()

  return (
    <div className="relative flex flex-col gap-4 h-full min-h-0">
      <div className="shrink-0">
        <h1 className="text-lg font-semibold">Video Upscale</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {batchMode
            ? 'Process a folder of MP4 videos'
            : 'Extract frames, upscale with AI, and rebuild an MP4'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-6 shrink-0">
        <ModelSelector activeFilePath={batchMode ? activeBatchPath || undefined : inputPath || undefined} />
        <ScaleSelector />
        <div className="flex flex-col gap-1.5 pb-0.5">
          <label className="text-xs text-[var(--text-muted)]">Upscale with Interpolation</label>
          <div className="flex items-center gap-2 h-9">
            <Switch
              checked={withInterpolation}
              disabled={busy}
              onCheckedChange={setWithInterpPersisted}
            />
            <span className="text-sm text-[var(--text-secondary)]">
              {withInterpolation ? `On ${interpHint}` : 'Off'}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 pb-0.5">
          <label className="text-xs text-[var(--text-muted)]">Green Sparkle Technology</label>
          <div className="flex items-center gap-2 h-9">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Switch
                    checked={Boolean(settings?.greenSparkleEnabled)}
                    disabled={busy || !gstStatus?.platformSupported}
                    onCheckedChange={(on) => void handleGstToggle(on)}
                    className={
                      settings?.greenSparkleEnabled
                        ? '!bg-[#76B900] !border-[#76B900]'
                        : undefined
                    }
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {gstStatus?.message ||
                  'NVIDIA-only TensorRT video upscale. Compiles an engine on this GPU the first time you turn it on.'}
              </TooltipContent>
            </Tooltip>
            <Sparkles
              className={cn(
                'h-4 w-4',
                settings?.greenSparkleEnabled ? 'text-[#76B900]' : 'text-[var(--text-muted)]'
              )}
            />
            <span className="text-sm text-[var(--text-secondary)]">
              {settings?.greenSparkleEnabled
                ? gstStatus?.engineReady
                  ? 'On (NVIDIA only)'
                  : 'On — compiling…'
                : 'Off (NVIDIA only)'}
            </span>
          </div>
        </div>
      </div>

      {withInterpolation && !rifeReady && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)] shrink-0">
          RIFE is not installed. Run <code className="font-mono text-xs">npm run setup</code> or
          turn this off.
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          size="sm"
          variant={batchMode ? 'default' : 'outline'}
          className="gap-1.5 no-drag"
          disabled={busy}
          onClick={toggleBatchMode}
        >
          <Layers className="h-3.5 w-3.5" />
          Batch mode {batchMode ? 'on' : 'off'}
        </Button>
        {batchMode && fileCount > 0 && (
          <span className="text-xs text-[var(--text-muted)]">
            {fileCount} video{fileCount === 1 ? '' : 's'} · {selectedCount} selected
          </span>
        )}
      </div>

      {!batchMode && inputPath && videoInfo ? (
        <div className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shrink-0">
          <div className="h-16 w-16 rounded-md bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
            <Film className="h-7 w-7 text-[var(--text-muted)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{inputPath.split(/[/\\]/).pop()}</p>
            <p className="text-sm text-[var(--text-secondary)]">
              {videoInfo.width} × {videoInfo.height} · {videoInfo.fps.toFixed(2)} fps ·{' '}
              {formatBytes(videoInfo.size)} · {Math.round(videoInfo.duration)}s
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="text-sm text-[var(--accent)] hover:underline no-drag"
              onClick={handleBrowse}
              disabled={busy}
            >
              Change
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 no-drag"
              onClick={clearVideo}
              disabled={busy}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
      ) : batchMode && fileCount > 0 ? (
        <div className="grid grid-cols-2 gap-4 shrink-0">
          <FolderField
            label="Input Folder"
            path={inputFolder}
            onBrowse={handleBrowse}
            disabled={busy}
          />
          <FolderField
            label="Output Folder"
            path={outputFolder}
            onBrowse={async () => {
              const folder = await window.electronAPI.openFolderDialog()
              if (folder) setOutputFolder(folder)
            }}
            disabled={busy}
          />
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed border-[var(--border)] cursor-pointer transition-all no-drag shrink-0',
            dragOver && 'border-[var(--accent)] bg-[var(--accent)]/5 scale-[1.02]',
            'hover:border-[var(--accent)]',
            busy && 'pointer-events-none opacity-60'
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={handleBrowse}
        >
          <div className="p-3 rounded-full bg-[var(--bg-tertiary)]">
            {dragOver ? (
              <Upload className="h-8 w-8 text-[var(--accent)]" />
            ) : batchMode ? (
              <Layers className="h-8 w-8 text-[var(--text-muted)]" />
            ) : (
              <Film className="h-8 w-8 text-[var(--text-muted)]" />
            )}
          </div>
          <div className="text-center">
            <p className="font-medium">{batchMode ? 'Drag folder here' : 'Drag MP4 here'}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {batchMode ? 'or click to browse a folder' : 'or click to browse'}
            </p>
          </div>
        </div>
      )}

      {batchMode ? (
        fileCount > 0 ? (
          <>
            <div className="relative flex-1 min-h-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 overflow-hidden">
              <VideoBatchFileList
                files={batchFiles}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                canEdit={!busy}
                onToggle={(index) =>
                  setBatchFiles((prev) =>
                    prev.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f))
                  )
                }
                onSelectRange={(from, to) => {
                  const lo = Math.min(from, to)
                  const hi = Math.max(from, to)
                  setBatchFiles((prev) =>
                    prev.map((f, i) => (i >= lo && i <= hi ? { ...f, selected: true } : f))
                  )
                }}
                onSelectAll={(selected) =>
                  setBatchFiles((prev) => prev.map((f) => ({ ...f, selected })))
                }
                onRemove={(index) => {
                  setBatchFiles((prev) => {
                    const next = prev.filter((_, i) => i !== index)
                    if (next.length === 0) resetBatchFolders()
                    return next
                  })
                }}
                onRemoveSelected={() => {
                  setBatchFiles((prev) => {
                    const next = prev.filter((f) => !f.selected)
                    if (next.length === 0) resetBatchFolders()
                    return next
                  })
                }}
                onClear={clearBatch}
              />
              {batchRunning && (
                <BatchProgressOverlay
                  done={batchDone}
                  total={batchTotal}
                  status="running"
                  allowPause={false}
                  statusLabel="Upscaling"
                  onCancel={handleCancel}
                />
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Button
                onClick={handleBatchStart}
                disabled={
                  !inputFolder ||
                  !outputFolder ||
                  selectedCount === 0 ||
                  batchRunning ||
                  (withInterpolation && !rifeReady)
                }
                className="gap-2"
              >
                <Play className="h-4 w-4" />
                Start Batch{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </Button>
            </div>
          </>
        ) : null
      ) : (
        <>
          <VideoBeforeAfterPreview
            beforeSrc={inputUrl || undefined}
            afterSrc={outputUrl || undefined}
            isProcessing={isProcessing}
            progress={progress}
            progressMessage={progressMessage}
            duration={videoInfo?.duration}
            beforeWidth={videoInfo?.width}
            beforeHeight={videoInfo?.height}
            beforeFps={videoInfo?.fps}
            afterWidth={targetWidth}
            afterHeight={targetHeight}
            afterFps={targetFps}
          />

          <div className="flex items-center gap-3 shrink-0">
            {isProcessing ? (
              <Button variant="outline" onClick={handleCancel} className="gap-2">
                Cancel
              </Button>
            ) : (
              <Button
                onClick={handleUpscale}
                disabled={!inputPath || !outputPath || (withInterpolation && !rifeReady)}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {withInterpolation ? 'Upscale + Interpolate' : 'Upscale Video'}
              </Button>
            )}
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="text-xs text-[var(--text-muted)] shrink-0">Output:</span>
              <input
                readOnly
                value={outputPath}
                className="flex-1 h-8 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 text-xs font-mono-path truncate no-drag"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!inputPath || busy}
                onClick={async () => {
                  const base = buildVideoOutputName(inputPath, selectedScale, withInterpolation)
                  const p = await window.electronAPI.saveVideoDialog(base)
                  if (p) {
                    setOutputPath(p)
                    setOutputUrl('')
                  }
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
      {gstSetup && (
        <GstSetupOverlay
          percent={gstPercent}
          message={gstMessage}
          onCancel={() => {
            void window.electronAPI.cancelGst()
          }}
        />
      )}
    </div>
  )
}

function FolderField({
  label,
  path,
  onBrowse,
  disabled
}: {
  label: string
  path: string
  onBrowse: () => void | Promise<void>
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <div className="flex items-center gap-2 min-w-0">
        <input
          readOnly
          value={path}
          placeholder="Select folder…"
          className="flex-1 h-9 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 text-xs font-mono-path truncate no-drag"
        />
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void onBrowse()}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
