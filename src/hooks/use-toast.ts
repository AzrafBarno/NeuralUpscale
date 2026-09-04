import * as React from 'react'
import type { ToastActionElement, ToastProps } from '@/components/ui/toast'

const TOAST_LIMIT = 3
const TOAST_REMOVE_DELAY = 5000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const listeners: Array<(state: State) => void> = []
let memoryState: State = { toasts: [] }

type State = { toasts: ToasterToast[] }

function dispatch(action: Action): void {
  memoryState = reducer(memoryState, action)
  listeners.forEach((l) => l(memoryState))
}

type Action =
  | { type: 'ADD_TOAST'; toast: ToasterToast }
  | { type: 'UPDATE_TOAST'; toast: Partial<ToasterToast> }
  | { type: 'DISMISS_TOAST'; toastId?: string }
  | { type: 'REMOVE_TOAST'; toastId?: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TOAST':
      return { ...state, toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) }
    case 'DISMISS_TOAST':
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toastId || action.toastId === undefined ? { ...t, open: false } : t
        )
      }
    case 'REMOVE_TOAST':
      return {
        ...state,
        toasts: action.toastId === undefined ? [] : state.toasts.filter((t) => t.id !== action.toastId)
      }
    default:
      return state
  }
}

let count = 0
function genId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

export function toast(props: Omit<ToasterToast, 'id'>): { id: string; dismiss: () => void } {
  const id = genId()
  dispatch({ type: 'ADD_TOAST', toast: { ...props, id, open: true } })
  setTimeout(() => dispatch({ type: 'DISMISS_TOAST', toastId: id }), TOAST_REMOVE_DELAY)
  setTimeout(() => dispatch({ type: 'REMOVE_TOAST', toastId: id }), TOAST_REMOVE_DELAY + 300)
  return { id, dismiss: () => dispatch({ type: 'DISMISS_TOAST', toastId: id }) }
}

export function useToast(): { toast: typeof toast; toasts: ToasterToast[] } {
  const [state, setState] = React.useState<State>(memoryState)
  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const i = listeners.indexOf(setState)
      if (i >= 0) listeners.splice(i, 1)
    }
  }, [])
  return { toast, toasts: state.toasts }
}
