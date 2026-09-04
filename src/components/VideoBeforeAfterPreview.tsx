import { useRef, useState, useCallback, useEffect } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoBeforeAfterPreviewProps {
  beforeSrc?: string
  afterSrc?: string
  isProcessing?: boolean
  progress?: number
  progressMessage?: string
  duration?: number
  /** Current (source) video size / fps — shown on the left in white */
  beforeWidth?: number
  beforeHeight?: number
  beforeFps?: number
  /** Target (output) size / fps — shown on the right in green */
  afterWidth?: number
  afterHeight?: number
  afterFps?: number
}

const RING_SIZE = 120
const RING_STROKE = 8
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRes(width?: number, height?: number): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null
  return `${Math.round(width)}×${Math.round(height)}`
}

function formatFps(fps?: number): string | null {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return null
  const rounded = Math.round(fps * 100) / 100
  return Number.isInteger(rounded) ? `${rounded} fps` : `${rounded.toFixed(2)} fps`
}

function formatMediaMeta(width?: number, height?: number, fps?: number): string | null {
  const parts = [formatRes(width, height), formatFps(fps)].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function VideoBeforeAfterPreview({
  beforeSrc,
  afterSrc,
  isProcessing = false,
  progress = 0,
  progressMessage,
  duration = 0,
  beforeWidth,
  beforeHeight,
  beforeFps,
  afterWidth,
  afterHeight,
  afterFps
}: VideoBeforeAfterPreviewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeRef = useRef<HTMLVideoElement>(null)
  const afterRef = useRef<HTMLVideoElement>(null)
  const [sliderPercent, setSliderPercent] = useState(50)
  const [dragging, setDragging] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mediaDuration, setMediaDuration] = useState(duration)

  useEffect(() => {
    setSliderPercent(50)
    setCurrentTime(0)
    setPlaying(false)
    if (beforeRef.current) {
      beforeRef.current.pause()
      beforeRef.current.currentTime = 0
    }
    if (afterRef.current) {
      afterRef.current.pause()
      afterRef.current.currentTime = 0
    }
  }, [beforeSrc, afterSrc])

  useEffect(() => {
    if (duration > 0) setMediaDuration(duration)
  }, [duration])

  const syncAfter = useCallback((time: number) => {
    const after = afterRef.current
    if (after && afterSrc) {
      if (Math.abs(after.currentTime - time) > 0.05) {
        after.currentTime = time
      }
    }
  }, [afterSrc])

  const updateSlider = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = ((clientX - rect.left) / rect.width) * 100
    setSliderPercent(Math.max(0, Math.min(100, pct)))
  }, [])

  useEffect(() => {
    if (!dragging || isProcessing) return
    const onMove = (e: MouseEvent | TouchEvent): void => {
      e.preventDefault()
      const x = 'touches' in e ? e.touches[0].clientX : e.clientX
      updateSlider(x)
    }
    const onUp = (): void => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [dragging, updateSlider, isProcessing])

  const seekTo = (time: number): void => {
    const before = beforeRef.current
    if (!before) return
    const clamped = Math.max(0, Math.min(mediaDuration || before.duration || 0, time))
    before.currentTime = clamped
    syncAfter(clamped)
    setCurrentTime(clamped)
  }

  const togglePlay = async (): Promise<void> => {
    if (isProcessing || !beforeRef.current) return
    const before = beforeRef.current
    const after = afterRef.current
    if (playing) {
      before.pause()
      after?.pause()
      setPlaying(false)
      return
    }
    try {
      syncAfter(before.currentTime)
      await before.play()
      if (after && afterSrc) {
        after.currentTime = before.currentTime
        await after.play().catch(() => undefined)
      }
      setPlaying(true)
    } catch {
      setPlaying(false)
    }
  }

  const clipInset = `inset(0 0 0 ${sliderPercent}%)`
  const clampedProgress = Math.max(0, Math.min(100, progress))
  const dashOffset = RING_CIRCUMFERENCE * (1 - clampedProgress / 100)
  const total = mediaDuration || duration || 0
  const beforeMeta = formatMediaMeta(beforeWidth, beforeHeight, beforeFps)
  const afterMeta = formatMediaMeta(afterWidth, afterHeight, afterFps)

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-[280px] rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-card)] select-none"
      >
        {!beforeSrc ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
            Select a video to preview
          </div>
        ) : (
          <>
            <div
              className="absolute inset-0 flex items-center justify-center transition-[filter] duration-300"
              style={{ filter: isProcessing ? 'blur(8px)' : undefined }}
            >
              <video
                ref={beforeRef}
                src={beforeSrc}
                className="max-w-full max-h-full object-contain pointer-events-none"
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0) setMediaDuration(d)
                }}
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime
                  setCurrentTime(t)
                  syncAfter(t)
                }}
                onEnded={() => {
                  setPlaying(false)
                  afterRef.current?.pause()
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            </div>

            <div
              className="absolute inset-0 transition-[filter] duration-300"
              style={{
                clipPath: clipInset,
                filter: isProcessing ? 'blur(8px)' : undefined
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                {afterSrc ? (
                  <video
                    ref={afterRef}
                    src={afterSrc}
                    className="max-w-full max-h-full object-contain pointer-events-none"
                    muted
                    playsInline
                    preload="auto"
                  />
                ) : (
                  <>
                    <video
                      src={beforeSrc}
                      className="max-w-full max-h-full object-contain blur-sm opacity-60 pointer-events-none"
                      muted
                      playsInline
                    />
                    {!isProcessing && (
                      <span className="absolute text-sm text-[var(--text-secondary)] bg-black/40 px-3 py-1 rounded-full pointer-events-none">
                        Upscaled preview will appear here
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {!isProcessing && (
              <div
                data-slider-handle
                className="absolute top-0 bottom-0 z-20 w-0.5 bg-white cursor-ew-resize"
                style={{ left: `${sliderPercent}%`, touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setDragging(true)
                  updateSlider(e.clientX)
                }}
                onTouchStart={(e) => {
                  e.stopPropagation()
                  setDragging(true)
                  updateSlider(e.touches[0].clientX)
                }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white shadow-lg flex items-center justify-center">
                  <div className="flex gap-0.5">
                    <div className="w-0.5 h-4 bg-gray-400" />
                    <div className="w-0.5 h-4 bg-gray-400" />
                  </div>
                </div>
              </div>
            )}

            {!isProcessing && (
              <>
                <div className="absolute top-3 left-3 z-30 flex flex-col items-start gap-1 pointer-events-none">
                  <span className="text-xs font-medium bg-black/60 text-white px-2 py-0.5 rounded-full">
                    BEFORE
                  </span>
                  {beforeMeta && (
                    <span className="text-xs font-medium tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] px-0.5">
                      {beforeMeta}
                    </span>
                  )}
                </div>
                <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1 pointer-events-none">
                  <span className="text-xs font-medium bg-black/60 text-white px-2 py-0.5 rounded-full">
                    AFTER
                  </span>
                  {afterMeta && (
                    <span className="text-xs font-medium tabular-nums text-[var(--accent)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] px-0.5">
                      {afterMeta}
                    </span>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {isProcessing && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/35 backdrop-blur-[2px]">
            <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
              <svg
                width={RING_SIZE}
                height={RING_SIZE}
                className="-rotate-90"
                viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              >
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth={RING_STROKE}
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-200 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold tabular-nums text-white">
                  {Math.round(clampedProgress)}%
                </span>
              </div>
            </div>
            <p className="text-sm text-white/80 px-4 text-center">
              {progressMessage || 'Processing…'}
            </p>
          </div>
        )}
      </div>

      {beforeSrc && (
        <div className="flex items-center gap-3 shrink-0 px-1">
          <button
            type="button"
            className={cn(
              'p-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-tertiary)] no-drag',
              isProcessing && 'opacity-50 pointer-events-none'
            )}
            onClick={() => void togglePlay()}
            disabled={isProcessing}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <span className="text-xs tabular-nums text-[var(--text-muted)] w-10 shrink-0">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(total, 0.01)}
            step={0.01}
            value={Math.min(currentTime, total || 0)}
            disabled={isProcessing || total <= 0}
            onChange={(e) => {
              setPlaying(false)
              beforeRef.current?.pause()
              afterRef.current?.pause()
              seekTo(parseFloat(e.target.value))
            }}
            className="flex-1 h-1.5 accent-[var(--accent)] cursor-pointer no-drag disabled:opacity-50"
          />
          <span className="text-xs tabular-nums text-[var(--text-muted)] w-10 shrink-0 text-right">
            {formatTime(total)}
          </span>
        </div>
      )}
    </div>
  )
}
