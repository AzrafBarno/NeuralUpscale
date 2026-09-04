import { useAppStore, type ScaleFactor } from '@/store/app.store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const SCALES: ScaleFactor[] = [2, 3, 4]

export function ScaleSelector(): JSX.Element {
  const selectedScale = useAppStore((s) => s.selectedScale)
  const setSelectedScale = useAppStore((s) => s.setSelectedScale)

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-[var(--text-muted)]">Scale</label>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
              {SCALES.map((scale) => (
                <Button
                  key={scale}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'rounded-none border-r border-[var(--border)] last:border-r-0 px-4',
                    selectedScale === scale && 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                  )}
                  onClick={() => setSelectedScale(scale)}
                >
                  {scale}x
                </Button>
              ))}
            </div>
          </TooltipTrigger>
          {(selectedScale === 2 || selectedScale === 3) && (
            <TooltipContent>
              This model upscales to 4x natively. Output will be downscaled to match your selection.
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
