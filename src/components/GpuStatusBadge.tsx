import { useAppStore } from '@/store/app.store'
import { cn } from '@/lib/utils'

export function GpuStatusBadge(): JSX.Element {
  const gpuInfo = useAppStore((s) => s.gpuInfo)

  if (!gpuInfo) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)]">
        <span className="h-2 w-2 rounded-full bg-[var(--text-muted)] animate-pulse" />
        Detecting GPU...
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-tertiary)] text-sm">
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          gpuInfo.vulkanSupported ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'
        )}
      />
      <span className="text-[var(--text-secondary)]">{gpuInfo.gpuName}</span>
    </div>
  )
}
