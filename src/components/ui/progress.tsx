import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { shimmer?: boolean }
>(({ className, value, shimmer, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn('relative h-2 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn('h-full w-full flex-1 transition-all', shimmer && 'progress-shimmer')}
      style={{
        transform: `translateX(-${100 - (value || 0)}%)`,
        background: shimmer ? undefined : 'var(--accent)'
      }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = 'Progress'
