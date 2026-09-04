import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Switch({
  checked = false,
  onCheckedChange,
  className,
  disabled,
  ...props
}: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors no-drag',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'bg-[var(--accent)] border-[var(--accent)]'
          : 'bg-[var(--bg-tertiary)] border-[var(--border)]',
        className
      )}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}
