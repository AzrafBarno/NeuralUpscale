import { useRef, useState, useCallback, useEffect } from 'react'

interface BeforeAfterSliderProps {
  beforeSrc?: string
  afterSrc?: string
  isProcessing?: boolean
  progress?: number
  progressMessage?: string
}

const RING_SIZE = 120
const RING_STROKE = 8
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  isProcessing = false,
  progress = 0,
  progressMessage
}: BeforeAfterSliderProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [sliderPercent, setSliderPercent] = useState(50)
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSliderPercent(50)
  }, [beforeSrc])

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

  const handleWheel = (e: React.WheelEvent): void => {
    if (isProcessing) return
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    setZoom((z) => {
      const next = Math.max(1, Math.min(4, Math.round((z + delta) * 10) / 10))
      if (next === 1) setPan({ x: 0, y: 0 })
      return next
    })
  }

  const handlePanStart = (e: React.MouseEvent): void => {
    if (isProcessing || zoom <= 1 || dragging || e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-slider-handle]')) return
    setPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  useEffect(() => {
    if (!panning) return
    const onMove = (e: MouseEvent): void => {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y)
      })
    }
    const onUp = (): void => setPanning(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [panning])

  const mediaTransform = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: 'center center'
  }

  const clipInset = `inset(0 0 0 ${sliderPercent}%)`
  const clampedProgress = Math.max(0, Math.min(100, progress))
  const dashOffset = RING_CIRCUMFERENCE * (1 - clampedProgress / 100)

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-[300px] rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-tertiary)] select-none"
      onWheel={handleWheel}
      onMouseDown={handlePanStart}
      style={{
        cursor: isProcessing
          ? 'default'
          : panning
            ? 'grabbing'
            : zoom > 1
              ? 'grab'
              : 'default'
      }}
    >
      {!beforeSrc ? (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
          Select an image to preview
        </div>
      ) : (
        <>
          <div
            className="absolute inset-0 flex items-center justify-center transition-[filter] duration-300"
            style={{
              ...mediaTransform,
              filter: isProcessing ? 'blur(8px)' : undefined
            }}
          >
            <img
              src={beforeSrc}
              alt="Before"
              className="max-w-full max-h-full object-contain pointer-events-none"
              draggable={false}
            />
          </div>

          <div
            className="absolute inset-0 transition-[filter] duration-300"
            style={{
              clipPath: clipInset,
              filter: isProcessing ? 'blur(8px)' : undefined
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center" style={mediaTransform}>
              {afterSrc ? (
                <img
                  src={afterSrc}
                  alt="After"
                  className="max-w-full max-h-full object-contain pointer-events-none"
                  draggable={false}
                />
              ) : (
                <>
                  <img
                    src={beforeSrc}
                    alt="Placeholder"
                    className="max-w-full max-h-full object-contain blur-sm opacity-60 pointer-events-none"
                    draggable={false}
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
        </>
      )}

      {beforeSrc && !isProcessing && (
        <>
          <span className="absolute bottom-3 left-3 z-30 text-xs font-medium bg-black/60 text-white px-2 py-0.5 rounded-full pointer-events-none">
            BEFORE
          </span>
          <span className="absolute bottom-3 right-3 z-30 text-xs font-medium bg-black/60 text-white px-2 py-0.5 rounded-full pointer-events-none">
            AFTER
          </span>
        </>
      )}

      {zoom > 1 && !isProcessing && (
        <button
          type="button"
          className="absolute top-3 right-3 z-30 text-xs bg-black/60 text-white px-2 py-0.5 rounded-full no-drag hover:bg-black/80"
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
          title="Reset zoom"
        >
          {zoom.toFixed(1)}x · Reset
        </button>
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
          <p className="text-sm text-white/80">
            {progressMessage || 'Upscaling…'}
          </p>
        </div>
      )}
    </div>
  )
}
