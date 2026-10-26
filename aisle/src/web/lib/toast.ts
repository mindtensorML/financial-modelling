import { observable } from './observable'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: { label: string; run: () => void }
}

export const toasts = observable<Toast[]>([])
let nextId = 1

export function toast(message: string, options: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}): void {
  const id = nextId++
  toasts.set((list) => [...list.slice(-2), { id, message, tone: options.tone ?? 'info', action: options.action }])
  setTimeout(() => dismissToast(id), options.ms ?? (options.action ? 6000 : 3500))
}

export function dismissToast(id: number): void {
  toasts.set((list) => list.filter((t) => t.id !== id))
}
