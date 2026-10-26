import { del, get, set } from 'idb-keyval'
import type { Capture, CaptureHint } from '../../shared/types'
import { api, ApiError, errorMessage, isTransient, OfflineError } from './api'
import { prepareImage } from './images'
import { observable, useObservable } from './observable'

export interface PendingUpload {
  id: string
  hint: CaptureHint
  /** Stored as bytes: some browsers cannot keep File objects in IndexedDB reliably. */
  bytes: ArrayBuffer | null
  type: string | null
  fileName: string | null
  text: string | null
  createdAt: number
  /** Why the server refused it; such uploads wait for the user to remove them. */
  error: string | null
}

const KEY = 'aisle-uploads'

/**
 * Captures waiting to reach the server. Each is saved to IndexedDB before upload, so a photo
 * taken in a store with no signal goes up later, and the id it was given makes a retried
 * upload land on the same capture.
 */
class UploadQueue {
  readonly items = observable<PendingUpload[]>([])
  onUploaded: ((capture: Capture) => void) | null = null
  private loaded: Promise<void> | null = null
  private running = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  load(): Promise<void> {
    this.loaded ??= get<PendingUpload[]>(KEY)
      .then((saved) => {
        if (saved?.length) this.items.set(saved)
        window.addEventListener('online', () => void this.process())
      })
      .catch(() => undefined)
    return this.loaded
  }

  async add(input: { hint: CaptureHint; file?: File; text?: string }): Promise<string> {
    await this.load()
    const file = input.file?.type.startsWith('image/') ? await prepareImage(input.file) : input.file
    const upload: PendingUpload = {
      id: crypto.randomUUID(),
      hint: input.hint,
      bytes: file ? await file.arrayBuffer() : null,
      type: file ? file.type || 'application/octet-stream' : null,
      fileName: file?.name ?? null,
      text: file ? null : (input.text ?? '').trim(),
      createdAt: Date.now(),
      error: null,
    }
    this.items.set((list) => [...list, upload])
    await this.save()
    void this.process()
    return upload.id
  }

  async remove(id: string): Promise<void> {
    this.items.set((list) => list.filter((u) => u.id !== id))
    await this.save()
  }

  async clear(): Promise<void> {
    this.items.set([])
    await del(KEY).catch(() => undefined)
  }

  async process(): Promise<void> {
    await this.load()
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const next = this.items.get().find((u) => !u.error)
        if (!next) break
        try {
          const capture = await this.send(next)
          await this.remove(next.id)
          this.onUploaded?.(capture)
        } catch (error) {
          // Signed out: keep it for after the next sign-in.
          if (error instanceof ApiError && error.status === 401) break
          if (isTransient(error)) {
            this.retryLater(error instanceof OfflineError ? 15_000 : 30_000)
            break
          }
          this.items.set((list) => list.map((u) => (u.id === next.id ? { ...u, error: errorMessage(error) } : u)))
          await this.save()
        }
      }
    } finally {
      this.running = false
    }
  }

  private send(upload: PendingUpload): Promise<Capture> {
    const form = new FormData()
    form.append('id', upload.id)
    form.append('hint', upload.hint)
    if (upload.bytes) {
      form.append('file', new File([upload.bytes], upload.fileName ?? 'capture', { type: upload.type ?? '' }))
    } else {
      form.append('text', upload.text ?? '')
    }
    return api<Capture>('POST', '/api/captures', form)
  }

  private retryLater(ms: number): void {
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.process()
    }, ms)
  }

  private save(): Promise<void> {
    return set(KEY, this.items.get()).catch(() => undefined)
  }
}

export const uploads = new UploadQueue()

export function useUploads(): PendingUpload[] {
  return useObservable(uploads.items)
}
