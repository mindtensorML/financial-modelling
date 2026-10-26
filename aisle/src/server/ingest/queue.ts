import type { DB } from '../db'
import type { RealtimeHub } from '../realtime'
import type { CaptureRow } from '../rows'
import { getCapture, updateCapture } from '../services/captures'
import { type WriteContext, withWrite } from '../services/context'
import { AiError } from './ai'
import type { BlobStore } from './blobs'
import { CaptureFailure, type Engines, type PipelineOutput, runPipeline } from './pipeline'
import { extractContext, resolveExtraction } from './resolve'

export interface QueueDeps {
  db: DB
  blobs: BlobStore
  engines: Engines
  hub: RealtimeHub
  now: () => number
  concurrency?: number
}

/**
 * Runs captures through the extraction pipeline in the background, a couple at a time. The
 * queue lives in memory; `resume` picks up whatever a restart interrupted, since every job's
 * state is in the captures table.
 */
export class CaptureQueue {
  private waiting: string[] = []
  private running = new Set<string>()
  private idleWaiters: Array<() => void> = []

  constructor(private readonly deps: QueueDeps) {}

  enqueue(captureId: string): void {
    if (this.running.has(captureId) || this.waiting.includes(captureId)) return
    this.waiting.push(captureId)
    this.pump()
  }

  resume(): number {
    const rows = this.deps.db
      .prepare(`SELECT id FROM captures WHERE status IN ('pending', 'processing') AND deleted_at IS NULL ORDER BY created_at`)
      .all() as { id: string }[]
    for (const { id } of rows) this.enqueue(id)
    return rows.length
  }

  /** Resolves once nothing is queued or running. */
  idle(): Promise<void> {
    if (!this.running.size && !this.waiting.length) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private pump(): void {
    const limit = this.deps.concurrency ?? 2
    while (this.running.size < limit && this.waiting.length) {
      const id = this.waiting.shift()!
      this.running.add(id)
      void this.process(id)
        .catch((error) => console.error(`Capture ${id} could not be processed`, error))
        .finally(() => {
          this.running.delete(id)
          this.pump()
          if (!this.running.size && !this.waiting.length) for (const resolve of this.idleWaiters.splice(0)) resolve()
        })
    }
  }

  private write(householdId: string, fn: (ctx: WriteContext) => void): void {
    const { rev } = withWrite(this.deps.db, householdId, null, this.deps.now(), fn)
    this.deps.hub.publish(householdId, rev)
  }

  private async process(id: string): Promise<void> {
    const { db, blobs, engines } = this.deps
    const capture = db.prepare('SELECT * FROM captures WHERE id = ?').get(id) as CaptureRow | undefined
    if (!capture || capture.deleted_at || (capture.status !== 'pending' && capture.status !== 'processing')) return
    const householdId = capture.household_id
    this.write(householdId, (ctx) => updateCapture(ctx, id, { status: 'processing', error: null }))

    let output: PipelineOutput | null = null
    let failure: string | null = null
    try {
      const bytes = capture.blob_key ? await blobs.read(capture.blob_key) : null
      output = await runPipeline(
        { media: capture.media, mimeType: capture.mime_type, bytes, text: capture.text_input },
        engines,
        extractContext(db, householdId, capture.hint),
      )
    } catch (error) {
      if (error instanceof CaptureFailure || error instanceof AiError) failure = error.message
      else {
        console.error(`Capture ${id} failed`, error)
        failure = 'Something went wrong while reading this. Try again.'
      }
    }

    // The user may have dismissed or deleted the capture while it was being read.
    const current = getCapture(db, householdId, id)
    if (!current || current.deleted_at || current.status !== 'processing') return
    this.write(householdId, (ctx) => {
      if (!output) {
        updateCapture(ctx, id, { status: 'failed', error: failure })
        return
      }
      const extraction = resolveExtraction(db, householdId, output.raw, output.warnings, ctx.now)
      updateCapture(ctx, id, {
        status: 'ready',
        extraction: JSON.stringify(extraction),
        engine: output.engine,
        transcript: output.transcript,
        error: null,
      })
    })
  }
}
