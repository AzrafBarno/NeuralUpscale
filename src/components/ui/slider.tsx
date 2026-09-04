import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center no-drag', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
      <SliderPrimitive.Range className="absolute h-full bg-[var(--accent)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-[var(--accent)] bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]" />
  </SliderPrimitive.Root>
))
Slider.displayName = 'Slider'
