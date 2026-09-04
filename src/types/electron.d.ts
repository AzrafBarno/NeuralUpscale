import type {
  AppSettings,
  BatchOptions,
  BatchProgressEvent,
  CustomModelInfo,
  DeviceInfo,
  FileInfo,
  FormatModelChoice,
  FormatModelDefaults,
  GpuInfo,
  InputFileFormat,
  InterpolationMode,
  InterpolationMultiplier,
  InterpolationOptions,
  InterpolationProgressEvent,
  InterpolationResult,
  LoadModelsFromFolderResult,
  ModelInfo,
  ProgressEvent,
  UpscaleOptions,
  UpscaleResult,
  VideoInfo,
  VideoProgressEvent,
  VideoUpscaleOptions,
  VideoUpscaleResult,
  GstProgressEvent,
  GstStatus,
  ScaleFactor
} from '../../electron/types'

export type {
  AppSettings,
  BatchOptions,
  BatchProgressEvent,
  CustomModelInfo,
  DeviceInfo,
  FileInfo,
  FormatModelChoice,
  FormatModelDefaults,
  GpuInfo,
  InputFileFormat,
  InterpolationMode,
  InterpolationMultiplier,
  InterpolationOptions,
  InterpolationProgressEvent,
  InterpolationResult,
  LoadModelsFromFolderResult,
  ModelInfo,
  ProgressEvent,
  UpscaleOptions,
  UpscaleResult,
  VideoInfo,
  VideoProgressEvent,
  VideoUpscaleOptions,
  VideoUpscaleResult,
  GstProgressEvent,
  GstStatus,
  ScaleFactor
}

export interface ElectronAPI {
  detectGpu: () => Promise<GpuInfo>
  getDeviceInfo: () => Promise<DeviceInfo>
  openFileDialog: () => Promise<string | null>
  openVideoDialog: () => Promise<string | null>
  openFolderDialog: () => Promise<string | null>
  saveFileDialog: (defaultName: string) => Promise<string | null>
  saveVideoDialog: (defaultName: string) => Promise<string | null>
  upscaleSingle: (opts: UpscaleOptions) => Promise<UpscaleResult>
  upscaleBatch: (opts: BatchOptions) => Promise<{ success: number; failed: number }>
  cancelBatch: () => Promise<void>
  pauseBatch: () => Promise<void>
  resumeBatch: () => Promise<void>
  getVideoInfo: (filePath: string) => Promise<VideoInfo>
  upscaleVideo: (opts: VideoUpscaleOptions) => Promise<VideoUpscaleResult>
  cancelVideo: () => Promise<void>
  onVideoProgress: (cb: (data: VideoProgressEvent) => void) => void
  offVideoProgress: () => void
  interpolateVideo: (opts: InterpolationOptions) => Promise<InterpolationResult>
  cancelInterpolate: () => Promise<void>
  onInterpolateProgress: (cb: (data: InterpolationProgressEvent) => void) => void
  offInterpolateProgress: () => void
  checkRifeExists: () => Promise<boolean>
  getGstStatus: (opts: {
    modelName: string
    scale: ScaleFactor
    modelPath?: string
  }) => Promise<GstStatus>
  enableGst: (opts: {
    modelName: string
    scale: ScaleFactor
    modelPath?: string
  }) => Promise<GstStatus>
  disableGst: () => Promise<boolean>
  recompileGst: (opts: {
    modelName: string
    scale: ScaleFactor
    modelPath?: string
  }) => Promise<GstStatus>
  cancelGst: () => Promise<void>
  onGstProgress: (cb: (data: GstProgressEvent) => void) => void
  offGstProgress: () => void
  onProgress: (cb: (data: ProgressEvent) => void) => void
  onBatchProgress: (cb: (data: BatchProgressEvent) => void) => void
  offProgress: () => void
  offBatchProgress: () => void
  loadCustomModel: () => Promise<CustomModelInfo | null>
  loadCustomModelFolder: () => Promise<LoadModelsFromFolderResult | null>
  removeCustomModel: (id: string, modelPath: string) => Promise<CustomModelInfo[]>
  getAvailableModels: () => Promise<ModelInfo[]>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  openInExplorer: (filePath: string) => void
  getFileInfo: (filePath: string) => Promise<FileInfo>
  getImageUrl: (filePath: string) => Promise<string>
  getThumbnail: (filePath: string) => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<string[]>
  scanVideoFolder: (folderPath: string) => Promise<string[]>
  buildOutputPath: (
    inputPath: string,
    outputDir: string,
    scale: number,
    modelName: string,
    format: string,
    pattern?: string
  ) => Promise<string>
  checkModelsExist: () => Promise<boolean>
  runSetup: () => Promise<{ success: boolean; message: string }>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  getPlatform: () => string
  getAppVersion: () => Promise<string>
  openExternal: (url: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
