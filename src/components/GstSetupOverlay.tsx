import { XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

interface GstSetupOverlayProps {
  percent: number
  message: string
  onCancel: () => void
}

export function GstSetupOverlay({ percent, message, onCancel }: GstSetupOverlayProps): JSX.Element {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/50 backdrop-blur-md rounded-lg p-6">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-lg">
        <p className="text-sm font-medium text-[#76B900]">Green Sparkle Technology</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{message || 'Preparing TensorRT…'}</p>
        <Progress value={Math.max(0, Math.min(100, percent))} className="mt-4" />
        <p className="mt-2 text-xs tabular-nums text-[var(--text-muted)]">{Math.round(percent)}%</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          First-time setup downloads the TensorRT runtime and compiles an engine for this GPU. It only
          happens once.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="destructive" size="sm" className="gap-1.5" onClick={onCancel}>
            <XCircle className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
