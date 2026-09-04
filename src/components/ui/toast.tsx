import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const ToastProvider = ToastPrimitives.Provider

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      // Inset from the window edge so the card is never clipped by the Electron frame
      'fixed bottom-4 right-4 z-[100] flex max-h-[calc(100vh-2rem)] w-[min(100%-2rem,420px)] flex-col-reverse gap-2 outline-none',
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = 'ToastViewport'

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Root
    ref={ref}
    className={cn(
      'group pointer-events-auto relative flex w-full flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-4 pr-10 shadow-lg transition-all',
      className
    )}
    {...props}
  />
))
Toast.displayName = 'Toast'

export const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-transparent px-3 text-sm font-medium hover:bg-[var(--bg-tertiary)] no-drag',
      className
    )}
    {...props}
  />
))
ToastAction.displayName = 'ToastAction'

export const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-md p-1.5 text-[var(--text-muted)] opacity-70 hover:opacity-100 hover:bg-[var(--bg-tertiary)]',
      className
    )}
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = 'ToastClose'

export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
))
ToastTitle.displayName = 'ToastTitle'

export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-sm text-[var(--text-secondary)] break-words', className)}
    {...props}
  />
))
ToastDescription.displayName = 'ToastDescription'
