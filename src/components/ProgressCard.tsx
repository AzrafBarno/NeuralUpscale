import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app.store'
import { Progress } from '@/components/ui/progress'
import { formatEta } from '@/lib/utils'

export function ProgressCard(): JSX.Element | null {
  const isProcessing = useAppStore((s) => s.isProcessing)
  const progress = useAppStore((s) => s.progress)
  const progressMessage = useAppStore((s) => s.progressMessage)
  const [startTime] = useState(() => Date.now())
  const [eta, setEta] = useState('--:--')

  useEffect(() => {
    if (!isProcessing || progress <= 0) return
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000
      const remaining = progress > 0 ? (elapsed / progress) * (100 - progress) : 0
      setEta(formatEta(remaining))
    }, 500)
    return () => clearInterval(interval)
  }, [isProcessing, progress, startTime])

  if (!isProcessing && progress === 0) return null

  return (
    <div className="space-y-2 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex justify-between text-sm">
        <span className="text-[var(--text-secondary)]">{progressMessage || 'Processing...'}</span>
        <span className="font-mono-path">{Math.round(progress)}%</span>
      </div>
      <Progress value={progress} shimmer={isProcessing} />
      {isProcessing && progress > 0 && progress < 100 && (
        <p className="text-xs text-[var(--text-muted)] text-right">ETA: {eta}</p>
      )}
    </div>
  )
}
