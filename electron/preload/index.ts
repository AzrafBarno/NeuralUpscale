import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  BatchOptions,
  BatchProgressEvent,
  ProgressEvent,
  UpscaleOptions,
  VideoProgressEvent,
  VideoUpscaleOptions,
  InterpolationOptions,
  InterpolationProgressEvent,
  GstProgressEvent,
  GstStatus,
  ScaleFactor
} from '../types'

contextBridge.exposeInMainWorld('electronAPI', {
  detectGpu: () => ipcRenderer.invoke('gpu:detect'),
  getDeviceInfo: () => ipcRenderer.invoke('device:info'),

  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openVideoDialog: () => ipcRenderer.invoke('dialog:openVideo'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFileDialog: (defaultName: string) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  saveVideoDialog: (defaultName: string) => ipcRenderer.invoke('dialog:saveVideo', defaultName),

  upscaleSingle: (opts: UpscaleOptions) => ipcRenderer.invoke('upscale:single', opts),
  upscaleBatch: (opts: BatchOptions) => ipcRenderer.invoke('upscale:batch', opts),
  cancelBatch: () => ipcRenderer.invoke('upscale:cancel'),
  pauseBatch: () => ipcRenderer.invoke('upscale:pause'),
  resumeBatch: () => ipcRenderer.invoke('upscale:resume'),

  getVideoInfo: (filePath: string) => ipcRenderer.invoke('video:info', filePath),
  upscaleVideo: (opts: VideoUpscaleOptions) => ipcRenderer.invoke('video:upscale', opts),
  cancelVideo: () => {
    ipcRenderer.send('video:cancel')
    return ipcRenderer.invoke('video:cancel')
  },
  onVideoProgress: (cb: (data: VideoProgressEvent) => void) => {
    ipcRenderer.removeAllListeners('video:progress')
    ipcRenderer.on('video:progress', (_e, data) => cb(data))
  },
  offVideoProgress: () => ipcRenderer.removeAllListeners('video:progress'),

  interpolateVideo: (opts: InterpolationOptions) => ipcRenderer.invoke('interpolate:run', opts),
  cancelInterpolate: () => {
    ipcRenderer.send('interpolate:cancel')
    return ipcRenderer.invoke('interpolate:cancel')
  },
  onInterpolateProgress: (cb: (data: InterpolationProgressEvent) => void) => {
    ipcRenderer.removeAllListeners('interpolate:progress')
    ipcRenderer.on('interpolate:progress', (_e, data) => cb(data))
  },
  offInterpolateProgress: () => ipcRenderer.removeAllListeners('interpolate:progress'),
  checkRifeExists: () => ipcRenderer.invoke('rife:check'),

  getGstStatus: (opts: { modelName: string; scale: ScaleFactor; modelPath?: string }) =>
    ipcRenderer.invoke('gst:status', opts),
  enableGst: (opts: { modelName: string; scale: ScaleFactor; modelPath?: string }) =>
    ipcRenderer.invoke('gst:enable', opts),
  disableGst: () => ipcRenderer.invoke('gst:disable'),
  recompileGst: (opts: { modelName: string; scale: ScaleFactor; modelPath?: string }) =>
    ipcRenderer.invoke('gst:recompile', opts),
  cancelGst: () => {
    ipcRenderer.send('gst:cancel')
    return ipcRenderer.invoke('gst:cancel')
  },
  onGstProgress: (cb: (data: GstProgressEvent) => void) => {
    ipcRenderer.removeAllListeners('gst:progress')
    ipcRenderer.on('gst:progress', (_e, data) => cb(data))
  },
  offGstProgress: () => ipcRenderer.removeAllListeners('gst:progress'),

  onProgress: (cb: (data: ProgressEvent) => void) => {
    ipcRenderer.removeAllListeners('upscale:progress')
    ipcRenderer.on('upscale:progress', (_e, data) => cb(data))
  },
  onBatchProgress: (cb: (data: BatchProgressEvent) => void) => {
    ipcRenderer.removeAllListeners('batch:progress')
    ipcRenderer.on('batch:progress', (_e, data) => cb(data))
  },
  offProgress: () => ipcRenderer.removeAllListeners('upscale:progress'),
  offBatchProgress: () => ipcRenderer.removeAllListeners('batch:progress'),

  loadCustomModel: () => ipcRenderer.invoke('model:load'),
  loadCustomModelFolder: () => ipcRenderer.invoke('model:loadFolder'),
  removeCustomModel: (id: string, modelPath: string) =>
    ipcRenderer.invoke('model:removeCustom', { id, modelPath }),
  getAvailableModels: () => ipcRenderer.invoke('model:list'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),

  openInExplorer: (filePath: string) => ipcRenderer.send('shell:open', filePath),

  getFileInfo: (filePath: string) => ipcRenderer.invoke('file:info', filePath),
  getImageUrl: (filePath: string) => ipcRenderer.invoke('file:imageUrl', filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke('file:thumbnail', filePath),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('file:scan', folderPath),
  scanVideoFolder: (folderPath: string) => ipcRenderer.invoke('file:scanVideos', folderPath),
  buildOutputPath: (
    inputPath: string,
    outputDir: string,
    scale: number,
    modelName: string,
    format: string,
    pattern?: string
  ) => ipcRenderer.invoke('file:buildOutput', inputPath, outputDir, scale, modelName, format, pattern),

  checkModelsExist: () => ipcRenderer.invoke('models:check'),
  runSetup: () => ipcRenderer.invoke('setup:run'),

  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  getPlatform: (): string => process.platform,
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
})
