import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import type { GstProgressEvent, GstStatus, ScaleFactor } from '../types'
import { GpuDetectService, buildGpuFingerprint } from './gpu-detect.service'
import { killProcessTree } from './process-kill'
import {
  getGstEnginesDir,
  getGstOnnxDir,
  getGstRuntimeDir,
  getGstScriptsDir
} from './paths'
import {
  buildVsProcessEnv,
  ensureVsRuntime,
  getGstVsScriptPath,
  getVspipePath,
  vsRuntimeReady
} from './gst-vs-runtime'

const PYTHON_EMBED_URL = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip'
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

const ANIME_V3_X4_ONNX =
  'https://huggingface.co/tidus2102/Real-ESRGAN/resolve/main/RealESR-AnimeVideo-v3_x4.onnx'
const X4PLUS_ONNX =
  'https://huggingface.co/qualcomm/Real-ESRGAN-x4plus/resolve/main/Real-ESRGAN-x4plus.onnx'

/**
 * Canonical ONNX graphs that actually exist on Hugging Face.
 * tidus2102/Real-ESRGAN only publishes AnimeVideo-v3 x4 (not x2/x3).
 */
export const GST_ONNX_CATALOG: Record<string, string> = {
  'realesr-animevideov3-x4': ANIME_V3_X4_ONNX,
  'realesrgan-x4plus': X4PLUS_ONNX
}

/** Builtin models → canonical ONNX key. Missing graphs reuse the closest 4x ONNX, then downscale. */
const GST_ONNX_ALIAS: Record<string, string> = {
  'realesr-animevideov3-x2': 'realesr-animevideov3-x4',
  'realesr-animevideov3-x3': 'realesr-animevideov3-x4',
  'realesr-animevideov3-x4': 'realesr-animevideov3-x4',
  'realesrgan-x4plus': 'realesrgan-x4plus',
  'realesrgan-x4plus-anime': 'realesr-animevideov3-x4',
  'realesrnet-x4plus': 'realesrgan-x4plus'
}

export function gstOnnxKey(resolvedModelName: string): string {
  if (GST_ONNX_ALIAS[resolvedModelName]) return GST_ONNX_ALIAS[resolvedModelName]

  // Custom / alternate filenames that are still Real-ESRGAN family
  const lower = resolvedModelName.toLowerCase()
  if (lower.includes('animevideov3') || lower.includes('animevideo')) {
    return 'realesr-animevideov3-x4'
  }
  if (lower.includes('x4plus-anime') || lower.includes('anime')) {
    // Prefer anime ONNX for anime-tagged custom weights; general x4plus otherwise below
    if (lower.includes('realesrgan') || lower.includes('realesr')) {
      return 'realesr-animevideov3-x4'
    }
  }
  if (lower.includes('realesrnet-x4plus') || lower.includes('realesrnet')) {
    return 'realesrgan-x4plus'
  }
  if (lower.includes('realesrgan-x4plus') || lower.includes('x4plus')) {
    return 'realesrgan-x4plus'
  }
  return resolvedModelName
}

/** Native scale of the ONNX graph itself (all catalog graphs are 4x). */
export function gstOnnxNativeScale(_resolvedModelName: string): ScaleFactor {
  return 4
}

/** CUDA 12 TensorRT. The unversioned `tensorrt` meta-package now defaults to CUDA 13
 *  and pypi.nvidia.com still serves a 10.0.0b6 wheel that cannot resolve tensorrt-cu12. */
const PIP_BASE_PACKAGES = ['numpy', 'pillow', 'cuda-python>=12.6,<13']
const PIP_TENSORRT_PACKAGES = ['tensorrt-cu12>=10.10,<11']

/**
 * GST uses catalog ONNX graphs (not NCNN .bin/.param). Custom models are supported when
 * their name maps to a known Real-ESRGAN ONNX — modelPath alone does not block GST.
 */
export function isGstModelSupported(resolvedModelName: string, _modelPath?: string): boolean {
  return Boolean(GST_ONNX_CATALOG[gstOnnxKey(resolvedModelName)])
}

export function pickGstTileSize(vramMB?: number): number {
  if (!vramMB || vramMB < 8000) return 64
  if (vramMB < 12000) return 128
  return 192
}

function fileHash12(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex').slice(0, 12)
}

function sanitize(name: string): string {
  return name.replace(/[^\w.-]+/g, '_')
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    const tmpPath = destPath + '.tmp'
    const file = fs.createWriteStream(tmpPath)

    const request = (requestUrl: string, redirects = 0): void => {
      if (redirects > 8) {
        reject(new Error(`Too many redirects for ${url}`))
        return
      }
      const client = requestUrl.startsWith('https') ? https : http
      client
        .get(requestUrl, { headers: { 'User-Agent': 'NeuralUpscale' } }, (response) => {
          const code = response.statusCode ?? 0
          if (code >= 300 && code < 400 && response.headers.location) {
            request(response.headers.location, redirects + 1)
            return
          }
          if (code !== 200) {
            reject(new Error(`Download failed: HTTP ${code} for ${requestUrl}`))
            return
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close()
            fs.renameSync(tmpPath, destPath)
            resolve()
          })
        })
        .on('error', (err) => {
          fs.unlink(tmpPath, () => reject(err))
        })
    }

    request(url)
  })
}

function runCapture(
  bin: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export class GstService {
  private proc: ChildProcess | null = null
  private cancelled = false
  private gpuDetect = new GpuDetectService()

  clearCancelFlags(): void {
    this.cancelled = false
  }

  cancel(): void {
    this.cancelled = true
    const proc = this.proc
    this.proc = null
    killProcessTree(proc)
  }

  async getStatus(resolvedModelName: string, modelPath?: string, enabled = false): Promise<GstStatus> {
    const gpu = await this.gpuDetect.detect()
    const platformSupported = process.platform !== 'darwin' && gpu.nvidia
    const modelSupported = isGstModelSupported(resolvedModelName, modelPath)
    if (!platformSupported) {
      return {
        nvidia: gpu.nvidia,
        platformSupported: false,
        modelSupported,
        runtimeReady: false,
        engineReady: false,
        enabled: false,
        gpuName: gpu.nvidiaName || gpu.gpuName,
        message: process.platform === 'darwin'
          ? 'Green Sparkle Technology requires an NVIDIA GPU (not available on macOS).'
          : 'Green Sparkle Technology requires an NVIDIA GPU.'
      }
    }

    const python = this.getPythonPath()
    const vsReady = vsRuntimeReady()
    const runtimeReady = Boolean(
      python && this.workerExists() && this.tensorrtMarkerExists() && vsReady
    )
    const fingerprint = gpu.fingerprint || buildGpuFingerprint(gpu)
    const tileSize = pickGstTileSize(gpu.vramMB)
    const onnxKey = gstOnnxKey(resolvedModelName)
    let engineReady = false
    let enginePath: string | undefined
    if (runtimeReady && modelSupported) {
      const onnxPath = this.onnxDest(onnxKey)
      if (fs.existsSync(onnxPath)) {
        enginePath = this.enginePath(fingerprint, onnxKey, tileSize, fileHash12(onnxPath))
        engineReady = fs.existsSync(enginePath)
      }
    }

    return {
      nvidia: true,
      platformSupported: true,
      modelSupported,
      runtimeReady,
      engineReady,
      enabled: enabled && engineReady,
      gpuName: gpu.nvidiaName || gpu.gpuName,
      fingerprint,
      tileSize,
      enginePath,
      message: !modelSupported
        ? 'This model has no TensorRT ONNX mapping. Use a Real-ESRGAN Anime Video / x4plus-style model for Green Sparkle.'
        : engineReady
          ? 'VapourSynth + TensorRT engine ready.'
          : runtimeReady
            ? 'Runtime installed. Engine will compile on enable.'
            : vsReady
              ? 'NVIDIA GPU detected. First enable downloads TensorRT (~1 GB) and compiles an engine.'
              : 'NVIDIA GPU detected. First enable installs VapourSynth + TensorRT and compiles an engine.'
    }
  }

  async enableAndCompile(
    resolvedModelName: string,
    _scale: ScaleFactor,
    modelPath: string | undefined,
    onProgress?: (event: GstProgressEvent) => void
  ): Promise<GstStatus> {
    this.cancelled = false
    const gpu = await this.gpuDetect.detect()
    this.throwIfCancelled()

    if (process.platform === 'darwin' || !gpu.nvidia) {
      throw new Error('Green Sparkle Technology requires an NVIDIA GPU on Windows or Linux.')
    }
    if (!isGstModelSupported(resolvedModelName, modelPath)) {
      throw new Error(
        'Green Sparkle Technology needs a Real-ESRGAN family model (Anime Video, x4plus, etc.). This model stays on Vulkan.'
      )
    }

    const fingerprint = gpu.fingerprint || buildGpuFingerprint(gpu)
    const tile = pickGstTileSize(gpu.vramMB)
    const onnxKey = gstOnnxKey(resolvedModelName)
    const nativeScale = gstOnnxNativeScale(resolvedModelName)

    await this.ensureRuntime((percent, message) => {
      onProgress?.({ stage: 'runtime', percent: Math.min(40, percent), message })
    })
    this.throwIfCancelled()

    await ensureVsRuntime((percent, message) => {
      onProgress?.({ stage: 'runtime', percent, message })
    }, () => this.throwIfCancelled())
    this.throwIfCancelled()

    const onnxPath = await this.ensureOnnx(onnxKey, resolvedModelName, (percent, message) => {
      onProgress?.({ stage: 'onnx', percent: 55 + percent * 0.1, message })
    })
    this.throwIfCancelled()

    const hash = fileHash12(onnxPath)
    const enginePath = this.enginePath(fingerprint, onnxKey, tile, hash)
    if (!fs.existsSync(enginePath)) {
      onProgress?.({
        stage: 'compile',
        percent: 68,
        message: `Compiling TensorRT engine for ${gpu.nvidiaName || gpu.gpuName}…`
      })
      await this.buildEngine(onnxPath, enginePath, tile, nativeScale, (message) => {
        onProgress?.({ stage: 'compile', percent: 75, message })
      })
    }

    this.throwIfCancelled()
    onProgress?.({
      stage: 'ready',
      percent: 100,
      message: 'Green Sparkle Technology is ready (VapourSynth + TensorRT)'
    })
    return this.getStatus(resolvedModelName, modelPath, true)
  }

  async ensureEngine(
    resolvedModelName: string,
    scale: ScaleFactor,
    modelPath: string | undefined,
    onProgress?: (event: GstProgressEvent) => void
  ): Promise<{ enginePath: string; tile: number }> {
    const status = await this.enableAndCompile(resolvedModelName, scale, modelPath, onProgress)
    if (!status.enginePath || !fs.existsSync(status.enginePath)) {
      throw new Error('TensorRT engine was not created')
    }
    return { enginePath: status.enginePath, tile: status.tileSize ?? 128 }
  }

  async inferFolder(
    framesIn: string,
    framesOut: string,
    enginePath: string,
    scale: ScaleFactor,
    tile: number,
    onProgress?: (frameIndex: number, frameTotal: number, percent: number) => void
  ): Promise<void> {
    this.cancelled = false
    const python = this.requirePython()
    const worker = this.requireWorker()
    fs.mkdirSync(framesOut, { recursive: true })

    const args = [
      worker,
      'infer',
      '--engine',
      enginePath,
      '--input-dir',
      framesIn,
      '--output-dir',
      framesOut,
      '--scale',
      '4',
      '--target-scale',
      String(scale),
      '--tile',
      String(tile)
    ]

    await this.runWorker(python, args, (line) => {
      const match = line.match(/GST_FRAME\s+(\d+)\/(\d+)\s+([\d.]+)%/)
      if (match) {
        onProgress?.(parseInt(match[1], 10), parseInt(match[2], 10), parseFloat(match[3]))
      }
    })
  }

  /**
   * Spawn vspipe for GPU-resident vs-mlrt TensorRT upscale (raw yuv420p on stdout).
   * R79: omit -c for raw frames. Do not use -c y4m — ffmpeg 6.1 rejects long VS headers.
   */
  spawnVspipeUpscale(opts: {
    inputPath: string
    enginePath: string
    tile: number
    scale: ScaleFactor
    /** yuv420p for NVENC; yuv444p for full-chroma PNG dump → RIFE */
    outputFormat?: 'yuv420p' | 'yuv444p' | 'gbrp' | 'rgb24' | 'bgr32'
    onProgressLine?: (line: string) => void
  }): ChildProcess {
    this.cancelled = false
    if (!vsRuntimeReady()) {
      throw new Error(
        'VapourSynth runtime is not installed. Enable Green Sparkle again to finish setup.'
      )
    }
    let vspipe = getVspipePath()
    if (!vspipe) {
      throw new Error('vspipe.exe not found. Re-enable Green Sparkle to reinstall VapourSynth.')
    }
    // Never spawn the .bat stub via Node — it breaks binary stdout pipes on Windows.
    if (/\.bat$/i.test(vspipe)) {
      const resolved = vspipe.replace(/vspipe\.bat$/i, 'Lib\\site-packages\\vapoursynth\\vspipe.exe')
      if (fs.existsSync(resolved)) vspipe = resolved
      else {
        throw new Error(
          'vspipe.bat found but vspipe.exe is missing. Delete %AppData%\\neuralupscale\\gst\\vs and re-enable Green Sparkle.'
        )
      }
    }
    const script = getGstVsScriptPath()
    if (!fs.existsSync(script)) {
      throw new Error(`VapourSynth script missing at ${script}`)
    }

    const overlap = Math.min(16, Math.max(0, Math.floor(opts.tile / 8)))
    const outputFormat = opts.outputFormat || 'yuv420p'
    const env = buildVsProcessEnv({
      GST_VS_INPUT: opts.inputPath,
      GST_VS_ENGINE: opts.enginePath,
      GST_VS_TILE: String(opts.tile),
      GST_VS_OVERLAP: String(overlap),
      GST_VS_NATIVE_SCALE: '4',
      GST_VS_TARGET_SCALE: String(opts.scale),
      GST_VS_OUTPUT: outputFormat
    })

    // No -c flag → raw planar frames on stdout (R79 has no "raw" container type).
    // Avoid -c y4m: ffmpeg 6.1 hits "Header too large" on VS colorimetry X-tags.
    const args = ['-p', script, '-']
    const proc = spawn(vspipe, args, {
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = proc
    this.lastVspipeStderr = ''

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      this.lastVspipeStderr += text
      if (this.lastVspipeStderr.length > 8000) {
        this.lastVspipeStderr = this.lastVspipeStderr.slice(-4000)
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) opts.onProgressLine?.(line)
      }
    })

    if (this.cancelled) {
      this.proc = null
      killProcessTree(proc)
      throw new Error('__CANCELLED__')
    }
    return proc
  }

  /** Last stderr from vspipe (for richer encode-pipe errors). */
  lastVspipeStderr = ''

  waitChild(proc: ChildProcess, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (this.proc === proc) this.proc = null
        if (this.cancelled) {
          reject(new Error('__CANCELLED__'))
          return
        }
        if (code === 0) resolve()
        else {
          reject(
            new Error(
              `${label} exited ${code}\n${(this.lastVspipeStderr || '').slice(-1500)}`
            )
          )
        }
      })
      proc.on('error', (err) => {
        if (this.proc === proc) this.proc = null
        reject(err)
      })
    })
  }

  private enginePath(fingerprint: string, model: string, tile: number, hash: string): string {
    return path.join(
      getGstEnginesDir(),
      sanitize(fingerprint),
      `${sanitize(model)}_vsmlrt_t${tile}_fp16_${hash}.engine`
    )
  }

  private onnxDest(model: string): string {
    return path.join(getGstOnnxDir(), `${sanitize(model)}.onnx`)
  }

  private workerExists(): boolean {
    return fs.existsSync(path.join(getGstScriptsDir(), 'gst_worker.py'))
  }

  private requireWorker(): string {
    const worker = path.join(getGstScriptsDir(), 'gst_worker.py')
    if (!fs.existsSync(worker)) {
      throw new Error(`GST worker missing at ${worker}`)
    }
    return worker
  }

  private getPythonPath(): string | null {
    if (process.platform === 'win32') {
      const embed = path.join(getGstRuntimeDir(), 'python', 'python.exe')
      if (fs.existsSync(embed)) return embed
      return null
    }
    const venv = path.join(getGstRuntimeDir(), 'venv', 'bin', 'python')
    if (fs.existsSync(venv)) return venv
    return null
  }

  private requirePython(): string {
    const python = this.getPythonPath()
    if (!python) throw new Error('Green Sparkle runtime is not installed')
    return python
  }

  private tensorrtMarkerExists(): boolean {
    const python = this.getPythonPath()
    if (!python) return false
    if (process.platform === 'win32') {
      const site = path.join(path.dirname(python), 'Lib', 'site-packages')
      return ['tensorrt', 'tensorrt_cu12', 'tensorrt_libs'].some((name) =>
        fs.existsSync(path.join(site, name))
      )
    }
    try {
      const lib = path.join(getGstRuntimeDir(), 'venv', 'lib')
      const dirs = fs.existsSync(lib) ? fs.readdirSync(lib) : []
      return dirs.some((d) => {
        const site = path.join(lib, d, 'site-packages')
        return ['tensorrt', 'tensorrt_cu12', 'tensorrt_libs'].some((name) =>
          fs.existsSync(path.join(site, name))
        )
      })
    } catch {
      return false
    }
  }

  private workerEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      CUDA_MODULE_LOADING: 'LAZY',
      NVIDIA_TENSORRT_DISABLE_INTERNAL_PIP: '0'
    }
    const python = this.getPythonPath()
    if (!python) return env
    const extra: string[] = []
    const roots =
      process.platform === 'win32'
        ? [path.join(path.dirname(python), 'Lib', 'site-packages')]
        : this.linuxSitePackages()

    for (const site of roots) {
      extra.push(
        path.join(site, 'nvidia', 'cuda_runtime', 'bin'),
        path.join(site, 'nvidia', 'cublas', 'bin'),
        path.join(site, 'nvidia', 'cudnn', 'bin'),
        path.join(site, 'nvidia', 'cuda_nvrtc', 'bin'),
        path.join(site, 'tensorrt_libs'),
        path.join(site, 'nvidia', 'cufft', 'bin')
      )
    }
    const existing = env.PATH || env.Path || ''
    const joined = [...extra.filter((p) => fs.existsSync(p)), existing].join(path.delimiter)
    env.PATH = joined
    if (process.platform === 'win32') env.Path = joined
    return env
  }

  private linuxSitePackages(): string[] {
    const lib = path.join(getGstRuntimeDir(), 'venv', 'lib')
    if (!fs.existsSync(lib)) return []
    return fs
      .readdirSync(lib)
      .filter((d) => d.startsWith('python'))
      .map((d) => path.join(lib, d, 'site-packages'))
  }

  private async ensureRuntime(
    onProgress: (percent: number, message: string) => void
  ): Promise<void> {
    if (this.tensorrtMarkerExists()) {
      onProgress(50, 'TensorRT runtime ready')
      return
    }

    fs.mkdirSync(getGstRuntimeDir(), { recursive: true })
    if (process.platform === 'win32') {
      await this.ensureWindowsPython(onProgress)
    } else {
      await this.ensureLinuxVenv(onProgress)
    }
    this.throwIfCancelled()

    const python = this.requirePython()
    await this.ensurePipTools(python, onProgress)
    this.throwIfCancelled()

    onProgress(28, 'Installing NumPy, Pillow, and CUDA Python…')
    const onPipLine = (line: string): void => {
      if (/Downloading|Installing|Successfully|Collecting/i.test(line)) {
        onProgress(40, line.trim().slice(0, 120))
      }
    }
    await this.pip(python, ['install', ...PIP_BASE_PACKAGES], onPipLine)
    this.throwIfCancelled()

    onProgress(38, 'Installing TensorRT (CUDA 12)…')
    await this.pip(python, ['install', 'wheel_stub'], onPipLine)
    await this.pip(
      python,
      [
        'install',
        '--no-build-isolation',
        '--extra-index-url',
        'https://pypi.nvidia.com',
        ...PIP_TENSORRT_PACKAGES
      ],
      onPipLine
    )
    if (!this.tensorrtMarkerExists()) {
      throw new Error('TensorRT installed but the tensorrt package was not found. Try Green Sparkle again.')
    }
    onProgress(50, 'TensorRT runtime installed')
  }

  private async pip(
    python: string,
    args: string[],
    onLine: (line: string) => void
  ): Promise<void> {
    await this.runWorker(
      python,
      ['-m', 'pip', '--disable-pip-version-check', ...args],
      onLine
    )
  }

  private async ensurePipTools(
    python: string,
    onProgress: (percent: number, message: string) => void
  ): Promise<void> {
    onProgress(18, 'Installing pip, setuptools, and wheel…')
    // pip 25+ fails NVIDIA packages with: Cannot import 'wheel_stub.buildapi'
    await this.pip(
      python,
      ['install', '--upgrade', 'pip==24.3.1', 'setuptools', 'wheel'],
      (line) => {
        if (/Successfully|Requirement already/i.test(line)) {
          onProgress(22, line.trim().slice(0, 120))
        }
      }
    )
  }

  private async ensureWindowsPython(onProgress: (percent: number, message: string) => void): Promise<void> {
    const pythonDir = path.join(getGstRuntimeDir(), 'python')
    const pythonExe = path.join(pythonDir, 'python.exe')
    if (!fs.existsSync(pythonExe)) {
      onProgress(5, 'Downloading portable Python…')
      const zipPath = path.join(getGstRuntimeDir(), 'python-embed.zip')
      await downloadFile(PYTHON_EMBED_URL, zipPath)
      this.throwIfCancelled()
      fs.mkdirSync(pythonDir, { recursive: true })
      const unzip = await runCapture('tar', ['-xf', zipPath, '-C', pythonDir])
      if (unzip.code !== 0) {
        throw new Error(`Failed to extract Python: ${unzip.stderr || unzip.stdout}`)
      }
      try {
        fs.unlinkSync(zipPath)
      } catch {
        // ignore
      }
    }

    const pth = fs.readdirSync(pythonDir).find((f) => f.endsWith('._pth'))
    if (pth) {
      const pthPath = path.join(pythonDir, pth)
      let text = fs.readFileSync(pthPath, 'utf-8')
      if (!text.includes('import site')) {
        text = text.replace(/#\s*import site/, 'import site')
        if (!text.includes('import site')) text += '\nimport site\n'
      }
      if (!text.includes('Lib\\site-packages') && !text.includes('Lib/site-packages')) {
        text += 'Lib\\site-packages\n'
      }
      fs.writeFileSync(pthPath, text)
    }

    onProgress(15, 'Installing pip…')
    const getPip = path.join(getGstRuntimeDir(), 'get-pip.py')
    if (!fs.existsSync(path.join(pythonDir, 'Lib', 'site-packages', 'pip'))) {
      await downloadFile(GET_PIP_URL, getPip)
      this.throwIfCancelled()
      await this.runWorker(
        pythonExe,
        [getPip, 'pip==24.3.1', 'setuptools', 'wheel'],
        () => undefined
      )
    }
  }

  private async ensureLinuxVenv(onProgress: (percent: number, message: string) => void): Promise<void> {
    const venvPython = path.join(getGstRuntimeDir(), 'venv', 'bin', 'python')
    if (fs.existsSync(venvPython)) return
    onProgress(8, 'Creating Python virtualenv…')
    const result = await runCapture('python3', ['-m', 'venv', path.join(getGstRuntimeDir(), 'venv')])
    if (result.code !== 0) {
      throw new Error(`python3 venv failed: ${result.stderr || result.stdout}`)
    }
  }

  private async ensureOnnx(
    onnxKey: string,
    requestedModel: string,
    onProgress: (percent: number, message: string) => void
  ): Promise<string> {
    const dest = this.onnxDest(onnxKey)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest
    const url = GST_ONNX_CATALOG[onnxKey]
    if (!url) throw new Error(`No ONNX mapping for ${requestedModel}`)
    const aliasNote =
      onnxKey !== requestedModel ? ` (4x graph; ${requestedModel} is not published)` : ''
    onProgress(0, `Downloading ONNX for ${onnxKey}${aliasNote}…`)
    await downloadFile(url, dest)
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      throw new Error(`ONNX download failed for ${requestedModel}`)
    }
    onProgress(100, 'ONNX ready')
    return dest
  }

  private async buildEngine(
    onnxPath: string,
    enginePath: string,
    tile: number,
    scale: ScaleFactor,
    onMessage: (message: string) => void
  ): Promise<void> {
    const python = this.requirePython()
    const worker = this.requireWorker()
    fs.mkdirSync(path.dirname(enginePath), { recursive: true })
    await this.runWorker(
      python,
      [
        worker,
        'build',
        '--onnx',
        onnxPath,
        '--engine',
        enginePath,
        '--tile',
        String(tile),
        '--scale',
        String(scale)
      ],
      (line) => {
        const msg = line.replace(/^GST_STAGE\s+\w+\s*/, '').trim()
        if (msg) onMessage(msg.slice(0, 160))
      }
    )
    if (!fs.existsSync(enginePath)) {
      throw new Error('Engine compile finished but the .engine file is missing')
    }
  }

  private runWorker(
    bin: string,
    args: string[],
    onLine: (line: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('__CANCELLED__'))
        return
      }

      const proc = spawn(bin, args, {
        windowsHide: true,
        env: this.workerEnv()
      })
      this.proc = proc
      let stderr = ''

      if (this.cancelled) {
        this.proc = null
        killProcessTree(proc)
        reject(new Error('__CANCELLED__'))
        return
      }

      const handle = (data: Buffer): void => {
        const text = data.toString()
        stderr += text
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLine(line)
        }
      }

      proc.stdout.on('data', handle)
      proc.stderr.on('data', handle)

      proc.on('close', (code) => {
        this.proc = null
        if (this.cancelled) {
          reject(new Error('__CANCELLED__'))
          return
        }
        if (code === 0) resolve()
        else reject(new Error(`GST worker exited ${code}\n${stderr.slice(-1500)}`))
      })

      proc.on('error', (err) => {
        this.proc = null
        reject(err)
      })
    })
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error('__CANCELLED__')
  }
}
