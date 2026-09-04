import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import type {
  BatchOptions,
  BatchProgressEvent,
  FormatModelChoice,
  FormatModelDefaults,
  InputFileFormat,
  ProgressEvent,
  ScaleFactor,
  UpscaleOptions,
  UpscaleResult
} from '../types'
import { getBinaryPath, getModelsDir } from './paths'
import { FileService } from './file.service'
import { killProcessTree } from './process-kill'

function getInputFileFormat(filePath: string): InputFileFormat | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg'
  if (ext === '.png') return 'png'
  if (ext === '.mp4') return 'mp4'
  return null
}

function resolveBatchModel(
  filePath: string,
  opts: BatchOptions
): FormatModelChoice {
  const fallback = { modelId: opts.modelName, modelPath: opts.modelPath }
  if (!opts.useFormatModelDefaults || !opts.formatModelDefaults) return fallback
  const format = getInputFileFormat(filePath)
  if (!format) return fallback
  const choice = (opts.formatModelDefaults as FormatModelDefaults)[format]
  if (!choice?.modelId) return fallback
  return { modelId: choice.modelId, modelPath: choice.modelPath }
}

export class UpscalerService {
  private activeProcess: ChildProcess | null = null
  private batchCancelled = false
  private batchPaused = false
  private pauseKilled = false
  private pauseResolve: (() => void) | null = null
  private fileService = new FileService()

  /** Clear cancel/pause flags before starting a new job. */
  clearCancelFlags(): void {
    this.batchCancelled = false
    this.batchPaused = false
    this.pauseKilled = false
  }

  async upscaleImage(
    opts: UpscaleOptions,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<UpscaleResult> {
    if (this.batchCancelled) throw new Error('__CANCELLED__')

    const resolvedFormat = this.fileService.resolveOutputFormat(opts.outputFormat, opts.inputPath)
    const outputPath = this.fileService.ensureDistinctOutputPath(
      opts.inputPath,
      opts.outputPath,
      opts.scale,
      resolvedFormat
    )
    opts = { ...opts, outputPath, outputFormat: resolvedFormat }

    const nativeScale = this.getNativeScale(opts.scale, opts.modelName)
    const needsDownscale = opts.scale !== nativeScale
    const tempDir = os.tmpdir()
    const tempOutput = needsDownscale
      ? path.join(tempDir, `neuralupscale-${Date.now()}-4x.png`)
      : opts.outputPath

    this.fileService.ensureDir(path.dirname(opts.outputPath))

    onProgress?.({ percent: 0, stage: 'loading', message: 'Starting upscale...' })

    let stderrOutput = ''
    try {
      await this.runBinary(
        {
          ...opts,
          outputPath: tempOutput,
          scale: nativeScale
        },
        (percent) => {
          if (this.batchCancelled) return
          const adjusted = needsDownscale ? percent * 0.85 : percent
          onProgress?.({
            percent: adjusted,
            stage: 'processing',
            message: `Upscaling... ${percent.toFixed(1)}%`
          })
        },
        (stderr) => {
          stderrOutput += stderr
        }
      )

      if (this.batchCancelled) throw new Error('__CANCELLED__')

      if (needsDownscale) {
        onProgress?.({ percent: 90, stage: 'saving', message: 'Downscaling to target size...' })
        await this.downscaleOutput(tempOutput, opts.outputPath, opts.scale, resolvedFormat, opts.jpegQuality)
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput)
      } else if (resolvedFormat === 'jpg' && !opts.outputPath.toLowerCase().endsWith('.jpg')) {
        await this.convertFormat(tempOutput, opts.outputPath, resolvedFormat, opts.jpegQuality)
      }

      if (this.batchCancelled) throw new Error('__CANCELLED__')

      onProgress?.({ percent: 100, stage: 'saving', message: 'Complete' })

      const info = await this.fileService.getFileInfo(opts.outputPath)
      return {
        outputPath: opts.outputPath,
        width: info.width,
        height: info.height
      }
    } catch (err) {
      const msg = (err as Error).message
      if (msg === '__PAUSED__' || msg === '__CANCELLED__') throw err
      if (this.batchCancelled) throw new Error('__CANCELLED__')
      if (stderrOutput) {
        throw new Error(`${msg}\n\n${stderrOutput}`)
      }
      throw err
    }
  }

  async upscaleBatch(
    opts: BatchOptions,
    sendProgress: (event: BatchProgressEvent) => void
  ): Promise<{ success: number; failed: number }> {
    this.clearCancelFlags()

    const files = opts.files?.length
      ? opts.files
      : this.fileService.scanFolderRecursive(opts.inputFolder)
    this.fileService.ensureDir(opts.outputFolder)

    let success = 0
    let failed = 0

    for (let i = 0; i < files.length; i++) {
      if (this.batchCancelled) break

      await this.waitIfPaused()
      if (this.batchCancelled) break

      const inputPath = files[i]
      const fileName = path.basename(inputPath)
      const fileModel = resolveBatchModel(inputPath, opts)

      sendProgress({
        fileIndex: i,
        fileName,
        filePercent: 0,
        overallPercent: Math.round((i / files.length) * 100),
        status: 'processing'
      })

      const outputPath = this.fileService.ensureDistinctOutputPath(
        inputPath,
        this.fileService.buildOutputPath(
          inputPath,
          opts.outputFolder,
          opts.scale,
          fileModel.modelId,
          opts.outputFormat,
          opts.namingPattern
        ),
        opts.scale,
        opts.outputFormat
      )

      try {
        await this.upscaleImage(
          {
            inputPath,
            outputPath,
            modelName: fileModel.modelId,
            modelPath: fileModel.modelPath,
            scale: opts.scale,
            gpuIndex: opts.gpuIndex,
            tileSize: opts.tileSize,
            threads: opts.threads,
            outputFormat: opts.outputFormat,
            jpegQuality: opts.jpegQuality
          },
          (event) => {
            if (this.batchPaused || this.batchCancelled) return
            sendProgress({
              fileIndex: i,
              fileName,
              filePercent: event.percent,
              overallPercent: Math.round(((i + event.percent / 100) / files.length) * 100),
              status: 'processing'
            })
          }
        )

        success++
        sendProgress({
          fileIndex: i,
          fileName,
          filePercent: 100,
          overallPercent: Math.round(((i + 1) / files.length) * 100),
          status: 'done'
        })
      } catch (err) {
        if (this.batchCancelled) break

        // Pause interrupted this file — wait for resume, then retry it
        if ((err as Error).message === '__PAUSED__' || this.batchPaused) {
          sendProgress({
            fileIndex: i,
            fileName,
            filePercent: 0,
            overallPercent: Math.round((i / files.length) * 100),
            status: 'queued'
          })
          await this.waitIfPaused()
          if (this.batchCancelled) break
          i--
          continue
        }

        failed++
        sendProgress({
          fileIndex: i,
          fileName,
          filePercent: 0,
          overallPercent: Math.round(((i + 1) / files.length) * 100),
          status: 'error',
          error: (err as Error).message
        })
      }
    }

    // Mark remaining as queued->cancelled implicitly by breaking
    for (let j = success + failed; j < files.length; j++) {
      if (this.batchCancelled) {
        sendProgress({
          fileIndex: j,
          fileName: path.basename(files[j]),
          filePercent: 0,
          overallPercent: Math.round((j / files.length) * 100),
          status: 'queued'
        })
      }
    }

    return { success, failed }
  }

  cancelBatch(): void {
    this.batchCancelled = true
    this.batchPaused = false
    this.pauseKilled = false
    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
    const proc = this.activeProcess
    this.activeProcess = null
    killProcessTree(proc)
  }

  pauseBatch(): void {
    this.batchPaused = true
    if (this.activeProcess) {
      this.pauseKilled = true
      const proc = this.activeProcess
      this.activeProcess = null
      killProcessTree(proc)
    }
  }

  resumeBatch(): void {
    this.batchPaused = false
    this.pauseKilled = false
    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
  }

  private waitIfPaused(): Promise<void> {
    if (!this.batchPaused) return Promise.resolve()
    return new Promise((resolve) => {
      this.pauseResolve = resolve
    })
  }

  private getNativeScale(scale: ScaleFactor, modelName: string): ScaleFactor {
    // Scale-specific models (anime video) run at their native scale
    if (/realesr-animevideov3-x[234]/i.test(modelName) || /-x([234])$/i.test(modelName)) {
      const match = modelName.match(/-x([234])$/i)
      if (match) return Number(match[1]) as ScaleFactor
      return scale
    }
    if (scale === 2) return 2
    return 4
  }

  private async downscaleOutput(
    inputPath: string,
    outputPath: string,
    targetScale: ScaleFactor,
    format: string,
    quality: number
  ): Promise<void> {
    const meta = await sharp(inputPath).metadata()
    const ratio = targetScale / 4
    const targetW = Math.round((meta.width ?? 0) * ratio)
    const targetH = Math.round((meta.height ?? 0) * ratio)

    let pipeline = sharp(inputPath).resize(targetW, targetH, { kernel: 'lanczos3' })
    if (format === 'jpg') {
      pipeline = pipeline.jpeg({ quality })
    } else {
      pipeline = pipeline.png()
    }
    await pipeline.toFile(outputPath)
  }

  private async convertFormat(
    inputPath: string,
    outputPath: string,
    format: string,
    quality: number
  ): Promise<void> {
    let pipeline = sharp(inputPath)
    if (format === 'jpg') {
      pipeline = pipeline.jpeg({ quality })
    } else {
      pipeline = pipeline.png()
    }
    await pipeline.toFile(outputPath)
  }

  private runBinary(
    opts: UpscaleOptions,
    onPercent: (percent: number) => void,
    onStderr: (text: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const binaryPath = getBinaryPath()
      if (!fs.existsSync(binaryPath)) {
        reject(new Error(`Upscaler binary not found at ${binaryPath}. Run npm run setup.`))
        return
      }

      const modelDirAbs = path.resolve(opts.modelPath ?? getModelsDir())
      const paramFile = path.join(modelDirAbs, `${opts.modelName}.param`)
      const binFile = path.join(modelDirAbs, `${opts.modelName}.bin`)
      if (!fs.existsSync(paramFile) || !fs.existsSync(binFile)) {
        reject(
          new Error(
            `Model "${opts.modelName}" not found in ${modelDirAbs}. Expected .bin and .param files.`
          )
        )
        return
      }

      // realesrgan-ncnn-vulkan joins -m to the executable directory. Absolute Windows
      // paths become "…\win32\D:\…" and fail — always pass a path relative to the binary.
      const binaryDir = path.dirname(path.resolve(binaryPath))
      let modelDirArg = path.relative(binaryDir, modelDirAbs)
      if (!modelDirArg) modelDirArg = '.'
      // Prefer forward slashes; the binary accepts them on Windows
      modelDirArg = modelDirArg.split(path.sep).join('/')

      const outFormat = this.fileService.resolveOutputFormat(opts.outputFormat, opts.inputPath)
      const outExt = outFormat === 'jpg' ? '.jpg' : '.png'
      let outputPath = opts.outputPath
      if (!outputPath.toLowerCase().endsWith(outExt)) {
        outputPath = outputPath.replace(/\.[^.]+$/, outExt)
      }

      const args = [
        '-i',
        opts.inputPath,
        '-o',
        outputPath,
        '-n',
        opts.modelName,
        '-s',
        String(opts.scale),
        '-m',
        modelDirArg,
        '-g',
        String(opts.gpuIndex),
        '-f',
        outFormat
      ]

      if (opts.tileSize > 0) args.push('-t', String(opts.tileSize))
      if (opts.threads) args.push('-j', opts.threads)

      const proc = spawn(binaryPath, args, {
        windowsHide: true,
        cwd: binaryDir
      })
      this.activeProcess = proc

      // Cancel may have arrived between spawn scheduling and assignment
      if (this.batchCancelled) {
        killProcessTree(proc)
        this.activeProcess = null
        reject(new Error('__CANCELLED__'))
        return
      }

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        onStderr(text)
        if (this.batchCancelled) return
        const match = text.match(/(\d+\.\d+)%/)
        if (match) onPercent(parseFloat(match[1]))
      })

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        if (this.batchCancelled) return
        const match = text.match(/(\d+\.\d+)%/)
        if (match) onPercent(parseFloat(match[1]))
      })

      proc.on('close', (code) => {
        this.activeProcess = null
        if (this.pauseKilled) {
          this.pauseKilled = false
          reject(new Error('__PAUSED__'))
          return
        }
        if (this.batchCancelled) {
          reject(new Error('__CANCELLED__'))
          return
        }
        if (code === 0) resolve()
        else reject(new Error(`realesrgan exited with code ${code}`))
      })

      proc.on('error', (err) => {
        this.activeProcess = null
        reject(err)
      })
    })
  }
}
