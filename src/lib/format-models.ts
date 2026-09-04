export type InputFileFormat = 'jpg' | 'png' | 'mp4'

export interface FormatModelChoice {
  modelId: string
  modelPath?: string
}

export type FormatModelDefaults = Record<InputFileFormat, FormatModelChoice>

export const INPUT_FILE_FORMATS: InputFileFormat[] = ['jpg', 'png', 'mp4']

export const FORMAT_LABELS: Record<InputFileFormat, string> = {
  jpg: 'JPG / JPEG',
  png: 'PNG',
  mp4: 'MP4'
}

export const DEFAULT_FORMAT_MODEL_DEFAULTS: FormatModelDefaults = {
  jpg: { modelId: 'realesrgan-x4plus' },
  png: { modelId: 'realesrgan-x4plus' },
  mp4: { modelId: 'realesr-animevideov3' }
}

export function getInputFileFormat(filePath: string): InputFileFormat | null {
  const match = /\.([^.\\/]+)$/.exec(filePath)
  if (!match) return null
  const ext = match[1].toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg'
  if (ext === 'png') return 'png'
  if (ext === 'mp4') return 'mp4'
  return null
}

export function mergeFormatModelDefaults(
  partial?: Partial<FormatModelDefaults> | null
): FormatModelDefaults {
  return {
    jpg: { ...DEFAULT_FORMAT_MODEL_DEFAULTS.jpg, ...partial?.jpg },
    png: { ...DEFAULT_FORMAT_MODEL_DEFAULTS.png, ...partial?.png },
    mp4: { ...DEFAULT_FORMAT_MODEL_DEFAULTS.mp4, ...partial?.mp4 }
  }
}

export function resolveModelForFile(
  filePath: string,
  defaults: FormatModelDefaults | Partial<FormatModelDefaults> | undefined,
  fallback: FormatModelChoice
): FormatModelChoice {
  const format = getInputFileFormat(filePath)
  if (!format) return fallback
  const choice = defaults?.[format]
  if (!choice?.modelId) return fallback
  return {
    modelId: choice.modelId,
    modelPath: choice.modelPath
  }
}
