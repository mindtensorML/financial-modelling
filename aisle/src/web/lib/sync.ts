import { del, get, set } from 'idb-keyval'
import type { Op } from '../../shared/ops'
import type { Capture, ListItem, Me, OpsResponse, Product, Store, SyncResponse } from '../../shared/types'
import { api, ApiError, isTransient, OfflineError } from './api'
import { observable, useObservable } from './observable'
import { replay, type Tables } from './replay'

/** An operation without its id; the engine assigns one. */
export type OpInput = Op extends infer T ? (T extends Op ? Omit<T, 'opId'> : never) : never

interface PendingOp {
  op: Op
  /** The server rev that includes this operation, once it has confirmed it. */
  ackRev: number | null
}

interface Saved {
  version: 1
  userId: string
  householdId: string
  rev: number
  stores: Store[]
  products: Product[]
  items: ListItem[]
  captures: Capture[]
}

export type SyncStatus = 'connecting' | 'online' | 'offline' | 'error'

export interface SyncState {
  ready: boolean
  rev: number
  status: SyncStatus
  /** Changes made on this device that the server has not confirmed yet. */
  pending: number
  stores: Store[]
  storesById: Map<string, Store>
  products: Map<string, Product>
  items: ListItem[]
  captures: Capture[]
}

const REPLICA_KEY = 'aisle-replica'
const OUTBOX_KEY = 'aisle-outbox'
const POLL_MS = 60_000
const STALE_EVENTS_MS = 75_000
const BATCH = 100

const empty = (): Tables & { captures: Map<string, Capture> } => ({
  stores: new Map(),
  products: new Map(),
  items: new Map(),
  captures: new Map(),
})

const initialState: SyncState = {
  ready: false,
  rev: 0,
  status: 'connecting',
  pending: 0,
  stores: [],
  storesById: new Map(),
  products: new Map(),
  items: [],
  captures: [],
}

/**
 * Keeps this device's copy of the household in step with the server. Edits are operations:
 * applied locally at once, kept in an IndexedDB outbox until the server confirms them, and
 * replayed on top of the server's state so they never flicker away. Changes from other devices
 * arrive through server-sent events, with polling as a fallback.
 */
export class SyncEngine {
  readonly state = observable<SyncState>(initialState)
  onRejected: ((message: string) => void) | null = null

  private base = empty()
  private rev = 0
  /** Whether the copy on screen is the household's: saved on this device, pulled, or edited here. */
  private loaded = false
  private userId: string | null = null
  private householdId: string | null = null
  private outbox: PendingOp[] = []
  private status: SyncStatus = 'connecting'
  private running = false
  private events: EventSource | null = null
  private lastEventAt = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 2_000
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pulling: Promise<void> | null = null
  private pullAgain = false
  private flushing: Promise<void> | null = null
  private flushAgain = false

  async start(me: Me): Promise<void> {
    this.stop()
    this.running = true
    this.loaded = false
    this.userId = me.user.id
    this.householdId = me.household.id
    const [saved, outbox] = await Promise.all([
      get<Saved>(REPLICA_KEY).catch(() => undefined),
      get<PendingOp[]>(OUTBOX_KEY).catch(() => undefined),
    ])
    if (!this.running) return
    const mine = saved?.version === 1 && saved.userId === me.user.id
    const same = mine && saved.householdId === me.household.id
    this.loaded = same
    if (same) {
      this.base = {
        stores: new Map(saved.stores.map((s) => [s.id, s])),
        products: new Map(saved.products.map((p) => [p.id, p])),
        items: new Map(saved.items.map((i) => [i.id, i])),
        captures: new Map(saved.captures.map((c) => [c.id, c])),
      }
      this.rev = saved.rev
    } else {
      this.base = empty()
      this.rev = 0
    }
    // Operations queued for another account or household must not be sent for this one.
    this.outbox = same ? (outbox ?? []) : []
    this.publish()

    window.addEventListener('online', this.onOnline)
    document.addEventListener('visibilitychange', this.onVisible)
    this.timer = setInterval(this.tick, 15_000)
    this.connect()
    void this.flush()
    void this.pull()
  }

  stop(): void {
    this.running = false
    this.events?.close()
    this.events = null
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.timer = this.retryTimer = null
    window.removeEventListener('online', this.onOnline)
    document.removeEventListener('visibilitychange', this.onVisible)
  }

  /** Forgets everything on this device, for signing out. */
  async clear(): Promise<void> {
    this.stop()
    this.base = empty()
    this.rev = 0
    this.loaded = false
    this.outbox = []
    this.state.set(initialState)
    await Promise.all([del(REPLICA_KEY), del(OUTBOX_KEY)]).catch(() => undefined)
  }

  enqueue(...inputs: OpInput[]): void {
    if (!inputs.length) return
    for (const input of inputs) this.outbox.push({ op: { ...input, opId: crypto.randomUUID() } as Op, ackRev: null })
    void set(OUTBOX_KEY, this.outbox).catch(() => undefined)
    this.loaded = true
    this.publish()
    void this.flush()
  }

  /** Records a capture the server just returned, ahead of the next pull. */
  putCapture(capture: Capture): void {
    if (capture.deletedAt) this.base.captures.delete(capture.id)
    else this.base.captures.set(capture.id, capture)
    this.publish()
  }

  pull(): Promise<void> {
    if (!this.running) return Promise.resolve()
    if (this.pulling) {
      this.pullAgain = true
      return this.pulling
    }
    this.pulling = (async () => {
      do {
        this.pullAgain = false
        const res = await api<SyncResponse>('GET', `/api/sync?since=${this.rev}`)
        if (!this.running) return
        if (res.householdId !== this.householdId) {
          // Joined or left a household on another device: start over from a full copy.
          this.householdId = res.householdId
          this.base = empty()
          this.rev = 0
          this.outbox = []
          if (!res.full) {
            this.pullAgain = true
            continue
          }
        }
        this.applyPull(res)
      } while (this.pullAgain && this.running)
      this.succeeded()
    })()
      .catch((error: unknown) => this.failed(error))
      .finally(() => {
        this.pulling = null
      })
    return this.pulling
  }

  flush(): Promise<void> {
    if (!this.running) return Promise.resolve()
    if (this.flushing) {
      this.flushAgain = true
      return this.flushing
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false
        let batch: PendingOp[]
        while ((batch = this.outbox.filter((p) => p.ackRev === null).slice(0, BATCH)).length) {
          await this.send(batch)
          if (!this.running) return
        }
      } while (this.flushAgain && this.running)
      this.succeeded()
    })()
      .catch((error: unknown) => this.failed(error))
      .finally(() => {
        this.flushing = null
      })
    return this.flushing
  }

  private async send(batch: PendingOp[]): Promise<void> {
    let res: OpsResponse
    try {
      res = await api<OpsResponse>('POST', '/api/ops', { ops: batch.map((p) => p.op) })
    } catch (error) {
      // A malformed operation would block the outbox forever; find it and drop it.
      if (error instanceof ApiError && error.status === 400) {
        if (batch.length === 1) {
          this.drop(batch[0]!, `A change could not be saved: ${error.message}`)
          return
        }
        for (const one of batch) await this.send([one])
        return
      }
      throw error
    }
    const results = new Map(res.results.map((r) => [r.opId, r]))
    for (const pending of batch) {
      const result = results.get(pending.op.opId)
      if (result?.status === 'rejected') this.drop(pending, result.error ?? 'A change could not be saved')
      else pending.ackRev = res.rev
    }
    this.settle()
    void set(OUTBOX_KEY, this.outbox).catch(() => undefined)
    this.publish()
    if (res.rev > this.rev) void this.pull()
  }

  private drop(pending: PendingOp, message: string): void {
    this.outbox = this.outbox.filter((p) => p !== pending)
    this.onRejected?.(message)
  }

  /** Confirmed operations are dropped once the copy from the server includes them. */
  private settle(): void {
    this.outbox = this.outbox.filter((p) => p.ackRev === null || p.ackRev > this.rev)
  }

  private applyPull(res: SyncResponse): void {
    if (res.full) {
      this.base = {
        stores: new Map(res.stores.map((s) => [s.id, s])),
        products: new Map(res.products.map((p) => [p.id, p])),
        items: new Map(res.items.map((i) => [i.id, i])),
        captures: new Map(res.captures.map((c) => [c.id, c])),
      }
    } else {
      const merge = <T extends { id: string; deletedAt: number | null }>(table: Map<string, T>, rows: T[]) => {
        for (const row of rows) {
          if (row.deletedAt) table.delete(row.id)
          else table.set(row.id, row)
        }
      }
      merge(this.base.stores, res.stores)
      merge(this.base.products, res.products)
      merge(this.base.items, res.items)
      merge(this.base.captures, res.captures)
    }
    this.rev = res.rev
    this.loaded = true
    const before = this.outbox.length
    this.settle()
    if (this.outbox.length !== before) void set(OUTBOX_KEY, this.outbox).catch(() => undefined)
    this.publish()
    this.save()
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      if (!this.userId || !this.householdId) return
      const saved: Saved = {
        version: 1,
        userId: this.userId,
        householdId: this.householdId,
        rev: this.rev,
        stores: [...this.base.stores.values()],
        products: [...this.base.products.values()],
        items: [...this.base.items.values()],
        captures: [...this.base.captures.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
      }
      void set(REPLICA_KEY, saved).catch(() => undefined)
    }, 400)
  }

  private publish(): void {
    const tables = replay(
      this.base,
      this.outbox.map((p) => p.op),
      { userId: this.userId, now: Date.now() },
    )
    this.state.set({
      ready: this.loaded,
      rev: this.rev,
      status: this.status,
      pending: this.outbox.filter((p) => p.ackRev === null).length,
      stores: [...tables.stores.values()]
        .filter((s) => !s.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      storesById: tables.stores,
      products: tables.products,
      items: [...tables.items.values()].filter((i) => !i.deletedAt),
      captures: [...this.base.captures.values()].filter((c) => !c.deletedAt).sort((a, b) => b.createdAt - a.createdAt),
    })
  }

  private setStatus(status: SyncStatus): void {
    if (this.status === status) return
    this.status = status
    this.publish()
  }

  private succeeded(): void {
    this.retryDelay = 2_000
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.setStatus('online')
  }

  private failed(error: unknown): void {
    if (!this.running) return
    if (error instanceof ApiError && error.status === 401) return
    // Show what this device has rather than a spinner; the status says it is not the latest.
    this.loaded = true
    this.status = error instanceof OfflineError ? 'offline' : 'error'
    this.publish()
    if (!isTransient(error)) console.error(error)
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
      void this.pull()
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
  }

  private connect(): void {
    this.events?.close()
    if (typeof EventSource === 'undefined') return
    const events = new EventSource('/api/events')
    this.events = events
    this.lastEventAt = Date.now()
    const seen = () => {
      this.lastEventAt = Date.now()
    }
    events.addEventListener('rev', (event) => {
      seen()
      const { rev } = JSON.parse((event as MessageEvent<string>).data) as { rev: number }
      if (rev !== this.rev) void this.pull()
    })
    events.addEventListener('ping', seen)
    events.addEventListener('open', () => {
      seen()
      void this.flush()
    })
  }

  private readonly tick = () => {
    if (!this.running) return
    // The server pings every 25 seconds; silence means the connection died without an error.
    if (Date.now() - this.lastEventAt > STALE_EVENTS_MS && navigator.onLine) this.connect()
    if (document.visibilityState === 'visible' && Date.now() - this.lastEventAt > POLL_MS / 2) void this.pull()
  }

  private readonly onOnline = () => {
    this.retryDelay = 2_000
    this.connect()
    void this.flush()
    void this.pull()
  }

  private readonly onVisible = () => {
    if (document.visibilityState !== 'visible') return
    void this.flush()
    void this.pull()
  }
}

export const sync = new SyncEngine()

export function useSync(): SyncState {
  return useObservable(sync.state)
}
