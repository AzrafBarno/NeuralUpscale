import { Pause, Play, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface BatchProgressOverlayProps {
  done: number
  total: number
  status: 'running' | 'paused'
  onPause?: () => void
  onResume?: () => void
  onCancel: () => void
  /** When false, only Cancel is shown (e.g. video batch). Default true. */
  allowPause?: boolean
  statusLabel?: string
}

const SIZE = 168
const STROKE = 12
const RADIUS = (SIZE - STROKE) / 2
const CENTER = SIZE / 2

/** Polar angle (deg, 0 = top, clockwise) → SVG point */
function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(startDeg: number, endDeg: number): string {
  const start = polar(CENTER, CENTER, RADIUS, startDeg)
  const end = polar(CENTER, CENTER, RADIUS, endDeg)
  const sweep = endDeg - startDeg
  const largeArc = sweep > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

export function BatchProgressOverlay({
  done,
  total,
  status,
  onPause,
  onResume,
  onCancel,
  allowPause = true,
  statusLabel = 'Upscaling'
}: BatchProgressOverlayProps): JSX.Element {
  const safeTotal = Math.max(total, 1)
  const clampedDone = Math.max(0, Math.min(done, safeTotal))

  // Gap between fragments scales down with larger batches
  const gapDeg = Math.min(6, Math.max(1.2, 360 / safeTotal / 5))
  const segmentSpan = 360 / safeTotal
  const usable = Math.max(segmentSpan - gapDeg, 0.5)

  const segments = Array.from({ length: safeTotal }, (_, i) => {
    const start = i * segmentSpan + gapDeg / 2
    const end = start + usable
    return { i, start, end, filled: i < clampedDone }
  })

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-black/40 backdrop-blur-md rounded-lg">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="overflow-visible">
          {segments.map(({ i, start, end, filled }) => (
            <path
              key={i}
              d={arcPath(start, end)}
              fill="none"
              stroke={filled ? 'var(--accent)' : 'rgba(255,255,255,0.18)'}
              strokeWidth={STROKE}
              strokeLinecap="butt"
              className={cn(
                'transition-colors duration-300',
                !filled && status === 'running' && i === clampedDone && 'animate-pulse'
              )}
              style={
                !filled && status === 'running' && i === clampedDone
                  ? { stroke: 'rgba(16, 185, 129, 0.45)' }
                  : undefined
              }
            />
          ))}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-3xl font-semibold tabular-nums text-white leading-none">
            {clampedDone}
            <span className="text-white/50 font-medium">/{safeTotal}</span>
          </span>
          <span className="mt-1.5 text-xs text-white/60">
            {status === 'paused' ? 'Paused' : statusLabel}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {allowPause &&
          (status === 'running' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onPause}
              className="gap-1.5 min-w-[96px]"
              disabled={!onPause}
            >
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={onResume}
              className="gap-1.5 min-w-[96px]"
              disabled={!onResume}
            >
              <Play className="h-4 w-4" />
              Resume
            </Button>
          ))}
        <Button variant="destructive" size="sm" onClick={onCancel} className="gap-1.5 min-w-[96px]">
          <XCircle className="h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  )
}
