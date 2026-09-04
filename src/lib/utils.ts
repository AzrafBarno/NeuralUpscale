import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function calcEta(startTime: number, progress: number): number {
  if (progress <= 0) return Infinity
  const elapsed = (Date.now() - startTime) / 1000
  return (elapsed / progress) * (1 - progress)
}

export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/'
  let result = base.replace(/[/\\]+$/, '')
  for (const part of parts) {
    const cleaned = part.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '')
    if (cleaned) result += `${sep}${cleaned}`
  }
  return result
}

function normFolderPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Batch image output folder: `<input>/neuralupscale_<model>_<scale>x_upscaled` */
export function buildImageBatchOutputDir(
  inputFolder: string,
  modelName: string,
  scale: number
): string {
  return joinPath(inputFolder, `neuralupscale_${modelName}_${scale}x_upscaled`)
}

export function isImageBatchOutputDir(outputFolder: string, inputFolder: string): boolean {
  const out = normFolderPath(outputFolder)
  const prefix = `${normFolderPath(inputFolder)}/neuralupscale_`
  return out.startsWith(prefix) && out.endsWith('_upscaled')
}

export function resolveVideoComboTargetFps(
  settings:
    | {
        defaultInterpolationMode?: 'multiplier' | 'targetFps'
        defaultInterpolationMultiplier?: number
        defaultInterpolationTargetFps?: number
      }
    | null
    | undefined,
  sourceFps?: number
): number {
  if (settings?.defaultInterpolationMode === 'targetFps') {
    return Math.round(Math.max(1, settings.defaultInterpolationTargetFps ?? 60))
  }
  const multiplier = settings?.defaultInterpolationMultiplier === 4 ? 4 : 2
  const fps = sourceFps && sourceFps > 0 ? sourceFps : 30
  return Math.round(fps * multiplier)
}

/** Batch video upscale+interpolation folder: `<input>/neuralupscale_<model>_<scale>_<targetfps>_processed` */
export function buildVideoComboBatchOutputDir(
  inputFolder: string,
  modelName: string,
  scale: number,
  targetFps: number
): string {
  return joinPath(
    inputFolder,
    `neuralupscale_${modelName}_${scale}_${Math.round(targetFps)}_processed`
  )
}

export function isVideoComboBatchOutputDir(outputFolder: string, inputFolder: string): boolean {
  const out = normFolderPath(outputFolder)
  const prefix = `${normFolderPath(inputFolder)}/neuralupscale_`
  return out.startsWith(prefix) && out.endsWith('_processed')
}
