export interface DeviceInfo {
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  totalRamMB: number
  osName: string
  osArch: string
  gpuName: string
  gpuVulkan: boolean
  gpuNvidia: boolean
  gpuVramMB?: number
  gpuComputeCap?: string
}

export type ScaleFactor = 2 | 3 | 4
export type OutputFormat = 'auto' | 'jpg' | 'png'
export type ResolvedOutputFormat = 'jpg' | 'png'
export type Theme = 'dark' | 'light'
export type ProgressStage = 'loading' | 'processing' | 'saving'
export type BatchFileStatus = 'queued' | 'processing' | 'done' | 'error'
export type InterpolationMode = 'multiplier' | 'targetFps'
export type InterpolationMultiplier = 2 | 4
export type InputFileFormat = 'jpg' | 'png' | 'mp4'

export interface FormatModelChoice {
  modelId: string
  modelPath?: string
}

export type FormatModelDefaults = Record<InputFileFormat, FormatModelChoice>

export const DEFAULT_FORMAT_MODEL_DEFAULTS: FormatModelDefaults = {
  jpg: { modelId: 'realesrgan-x4plus' },
  png: { modelId: 'realesrgan-x4plus' },
  mp4: { modelId: 'realesr-animevideov3' }
}

export interface GpuInfo {
  gpuName: string
  vulkanSupported: boolean
  gpuIndex: number
  /** True when an NVIDIA GPU is present (nvidia-smi or name match). */
  nvidia: boolean
  nvidiaName?: string
  computeCap?: string
  vramMB?: number
  gpuUuid?: string
  /** Stable id for TensorRT engine cache folders. */
  fingerprint?: string
}

export interface FileInfo {
  path: string
  width: number
  height: number
  size: number
  format: string
}

export interface ModelInfo {
  id: string
  label: string
  maxScale: number
  isCustom?: boolean
  modelPath?: string
}

export interface CustomModelInfo {
  id: string
  label: string
  modelPath: string
}

export interface LoadModelsFromFolderResult {
  folderPath: string
  models: CustomModelInfo[]
  imported: number
}

export interface AppSettings {
  gpuIndex: number
  tileSize: number
  threads: string
  defaultOutputFormat: OutputFormat
  defaultScale: ScaleFactor
  /** Default scale used on the Video Upscale page (independent of image default). */
  defaultVideoScale: ScaleFactor
  outputNamingPattern: string
  theme: Theme
  lastUsedModel: string
  /** Directory of the last custom model (.bin/.param). Undefined for built-ins. */
  lastUsedModelPath?: string
  /** Last model chosen on Image Upscale (independent of video). */
  lastUsedImageModel?: string
  lastUsedImageModelPath?: string
  /** Last model chosen on Video Upscale (independent of image). */
  lastUsedVideoModel?: string
  lastUsedVideoModelPath?: string
  jpegQuality: number
  /** Interpolation defaults (RIFE) */
  defaultInterpolationMode: InterpolationMode
  defaultInterpolationMultiplier: InterpolationMultiplier
  defaultInterpolationTargetFps: number
  /** Play assets/completed.mp3 when a job finishes successfully */
  playCompletionSound: boolean
  /** When true, pick the upscale model from formatModelDefaults per input extension */
  useFormatModelDefaults: boolean
  formatModelDefaults: FormatModelDefaults
  /** Opt-in NVIDIA TensorRT video upscale (Green Sparkle Technology) */
  greenSparkleEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  gpuIndex: 0,
  tileSize: 0,
  threads: '1:2:2',
  defaultOutputFormat: 'png',
  defaultScale: 4,
  defaultVideoScale: 4,
  outputNamingPattern: '{filename}_upscaled_{scale}x',
  theme: 'dark',
  lastUsedModel: 'realesrgan-x4plus',
  lastUsedImageModel: 'realesrgan-x4plus',
  lastUsedVideoModel: 'realesr-animevideov3',
  jpegQuality: 95,
  defaultInterpolationMode: 'multiplier',
  defaultInterpolationMultiplier: 2,
  defaultInterpolationTargetFps: 60,
  playCompletionSound: true,
  useFormatModelDefaults: false,
  formatModelDefaults: { ...DEFAULT_FORMAT_MODEL_DEFAULTS },
  greenSparkleEnabled: false
}

export interface UpscaleOptions {
  inputPath: string
  outputPath: string
  modelName: string
  modelPath?: string
  scale: ScaleFactor
  gpuIndex: number
  tileSize: number
  threads: string
  outputFormat: OutputFormat
  jpegQuality: number
}

export interface UpscaleResult {
  outputPath: string
  width: number
  height: number
}

export interface BatchOptions {
  inputFolder: string
  outputFolder: string
  files?: string[]
  modelName: string
  modelPath?: string
  scale: ScaleFactor
  gpuIndex: number
  tileSize: number
  threads: string
  outputFormat: OutputFormat
  jpegQuality: number
  namingPattern: string
  /** When set with formatModelDefaults, each file uses its format's model */
  useFormatModelDefaults?: boolean
  formatModelDefaults?: FormatModelDefaults
}

export interface ProgressEvent {
  percent: number
  stage: ProgressStage
  message: string
}

export interface BatchProgressEvent {
  fileIndex: number
  fileName: string
  filePercent: number
  overallPercent: number
  status: BatchFileStatus
  error?: string
}

export interface BatchFileInfo {
  index: number
  path: string
  fileName: string
  filePercent: number
  status: BatchFileStatus
  error?: string
}

export const BUILTIN_MODELS: ModelInfo[] = [
  { id: 'realesrgan-x4plus', label: 'RealESRGAN General', maxScale: 4 },
  { id: 'realesrgan-x4plus-anime', label: 'RealESRGAN Anime', maxScale: 4 },
  { id: 'realesrnet-x4plus', label: 'RealESRNet General', maxScale: 4 },
  { id: 'realesr-animevideov3', label: 'RealESR Anime Video', maxScale: 4 }
]

/** Resolve UI model id + scale to the on-disk realesrgan `-n` name. */
export function resolveModelName(modelId: string, scale: ScaleFactor): string {
  if (modelId === 'realesr-animevideov3') {
    return `realesr-animevideov3-x${scale}`
  }
  return modelId
}

export interface VideoInfo {
  path: string
  duration: number
  fps: number
  width: number
  height: number
  codec: string
  size: number
  hasAudio: boolean
}

export interface VideoUpscaleOptions {
  inputPath: string
  outputPath: string
  modelName: string
  modelPath?: string
  scale: ScaleFactor
  gpuIndex: number
  tileSize: number
  threads: string
  /** When true, upscale PNG frames then interpolate them (single encode at the end) */
  withInterpolation?: boolean
  interpolationMode?: InterpolationMode
  interpolationMultiplier?: InterpolationMultiplier
  interpolationTargetFps?: number
  /** Use local TensorRT engine for folder upscale when compiled */
  greenSparkleEnabled?: boolean
}

export type VideoProgressStage =
  | 'extracting'
  | 'upscaling'
  | 'encoding'
  | 'interpolating'
  | 'done'

export interface VideoProgressEvent {
  stage: VideoProgressStage
  percent: number
  message: string
  frameIndex?: number
  frameTotal?: number
}

export interface VideoUpscaleResult {
  outputPath: string
  width: number
  height: number
  frameCount: number
}

export interface InterpolationOptions {
  inputPath: string
  outputPath: string
  mode: InterpolationMode
  /** Used when mode === 'multiplier' */
  multiplier: InterpolationMultiplier
  /** Used when mode === 'targetFps' */
  targetFps: number
  gpuIndex: number
  threads: string
  /** Optional absolute path to a RIFE model folder (contains flownet.bin) */
  modelPath?: string
}

export type InterpolationProgressStage = 'extracting' | 'interpolating' | 'encoding' | 'done'

export interface InterpolationProgressEvent {
  stage: InterpolationProgressStage
  percent: number
  message: string
  frameIndex?: number
  frameTotal?: number
}

export interface InterpolationResult {
  outputPath: string
  width: number
  height: number
  inputFps: number
  outputFps: number
  inputFrames: number
  outputFrames: number
}

export type GstProgressStage = 'runtime' | 'onnx' | 'compile' | 'ready' | 'error'

export interface GstProgressEvent {
  stage: GstProgressStage
  percent: number
  message: string
}

export interface GstStatus {
  nvidia: boolean
  platformSupported: boolean
  modelSupported: boolean
  runtimeReady: boolean
  engineReady: boolean
  enabled: boolean
  gpuName?: string
  fingerprint?: string
  tileSize?: number
  enginePath?: string
  message?: string
}
