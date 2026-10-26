import type { Capture } from '../../shared/types'
import { plural } from './format'

/** "Costco receipt", "Voice note", "List photo"... */
export function captureTitle(capture: Capture): string {
  const kind = capture.extraction?.kind ?? (capture.hint === 'auto' ? null : capture.hint)
  if (kind === 'receipt') return capture.extraction?.store ? `${capture.extraction.store} receipt` : 'Receipt'
  if (capture.media === 'audio') return 'Voice note'
  if (kind === 'list') return capture.media === 'image' ? 'List photo' : 'Text list'
  return capture.media === 'image' ? 'Photo' : 'Text'
}

/** One line about what is in it, or what happened to it. */
export function captureDetail(capture: Capture): string | null {
  const { result, extraction } = capture
  if (capture.status === 'failed') return capture.error
  if (capture.status === 'applied' && result) {
    if (result.mode === 'receipt') {
      const checked = result.checkedOff ? `, ${result.checkedOff} checked off` : ''
      return `${plural(result.purchases, 'purchase')} recorded${checked}`
    }
    const merged = result.merged ? ` (${result.merged} already there)` : ''
    return `${plural(result.added + result.merged, 'item')} added${merged}`
  }
  if (extraction && capture.status === 'ready') {
    if (!extraction.items.length) return 'No items found'
    const names = extraction.items.slice(0, 3).map((i) => i.name)
    return `${plural(extraction.items.length, 'item')}: ${names.join(', ')}${extraction.items.length > 3 ? '…' : ''}`
  }
  const text = capture.transcript ?? capture.textInput
  if (text) return text.replace(/\s+/g, ' ').slice(0, 90)
  return capture.fileName
}

export type StatusTone = 'busy' | 'ready' | 'failed' | 'done'

export function captureStatus(capture: Capture): { label: string; tone: StatusTone } {
  switch (capture.status) {
    case 'pending':
    case 'processing':
      return { label: 'Reading…', tone: 'busy' }
    case 'ready':
      return { label: 'Ready to review', tone: 'ready' }
    case 'failed':
      return { label: 'Could not read it', tone: 'failed' }
    case 'applied':
      return { label: 'Added', tone: 'done' }
    case 'dismissed':
      return { label: 'Dismissed', tone: 'done' }
  }
}

export const captureFileUrl = (id: string) => `/api/captures/${encodeURIComponent(id)}/file`
