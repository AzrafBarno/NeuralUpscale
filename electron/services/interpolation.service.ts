import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type {
  InterpolationOptions,
  InterpolationProgressEvent,
  InterpolationResult,
  VideoInfo
} from '../types'
import { getDefaultRifeModelPath, getRifeBinaryPath, checkRifeExists } from './paths'
import { FileService } from './file.service'
import { killProcessTree } from './process-kill'
import {
  FfmpegSession,
  listPngSequence,
  probeVideo
} from './ffmpeg-encode'

const FRAME_PATTERN = '%08d.png'

export class InterpolationService {
  private proc: ChildProcess | null = null
  private cancelled = false
  private fileService = new FileService()
  private ffmpeg = new FfmpegSession()

  clearCancelFlags(): void {
    this.cancelled = false
    this.ffmpeg.reset()
  }

  async interpolate(
    opts: InterpolationOptions,
    onProgress?: (event: InterpolationProgressEvent) => void
  ): Promise<InterpolationResult> {
    this.clearCancelFlags()

    if (!checkRifeExists()) {
      throw new Error('RIFE binary/models not found. Run npm run setup to install frame interpolation.')
    }

    const info = await probeVideo(opts.inputPath)
    this.throwIfCancelled()

    const workRoot = path.join(os.tmpdir(), `neuralupscale-interp-${Date.now()}`)
    const framesIn = path.join(workRoot, 'frames_in')
    const framesOut = path.join(workRoot, 'frames_out')
    this.fileService.ensureDir(framesIn)
    this.fileService.ensureDir(framesOut)
    this.fileService.ensureDir(path.dirname(opts.outputPath))

    try {
      onProgress?.({ stage: 'extracting', percent: 0, message: 'Extracting frames…' })

      await this.ffmpeg.extractFrames({
        inputPath: opts.inputPath,
        outDir: framesIn,
        fps: info.fps,
        duration: info.duration,
        width: info.width,
        pattern: FRAME_PATTERN,
        onPercent: (p) => {
          if (this.cancelled) return
          onProgress?.({
            stage: 'extracting',
            percent: Math.round(p * 0.2),
            message: `Extracting frames… ${Math.round(p)}%`
          })
        }
      })

      this.throwIfCancelled()

      const inputCount = listPngSequence(framesIn).length
      if (inputCount < 2) throw new Error('Need at least 2 frames to interpolate')

      const interp = await this.interpolateFromFrames(
        framesIn,
        framesOut,
        info.fps,
        info.width,
        opts,
        (p, msg, targetCount) => {
          if (this.cancelled) return
          onProgress?.({
            stage: 'interpolating',
            percent: Math.round(22 + p * 0.58),
            message: msg,
            frameTotal: targetCount
          })
        }
      )

      this.throwIfCancelled()

      onProgress?.({
        stage: 'encoding',
        percent: 82,
        message: 'Encoding video…',
        frameTotal: interp.outputFrames
      })

      await this.ffmpeg.encodeFrames({
        framesDir: framesOut,
        framePattern: FRAME_PATTERN,
        startNumber: interp.startNumber,
        fps: interp.outputFps,
        sourceVideo: opts.inputPath,
        outputPath: opts.outputPath,
        hasAudio: info.hasAudio,
        frameTotal: interp.outputFrames,
        width: info.width,
        height: info.height,
        tune: 'film',
        preferNvenc: true,
        enforceBitrate: true,
        onPercent: (p) => {
          if (this.cancelled) return
          onProgress?.({
            stage: 'encoding',
            percent: Math.round(82 + p * 0.18),
            message: `Encoding video… ${Math.round(p)}%`,
            frameTotal: interp.outputFrames
          })
        }
      })

      this.throwIfCancelled()

      onProgress?.({
        stage: 'done',
        percent: 100,
        message: 'Complete',
        frameTotal: interp.outputFrames
      })

      const outMeta = await probeVideo(opts.outputPath)
      return {
        outputPath: opts.outputPath,
        width: outMeta.width,
        height: outMeta.height,
        inputFps: info.fps,
        outputFps: interp.outputFps,
        inputFrames: inputCount,
        outputFrames: interp.outputFrames
      }
    } catch (err) {
      if ((err as Error).message === '__CANCELLED__' || this.cancelled) {
        throw new Error('__CANCELLED__')
      }
      throw err
    } finally {
      this.cleanupDir(workRoot)
    }
  }

  /**
   * Run RIFE on an existing PNG sequence (lossless). Used by video upscale+interpolate
   * so frames are never re-encoded before interpolation.
   */
  async interpolateFromFrames(
    framesIn: string,
    framesOut: string,
    sourceFps: number,
    frameWidth: number,
    opts: Pick<InterpolationOptions, 'mode' | 'multiplier' | 'targetFps' | 'gpuIndex' | 'threads' | 'modelPath'>,
    onProgress?: (percent: number, message: string, targetCount: number) => void
  ): Promise<{ outputFps: number; outputFrames: number; startNumber: number }> {
    this.throwIfCancelled()

    const inputFrames = listPngSequence(framesIn)
    const inputCount = inputFrames.length
    if (inputCount < 2) throw new Error('Need at least 2 frames to interpolate')

    const { targetCount, outputFps } = this.resolveTargets(
      { fps: sourceFps } as VideoInfo,
      inputCount,
      opts
    )

    onProgress?.(0, `Interpolating ${inputCount} → ${targetCount} frames…`, targetCount)

    await this.runRife(framesIn, framesOut, targetCount, frameWidth, opts, (p, msg) => {
      onProgress?.(p, msg, targetCount)
    })

    this.throwIfCancelled()

    const outputFrames = listPngSequence(framesOut)
    if (outputFrames.length < 2) {
      throw new Error('Interpolation produced no frames')
    }

    const startNumber = parseInt(path.parse(outputFrames[0]).name, 10)
    return {
      outputFps,
      outputFrames: outputFrames.length,
      startNumber: Number.isFinite(startNumber) ? startNumber : 1
    }
  }

  cancel(): void {
    this.cancelled = true
    this.ffmpeg.cancel()
    const proc = this.proc
    this.proc = null
    killProcessTree(proc)
  }

  private resolveTargets(
    info: Pick<VideoInfo, 'fps'>,
    inputCount: number,
    opts: Pick<InterpolationOptions, 'mode' | 'multiplier' | 'targetFps'>
  ): { targetCount: number; outputFps: number } {
    if (opts.mode === 'multiplier') {
      const mult = opts.multiplier === 4 ? 4 : 2
      return {
        targetCount: Math.max(inputCount + 1, inputCount * mult),
        outputFps: info.fps * mult
      }
    }

    const targetFps = Math.max(1, opts.targetFps || 60)
    const ratio = targetFps / (info.fps > 0 ? info.fps : 24)
    const targetCount = Math.max(inputCount + 1, Math.round(inputCount * ratio))
    return { targetCount, outputFps: targetFps }
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error('__CANCELLED__')
  }

  private async runRife(
    framesIn: string,
    framesOut: string,
    targetCount: number,
    frameWidth: number,
    opts: Pick<InterpolationOptions, 'gpuIndex' | 'threads' | 'modelPath'>,
    onProgress: (percent: number, message: string) => void
  ): Promise<void> {
    const binary = getRifeBinaryPath()
    const modelPath = opts.modelPath || getDefaultRifeModelPath()

    const args = [
      '-i',
      framesIn,
      '-o',
      framesOut,
      '-n',
      String(targetCount),
      '-m',
      modelPath,
      '-g',
      String(opts.gpuIndex >= 0 ? opts.gpuIndex : -1),
      '-j',
      opts.threads || '1:2:2',
      '-f',
      FRAME_PATTERN
    ]

    // Optical flow at native 4K without UHD mode is a known quality bottleneck
    if (frameWidth >= 1920) {
      args.push('-u')
    }

    await new Promise<void>((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('__CANCELLED__'))
        return
      }

      const proc = spawn(binary, args, { windowsHide: true })
      this.proc = proc
      let stderr = ''

      if (this.cancelled) {
        this.proc = null
        killProcessTree(proc)
        reject(new Error('__CANCELLED__'))
        return
      }

      const handleChunk = (data: Buffer): void => {
        const text = data.toString()
        stderr += text
        if (this.cancelled) return
        const pctMatch = text.match(/(\d+(?:\.\d+)?)%/)
        if (pctMatch) {
          onProgress(parseFloat(pctMatch[1]), `Interpolating… ${pctMatch[1]}%`)
        }
      }

      proc.stderr.on('data', handleChunk)
      proc.stdout.on('data', handleChunk)

      proc.on('close', (code) => {
        this.proc = null
        if (this.cancelled) {
          reject(new Error('__CANCELLED__'))
          return
        }
        if (code === 0) {
          onProgress(100, 'Interpolation complete')
          resolve()
        } else {
          reject(new Error(`rife-ncnn-vulkan exited with code ${code}\n${stderr.slice(-1200)}`))
        }
      })

      proc.on('error', (err) => {
        this.proc = null
        reject(err)
      })
    })
  }

  private cleanupDir(dir: string): void {
    try {
      if (!fs.existsSync(dir)) return
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}
