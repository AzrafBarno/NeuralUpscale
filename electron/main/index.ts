import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell
} from 'electron'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { Readable } from 'stream'
import { pathToFileURL } from 'url'
import Store from 'electron-store'
import { GpuDetectService } from '../services/gpu-detect.service'
import { UpscalerService } from '../services/upscaler.service'
import { FileService } from '../services/file.service'
import { checkModelsExist, checkRifeExists, getModelsDir } from '../services/paths'
import {
  BUILTIN_MODELS,
  DEFAULT_FORMAT_MODEL_DEFAULTS,
  DEFAULT_SETTINGS,
  resolveModelName,
  type AppSettings,
  type BatchOptions,
  type CustomModelInfo,
  type FormatModelDefaults,
  type InterpolationOptions,
  type UpscaleOptions,
  type VideoUpscaleOptions,
  type ScaleFactor
} from '../types'
import { VideoService } from '../services/video.service'
import { InterpolationService } from '../services/interpolation.service'
import { GstService } from '../services/gst.service'

const store = new Store<{ settings: AppSettings; customModels: CustomModelInfo[] }>({
  defaults: {
    settings: DEFAULT_SETTINGS,
    customModels: []
  }
})

function registerCustomModels(models: CustomModelInfo[]): void {
  const customModels = store.get('customModels') ?? []
  for (const model of models) {
    const existing = customModels.findIndex((m) => m.id === model.id && m.modelPath === model.modelPath)
    if (existing >= 0) customModels[existing] = model
    else customModels.push(model)
  }
  store.set('customModels', customModels)
}

function removeCustomModel(id: string, modelPath: string): CustomModelInfo[] {
  const customModels = (store.get('customModels') ?? []).filter(
    (m) => !(m.id === id && m.modelPath === modelPath)
  )
  store.set('customModels', customModels)
  return customModels
}

const gpuService = new GpuDetectService()
const upscalerService = new UpscalerService()
const fileService = new FileService()
const interpolationService = new InterpolationService()
const gstService = new GstService()
const videoService = new VideoService(interpolationService, gstService)

function modelIsAvailable(modelsDir: string, modelId: string, modelPath?: string): boolean {
  const dir = modelPath ?? modelsDir
  if (modelId === 'realesr-animevideov3') {
    return [2, 3, 4].some(
      (s) =>
        fs.existsSync(path.join(dir, `realesr-animevideov3-x${s}.bin`)) &&
        fs.existsSync(path.join(dir, `realesr-animevideov3-x${s}.param`))
    )
  }
  return (
    fs.existsSync(path.join(dir, `${modelId}.bin`)) &&
    fs.existsSync(path.join(dir, `${modelId}.param`))
  )
}

let mainWindow: BrowserWindow | null = null

function mergeFormatModelDefaults(
  partial?: Partial<FormatModelDefaults> | null
): FormatModelDefaults {
  return {
    jpg: { ...DEFAULT_FORMAT_MODEL_DEFAULTS.jpg, ...partial?.jpg },
    png: { ...DEFAULT_FORMAT_MODEL_DEFAULTS.png, ...partial?.png },
    mp4: { ...DEFAULT_FORMAT_MODEL_DEFAULTS.mp4, ...partial?.mp4 }
  }
}

function getSettings(): AppSettings {
  const stored = (store.get('settings') ?? {}) as Partial<AppSettings>
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    formatModelDefaults: mergeFormatModelDefaults(stored.formatModelDefaults)
  }

  if (!stored.lastUsedImageModel && stored.lastUsedModel) {
    if (stored.lastUsedModel === 'realesr-animevideov3') {
      merged.lastUsedImageModel = DEFAULT_SETTINGS.lastUsedImageModel
      merged.lastUsedImageModelPath = undefined
    } else {
      merged.lastUsedImageModel = stored.lastUsedModel
      merged.lastUsedImageModelPath = stored.lastUsedModelPath
    }
  }
  if (!stored.lastUsedVideoModel) {
    merged.lastUsedVideoModel =
      stored.lastUsedModel === 'realesr-animevideov3'
        ? stored.lastUsedModel
        : DEFAULT_SETTINGS.lastUsedVideoModel
    merged.lastUsedVideoModelPath =
      stored.lastUsedModel === 'realesr-animevideov3' ? stored.lastUsedModelPath : undefined
  }

  return merged
}

function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ...partial,
    formatModelDefaults: mergeFormatModelDefaults(
      partial.formatModelDefaults ?? current.formatModelDefaults
    )
  }
  store.set('settings', updated)
  return updated
}

function getAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png')
  }
  return path.join(__dirname, '../../build/icon.png')
}

function createWindow(): void {
  const iconPath = getAppIconPath()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0f0f0f',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function mimeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function nodeStreamToWeb(stream: fs.ReadStream): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream
}

async function serveLocalFile(request: Request, filePath: string): Promise<Response> {
  const stat = await fs.promises.stat(filePath)
  const fileSize = stat.size
  const contentType = mimeForPath(filePath)
  const rangeHeader = request.headers.get('Range') || request.headers.get('range')

  // HTML5 <video> requires byte-range responses; without them playback/seeking corrupts
  if (rangeHeader?.startsWith('bytes=')) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
    if (!match) {
      return new Response('Invalid range', { status: 416 })
    }
    const start = match[1] ? parseInt(match[1], 10) : 0
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= fileSize || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` }
      })
    }

    const stream = fs.createReadStream(filePath, { start, end })
    return new Response(nodeStreamToWeb(stream), {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes'
      }
    })
  }

  // Prefer net.fetch for full-file image loads (simple + fast)
  if (contentType.startsWith('image/')) {
    return net.fetch(pathToFileURL(filePath).href, { bypassCustomProtocolHandlers: true } as RequestInit)
  }

  const stream = fs.createReadStream(filePath)
  return new Response(nodeStreamToWeb(stream), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes'
    }
  })
}

function registerProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'local') {
      const filePath = decodeURIComponent(url.searchParams.get('path') ?? '')
      if (filePath && fs.existsSync(filePath)) {
        try {
          return await serveLocalFile(request, filePath)
        } catch (err) {
          return new Response(`Failed to read file: ${(err as Error).message}`, { status: 500 })
        }
      }
    }
    return new Response('Not found', { status: 404 })
  })
}

function registerIpc(): void {
  ipcMain.handle('gpu:detect', async () => {
    const info = await gpuService.detect()
    const settings = getSettings()
    return { ...info, gpuIndex: settings.gpuIndex >= 0 && info.vulkanSupported ? settings.gpuIndex : info.gpuIndex }
  })

  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:openVideo', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultName,
      filters: [
        { name: 'PNG', extensions: ['png'] },
        { name: 'JPEG', extensions: ['jpg', 'jpeg'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('dialog:saveVideo', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultName,
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('upscale:single', async (event, opts: UpscaleOptions) => {
    const settings = getSettings()
    const gpuIndex = settings.gpuIndex
    const outputPath = fileService.ensureDistinctOutputPath(
      opts.inputPath,
      opts.outputPath,
      opts.scale,
      opts.outputFormat
    )
    upscalerService.clearCancelFlags()
    return upscalerService.upscaleImage(
      {
        ...opts,
        outputPath,
        modelName: resolveModelName(opts.modelName, opts.scale),
        gpuIndex: gpuIndex >= 0 ? gpuIndex : -1
      },
      (progress) => {
        event.sender.send('upscale:progress', progress)
      }
    )
  })

  ipcMain.handle('upscale:batch', async (event, opts: BatchOptions) => {
    const settings = getSettings()
    const files = opts.files?.length
      ? opts.files
      : fileService.scanFolderRecursive(opts.inputFolder)

    files.forEach((f, i) => {
      event.sender.send('batch:progress', {
        fileIndex: i,
        fileName: path.basename(f),
        filePercent: 0,
        overallPercent: 0,
        status: 'queued' as const
      })
    })

    const result = await upscalerService.upscaleBatch(
      {
        ...opts,
        files,
        modelName: resolveModelName(opts.modelName, opts.scale),
        gpuIndex: settings.gpuIndex >= 0 ? settings.gpuIndex : -1
      },
      (progress) => {
        event.sender.send('batch:progress', progress)
      }
    )
    return result
  })

  ipcMain.handle('upscale:cancel', () => upscalerService.cancelBatch())
  ipcMain.handle('upscale:pause', () => upscalerService.pauseBatch())
  ipcMain.handle('upscale:resume', () => upscalerService.resumeBatch())

  ipcMain.handle('video:info', (_e, filePath: string) => videoService.getVideoInfo(filePath))

  ipcMain.handle('video:upscale', async (event, opts: VideoUpscaleOptions) => {
    const settings = getSettings()
    const modelName = resolveModelName(opts.modelName, opts.scale)
    const gpuIndex = settings.gpuIndex >= 0 ? settings.gpuIndex : -1
    const tileSize = opts.tileSize || settings.tileSize
    const threads = opts.threads || settings.threads

    const sendProgress = (progress: {
      stage: string
      percent: number
      message: string
      frameIndex?: number
      frameTotal?: number
    }): void => {
      event.sender.send('video:progress', progress)
    }

    if (opts.withInterpolation && !checkRifeExists()) {
      throw new Error('RIFE is not installed. Run npm run setup, or turn off Upscale with Interpolation.')
    }

    return videoService.upscaleVideo(
      {
        ...opts,
        modelName,
        gpuIndex,
        tileSize,
        threads,
        interpolationMode: settings.defaultInterpolationMode ?? 'multiplier',
        interpolationMultiplier: settings.defaultInterpolationMultiplier ?? 2,
        interpolationTargetFps: settings.defaultInterpolationTargetFps ?? 60,
        greenSparkleEnabled: Boolean(opts.greenSparkleEnabled ?? settings.greenSparkleEnabled)
      },
      sendProgress
    )
  })

  ipcMain.handle('video:cancel', () => {
    videoService.cancel()
    interpolationService.cancel()
    gstService.cancel()
    return true
  })
  ipcMain.on('video:cancel', () => {
    videoService.cancel()
    interpolationService.cancel()
    gstService.cancel()
  })

  ipcMain.handle('interpolate:run', async (event, opts: InterpolationOptions) => {
    const settings = getSettings()
    return interpolationService.interpolate(
      {
        ...opts,
        gpuIndex: settings.gpuIndex >= 0 ? settings.gpuIndex : -1,
        threads: opts.threads || settings.threads
      },
      (progress) => {
        event.sender.send('interpolate:progress', progress)
      }
    )
  })

  ipcMain.handle('interpolate:cancel', () => {
    interpolationService.cancel()
    return true
  })
  ipcMain.on('interpolate:cancel', () => {
    interpolationService.cancel()
  })

  ipcMain.handle('rife:check', () => checkRifeExists())

  ipcMain.handle(
    'gst:status',
    (_e, payload: { modelName: string; scale: ScaleFactor; modelPath?: string }) => {
      const settings = getSettings()
      const modelName = resolveModelName(payload.modelName, payload.scale)
      return gstService.getStatus(modelName, payload.modelPath, settings.greenSparkleEnabled)
    }
  )

  ipcMain.handle(
    'gst:enable',
    async (
      event,
      payload: { modelName: string; scale: ScaleFactor; modelPath?: string }
    ) => {
      const modelName = resolveModelName(payload.modelName, payload.scale)
      const status = await gstService.enableAndCompile(
        modelName,
        payload.scale,
        payload.modelPath,
        (progress) => {
          event.sender.send('gst:progress', progress)
        }
      )
      saveSettings({ greenSparkleEnabled: true })
      return status
    }
  )

  ipcMain.handle('gst:disable', () => {
    saveSettings({ greenSparkleEnabled: false })
    return true
  })

  ipcMain.handle('gst:cancel', () => {
    gstService.cancel()
    return true
  })
  ipcMain.on('gst:cancel', () => {
    gstService.cancel()
  })

  ipcMain.handle(
    'gst:recompile',
    async (
      event,
      payload: { modelName: string; scale: ScaleFactor; modelPath?: string }
    ) => {
      const settings = getSettings()
      const modelName = resolveModelName(payload.modelName, payload.scale)
      const status = await gstService.getStatus(modelName, payload.modelPath, settings.greenSparkleEnabled)
      if (status.enginePath && fs.existsSync(status.enginePath)) {
        fs.unlinkSync(status.enginePath)
        const meta = status.enginePath.replace(/\.engine$/i, '.json')
        if (fs.existsSync(meta)) fs.unlinkSync(meta)
      }
      const next = await gstService.enableAndCompile(
        modelName,
        payload.scale,
        payload.modelPath,
        (progress) => {
          event.sender.send('gst:progress', progress)
        }
      )
      saveSettings({ greenSparkleEnabled: true })
      return next
    }
  )

  ipcMain.handle('model:load', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Model', extensions: ['bin'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const binPath = result.filePaths[0]
    const paramPath = binPath.replace(/\.bin$/i, '.param')
    if (!fs.existsSync(paramPath)) {
      throw new Error(`Missing .param file: ${paramPath}`)
    }

    const model: CustomModelInfo = {
      id: path.basename(binPath, '.bin'),
      label: path.basename(binPath, '.bin'),
      modelPath: path.dirname(binPath)
    }

    registerCustomModels([model])
    return model
  })

  ipcMain.handle('model:loadFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select folder containing model weights'
    })
    if (result.canceled || !result.filePaths[0]) return null

    const folderPath = result.filePaths[0]
    const models = fileService.scanModelPairs(folderPath, true)
    if (models.length === 0) {
      throw new Error('No valid model pairs found. Each model needs a .bin and matching .param file.')
    }

    registerCustomModels(models)
    return { folderPath, models, imported: models.length }
  })

  ipcMain.handle('model:removeCustom', (_e, payload: { id: string; modelPath: string }) => {
    if (!payload?.id || !payload?.modelPath) {
      throw new Error('Missing model id or path')
    }
    return removeCustomModel(payload.id, payload.modelPath)
  })

  ipcMain.handle('model:list', async () => {
    const customModels = store.get('customModels') ?? []
    const modelsDir = getModelsDir()
    const all = [...BUILTIN_MODELS, ...customModels.map((m) => ({ ...m, isCustom: true, maxScale: 4 }))]
    return all.filter((m) => modelIsAvailable(modelsDir, m.id, m.modelPath))
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial: Partial<AppSettings>) => saveSettings(partial))

  ipcMain.handle('device:info', async () => {
    const gpuInfo = await gpuService.detect()
    const cpus = os.cpus()
    const cpuModel = cpus[0]?.model ?? 'Unknown CPU'
    const cpuCores = new Set(cpus.map((c, i) => Math.floor(i / 2))).size === cpus.length
      ? cpus.length
      : Math.ceil(cpus.length / 2)
    const cpuThreads = cpus.length
    const totalRamMB = Math.round(os.totalmem() / 1024 / 1024)
    const platform = process.platform
    const osArch = os.arch()
    let osName = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
    try {
      if (platform === 'win32') {
        const { execSync } = await import('child_process')
        const ver = execSync('ver', { encoding: 'utf-8', shell: 'cmd.exe', windowsHide: true }).trim()
        if (ver) osName = ver.replace(/\r?\n.*/s, '').trim()
      } else if (platform === 'darwin') {
        const { execSync } = await import('child_process')
        const sw = execSync('sw_vers -productVersion', { encoding: 'utf-8', timeout: 3000 }).trim()
        if (sw) osName = `macOS ${sw}`
      } else {
        const { execSync } = await import('child_process')
        const id = execSync('lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\' ', { encoding: 'utf-8', timeout: 3000 }).trim()
        if (id) osName = id
      }
    } catch { /* ignore */ }
    return {
      cpuModel,
      cpuCores,
      cpuThreads,
      totalRamMB,
      osName,
      osArch,
      gpuName: gpuInfo.gpuName,
      gpuVulkan: gpuInfo.vulkanSupported,
      gpuNvidia: !!gpuInfo.nvidia,
      gpuVramMB: gpuInfo.vramMB,
      gpuComputeCap: gpuInfo.computeCap
    }
  })

  ipcMain.handle('file:info', (_e, filePath: string) => fileService.getFileInfo(filePath))

  ipcMain.handle('file:imageUrl', (_e, filePath: string) => {
    return `app://local?path=${encodeURIComponent(filePath)}`
  })

  const thumbnailCache = new Map<string, string>()
  ipcMain.handle('file:thumbnail', async (_e, filePath: string) => {
    const cached = thumbnailCache.get(filePath)
    if (cached) return cached
    const dataUrl = await fileService.createThumbnailDataUrl(filePath)
    if (dataUrl) thumbnailCache.set(filePath, dataUrl)
    return dataUrl
  })

  ipcMain.handle('file:scan', (_e, folderPath: string) =>
    fileService.scanFolderRecursive(folderPath)
  )

  ipcMain.handle('file:scanVideos', (_e, folderPath: string) =>
    fileService.scanVideoFolder(folderPath)
  )

  ipcMain.handle(
    'file:buildOutput',
    (_e, inputPath: string, outputDir: string, scale: number, modelName: string, format: string, pattern?: string) =>
      fileService.buildOutputPath(inputPath, outputDir, scale, modelName, format, pattern)
  )

  ipcMain.handle('models:check', () => checkModelsExist())

  ipcMain.handle('setup:run', async () => {
    try {
      const { execSync } = await import('child_process')
      execSync('npm run setup', { cwd: app.getAppPath(), stdio: 'pipe' })
      return { success: true, message: 'Setup completed successfully.' }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.on('shell:open', (_e, filePath: string) => fileService.openInExplorer(filePath))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
      return true
    }
    return false
  })
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

app.whenReady().then(() => {
  registerProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
