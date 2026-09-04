import { useCallback, useEffect, useState } from 'react'
import {
  FolderOpen,
  Layers,
  Image as ImageIcon,
  Play,
  Sparkles,
  Upload,
  X
} from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import { useUpscaler } from '@/hooks/useUpscaler'
import { ModelSelector } from '@/components/ModelSelector'
import { ScaleSelector } from '@/components/ScaleSelector'
import { BeforeAfterSlider } from '@/components/BeforeAfterSlider'
import { BatchFileList, type BatchViewMode } from '@/components/BatchFileList'
import { BatchProgressOverlay } from '@/components/BatchProgressOverlay'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { ToastAction as ToastActionEl } from '@/components/Toaster'
import { buildImageBatchOutputDir, cn, formatBytes, isImageBatchOutputDir } from '@/lib/utils'
import { playCompletionSound } from '@/lib/sfx'

const VIEW_STORAGE_KEY = 'neuralupscale-batch-view'
const BATCH_MODE_KEY = 'neuralupscale-batch-mode'

function loadViewMode(): BatchViewMode {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'list' || saved === 'compact' || saved === 'tiles') return saved
  } catch {
    // ignore
  }
  return 'compact'
}

function loadBatchMode(): boolean {
  try {
    return localStorage.getItem(BATCH_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export function ImageUpscalePage(): JSX.Element {
  const {
    inputFile,
    outputFile,
    outputPath,
    isProcessing,
    progress,
    progressMessage,
    selectedScale,
    outputFormat,
    jpegQuality,
    selectedModel,
    settings,
    setOutputPath,
    setOutputFormat,
    setJpegQuality,
    setOutputFile,
    setInputFile,
    setProgress,
    batchStatus,
    batchFiles,
    setBatchFiles,
    setBatchStatus,
    removeBatchFile,
    removeSelectedBatchFiles,
    clearBatchFiles
  } = useAppStore()

  const { upscaleSingle, startBatch, pauseBatch, resumeBatch, cancelBatch } = useUpscaler()

  const [batchMode, setBatchMode] = useState(loadBatchMode)
  const [inputFolder, setInputFolder] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [viewMode, setViewMode] = useState<BatchViewMode>(loadViewMode)
  const [dragOver, setDragOver] = useState(false)

  const canEditBatch = batchStatus === 'idle' || batchStatus === 'done'
  const fileCount = batchFiles.length
  const selectedCount = batchFiles.filter((f) => f.selected).length
  const runFiles = batchFiles.filter((f) => f.selected)
  const doneCount = runFiles.filter((f) => f.status === 'done').length
  const showProgressOverlay = batchStatus === 'running' || batchStatus === 'paused'
  const busy = isProcessing || batchStatus === 'running' || batchStatus === 'paused'

  const showJpegQuality =
    outputFormat === 'jpg' ||
    (outputFormat === 'auto' &&
      (batchMode
        ? true
        : /\.jpe?g$/i.test(inputFile?.path ?? '')))

  const setBatchModePersisted = (on: boolean): void => {
    setBatchMode(on)
    try {
      localStorage.setItem(BATCH_MODE_KEY, on ? '1' : '0')
    } catch {
      // ignore
    }
  }

  const suggestOutputPath = useCallback(
    async (inputPath: string) => {
      const dir = inputPath.replace(/[/\\][^/\\]+$/, '')
      const built = await window.electronAPI.buildOutputPath(
        inputPath,
        dir,
        selectedScale,
        selectedModel,
        outputFormat,
        settings?.outputNamingPattern
      )
      setOutputPath(built)
    },
    [selectedScale, selectedModel, outputFormat, settings, setOutputPath]
  )

  useEffect(() => {
    if (!batchMode && inputFile?.path) {
      void suggestOutputPath(inputFile.path)
    }
  }, [batchMode, inputFile?.path, selectedScale, selectedModel, outputFormat, settings?.outputNamingPattern, suggestOutputPath])

  const loadSingleFile = useCallback(
    async (filePath: string) => {
      const info = await window.electronAPI.getFileInfo(filePath)
      const previewUrl = await window.electronAPI.getImageUrl(filePath)
      setInputFile({ ...info, previewUrl })
      setOutputFile(null)
      await suggestOutputPath(filePath)
    },
    [setInputFile, setOutputFile, suggestOutputPath]
  )

  const scanFolder = useCallback(
    async (folder: string) => {
      const files = await window.electronAPI.scanFolder(folder)
      setBatchFiles(
        files.map((f, i) => ({
          index: i,
          path: f,
          fileName: f.split(/[/\\]/).pop() ?? f,
          filePercent: 0,
          status: 'queued' as const,
          selected: true
        }))
      )
      setBatchStatus('idle')
      setInputFolder(folder)
      setOutputFolder(buildImageBatchOutputDir(folder, selectedModel, selectedScale))
    },
    [setBatchFiles, setBatchStatus, selectedModel, selectedScale]
  )

  // Keep auto batch output folder in sync with model/scale unless the user picked a custom path
  useEffect(() => {
    if (!batchMode || !inputFolder) return
    setOutputFolder((current) => {
      if (current && !isImageBatchOutputDir(current, inputFolder)) return current
      return buildImageBatchOutputDir(inputFolder, selectedModel, selectedScale)
    })
  }, [batchMode, inputFolder, selectedModel, selectedScale])

  const clearSingle = (): void => {
    setInputFile(null)
    setOutputFile(null)
    setOutputPath('')
    setProgress(0, '')
  }

  const resetBatchFolders = (): void => {
    setInputFolder('')
    setOutputFolder('')
  }

  const clearBatch = (): void => {
    if (!canEditBatch) return
    clearBatchFiles()
    resetBatchFolders()
  }

  const removeBatchFileAndMaybeReset = (index: number): void => {
    if (!canEditBatch) return
    removeBatchFile(index)
    if (useAppStore.getState().batchFiles.length === 0) {
      resetBatchFolders()
    }
  }

  const removeSelectedAndMaybeReset = (): void => {
    if (!canEditBatch) return
    removeSelectedBatchFiles()
    if (useAppStore.getState().batchFiles.length === 0) {
      resetBatchFolders()
    }
  }

  const toggleBatchMode = (): void => {
    if (busy) return
    const next = !batchMode
    setBatchModePersisted(next)
    if (next) {
      clearSingle()
    } else {
      clearBatchFiles()
      resetBatchFolders()
    }
  }

  const handleBrowse = async (): Promise<void> => {
    if (busy) return
    if (batchMode) {
      const folder = await window.electronAPI.openFolderDialog()
      if (folder) await scanFolder(folder)
    } else {
      const path = await window.electronAPI.openFileDialog()
      if (path) await loadSingleFile(path)
    }
  }

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    if (busy) return

    if (batchMode) {
      const file = e.dataTransfer.files[0]
      // Electron exposes path; folders may arrive as a path without extension
      const droppedPath = (file as File & { path?: string })?.path
      if (!droppedPath) return
      // Prefer directory pick via dialog if we can't detect; try scan as folder
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

    const path = e.dataTransfer.files[0]?.path
    if (path) await loadSingleFile(path)
  }

  const handleSingleUpscale = async (): Promise<void> => {
    if (!inputFile) return
    setOutputFile(null)
    try {
      await upscaleSingle()
      const out = useAppStore.getState().outputFile
      if (out) {
        playCompletionSound()
        toast({
          title: 'Upscale complete!',
          description: `${out.width} × ${out.height}`,
          action: (
            <div className="flex gap-2">
              <ToastActionEl altText="Open file" onClick={() => window.electronAPI.openInExplorer(out.path)}>
                Open File
              </ToastActionEl>
              <ToastActionEl
                altText="Open folder"
                onClick={() => window.electronAPI.openInExplorer(out.path.replace(/[/\\][^/\\]+$/, ''))}
              >
                Open Folder
              </ToastActionEl>
            </div>
          ) as never
        })
      }
    } catch (err) {
      toast({
        title: 'Upscale failed',
        description: (err as Error).message,
        variant: 'destructive' as never
      })
    }
  }

  const handleBatchStart = async (): Promise<void> => {
    if (!inputFolder || !outputFolder || selectedCount === 0) return
    try {
      const result = await startBatch(inputFolder, outputFolder)
      playCompletionSound()
      toast({
        title: 'Batch complete',
        description: `${result.success}/${selectedCount} upscaled successfully`,
        action: (
          <ToastActionEl altText="Open folder" onClick={() => window.electronAPI.openInExplorer(outputFolder)}>
            Open output folder
          </ToastActionEl>
        ) as never
      })
    } catch (err) {
      toast({
        title: 'Batch failed',
        description: (err as Error).message,
        variant: 'destructive' as never
      })
    }
  }

  const handleViewModeChange = (mode: BatchViewMode): void => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="shrink-0">
        <h1 className="text-lg font-semibold">Image Upscale</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {batchMode ? 'Process a folder of images' : 'Upscale a single image'}
        </p>
      </div>

      {/* Shared settings — above dropzone */}
      <div className="flex flex-wrap items-end gap-6 shrink-0">
        <ModelSelector />
        <ScaleSelector />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-muted)]">Output Format</label>
          <Tabs value={outputFormat} onValueChange={(v) => setOutputFormat(v as 'auto' | 'jpg' | 'png')}>
            <TabsList>
              <TabsTrigger value="auto">Auto</TabsTrigger>
              <TabsTrigger value="jpg">JPG</TabsTrigger>
              <TabsTrigger value="png">PNG</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {showJpegQuality && (
          <div className="flex flex-col gap-1.5 w-40">
            <label className="text-xs text-[var(--text-muted)]">Quality: {jpegQuality}</label>
            <Slider
              value={[jpegQuality]}
              min={60}
              max={100}
              step={1}
              onValueChange={([v]) => setJpegQuality(v)}
            />
          </div>
        )}
      </div>

      {/* Batch toggle above dropzone */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <Button
          type="button"
          variant={batchMode ? 'default' : 'outline'}
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={toggleBatchMode}
        >
          <Layers className="h-4 w-4" />
          Batch mode {batchMode ? 'on' : 'off'}
        </Button>
        {batchMode && fileCount > 0 && (
          <p className="text-sm text-[var(--text-secondary)]">
            Found {fileCount} images
            {selectedCount > 0 && selectedCount < fileCount ? ` · ${selectedCount} selected` : ''}
          </p>
        )}
      </div>

      {/* Dropzone */}
      {!batchMode && inputFile ? (
        <div className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shrink-0">
          {inputFile.previewUrl && (
            <img
              src={inputFile.previewUrl}
              alt="Preview"
              className="h-16 w-16 object-cover rounded-md"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{inputFile.path.split(/[/\\]/).pop()}</p>
            <p className="text-sm text-[var(--text-secondary)]">
              {inputFile.width} × {inputFile.height} · {formatBytes(inputFile.size)}
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
              onClick={clearSingle}
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
              <ImageIcon className="h-8 w-8 text-[var(--text-muted)]" />
            )}
          </div>
          <div className="text-center">
            <p className="font-medium">{batchMode ? 'Drag folder here' : 'Drag image here'}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {batchMode ? 'or click to browse a folder' : 'or click to browse · JPG, PNG'}
            </p>
          </div>
        </div>
      )}

      {/* Mode-specific main area */}
      {batchMode ? (
        fileCount > 0 ? (
          <>
            <div className="relative flex-1 min-h-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 overflow-hidden">
              <BatchFileList
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                canEdit={canEditBatch}
                onRemove={removeBatchFileAndMaybeReset}
                onRemoveSelected={removeSelectedAndMaybeReset}
                onClear={clearBatch}
              />
              {showProgressOverlay && (batchStatus === 'running' || batchStatus === 'paused') && (
                <BatchProgressOverlay
                  done={doneCount}
                  total={runFiles.length || selectedCount}
                  status={batchStatus}
                  onPause={pauseBatch}
                  onResume={resumeBatch}
                  onCancel={cancelBatch}
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
                  batchStatus === 'running' ||
                  batchStatus === 'paused'
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
          <BeforeAfterSlider
            beforeSrc={inputFile?.previewUrl}
            afterSrc={outputFile?.previewUrl}
            isProcessing={isProcessing}
            progress={progress}
            progressMessage={progressMessage}
          />
          <div className="flex items-center gap-3 shrink-0">
            <Button onClick={handleSingleUpscale} disabled={!inputFile || isProcessing} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Upscale Now
            </Button>
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
                disabled={!inputFile || isProcessing}
                onClick={async () => {
                  const ext =
                    outputFormat === 'auto'
                      ? /\.jpe?g$/i.test(inputFile?.path ?? '')
                        ? 'jpg'
                        : 'png'
                      : outputFormat
                  const name =
                    inputFile?.path
                      .split(/[/\\]/)
                      .pop()
                      ?.replace(/\.[^.]+$/, `_upscaled_${selectedScale}x.${ext}`) ?? `output.${ext}`
                  const p = await window.electronAPI.saveFileDialog(name)
                  if (p) setOutputPath(p)
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
  onBrowse: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <div className="flex gap-2">
        <input
          readOnly
          value={path}
          placeholder="Select folder..."
          className="flex-1 h-9 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 text-xs font-mono-path truncate no-drag"
        />
        <Button variant="outline" size="sm" onClick={onBrowse} disabled={disabled}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
