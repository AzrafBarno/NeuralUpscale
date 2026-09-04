import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:pointer-events-none disabled:opacity-50 no-drag',
  {
    variants: {
      variant: {
        default: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
        secondary: 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]',
        outline: 'border border-[var(--border)] bg-transparent hover:bg-[var(--bg-tertiary)]',
        ghost: 'hover:bg-[var(--bg-tertiary)]',
        destructive: 'bg-[var(--error)] text-white hover:opacity-90'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = 'Button'

export { buttonVariants }
