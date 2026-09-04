import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, FolderOpen, Gauge, Layers, Play, Sparkles, Upload, X } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import { VideoBeforeAfterPreview } from '@/components/VideoBeforeAfterPreview'
import {
  VideoBatchFileList,
  type BatchViewMode,
  type VideoBatchItem
} from '@/components/VideoBatchFileList'
import { BatchProgressOverlay } from '@/components/BatchProgressOverlay'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { ToastAction as ToastActionEl } from '@/components/Toaster'
import { cn, formatBytes, joinPath } from '@/lib/utils'
import { playCompletionSound } from '@/lib/sfx'
import type {
  InterpolationMode,
  InterpolationMultiplier,
  VideoInfo
} from '@/types/electron'

const TARGET_FPS_PRESETS = [48, 60, 90, 120] as const
const BATCH_MODE_KEY = 'neuralupscale-interp-batch-mode'
const VIEW_STORAGE_KEY = 'neuralupscale-interp-batch-view'

function loadBatchMode(): boolean {
  try {
    return localStorage.getItem(BATCH_MODE_KEY) === '1'
  } catch {
    return false
  }
}

function loadViewMode(): BatchViewMode {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'list' || saved === 'compact' || saved === 'tiles') return saved
  } catch {
    // ignore
  }
  return 'compact'
}

function buildInterpOutputName(
  filePath: string,
  mode: InterpolationMode,
  multiplier: number,
  targetFps: number
): string {
  const base = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'video'
  const tag = mode === 'multiplier' ? `interp_${multiplier}x` : `interp_${Math.round(targetFps)}fps`
  return `${base}_${tag}.mp4`
}

function buildInterpBatchOutputDir(inputFolder: string): string {
  return joinPath(inputFolder, 'interpolated')
}

function isInterpBatchOutputDir(outputFolder: string, inputFolder: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(outputFolder) === norm(buildInterpBatchOutputDir(inputFolder))
}

function readInterpDefaults(): {
  mode: InterpolationMode
  multiplier: InterpolationMultiplier
  targetFps: number
} {
  const s = useAppStore.getState().settings
  return {
    mode: s?.defaultInterpolationMode ?? 'multiplier',
    multiplier: s?.defaultInterpolationMultiplier ?? 2,
    targetFps: s?.defaultInterpolationTargetFps ?? 60
  }
}

export function InterpolationPage(): JSX.Element {
  const settings = useAppStore((s) => s.settings)

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
  const [rifeReady, setRifeReady] = useState(true)

  const [mode, setMode] = useState<InterpolationMode>(() => readInterpDefaults().mode)
  const [multiplier, setMultiplier] = useState<InterpolationMultiplier>(
    () => readInterpDefaults().multiplier
  )
  const [targetFps, setTargetFps] = useState(() => readInterpDefaults().targetFps)
  const appliedSettingsKey = useRef<string | null>(
    (() => {
      const s = useAppStore.getState().settings
      return s
        ? `${s.defaultInterpolationMode}|${s.defaultInterpolationMultiplier}|${s.defaultInterpolationTargetFps}`
        : null
    })()
  )

  const [inputFolder, setInputFolder] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [batchFiles, setBatchFiles] = useState<VideoBatchItem[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchDone, setBatchDone] = useState(0)
  const [batchTotal, setBatchTotal] = useState(0)
  const cancelBatchRef = useRef(false)

  const busy = isProcessing || batchRunning
  const selectedCount = batchFiles.filter((f) => f.selected).length
  const fileCount = batchFiles.length

  useEffect(() => {
    void window.electronAPI.checkRifeExists().then(setRifeReady)
  }, [])

  // Apply settings only when they actually change (e.g. user saved Settings),
  // not on every mount flash — initial state already comes from the store.
  useEffect(() => {
    if (!settings) return
    const key = `${settings.defaultInterpolationMode}|${settings.defaultInterpolationMultiplier}|${settings.defaultInterpolationTargetFps}`
    if (appliedSettingsKey.current === key) return
    appliedSettingsKey.current = key
    setMode(settings.defaultInterpolationMode ?? 'multiplier')
    setMultiplier(settings.defaultInterpolationMultiplier ?? 2)
    setTargetFps(settings.defaultInterpolationTargetFps ?? 60)
  }, [settings])

  const predictedFps = useMemo(() => {
    if (!videoInfo) return null
    if (mode === 'multiplier') return videoInfo.fps * multiplier
    return targetFps
  }, [videoInfo, mode, multiplier, targetFps])

  const suggestOutputPath = useCallback(
    (filePath: string) => {
      const dir = filePath.replace(/[/\\][^/\\]+$/, '')
      const name = buildInterpOutputName(filePath, mode, multiplier, targetFps)
      // Single mode: same folder as the source (not an interpolated/ subfolder)
      setOutputPath(joinPath(dir, name))
      setOutputUrl('')
    },
    [mode, multiplier, targetFps]
  )

  useEffect(() => {
    if (!batchMode && inputPath) suggestOutputPath(inputPath)
  }, [batchMode, inputPath, suggestOutputPath])

  // Keep default batch output on <input>/interpolated unless the user picked another folder
  useEffect(() => {
    if (!batchMode || !inputFolder) return
    setOutputFolder((current) => {
      if (current && !isInterpBatchOutputDir(current, inputFolder) && current !== inputFolder) {
        return current
      }
      return buildInterpBatchOutputDir(inputFolder)
    })
  }, [batchMode, inputFolder])

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
    if (paths.length === 0) {
      toast({
        title: 'No MP4 files found',
        description: 'Drop a folder that contains .mp4 files.',
        variant: 'destructive' as never
      })
      setBatchFiles([])
      setInputFolder(folder)
      setOutputFolder(buildInterpBatchOutputDir(folder))
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
    setInputFolder(folder)
    setOutputFolder(buildInterpBatchOutputDir(folder))
    toast({
      title: 'Folder scanned',
      description: `${items.length} video${items.length === 1 ? '' : 's'} ready`
    })
  }, [])

  const setBatchModePersisted = (on: boolean): void => {
    setBatchMode(on)
    try {
      localStorage.setItem(BATCH_MODE_KEY, on ? '1' : '0')
    } catch {
      // ignore
    }
  }

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

  const handleViewModeChange = (next: BatchViewMode): void => {
    setViewMode(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // ignore
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

  const handleInterpolate = async (): Promise<void> => {
    if (!inputPath || !outputPath || busy) return
    if (!rifeReady) {
      toast({
        title: 'RIFE not installed',
        description: 'Run npm run setup to download AI frame interpolation.',
        variant: 'destructive' as never
      })
      return
    }

    setIsProcessing(true)
    setProgress(0)
    setProgressMessage('Starting…')
    setOutputUrl('')

    window.electronAPI.onInterpolateProgress((ev) => {
      setProgress((prev) => Math.max(prev, Math.round(ev.percent)))
      setProgressMessage(ev.message)
    })

    try {
      const result = await window.electronAPI.interpolateVideo({
        inputPath,
        outputPath,
        mode,
        multiplier,
        targetFps,
        gpuIndex: settings?.gpuIndex ?? 0,
        threads: settings?.threads ?? '1:2:2'
      })

      const url = await window.electronAPI.getImageUrl(result.outputPath)
      setOutputPath(result.outputPath)
      setOutputUrl(url)
      playCompletionSound()
      toast({
        title: 'Interpolation complete',
        description: `${result.inputFps.toFixed(2)} → ${result.outputFps.toFixed(2)} fps · ${result.inputFrames} → ${result.outputFrames} frames`,
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
        toast({ title: 'Cancelled', description: 'Interpolation was cancelled.' })
      } else {
        toast({
          title: 'Interpolation failed',
          description: msg,
          variant: 'destructive' as never
        })
      }
    } finally {
      window.electronAPI.offInterpolateProgress()
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
    if (!rifeReady) {
      toast({
        title: 'RIFE not installed',
        description: 'Run npm run setup to download AI frame interpolation.',
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
        const outName = buildInterpOutputName(input, mode, multiplier, targetFps)
        const outPath = joinPath(outputFolder, outName)

        patchBatchFile(index, {
          status: 'processing',
          progress: 0,
          message: 'Starting…',
          error: undefined
        })

        window.electronAPI.onInterpolateProgress((ev) => {
          patchBatchFile(index, {
            progress: ev.percent,
            message: ev.message
          })
        })

        try {
          await window.electronAPI.interpolateVideo({
            inputPath: input,
            outputPath: outPath,
            mode,
            multiplier,
            targetFps,
            gpuIndex: settings?.gpuIndex ?? 0,
            threads: settings?.threads ?? '1:2:2'
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
      window.electronAPI.offInterpolateProgress()
      setBatchRunning(false)
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
    void window.electronAPI.cancelInterpolate()
  }

  return (
    <div className="relative flex flex-col gap-4 h-full min-h-0">
      <div className="shrink-0">
        <h1 className="text-lg font-semibold">Interpolation</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {batchMode
            ? 'Process a folder of MP4 videos with RIFE'
            : 'AI frame interpolation — increase FPS with RIFE'}
        </p>
      </div>

      {!rifeReady && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)] shrink-0">
          RIFE is not installed yet. Run <code className="font-mono text-xs">npm run setup</code> to
          enable interpolation.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-6 shrink-0">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-muted)]">Mode</label>
          <Tabs value={mode} onValueChange={(v) => setMode(v as InterpolationMode)}>
            <TabsList>
              <TabsTrigger value="multiplier" disabled={busy}>
                Multiplier
              </TabsTrigger>
              <TabsTrigger value="targetFps" disabled={busy}>
                Target FPS
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {mode === 'multiplier' ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-muted)]">Multiplier</label>
            <Tabs
              value={String(multiplier)}
              onValueChange={(v) => setMultiplier(Number(v) as InterpolationMultiplier)}
            >
              <TabsList>
                <TabsTrigger value="2" disabled={busy}>
                  2×
                </TabsTrigger>
                <TabsTrigger value="4" disabled={busy}>
                  4×
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-muted)]">Target FPS</label>
            <div className="flex items-center gap-2">
              <Tabs
                value={
                  TARGET_FPS_PRESETS.includes(targetFps as (typeof TARGET_FPS_PRESETS)[number])
                    ? String(targetFps)
                    : 'custom'
                }
                onValueChange={(v) => {
                  if (v !== 'custom') setTargetFps(Number(v))
                }}
              >
                <TabsList>
                  {TARGET_FPS_PRESETS.map((fps) => (
                    <TabsTrigger key={fps} value={String(fps)} disabled={busy}>
                      {fps}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <input
                type="number"
                min={1}
                max={240}
                step={1}
                value={targetFps}
                disabled={busy}
                onChange={(e) =>
                  setTargetFps(Math.max(1, Math.min(240, Number(e.target.value) || 1)))
                }
                className="h-9 w-20 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 text-sm no-drag"
              />
            </div>
          </div>
        )}

        {!batchMode && videoInfo && predictedFps != null && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] pb-1">
            <Gauge className="h-4 w-4 text-[var(--accent)]" />
            <span>
              {videoInfo.fps.toFixed(2)} → {predictedFps.toFixed(2)} fps
            </span>
          </div>
        )}
      </div>

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
                  statusLabel="Interpolating"
                  onCancel={handleCancel}
                />
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Button
                onClick={handleBatchStart}
                disabled={!inputFolder || !outputFolder || selectedCount === 0 || batchRunning || !rifeReady}
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
            afterWidth={videoInfo?.width}
            afterHeight={videoInfo?.height}
            afterFps={predictedFps ?? undefined}
          />

          <div className="flex items-center gap-3 shrink-0">
            {isProcessing ? (
              <Button variant="outline" onClick={handleCancel} className="gap-2">
                Cancel
              </Button>
            ) : (
              <Button
                onClick={handleInterpolate}
                disabled={!inputPath || !outputPath || !rifeReady}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Interpolate
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
                  const base = buildInterpOutputName(inputPath, mode, multiplier, targetFps)
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
