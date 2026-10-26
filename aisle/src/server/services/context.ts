import type { DB } from '../db'
import { refreshProduct } from '../learning/predictStore'
import { bumpRev } from './households'

/** Everything a write needs: one transaction, one new household rev, and a clock. */
export interface WriteContext {
  db: DB
  householdId: string
  userId: string | null
  rev: number
  now: number
  /** Products whose learned store or purchase stats must be recomputed before commit. */
  touchedProducts: Set<string>
}

export function withWrite<T>(
  db: DB,
  householdId: string,
  userId: string | null,
  now: number,
  fn: (ctx: WriteContext) => T,
): { rev: number; value: T } {
  return db.transaction(() => {
    const ctx: WriteContext = { db, householdId, userId, rev: bumpRev(db, householdId), now, touchedProducts: new Set() }
    const value = fn(ctx)
    for (const productId of ctx.touchedProducts) refreshProduct(ctx, productId)
    return { rev: ctx.rev, value }
  })()
}
