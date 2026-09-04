import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { VideoInfo } from '../types'
import { getFfmpegPath, getFfprobePath } from './paths'
import { killProcessTree } from './process-kill'

export function parseFps(rate: string): number {
  if (!rate || rate === '0/0') return 30
  if (rate.includes('/')) {
    const [a, b] = rate.split('/').map(Number)
    if (!b) return 30
    return a / b
  }
  const n = parseFloat(rate)
  return Number.isFinite(n) && n > 0 ? n : 30
}

/** Lower CRF = higher bitrate. 4K needs more bits than 1080p for the same apparent sharpness. */
export function pickEncodeCrf(width: number, height: number): number {
  const px = width * height
  // Slightly lower than before — AI-upscaled detail needs more bits than camera footage
  if (px >= 3840 * 2160 * 0.85) return 13
  if (px >= 2560 * 1440 * 0.85) return 14
  if (px >= 1920 * 1080 * 0.85) return 15
  return 16
}

/**
 * NVENC CQ is not 1:1 with x264 CRF — the same number encodes much leaner.
 * Offset ~5 so CQ tracks prior high-quality ~22MB / 4K24 AI-upscale sizes.
 */
export function pickNvencCq(width: number, height: number): number {
  return Math.max(7, pickEncodeCrf(width, height) - 5)
}

/**
 * Average bitrate floor for NVENC VBR.
 * ~32 Mbps @ 4K24; scales with fps so 4K60 stays ~bits-per-frame of a good 4K24 encode.
 */
export function pickNvencBitrate(width: number, height: number, fps: number): {
  bitrate: string
  maxrate: string
  bufsize: string
  mbps: number
} {
  const px = width * height
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 24
  const fpsFactor = safeFps / 24
  let mbps: number
  if (px >= 3840 * 2160 * 0.85) mbps = 32
  else if (px >= 2560 * 1440 * 0.85) mbps = 18
  else if (px >= 1920 * 1080 * 0.85) mbps = 10
  else mbps = 6
  mbps = Math.max(4, Math.round(mbps * fpsFactor))
  const max = Math.round(mbps * 1.6)
  const buf = Math.round(mbps * 2.2)
  return { bitrate: `${mbps}M`, maxrate: `${max}M`, bufsize: `${buf}M`, mbps }
}

/** Shared h264_nvenc flags for pipe + folder encodes. */
export function buildNvencVideoArgs(opts: {
  width: number
  height: number
  fps: number
  vf: string
  colorArgs: string[]
  /**
   * RIFE / high-fps frames are temporally smooth and CQ-undershoot badly
   * (e.g. 31MB 4K24 → 16MB 4K60). Force bitrate-primary VBR instead.
   */
  enforceBitrate?: boolean
}): string[] {
  const rates = pickNvencBitrate(opts.width, opts.height, opts.fps)
  const fpsGop = Math.max(1, Math.round(Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24))
  const fpsStr = (Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24).toFixed(6)
  const enforce =
    Boolean(opts.enforceBitrate) || (Number.isFinite(opts.fps) && opts.fps >= 48)

  // CQ mode lets NVENC spend fewer bits on smooth interpolated frames
  // (31MB 4K24 → 16MB 4K60). Use CBR so bits-per-frame track the 24fps upscale.
  const rcArgs = enforce
    ? [
        '-rc',
        'cbr',
        '-b:v',
        rates.bitrate,
        '-minrate',
        rates.bitrate,
        '-maxrate',
        rates.bitrate,
        '-bufsize',
        rates.bufsize
      ]
    : [
        '-rc',
        'vbr',
        '-cq',
        String(pickNvencCq(opts.width, opts.height)),
        '-b:v',
        rates.bitrate,
        '-maxrate',
        rates.maxrate,
        '-bufsize',
        rates.bufsize
      ]

  return [
    '-vf',
    opts.vf,
    '-c:v',
    'h264_nvenc',
    '-preset',
    'p6',
    '-tune',
    'hq',
    ...rcArgs,
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(fpsGop * 2),
    '-rc-lookahead',
    '32',
    '-spatial-aq',
    '1',
    '-temporal-aq',
    '1',
    '-aq-strength',
    '10',
    '-multipass',
    'fullres',
    ...opts.colorArgs,
    '-r',
    fpsStr,
    '-movflags',
    '+faststart'
  ]
}

export function estimateFrameCount(durationSec: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 24
  if (!(durationSec > 0)) return 0
  return Math.max(1, Math.round(durationSec * safeFps))
}

export function listPngSequence(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.png$/i.test(f))
    .sort()
}

let nvencProbe: Promise<boolean> | null = null

/** Cached probe: bundled ffmpeg lists h264_nvenc. */
export function nvencAvailable(): Promise<boolean> {
  if (!nvencProbe) {
    nvencProbe = (async () => {
      try {
        const ffmpeg = getFfmpegPath()
        if (!fs.existsSync(ffmpeg)) return false
        const out = await runCapture(ffmpeg, ['-hide_banner', '-encoders'])
        return /\bh264_nvenc\b/.test(out)
      } catch {
        return false
      }
    })()
  }
  return nvencProbe
}

export async function probeVideo(filePath: string): Promise<VideoInfo> {
  const ffprobe = getFfprobePath()
  if (!fs.existsSync(ffprobe)) {
    throw new Error(`ffprobe not found at ${ffprobe}. Run npm run setup.`)
  }

  const raw = await runCapture(ffprobe, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ])

  const data = JSON.parse(raw) as {
    format?: { duration?: string; size?: string }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
      r_frame_rate?: string
      avg_frame_rate?: string
      nb_frames?: string
    }>
  }

  const videoStream = data.streams?.find((s) => s.codec_type === 'video')
  if (!videoStream) throw new Error('No video stream found in file')

  const audioStream = data.streams?.find((s) => s.codec_type === 'audio')
  const fps = parseFps(videoStream.avg_frame_rate || videoStream.r_frame_rate || '30/1')
  const duration = parseFloat(data.format?.duration ?? '0') || 0
  const size = parseInt(data.format?.size ?? '0', 10) || fs.statSync(filePath).size

  return {
    path: filePath,
    duration,
    fps,
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    codec: videoStream.codec_name ?? 'unknown',
    size,
    hasAudio: Boolean(audioStream)
  }
}

export type EncodeTune = 'film' | 'animation'

export interface ExtractFramesOptions {
  inputPath: string
  outDir: string
  fps: number
  duration: number
  width: number
  pattern: string
  onPercent: (percent: number) => void
}

export interface EncodeFramesOptions {
  framesDir: string
  framePattern: string
  startNumber: number
  fps: number
  sourceVideo: string
  outputPath: string
  hasAudio: boolean
  frameTotal: number
  width: number
  height: number
  tune?: EncodeTune
  /** Prefer h264_nvenc; fall back to libx264 if unavailable or encode fails. */
  preferNvenc?: boolean
  /**
   * After RIFE: force bitrate-primary NVENC so 60fps does not CQ-undershoot
   * vs the 24fps upscale size.
   */
  enforceBitrate?: boolean
  onPercent: (percent: number) => void
}

export interface RawDecodePipeOptions {
  inputPath: string
  fps: number
  width: number
  /** Try CUDA/NVDEC first; on spawn failure callers should retry with false. */
  useCuda: boolean
}

export interface RawEncodePipeOptions {
  width: number
  height: number
  fps: number
  sourceVideo: string
  outputPath: string
  hasAudio: boolean
  frameTotal: number
  tune?: EncodeTune
  useNvenc: boolean
  onPercent?: (percent: number) => void
}

export interface Y4mEncodePipeOptions {
  sourceVideo: string
  outputPath: string
  hasAudio: boolean
  frameTotal: number
  width: number
  height: number
  fps: number
  tune?: EncodeTune
  useNvenc: boolean
  onPercent?: (percent: number) => void
}

export interface RawPngDumpPipeOptions {
  outDir: string
  /** image2 pattern, e.g. %08d.png */
  pattern: string
  width: number
  height: number
  fps: number
  /** Match vspipe GST_VS_OUTPUT / ffmpeg rawvideo pix_fmt */
  pixFmt: 'rgb24' | 'yuv420p' | 'yuv444p' | 'bgr0' | 'gbrp'
  frameTotal?: number
  onPercent?: (percent: number) => void
}

export class FfmpegSession {
  private proc: ChildProcess | null = null
  private procs: ChildProcess[] = []
  private cancelled = false

  cancel(): void {
    this.cancelled = true
    const all = [...this.procs]
    if (this.proc) all.push(this.proc)
    this.proc = null
    this.procs = []
    for (const p of all) killProcessTree(p)
  }

  reset(): void {
    this.cancelled = false
    this.procs = []
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new Error('__CANCELLED__')
  }

  track(proc: ChildProcess): void {
    this.procs.push(proc)
  }

  untrack(proc: ChildProcess): void {
    this.procs = this.procs.filter((p) => p !== proc)
  }

  async extractFrames(opts: ExtractFramesOptions): Promise<void> {
    const ffmpeg = getFfmpegPath()
    if (!fs.existsSync(ffmpeg)) {
      throw new Error(`ffmpeg not found at ${ffmpeg}. Run npm run setup.`)
    }

    const safeFps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24
    const matrix = opts.width >= 1280 ? '709' : '170m'
    const pattern = path.join(opts.outDir, opts.pattern)

    const primaries = matrix === '709' ? '709' : 'smpte170m'
    const vf = [
      `fps=${safeFps}`,
      `zscale=rangein=limited:range=full:matrixin=${matrix}:matrix=${matrix}:primariesin=${primaries}:primaries=${primaries}:transferin=${primaries}:transfer=${primaries}:f=lanczos`,
      'format=rgb24'
    ].join(',')

    const args = [
      '-y',
      '-i',
      opts.inputPath,
      '-fps_mode',
      'cfr',
      '-vf',
      vf,
      '-start_number',
      '1',
      '-c:v',
      'png',
      '-compression_level',
      '1',
      '-pix_fmt',
      'rgb24',
      pattern
    ]

    try {
      await this.runFfmpeg(args, opts.onPercent, opts.duration > 0 ? opts.duration : undefined)
    } catch (err) {
      if (this.cancelled) throw err
      await this.runFfmpeg(
        [
          '-y',
          '-i',
          opts.inputPath,
          '-fps_mode',
          'cfr',
          '-vf',
          `fps=${safeFps}`,
          '-start_number',
          '1',
          '-c:v',
          'png',
          '-compression_level',
          '1',
          pattern
        ],
        opts.onPercent,
        opts.duration > 0 ? opts.duration : undefined
      )
    }
  }

  /**
   * Spawn ffmpeg that reads raw yuv420p from stdin (vspipe -c raw) and encodes.
   * Avoids y4m "Header too large" with long VapourSynth colorimetry X-tags.
   */
  spawnY4mEncode(opts: Y4mEncodePipeOptions): ChildProcess {
    const ffmpeg = getFfmpegPath()
    if (!fs.existsSync(ffmpeg)) {
      throw new Error(`ffmpeg not found at ${ffmpeg}. Run npm run setup.`)
    }

    const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24
    const fpsStr = fps.toFixed(6)
    const crf = pickEncodeCrf(opts.width, opts.height)
    const fpsGop = Math.max(1, Math.round(fps))
    const matrix = opts.width >= 1280 ? '709' : '170m'
    const evenW = Math.max(2, opts.width - (opts.width % 2))
    const evenH = Math.max(2, opts.height - (opts.height % 2))
    // Input is already yuv420p from vspipe; only enforce even dims for NVENC.
    const vf =
      evenW === opts.width && evenH === opts.height
        ? 'format=yuv420p'
        : `scale=${evenW}:${evenH}:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p`

    const colorArgs = [
      '-color_range',
      'tv',
      '-colorspace',
      matrix === '709' ? 'bt709' : 'smpte170m',
      '-color_primaries',
      matrix === '709' ? 'bt709' : 'smpte170m',
      '-color_trc',
      matrix === '709' ? 'bt709' : 'smpte170m'
    ]

    const videoEncode = opts.useNvenc
      ? buildNvencVideoArgs({
          width: opts.width,
          height: opts.height,
          fps,
          vf,
          colorArgs
        })
      : [
          '-vf',
          vf,
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-crf',
          String(crf),
          ...(opts.tune ? ['-tune', opts.tune] : []),
          '-profile:v',
          'high',
          '-pix_fmt',
          'yuv420p',
          ...colorArgs,
          '-x264-params',
          `aq-mode=3:aq-strength=0.8:keyint=${fpsGop * 2}:min-keyint=${fpsGop}:psy-rd=1.0,0.15`,
          '-r',
          fpsStr,
          '-movflags',
          '+faststart'
        ]

    const head = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-stats',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'yuv420p',
      '-s',
      `${opts.width}x${opts.height}`,
      '-framerate',
      fpsStr,
      '-i',
      'pipe:0'
    ]

    const args = opts.hasAudio
      ? [
          ...head,
          '-i',
          opts.sourceVideo,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0?',
          ...videoEncode,
          '-c:a',
          'aac',
          '-b:a',
          '320k',
          '-ac',
          '2',
          '-af',
          'apad',
          '-shortest',
          opts.outputPath
        ]
      : [...head, ...videoEncode, opts.outputPath]

    const proc = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    this.track(proc)

    if (opts.onPercent && opts.frameTotal > 0) {
      const duration = opts.frameTotal / fps
      proc.stderr?.on('data', (data: Buffer) => {
        if (this.cancelled) return
        const text = data.toString()
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
        if (timeMatch && duration > 0) {
          const t =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseFloat(timeMatch[3])
          opts.onPercent?.(Math.max(0, Math.min(99, (t / duration) * 100)))
        }
      })
    }

    return proc
  }

  /**
   * Spawn ffmpeg that reads raw frames from stdin and writes a PNG sequence.
   * Used by Green Sparkle upscale+interpolate: vspipe TRT → PNG → RIFE.
   * Prefer yuv444p for RIFE-bound dumps (full chroma, correct BT.709 colors).
   * Avoid planar RGB/gbrp — easy to get channel order wrong.
   */
  spawnRawPngDump(opts: RawPngDumpPipeOptions): ChildProcess {
    const ffmpeg = getFfmpegPath()
    if (!fs.existsSync(ffmpeg)) {
      throw new Error(`ffmpeg not found at ${ffmpeg}. Run npm run setup.`)
    }

    fs.mkdirSync(opts.outDir, { recursive: true })
    const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24
    const fpsStr = fps.toFixed(6)
    const patternPath = path.join(opts.outDir, opts.pattern)

    // Tag limited-range BT.709/601 so YUV→RGB for PNG matches gst_vs_upscale.vpy
    const use709 = opts.width >= 1280
    const isYuv = opts.pixFmt === 'yuv420p' || opts.pixFmt === 'yuv444p'
    const yuvInputColor = isYuv
      ? use709
        ? [
            '-color_range',
            'tv',
            '-colorspace',
            'bt709',
            '-color_primaries',
            'bt709',
            '-color_trc',
            'bt709'
          ]
        : [
            '-color_range',
            'tv',
            '-colorspace',
            'smpte170m',
            '-color_primaries',
            'smpte170m',
            '-color_trc',
            'smpte170m'
          ]
      : []
    const yuvToRgbVf = isYuv
      ? use709
        ? 'zscale=rangein=limited:range=full:matrixin=709:matrix=709:primariesin=709:primaries=709:transferin=709:transfer=709,format=rgb24'
        : 'zscale=rangein=limited:range=full:matrixin=170m:matrix=170m:primariesin=smpte170m:primaries=smpte170m:transferin=smpte170m:transfer=smpte170m,format=rgb24'
      : null

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-stats',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      opts.pixFmt,
      '-s',
      `${opts.width}x${opts.height}`,
      '-framerate',
      fpsStr,
      ...yuvInputColor,
      '-i',
      'pipe:0',
      '-start_number',
      '1',
      ...(yuvToRgbVf ? ['-vf', yuvToRgbVf] : ['-pix_fmt', 'rgb24']),
      '-f',
      'image2',
      '-compression_level',
      '1',
      patternPath
    ]

    const proc = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    this.track(proc)

    const total = opts.frameTotal && opts.frameTotal > 0 ? opts.frameTotal : 0
    if (opts.onPercent && total > 0) {
      const duration = total / fps
      proc.stderr?.on('data', (data: Buffer) => {
        if (this.cancelled) return
        const text = data.toString()
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
        if (timeMatch && duration > 0) {
          const t =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseFloat(timeMatch[3])
          opts.onPercent?.(Math.max(0, Math.min(99, (t / duration) * 100)))
        }
        const frameMatch = text.match(/frame=\s*(\d+)/)
        if (frameMatch) {
          const cur = parseInt(frameMatch[1], 10)
          opts.onPercent?.(Math.max(0, Math.min(99, (cur / total) * 100)))
        }
      })
    }

    return proc
  }

  /**
   * Spawn ffmpeg that writes raw rgb24 frames to stdout (NVDEC when useCuda).
   * Caller owns the process lifetime; register with track() for cancel.
   */
  spawnRawDecode(opts: RawDecodePipeOptions): ChildProcess {
    const ffmpeg = getFfmpegPath()
    if (!fs.existsSync(ffmpeg)) {
      throw new Error(`ffmpeg not found at ${ffmpeg}. Run npm run setup.`)
    }

    const safeFps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24
    const matrix = opts.width >= 1280 ? '709' : '170m'
    const primaries = matrix === '709' ? '709' : 'smpte170m'
    const colorVf = `zscale=rangein=limited:range=full:matrixin=${matrix}:matrix=${matrix}:primariesin=${primaries}:primaries=${primaries}:transferin=${primaries}:transfer=${primaries}:f=lanczos,format=rgb24`

    // NVDEC accelerates decode; frames are downloaded for the rgb24 pipe.
    // (Keeping filters on host avoids fragile scale_cuda→rgb24 chains.)
    const args = opts.useCuda
      ? [
          '-hide_banner',
          '-loglevel',
          'error',
          '-hwaccel',
          'cuda',
          '-i',
          opts.inputPath,
          '-fps_mode',
          'cfr',
          '-vf',
          `fps=${safeFps},${colorVf}`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          'pipe:1'
        ]
      : [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          opts.inputPath,
          '-fps_mode',
          'cfr',
          '-vf',
          `fps=${safeFps},${colorVf}`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          'pipe:1'
        ]

    const proc = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.track(proc)
    return proc
  }

  /**
   * Spawn ffmpeg that reads raw rgb24 from stdin and encodes (NVENC or libx264).
   */
  spawnRawEncode(opts: RawEncodePipeOptions): ChildProcess {
    const ffmpeg = getFfmpegPath()
    if (!fs.existsSync(ffmpeg)) {
      throw new Error(`ffmpeg not found at ${ffmpeg}. Run npm run setup.`)
    }

    const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24
    const fpsStr = fps.toFixed(6)
    const crf = pickEncodeCrf(opts.width, opts.height)
    const fpsGop = Math.max(1, Math.round(fps))
    const matrix = opts.width >= 1280 ? '709' : '170m'
    const evenW = Math.max(2, opts.width - (opts.width % 2))
    const evenH = Math.max(2, opts.height - (opts.height % 2))

    const vf =
      `scale=${evenW}:${evenH}:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p`

    const colorArgs = [
      '-color_range',
      'tv',
      '-colorspace',
      matrix === '709' ? 'bt709' : 'smpte170m',
      '-color_primaries',
      matrix === '709' ? 'bt709' : 'smpte170m',
      '-color_trc',
      matrix === '709' ? 'bt709' : 'smpte170m'
    ]

    const videoEncode = opts.useNvenc
      ? buildNvencVideoArgs({
          width: opts.width,
          height: opts.height,
          fps,
          vf,
          colorArgs
        })
      : [
          '-vf',
          vf,
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-crf',
          String(crf),
          ...(opts.tune ? ['-tune', opts.tune] : []),
          '-profile:v',
          'high',
          '-pix_fmt',
          'yuv420p',
          ...colorArgs,
          '-x264-params',
          `aq-mode=3:aq-strength=0.8:keyint=${fpsGop * 2}:min-keyint=${fpsGop}:psy-rd=1.0,0.15`,
          '-r',
          fpsStr,
          '-movflags',
          '+faststart'
        ]

    const head = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${opts.width}x${opts.height}`,
      '-framerate',
      fpsStr,
      '-i',
      'pipe:0'
    ]

    const args = opts.hasAudio
      ? [
          ...head,
          '-i',
          opts.sourceVideo,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0?',
          ...videoEncode,
          '-c:a',
          'aac',
          '-b:a',
          '320k',
          '-ac',
          '2',
          '-af',
          'apad',
          '-shortest',
          opts.outputPath
        ]
      : [...head, ...videoEncode, opts.outputPath]

    const proc = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    this.track(proc)

    if (opts.onPercent && opts.frameTotal > 0) {
      const duration = opts.frameTotal / fps
      proc.stderr?.on('data', (data: Buffer) => {
        if (this.cancelled) return
        const text = data.toString()
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
        if (timeMatch && duration > 0) {
          const t =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseFloat(timeMatch[3])
          opts.onPercent?.(Math.max(0, Math.min(99, (t / duration) * 100)))
        }
      })
    }

    return proc
  }

  waitProc(proc: ChildProcess, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let stderr = ''
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      proc.on('close', (code) => {
        this.untrack(proc)
        if (this.cancelled) {
          reject(new Error('__CANCELLED__'))
          return
        }
        if (code === 0) resolve()
        else reject(new Error(`${label} exited ${code}\n${stderr.slice(-1200)}`))
      })
      proc.on('error', (err) => {
        this.untrack(proc)
        reject(err)
      })
    })
  }

  async encodeFrames(opts: EncodeFramesOptions): Promise<void> {
    const ffmpeg = getFfmpegPath()
    if (!fs.existsSync(ffmpeg)) {
      throw new Error(`ffmpeg not found at ${ffmpeg}. Run npm run setup.`)
    }

    const preferNvenc = Boolean(opts.preferNvenc) && (await nvencAvailable())
    if (preferNvenc) {
      try {
        await this.encodeFramesWithCodec(opts, true)
        return
      } catch (err) {
        if (this.cancelled) throw err
        console.warn('[ffmpeg] NVENC encode failed, falling back to libx264:', (err as Error).message)
      }
    }
    await this.encodeFramesWithCodec(opts, false)
  }

  private async encodeFramesWithCodec(opts: EncodeFramesOptions, useNvenc: boolean): Promise<void> {
    const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 24
    const fpsStr = fps.toFixed(6)
    const duration = opts.frameTotal / fps
    const framePattern = path.join(opts.framesDir, opts.framePattern)
    const crf = opts.enforceBitrate
      ? Math.max(10, pickEncodeCrf(opts.width, opts.height) - 2)
      : pickEncodeCrf(opts.width, opts.height)
    const fpsGop = Math.max(1, Math.round(fps))
    const matrix = opts.width >= 1280 ? '709' : '170m'
    const primaries = matrix === '709' ? '709' : 'smpte170m'

    const commonHead = [
      '-y',
      '-f',
      'image2',
      '-framerate',
      fpsStr,
      '-start_number',
      String(opts.startNumber),
      '-i',
      framePattern
    ]

    const vfHigh =
      `zscale=w=trunc(iw/2)*2:h=trunc(ih/2)*2:f=lanczos:dither=error_diffusion:rangein=full:range=limited:matrixin=${matrix}:matrix=${matrix}:primariesin=${primaries}:primaries=${primaries}:transferin=${primaries}:transfer=${primaries},format=yuv420p`
    const vfFallback =
      'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p'

    const colorArgs = [
      '-color_range',
      'tv',
      '-colorspace',
      matrix === '709' ? 'bt709' : 'smpte170m',
      '-color_primaries',
      matrix === '709' ? 'bt709' : 'smpte170m',
      '-color_trc',
      matrix === '709' ? 'bt709' : 'smpte170m'
    ]

    const videoEncode = (vf: string): string[] =>
      useNvenc
        ? buildNvencVideoArgs({
            width: opts.width,
            height: opts.height,
            fps,
            vf,
            colorArgs,
            enforceBitrate: opts.enforceBitrate || fps >= 48
          })
        : [
            '-vf',
            vf,
            '-c:v',
            'libx264',
            '-preset',
            'slow',
            '-crf',
            String(crf),
            ...(opts.tune ? ['-tune', opts.tune] : []),
            '-profile:v',
            'high',
            '-pix_fmt',
            'yuv420p',
            ...colorArgs,
            '-x264-params',
            `aq-mode=3:aq-strength=0.8:keyint=${fpsGop * 2}:min-keyint=${fpsGop}:psy-rd=1.0,0.15`,
            '-r',
            fpsStr,
            '-movflags',
            '+faststart'
          ]

    const tryEncode = async (vf: string, withAudio: boolean): Promise<void> => {
      const args = withAudio
        ? [
            ...commonHead,
            '-i',
            opts.sourceVideo,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0?',
            ...videoEncode(vf),
            '-c:a',
            'aac',
            '-b:a',
            '320k',
            '-ac',
            '2',
            '-af',
            'apad',
            '-shortest',
            opts.outputPath
          ]
        : [...commonHead, ...videoEncode(vf), opts.outputPath]

      await this.runFfmpeg(args, opts.onPercent, duration)
    }

    const encodeWithVf = async (vf: string): Promise<void> => {
      if (opts.hasAudio) {
        try {
          await tryEncode(vf, true)
        } catch (err) {
          if (this.cancelled) throw err
          await tryEncode(vf, false)
        }
      } else {
        await tryEncode(vf, false)
      }
    }

    try {
      await encodeWithVf(vfHigh)
    } catch (err) {
      if (this.cancelled) throw err
      await encodeWithVf(vfFallback)
    }
  }

  private runFfmpeg(
    args: string[],
    onPercent: (percent: number) => void,
    durationSec?: number
  ): Promise<void> {
    const ffmpeg = getFfmpegPath()
    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('__CANCELLED__'))
        return
      }

      const proc = spawn(ffmpeg, args, { windowsHide: true })
      this.proc = proc

      if (this.cancelled) {
        this.proc = null
        killProcessTree(proc)
        reject(new Error('__CANCELLED__'))
        return
      }

      let stderr = ''

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        if (this.cancelled) return

        if (durationSec && durationSec > 0) {
          const timeMatch = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
          if (timeMatch) {
            const t =
              parseInt(timeMatch[1], 10) * 3600 +
              parseInt(timeMatch[2], 10) * 60 +
              parseFloat(timeMatch[3])
            onPercent(Math.max(0, Math.min(99, (t / durationSec) * 100)))
            return
          }
        }

        const match = text.match(/frame=\s*(\d+)/)
        if (match) {
          onPercent(Math.min(99, (parseInt(match[1], 10) % 1000) / 10))
        }
      })

      proc.on('close', (code) => {
        this.proc = null
        if (this.cancelled) {
          reject(new Error('__CANCELLED__'))
          return
        }
        if (code === 0) {
          onPercent(100)
          resolve()
        } else {
          reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-1200)}`))
        }
      })

      proc.on('error', (err) => {
        this.proc = null
        reject(err)
      })
    })
  }
}

function runCapture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout + stderr)
      else reject(new Error(`command failed (${code}): ${stderr || stdout}`))
    })
    proc.on('error', reject)
  })
}
