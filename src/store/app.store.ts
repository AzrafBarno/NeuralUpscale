import { create } from 'zustand'

export interface FileInfo {
  path: string
  width: number
  height: number
  size: number
  format: string
  previewUrl?: string
}

export interface GpuInfo {
  gpuName: string
  vulkanSupported: boolean
  gpuIndex: number
  nvidia?: boolean
  nvidiaName?: string
  computeCap?: string
  vramMB?: number
  gpuUuid?: string
  fingerprint?: string
}

export interface ModelInfo {
  id: string
  label: string
  maxScale: number
  isCustom?: boolean
  modelPath?: string
}

export interface BatchFileInfo {
  index: number
  path: string
  fileName: string
  filePercent: number
  status: 'queued' | 'processing' | 'done' | 'error'
  error?: string
  previewUrl?: string
  selected: boolean
}

export type ScaleFactor = 2 | 3 | 4
export type OutputFormat = 'auto' | 'jpg' | 'png'

export type InputFileFormat = 'jpg' | 'png' | 'mp4'

export interface FormatModelChoice {
  modelId: string
  modelPath?: string
}

export type FormatModelDefaults = Record<InputFileFormat, FormatModelChoice>

export interface AppSettings {
  gpuIndex: number
  tileSize: number
  threads: string
  defaultOutputFormat: OutputFormat
  defaultScale: ScaleFactor
  defaultVideoScale: ScaleFactor
  outputNamingPattern: string
  theme: 'dark' | 'light'
  lastUsedModel: string
  /** Directory of the last custom model (.bin/.param). Undefined for built-ins. */
  lastUsedModelPath?: string
  lastUsedImageModel?: string
  lastUsedImageModelPath?: string
  lastUsedVideoModel?: string
  lastUsedVideoModelPath?: string
  jpegQuality: number
  defaultInterpolationMode: 'multiplier' | 'targetFps'
  defaultInterpolationMultiplier: 2 | 4
  defaultInterpolationTargetFps: number
  playCompletionSound: boolean
  /** When true, pick the upscale model from formatModelDefaults per input extension */
  useFormatModelDefaults: boolean
  formatModelDefaults: FormatModelDefaults
  greenSparkleEnabled: boolean
}

interface AppState {
  page: 'image' | 'video' | 'interpolation'
  inputFile: FileInfo | null
  outputFile: FileInfo | null
  outputPath: string
  isProcessing: boolean
  progress: number
  progressMessage: string
  batchFiles: BatchFileInfo[]
  batchStatus: 'idle' | 'running' | 'paused' | 'done'
  batchOverallPercent: number
  batchDoneCount: number
  selectedModel: string
  selectedModelPath?: string
  selectedScale: ScaleFactor
  outputFormat: OutputFormat
  jpegQuality: number
  gpuInfo: GpuInfo | null
  settings: AppSettings | null
  models: ModelInfo[]
  modelsMissing: boolean

  setPage: (page: 'image' | 'video' | 'interpolation') => void
  setInputFile: (file: FileInfo | null) => void
  setOutputFile: (file: FileInfo | null) => void
  setOutputPath: (path: string) => void
  setProcessing: (v: boolean) => void
  setProgress: (percent: number, message?: string) => void
  setBatchFiles: (files: BatchFileInfo[]) => void
  updateBatchFile: (index: number, update: Partial<BatchFileInfo>) => void
  patchBatchFiles: (updates: Array<{ index: number; update: Partial<BatchFileInfo> }>) => void
  removeBatchFile: (index: number) => void
  removeSelectedBatchFiles: () => void
  clearBatchFiles: () => void
  toggleBatchSelection: (index: number) => void
  setBatchFileSelected: (index: number, selected: boolean) => void
  selectBatchRange: (fromIndex: number, toIndex: number) => void
  selectAllBatchFiles: (selected: boolean) => void
  setBatchStatus: (status: AppState['batchStatus']) => void
  setBatchOverallPercent: (p: number) => void
  setBatchDoneCount: (c: number) => void
  setSelectedModel: (id: string, modelPath?: string) => void
  setSelectedScale: (scale: ScaleFactor) => void
  setOutputFormat: (format: OutputFormat) => void
  setJpegQuality: (q: number) => void
  setGpuInfo: (info: GpuInfo | null) => void
  setSettings: (settings: AppSettings) => void
  setModels: (models: ModelInfo[]) => void
  setModelsMissing: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  page: 'image',
  inputFile: null,
  outputFile: null,
  outputPath: '',
  isProcessing: false,
  progress: 0,
  progressMessage: '',
  batchFiles: [],
  batchStatus: 'idle',
  batchOverallPercent: 0,
  batchDoneCount: 0,
  selectedModel: 'realesrgan-x4plus',
  selectedScale: 4,
  outputFormat: 'png',
  jpegQuality: 95,
  gpuInfo: null,
  settings: null,
  models: [],
  modelsMissing: false,

  setPage: (page) =>
    set((s) => {
      if (page === s.page) return s
      if (page === 'image') {
        return {
          page,
          selectedModel: s.settings?.lastUsedImageModel ?? 'realesrgan-x4plus',
          selectedModelPath: s.settings?.lastUsedImageModelPath,
          selectedScale: s.settings?.defaultScale ?? 4
        }
      }
      if (page === 'video') {
        return {
          page,
          selectedModel: s.settings?.lastUsedVideoModel ?? 'realesr-animevideov3',
          selectedModelPath: s.settings?.lastUsedVideoModelPath,
          selectedScale: s.settings?.defaultVideoScale ?? 4
        }
      }
      return { page }
    }),
  setInputFile: (inputFile) => set({ inputFile }),
  setOutputFile: (outputFile) => set({ outputFile }),
  setOutputPath: (outputPath) => set({ outputPath }),
  setProcessing: (isProcessing) => set({ isProcessing }),
  setProgress: (progress, progressMessage = '') => set({ progress, progressMessage }),
  setBatchFiles: (batchFiles) => set({ batchFiles }),
  updateBatchFile: (index, update) =>
    set((s) => ({
      batchFiles: s.batchFiles.map((f) => (f.index === index ? { ...f, ...update } : f))
    })),
  patchBatchFiles: (updates) =>
    set((s) => {
      if (updates.length === 0) return s
      const map = new Map(updates.map((u) => [u.index, u.update]))
      return {
        batchFiles: s.batchFiles.map((f) => {
          const update = map.get(f.index)
          return update ? { ...f, ...update } : f
        })
      }
    }),
  removeBatchFile: (index) =>
    set((s) => ({
      batchFiles: s.batchFiles
        .filter((f) => f.index !== index)
        .map((f, i) => ({ ...f, index: i }))
    })),
  removeSelectedBatchFiles: () =>
    set((s) => ({
      batchFiles: s.batchFiles
        .filter((f) => !f.selected)
        .map((f, i) => ({ ...f, index: i }))
    })),
  clearBatchFiles: () =>
    set({
      batchFiles: [],
      batchStatus: 'idle',
      batchOverallPercent: 0,
      batchDoneCount: 0
    }),
  toggleBatchSelection: (index) =>
    set((s) => ({
      batchFiles: s.batchFiles.map((f) =>
        f.index === index ? { ...f, selected: !f.selected } : f
      )
    })),
  setBatchFileSelected: (index, selected) =>
    set((s) => ({
      batchFiles: s.batchFiles.map((f) => (f.index === index ? { ...f, selected } : f))
    })),
  selectBatchRange: (fromIndex, toIndex) =>
    set((s) => {
      const start = Math.min(fromIndex, toIndex)
      const end = Math.max(fromIndex, toIndex)
      return {
        batchFiles: s.batchFiles.map((f) => ({
          ...f,
          selected: f.index >= start && f.index <= end
        }))
      }
    }),
  selectAllBatchFiles: (selected) =>
    set((s) => ({
      batchFiles: s.batchFiles.map((f) => ({ ...f, selected }))
    })),
  setBatchStatus: (batchStatus) => set({ batchStatus }),
  setBatchOverallPercent: (batchOverallPercent) => set({ batchOverallPercent }),
  setBatchDoneCount: (batchDoneCount) => set({ batchDoneCount }),
  setSelectedModel: (selectedModel, selectedModelPath) => set({ selectedModel, selectedModelPath }),
  setSelectedScale: (selectedScale) => set({ selectedScale }),
  setOutputFormat: (outputFormat) => set({ outputFormat }),
  setJpegQuality: (jpegQuality) => set({ jpegQuality }),
  setGpuInfo: (gpuInfo) => set({ gpuInfo }),
  setSettings: (settings) => set({ settings }),
  setModels: (models) => set({ models }),
  setModelsMissing: (modelsMissing) => set({ modelsMissing })
}))
