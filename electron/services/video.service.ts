import fs from 'fs'
import os from 'os'
import path from 'path'
import type {
  InterpolationOptions,
  VideoProgressEvent,
  VideoUpscaleOptions,
  VideoUpscaleResult
} from '../types'
import { resolveModelName } from '../types'
import { checkRifeExists } from './paths'
import { UpscalerService } from './upscaler.service'
import { FileService } from './file.service'
import { InterpolationService } from './interpolation.service'
import { GstService, isGstModelSupported } from './gst.service'
import {
  estimateFrameCount,
  FfmpegSession,
  listPngSequence,
  nvencAvailable,
  probeVideo,
  type EncodeTune
} from './ffmpeg-encode'
import { killProcessTree } from './process-kill'

const FRAME_PATTERN = '%08d.png'

/** Keep overall job % moving forward only — avoids ring flicker from noisy/overlapping reporters. */
function createMonotonicProgress(
  onProgress?: (event: VideoProgressEvent) => void
): (event: VideoProgressEvent) => void {
  let last = -1
  return (event) => {
    if (!onProgress) return
    const next = Math.max(0, Math.min(100, Math.round(event.percent)))
    const percent = Math.max(last, next)
    last = percent
    onProgress({ ...event, percent })
  }
}

export class VideoService {
  private cancelled = false
  private upscaler = new UpscalerService()
  private fileService = new FileService()
  private ffmpeg = new FfmpegSession()

  constructor(
    private interpolationService?: InterpolationService,
    private gstService?: GstService
  ) {}

  async getVideoInfo(filePath: string) {
    return probeVideo(filePath)
  }

  async upscaleVideo(
    opts: VideoUpscaleOptions,
    onProgress?: (event: VideoProgressEvent) => void
  ): Promise<VideoUpscaleResult> {
    this.cancelled = false
    this.ffmpeg.reset()
    this.upscaler.clearCancelFlags()
    this.interpolationService?.clearCancelFlags()
    this.gstService?.clearCancelFlags()

    const report = createMonotonicProgress(onProgress)

    const info = await this.getVideoInfo(opts.inputPath)
    this.throwIfCancelled()

    const withInterp = Boolean(opts.withInterpolation)
    if (withInterp) {
      if (!this.interpolationService) {
        throw new Error('Interpolation service is not available')
      }
      if (!checkRifeExists()) {
        throw new Error('RIFE is not installed. Run npm run setup, or turn off Upscale with Interpolation.')
      }
    }

    const modelName = resolveModelName(opts.modelName, opts.scale)
    const encodeTune: EncodeTune = /anime/i.test(opts.modelName) ? 'animation' : 'film'
    const useGst =
      Boolean(opts.greenSparkleEnabled) &&
      Boolean(this.gstService) &&
      isGstModelSupported(modelName, opts.modelPath)

    // Green Sparkle without interpolation: VS TensorRT → NVENC (no PNG disk).
    if (useGst && !withInterp && this.gstService) {
      return this.upscaleVideoGstStream(opts, info, modelName, encodeTune, report)
    }

    // Green Sparkle + interpolate: VS TensorRT → PNG dump → RIFE → encode
    // (skips extract + inferFolder — those were the slow path).
    if (useGst && withInterp && this.gstService && this.interpolationService) {
      return this.upscaleVideoGstWithInterp(opts, info, modelName, encodeTune, report)
    }

    const workRoot = path.join(os.tmpdir(), `neuralupscale-video-${Date.now()}`)
    const framesIn = path.join(workRoot, 'frames_in')
    const framesOut = path.join(workRoot, 'frames_out')
    const framesInterp = path.join(workRoot, 'frames_interp')
    this.fileService.ensureDir(framesIn)
    this.fileService.ensureDir(framesOut)
    this.fileService.ensureDir(path.dirname(opts.outputPath))

    const extractShare = withInterp ? 8 : 15
    const upscaleShare = withInterp ? 54 : 73
    const upscaleStart = extractShare

    try {
      report({
        stage: 'extracting',
        percent: 0,
        message: 'Extracting frames…'
      })

      await this.ffmpeg.extractFrames({
        inputPath: opts.inputPath,
        outDir: framesIn,
        fps: info.fps,
        duration: info.duration,
        width: info.width,
        pattern: FRAME_PATTERN,
        onPercent: (p) => {
          if (this.cancelled) return
          report({
            stage: 'extracting',
            percent: Math.round((p / 100) * extractShare),
            message: `Extracting frames… ${Math.round(p)}%`
          })
        }
      })

      this.throwIfCancelled()

      const frameFiles = listPngSequence(framesIn)
      const frameTotal = frameFiles.length
      if (frameTotal === 0) throw new Error('No frames extracted from video')

      const sourceFps =
        info.duration > 0.01 ? frameTotal / info.duration : info.fps > 0 ? info.fps : 24

      let expectedOutW = 0
      let expectedOutH = 0

      if (useGst && this.gstService) {
        report({
          stage: 'upscaling',
          percent: upscaleStart,
          message: 'Green Sparkle: preparing TensorRT…',
          frameTotal
        })

        const { enginePath, tile } = await this.gstService.ensureEngine(
          modelName,
          opts.scale,
          opts.modelPath,
          (ev) => {
            if (this.cancelled) return
            report({
              stage: 'upscaling',
              percent: Math.round(upscaleStart + (ev.percent / 100) * 8),
              message: ev.message,
              frameTotal
            })
          }
        )
        this.throwIfCancelled()

        await this.gstService.inferFolder(
          framesIn,
          framesOut,
          enginePath,
          opts.scale,
          tile,
          (frameIndex, total, percent) => {
            if (this.cancelled) return
            report({
              stage: 'upscaling',
              percent: Math.round(upscaleStart + 8 + (percent / 100) * (upscaleShare - 8)),
              message: `Upscaling frame ${frameIndex} / ${total}`,
              frameIndex: frameIndex - 1,
              frameTotal: total
            })
          }
        )
        this.throwIfCancelled()

        const outFrames = listPngSequence(framesOut)
        if (outFrames.length === 0) throw new Error('TensorRT upscale produced no frames')
        const firstInfo = await this.fileService.getFileInfo(path.join(framesOut, outFrames[0]))
        expectedOutW = firstInfo.width
        expectedOutH = firstInfo.height
      } else {
        for (let i = 0; i < frameTotal; i++) {
          this.throwIfCancelled()
          const name = frameFiles[i]
          const inputPath = path.join(framesIn, name)
          const outputPath = path.join(framesOut, name)

          report({
            stage: 'upscaling',
            percent: Math.round(upscaleStart + (i / frameTotal) * upscaleShare),
            message: `Upscaling frame ${i + 1} / ${frameTotal}`,
            frameIndex: i,
            frameTotal
          })

          try {
            const result = await this.upscaler.upscaleImage(
              {
                inputPath,
                outputPath,
                modelName,
                modelPath: opts.modelPath,
                scale: opts.scale,
                gpuIndex: opts.gpuIndex,
                tileSize: opts.tileSize,
                threads: opts.threads,
                outputFormat: 'png',
                jpegQuality: 95
              },
              (ev) => {
                if (this.cancelled) return
                const frameFrac = (i + ev.percent / 100) / frameTotal
                report({
                  stage: 'upscaling',
                  percent: Math.round(upscaleStart + frameFrac * upscaleShare),
                  message: `Upscaling frame ${i + 1} / ${frameTotal} · ${ev.percent.toFixed(0)}%`,
                  frameIndex: i,
                  frameTotal
                })
              }
            )

            if (path.resolve(result.outputPath) !== path.resolve(outputPath)) {
              if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
              fs.renameSync(result.outputPath, outputPath)
            }

            if (i === 0) {
              expectedOutW = result.width
              expectedOutH = result.height
            } else if (result.width !== expectedOutW || result.height !== expectedOutH) {
              throw new Error(
                `Frame size mismatch at ${name}: got ${result.width}×${result.height}, expected ${expectedOutW}×${expectedOutH}`
              )
            }
          } catch (err) {
            if (this.cancelled || (err as Error).message === '__CANCELLED__') {
              throw new Error('__CANCELLED__')
            }
            throw err
          }

          this.throwIfCancelled()
        }
      }

      let encodeDir = framesOut
      let encodeFps = sourceFps
      let encodeCount = frameTotal
      let startNumber = 1

      if (withInterp && this.interpolationService) {
        this.fileService.ensureDir(framesInterp)
        this.throwIfCancelled()

        const interpOpts: InterpolationOptions = {
          inputPath: opts.inputPath,
          outputPath: opts.outputPath,
          mode: opts.interpolationMode ?? 'multiplier',
          multiplier: opts.interpolationMultiplier === 4 ? 4 : 2,
          targetFps: opts.interpolationTargetFps ?? 60,
          gpuIndex: opts.gpuIndex,
          threads: opts.threads
        }

        const interp = await this.interpolationService.interpolateFromFrames(
          framesOut,
          framesInterp,
          sourceFps,
          expectedOutW,
          interpOpts,
          (p, msg, outTotal) => {
            if (this.cancelled) return
            report({
              stage: 'interpolating',
              percent: Math.round(62 + (p / 100) * 26),
              message: msg,
              frameTotal: outTotal
            })
          }
        )

        this.throwIfCancelled()
        encodeDir = framesInterp
        encodeFps = interp.outputFps
        encodeCount = interp.outputFrames
        startNumber = interp.startNumber
      }

      this.throwIfCancelled()

      report({
        stage: 'encoding',
        percent: 88,
        message: useGst ? 'Encoding video (NVENC)…' : 'Encoding video…',
        frameIndex: encodeCount,
        frameTotal: encodeCount
      })

      await this.ffmpeg.encodeFrames({
        framesDir: encodeDir,
        framePattern: FRAME_PATTERN,
        startNumber,
        fps: encodeFps,
        sourceVideo: opts.inputPath,
        outputPath: opts.outputPath,
        hasAudio: info.hasAudio,
        frameTotal: encodeCount,
        width: expectedOutW,
        height: expectedOutH,
        tune: encodeTune,
        preferNvenc: useGst,
        enforceBitrate: withInterp,
        onPercent: (p) => {
          if (this.cancelled) return
          report({
            stage: 'encoding',
            percent: Math.round(88 + p * 0.12),
            message: `Encoding video… ${Math.round(p)}%`,
            frameIndex: encodeCount,
            frameTotal: encodeCount
          })
        }
      })

      this.throwIfCancelled()

      report({
        stage: 'done',
        percent: 100,
        message: 'Complete',
        frameIndex: encodeCount,
        frameTotal: encodeCount
      })

      const outMeta = await this.getVideoInfo(opts.outputPath)
      return {
        outputPath: opts.outputPath,
        width: outMeta.width,
        height: outMeta.height,
        frameCount: encodeCount
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
   * Green Sparkle + interpolation: GPU-resident VS/TRT upscale → PNG sequence →
   * RIFE (ncnn) → encode. Avoids extract-all-frames + per-PNG inferFolder.
   */
  private async upscaleVideoGstWithInterp(
    opts: VideoUpscaleOptions,
    info: Awaited<ReturnType<typeof probeVideo>>,
    modelName: string,
    encodeTune: EncodeTune,
    onProgress?: (event: VideoProgressEvent) => void
  ): Promise<VideoUpscaleResult> {
    if (!this.gstService) throw new Error('Green Sparkle service is not available')
    if (!this.interpolationService) throw new Error('Interpolation service is not available')

    const report = onProgress ?? ((): void => undefined)

    const workRoot = path.join(os.tmpdir(), `neuralupscale-video-gst-interp-${Date.now()}`)
    const framesOut = path.join(workRoot, 'frames_out')
    const framesInterp = path.join(workRoot, 'frames_interp')
    this.fileService.ensureDir(framesOut)
    this.fileService.ensureDir(framesInterp)
    this.fileService.ensureDir(path.dirname(opts.outputPath))

    const sourceFps = info.fps > 0 ? info.fps : 24
    const frameTotalHint = estimateFrameCount(info.duration, sourceFps)
    // Same even-dim yuv420p size as the GST encode-only path (correct colors)
    const outW = info.width * opts.scale - ((info.width * opts.scale) % 2)
    const outH = info.height * opts.scale - ((info.height * opts.scale) % 2)

    try {
      report({
        stage: 'upscaling',
        percent: 0,
        message: 'Green Sparkle: preparing VapourSynth + TensorRT…',
        frameTotal: frameTotalHint || undefined
      })

      const { enginePath, tile } = await this.gstService.ensureEngine(
        modelName,
        opts.scale,
        opts.modelPath,
        (ev) => {
          if (this.cancelled) return
          report({
            stage: 'upscaling',
            percent: Math.round((ev.percent / 100) * 6),
            message: ev.message,
            frameTotal: frameTotalHint || undefined
          })
        }
      )
      this.throwIfCancelled()

      report({
        stage: 'upscaling',
        percent: 6,
        message: 'Green Sparkle: VapourSynth TensorRT → frames…',
        frameTotal: frameTotalHint || undefined
      })

      await this.runGstVsPngDump({
        opts,
        enginePath,
        tile,
        sourceFps,
        frameTotal: frameTotalHint,
        outW,
        outH,
        framesOut,
        onProgress
      })
      this.throwIfCancelled()

      const outFrames = listPngSequence(framesOut)
      if (outFrames.length < 2) {
        throw new Error('Green Sparkle upscale produced too few frames for interpolation')
      }
      const firstInfo = await this.fileService.getFileInfo(path.join(framesOut, outFrames[0]))
      // Prefer probed PNG size; fall back to scaled source dims for bitrate tiering
      const expectedOutW =
        firstInfo.width >= outW * 0.9 ? firstInfo.width : outW
      const expectedOutH =
        firstInfo.height >= outH * 0.9 ? firstInfo.height : outH

      const interpOpts: InterpolationOptions = {
        inputPath: opts.inputPath,
        outputPath: opts.outputPath,
        mode: opts.interpolationMode ?? 'multiplier',
        multiplier: opts.interpolationMultiplier === 4 ? 4 : 2,
        targetFps: opts.interpolationTargetFps ?? 60,
        gpuIndex: opts.gpuIndex,
        threads: opts.threads
      }

      const interp = await this.interpolationService.interpolateFromFrames(
        framesOut,
        framesInterp,
        sourceFps,
        expectedOutW,
        interpOpts,
        (p, msg, outTotal) => {
          if (this.cancelled) return
          report({
            stage: 'interpolating',
            percent: Math.round(62 + (p / 100) * 26),
            message: msg,
            frameTotal: outTotal
          })
        }
      )
      this.throwIfCancelled()

      report({
        stage: 'encoding',
        percent: 88,
        message: 'Encoding video (NVENC)…',
        frameIndex: interp.outputFrames,
        frameTotal: interp.outputFrames
      })

      await this.ffmpeg.encodeFrames({
        framesDir: framesInterp,
        framePattern: FRAME_PATTERN,
        startNumber: interp.startNumber,
        fps: interp.outputFps,
        sourceVideo: opts.inputPath,
        outputPath: opts.outputPath,
        hasAudio: info.hasAudio,
        frameTotal: interp.outputFrames,
        width: expectedOutW,
        height: expectedOutH,
        tune: encodeTune,
        preferNvenc: true,
        enforceBitrate: true,
        onPercent: (p) => {
          if (this.cancelled) return
          report({
            stage: 'encoding',
            percent: Math.round(88 + p * 0.11),
            message: `Encoding… ${Math.round(p)}%`,
            frameTotal: interp.outputFrames
          })
        }
      })

      this.throwIfCancelled()

      report({
        stage: 'done',
        percent: 100,
        message: 'Complete',
        frameIndex: interp.outputFrames,
        frameTotal: interp.outputFrames
      })

      const outMeta = await this.getVideoInfo(opts.outputPath)
      return {
        outputPath: opts.outputPath,
        width: outMeta.width,
        height: outMeta.height,
        frameCount: interp.outputFrames
      }
    } catch (err) {
      if (this.cancelled || (err as Error).message === '__CANCELLED__') {
        throw new Error('__CANCELLED__')
      }
      throw err
    } finally {
      this.cleanupDir(workRoot)
    }
  }

  private async runGstVsPngDump(args: {
    opts: VideoUpscaleOptions
    enginePath: string
    tile: number
    sourceFps: number
    frameTotal: number
    outW: number
    outH: number
    framesOut: string
    onProgress?: (event: VideoProgressEvent) => void
  }): Promise<void> {
    const { opts, enginePath, tile, sourceFps, frameTotal, outW, outH, framesOut, onProgress } =
      args
    if (!this.gstService) throw new Error('Green Sparkle service is not available')
    const report = onProgress ?? ((): void => undefined)

    const totalHint = frameTotal || 0
    const vspipe = this.gstService.spawnVspipeUpscale({
      inputPath: opts.inputPath,
      enginePath,
      tile,
      scale: opts.scale,
      outputFormat: 'yuv444p',
      onProgressLine: (line) => {
        if (this.cancelled) return
        const m =
          line.match(/Frame:\s*(\d+)\s*\/\s*(\d+)/i) || line.match(/(\d+)\s*\/\s*(\d+)/)
        if (m) {
          const cur = parseInt(m[1], 10)
          const tot = parseInt(m[2], 10) || totalHint || 1
          const percent = Math.min(99, (cur / tot) * 100)
          report({
            stage: 'upscaling',
            percent: Math.round(6 + (percent / 100) * 54),
            message: `Upscaling frame ${cur} / ${tot}`,
            frameIndex: Math.max(0, cur - 1),
            frameTotal: tot
          })
        }
      }
    })

    const dump = this.ffmpeg.spawnRawPngDump({
      outDir: framesOut,
      pattern: FRAME_PATTERN,
      width: outW,
      height: outH,
      fps: sourceFps,
      pixFmt: 'yuv444p',
      frameTotal: totalHint || undefined
      // Progress comes from vspipe only — dump % in the same band caused jumps.
    })

    if (!vspipe.stdout || !dump.stdin) {
      killProcessTree(vspipe)
      killProcessTree(dump)
      throw new Error('Failed to open vspipe/ffmpeg PNG dump pipes')
    }

    this.ffmpeg.track(vspipe)
    const pipeDone = this.gstService.waitChild(vspipe, 'vspipe')
    const dumpDone = this.ffmpeg.waitProc(dump, 'ffmpeg png dump')

    vspipe.stdout.pipe(dump.stdin)

    try {
      await Promise.all([pipeDone, dumpDone])
    } catch (err) {
      killProcessTree(vspipe)
      killProcessTree(dump)
      this.gstService.cancel()
      const vsErr = this.gstService.lastVspipeStderr?.slice(-1200) || ''
      const base = (err as Error).message || String(err)
      if (vsErr && !base.includes(vsErr.slice(0, 80))) {
        throw new Error(`${base}\n--- vspipe ---\n${vsErr}`)
      }
      throw err
    }
  }

  private async upscaleVideoGstStream(
    opts: VideoUpscaleOptions,
    info: Awaited<ReturnType<typeof probeVideo>>,
    modelName: string,
    encodeTune: EncodeTune,
    onProgress?: (event: VideoProgressEvent) => void
  ): Promise<VideoUpscaleResult> {
    if (!this.gstService) throw new Error('Green Sparkle service is not available')

    const report = onProgress ?? ((): void => undefined)
    this.fileService.ensureDir(path.dirname(opts.outputPath))

    const sourceFps = info.fps > 0 ? info.fps : 24
    const frameTotal = estimateFrameCount(info.duration, sourceFps)
    const outW = info.width * opts.scale - ((info.width * opts.scale) % 2)
    const outH = info.height * opts.scale - ((info.height * opts.scale) % 2)

    report({
      stage: 'upscaling',
      percent: 0,
      message: 'Green Sparkle: preparing VapourSynth + TensorRT…',
      frameTotal: frameTotal || undefined
    })

    const { enginePath, tile } = await this.gstService.ensureEngine(
      modelName,
      opts.scale,
      opts.modelPath,
      (ev) => {
        if (this.cancelled) return
        report({
          stage: 'upscaling',
          percent: Math.round((ev.percent / 100) * 8),
          message: ev.message,
          frameTotal: frameTotal || undefined
        })
      }
    )
    this.throwIfCancelled()

    const useNvenc = await nvencAvailable()
    if (!useNvenc) {
      console.warn('[video] h264_nvenc not available; VS encode will use libx264')
    }

    report({
      stage: 'upscaling',
      percent: 8,
      message: 'Green Sparkle: VapourSynth TensorRT → NVENC…',
      frameTotal: frameTotal || undefined
    })

    try {
      await this.runGstVsPipeline({
        opts,
        hasAudio: info.hasAudio,
        enginePath,
        tile,
        sourceFps,
        frameTotal,
        outW,
        outH,
        encodeTune,
        useNvenc,
        onProgress
      })
    } catch (err) {
      if (this.cancelled || (err as Error).message === '__CANCELLED__') {
        throw new Error('__CANCELLED__')
      }
      const msg = (err as Error).message || ''
      if (useNvenc && /ffmpeg encode|nvenc/i.test(msg)) {
        console.warn('[video] NVENC failed after vspipe, retrying libx264:', msg)
        this.gstService.clearCancelFlags()
        this.ffmpeg.reset()
        await this.runGstVsPipeline({
          opts,
          hasAudio: info.hasAudio,
          enginePath,
          tile,
          sourceFps,
          frameTotal,
          outW,
          outH,
          encodeTune,
          useNvenc: false,
          onProgress
        })
      } else {
        throw err
      }
    }

    this.throwIfCancelled()

    report({
      stage: 'done',
      percent: 100,
      message: 'Complete',
      frameIndex: frameTotal || undefined,
      frameTotal: frameTotal || undefined
    })

    const outMeta = await this.getVideoInfo(opts.outputPath)
    return {
      outputPath: opts.outputPath,
      width: outMeta.width,
      height: outMeta.height,
      frameCount: frameTotal || 0
    }
  }

  private async runGstVsPipeline(args: {
    opts: VideoUpscaleOptions
    hasAudio: boolean
    enginePath: string
    tile: number
    sourceFps: number
    frameTotal: number
    outW: number
    outH: number
    encodeTune: EncodeTune
    useNvenc: boolean
    onProgress?: (event: VideoProgressEvent) => void
  }): Promise<void> {
    const {
      opts,
      hasAudio,
      enginePath,
      tile,
      sourceFps,
      frameTotal,
      outW,
      outH,
      encodeTune,
      useNvenc,
      onProgress
    } = args

    if (!this.gstService) throw new Error('Green Sparkle service is not available')

    const report = onProgress ?? ((): void => undefined)
    const totalHint = frameTotal || 0

    const vspipe = this.gstService.spawnVspipeUpscale({
      inputPath: opts.inputPath,
      enginePath,
      tile,
      scale: opts.scale,
      onProgressLine: (line) => {
        if (this.cancelled) return
        const m =
          line.match(/Frame:\s*(\d+)\s*\/\s*(\d+)/i) || line.match(/(\d+)\s*\/\s*(\d+)/)
        if (m) {
          const cur = parseInt(m[1], 10)
          const tot = parseInt(m[2], 10) || totalHint || 1
          const percent = Math.min(99, (cur / tot) * 100)
          // Keep pipe progress in 8–95%; encode runs in parallel so its % must not fight this.
          report({
            stage: 'upscaling',
            percent: Math.round(8 + (percent / 100) * 87),
            message: `Upscaling frame ${cur} / ${tot}`,
            frameIndex: Math.max(0, cur - 1),
            frameTotal: tot
          })
        }
      }
    })

    const encode = this.ffmpeg.spawnY4mEncode({
      sourceVideo: opts.inputPath,
      outputPath: opts.outputPath,
      hasAudio,
      frameTotal: frameTotal || Math.max(1, Math.round(sourceFps * 60)),
      width: outW,
      height: outH,
      fps: sourceFps,
      tune: encodeTune,
      useNvenc
      // Intentionally no onPercent — concurrent encode stats caused the progress ring to jump.
    })

    if (!vspipe.stdout || !encode.stdin) {
      killProcessTree(vspipe)
      killProcessTree(encode)
      throw new Error('Failed to open vspipe/ffmpeg stdio pipes')
    }

    this.ffmpeg.track(vspipe)
    const pipeDone = this.gstService.waitChild(vspipe, 'vspipe')
    const encodeDone = this.ffmpeg.waitProc(encode, 'ffmpeg encode')

    vspipe.stdout.pipe(encode.stdin)

    try {
      await Promise.all([pipeDone, encodeDone])
    } catch (err) {
      killProcessTree(vspipe)
      killProcessTree(encode)
      this.gstService.cancel()
      const vsErr = this.gstService.lastVspipeStderr?.slice(-1200) || ''
      const base = (err as Error).message || String(err)
      if (vsErr && !base.includes(vsErr.slice(0, 80))) {
        throw new Error(`${base}\n--- vspipe ---\n${vsErr}`)
      }
      throw err
    }

    if (!fs.existsSync(opts.outputPath) || fs.statSync(opts.outputPath).size < 1000) {
      throw new Error('Green Sparkle VapourSynth pipeline produced no output')
    }
  }

  cancel(): void {
    this.cancelled = true
    this.upscaler.cancelBatch()
    this.ffmpeg.cancel()
    this.interpolationService?.cancel()
    this.gstService?.cancel()
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error('__CANCELLED__')
  }

  private cleanupDir(dir: string): void {
    try {
      if (!fs.existsSync(dir)) return
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}
