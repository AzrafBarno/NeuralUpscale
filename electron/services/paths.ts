import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export function getResourcesRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return path.join(__dirname, '../../resources')
}

export function getBinaryPath(): string {
  const platform = process.platform
  const binaryName = platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan'
  const binaryPath = path.join(getResourcesRoot(), 'bin', platform, binaryName)

  if (platform !== 'win32' && fs.existsSync(binaryPath)) {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // ignore chmod errors
    }
  }

  return binaryPath
}

export function getFfmpegPath(): string {
  const platform = process.platform
  const name = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const binaryPath = path.join(getResourcesRoot(), 'bin', platform, name)
  if (platform !== 'win32' && fs.existsSync(binaryPath)) {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // ignore
    }
  }
  return binaryPath
}

export function getFfprobePath(): string {
  const platform = process.platform
  const name = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const binaryPath = path.join(getResourcesRoot(), 'bin', platform, name)
  if (platform !== 'win32' && fs.existsSync(binaryPath)) {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // ignore
    }
  }
  return binaryPath
}

export function getRifeBinaryPath(): string {
  const platform = process.platform
  const name = platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan'
  const binaryPath = path.join(getResourcesRoot(), 'bin', platform, name)
  if (platform !== 'win32' && fs.existsSync(binaryPath)) {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // ignore
    }
  }
  return binaryPath
}

export function getRifeModelsDir(): string {
  return path.join(getResourcesRoot(), 'rife-models')
}

export function getDefaultRifeModelPath(): string {
  return path.join(getRifeModelsDir(), 'rife-v4.6')
}

export function checkRifeExists(): boolean {
  const bin = getRifeBinaryPath()
  const model = getDefaultRifeModelPath()
  return (
    fs.existsSync(bin) &&
    fs.existsSync(path.join(model, 'flownet.bin')) &&
    fs.existsSync(path.join(model, 'flownet.param'))
  )
}

export function getModelsDir(): string {
  return path.join(getResourcesRoot(), 'models')
}

export function checkModelsExist(): boolean {
  const modelsDir = getModelsDir()
  const bin = path.join(modelsDir, 'realesrgan-x4plus.bin')
  const param = path.join(modelsDir, 'realesrgan-x4plus.param')
  return fs.existsSync(bin) && fs.existsSync(param)
}

export function getGstScriptsDir(): string {
  return path.join(getResourcesRoot(), 'gst')
}

export function getGstUserRoot(): string {
  return path.join(app.getPath('userData'), 'gst')
}

export function getGstRuntimeDir(): string {
  return path.join(getGstUserRoot(), 'runtime')
}

export function getGstOnnxDir(): string {
  return path.join(getGstUserRoot(), 'onnx')
}

export function getGstEnginesDir(): string {
  return path.join(getGstUserRoot(), 'engines')
}

/** Portable VapourSynth + vs-mlrt plugins (Green Sparkle video path). */
export function getGstVsDir(): string {
  return path.join(getGstUserRoot(), 'vs')
}
