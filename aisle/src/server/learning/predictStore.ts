import type { Category } from '../../shared/categories'
import type { StoreSource } from '../../shared/types'
import type { DB } from '../db'
import type { ProductRow } from '../rows'
import type { WriteContext } from '../services/context'

const DAY_MS = 86_400_000
export const HALF_LIFE_DAYS = 120
export const SIGNAL_WEIGHT = { receipt: 1, checkoff: 0.6, choice: 2 } as const
const MIN_LEARNED_WEIGHT = 0.5
const MIN_CATEGORY_WEIGHT = 1
const MIN_CATEGORY_SHARE = 0.5

type SignalSource = keyof typeof SIGNAL_WEIGHT

interface Signal {
  storeId: string
  at: number
  source: SignalSource
}

export interface StorePrediction {
  storeId: string | null
  source: Extract<StoreSource, 'learned' | 'category' | 'only' | 'none'>
  confidence: number | null
  reason: string | null
}

const NO_PREDICTION: StorePrediction = { storeId: null, source: 'none', confidence: null, reason: null }

const CATEGORY_PHRASE: Record<Category, string> = {
  Produce: 'produce',
  Bakery: 'bread and baked goods',
  Deli: 'deli food',
  'Meat & Seafood': 'meat and seafood',
  'Dairy & Eggs': 'dairy and eggs',
  Frozen: 'frozen food',
  Pantry: 'pantry staples',
  Breakfast: 'breakfast food',
  Snacks: 'snacks',
  Beverages: 'drinks',
  Household: 'household supplies',
  'Personal Care': 'personal care items',
  Health: 'health items',
  Baby: 'baby things',
  Pet: 'pet supplies',
  Other: 'other things',
}

/** Signals lose half their weight every HALF_LIFE_DAYS, so predictions follow a change of habit. */
export function decay(ageMs: number): number {
  return 0.5 ** (Math.max(0, ageMs) / (HALF_LIFE_DAYS * DAY_MS))
}

function activeStoreIds(db: DB, householdId: string): Set<string> {
  const rows = db.prepare('SELECT id FROM stores WHERE household_id = ? AND deleted_at IS NULL').all(householdId) as {
    id: string
  }[]
  return new Set(rows.map((r) => r.id))
}

function productSignals(db: DB, householdId: string, productId: string): Signal[] {
  return db
    .prepare(
      `SELECT store_id AS storeId, purchased_at AS at, source FROM purchases
       WHERE household_id = ? AND product_id = ? AND store_id IS NOT NULL
       UNION ALL
       SELECT store_id, chosen_at, 'choice' FROM store_choices WHERE household_id = ? AND product_id = ?`,
    )
    .all(householdId, productId, householdId, productId) as Signal[]
}

function categorySignals(db: DB, householdId: string, category: Category): Signal[] {
  return db
    .prepare(
      `SELECT pu.store_id AS storeId, pu.purchased_at AS at, pu.source FROM purchases pu
       JOIN products p ON p.id = pu.product_id
       WHERE pu.household_id = ? AND p.category = ? AND pu.store_id IS NOT NULL
       UNION ALL
       SELECT c.store_id, c.chosen_at, 'choice' FROM store_choices c
       JOIN products p ON p.id = c.product_id
       WHERE c.household_id = ? AND p.category = ?`,
    )
    .all(householdId, category, householdId, category) as Signal[]
}

function tally(signals: Signal[], now: number): { storeId: string; share: number; total: number } | null {
  const scores = new Map<string, number>()
  let total = 0
  for (const s of signals) {
    const weight = SIGNAL_WEIGHT[s.source] * decay(now - s.at)
    scores.set(s.storeId, (scores.get(s.storeId) ?? 0) + weight)
    total += weight
  }
  let best: [string, number] | null = null
  for (const entry of scores) if (!best || entry[1] > best[1]) best = entry
  return best && total > 0 ? { storeId: best[0], share: best[1] / total, total } : null
}

function historyReason(signals: Signal[], storeId: string): string {
  const purchases = signals.filter((s) => s.source !== 'choice')
  const here = purchases.filter((s) => s.storeId === storeId).length
  if (!here) return 'You put it here before'
  if (here === purchases.length) return here === 1 ? 'Bought here last time' : `Bought here all ${here} times`
  return `Bought here ${here} of ${purchases.length} times`
}

/**
 * What the product's own history says. The latest explicit choice (moving the item, or
 * writing the store next to it) wins until a later receipt shows it was bought elsewhere;
 * otherwise the store with the most decayed weight wins.
 */
export function predictFromHistory(
  db: DB,
  householdId: string,
  productId: string,
  now: number,
  stores = activeStoreIds(db, householdId),
): StorePrediction | null {
  const signals = productSignals(db, householdId, productId).filter((s) => stores.has(s.storeId))
  if (!signals.length) return null
  let latestChoice: Signal | null = null
  for (const s of signals) if (s.source === 'choice' && (!latestChoice || s.at > latestChoice.at)) latestChoice = s
  if (
    latestChoice &&
    !signals.some((s) => s.source === 'receipt' && s.at > latestChoice.at && s.storeId !== latestChoice.storeId)
  ) {
    return { storeId: latestChoice.storeId, source: 'learned', confidence: 1, reason: 'You put it here last time' }
  }
  const best = tally(signals, now)
  if (!best || best.total < MIN_LEARNED_WEIGHT) return null
  return { storeId: best.storeId, source: 'learned', confidence: best.share, reason: historyReason(signals, best.storeId) }
}

/** Picks the store for an item: its own history, then its category, then the only store, else Unsorted. */
export function predictStore(
  db: DB,
  householdId: string,
  productId: string | null,
  category: Category,
  now: number,
): StorePrediction {
  const stores = activeStoreIds(db, householdId)
  if (!stores.size) return NO_PREDICTION
  if (productId) {
    const learned = predictFromHistory(db, householdId, productId, now, stores)
    if (learned) return learned
  }
  if (category !== 'Other') {
    const best = tally(
      categorySignals(db, householdId, category).filter((s) => stores.has(s.storeId)),
      now,
    )
    if (best && best.total >= MIN_CATEGORY_WEIGHT && best.share >= MIN_CATEGORY_SHARE) {
      return {
        storeId: best.storeId,
        source: 'category',
        confidence: best.share,
        reason: `You usually buy ${CATEGORY_PHRASE[category]} here`,
      }
    }
  }
  if (stores.size === 1) return { storeId: [...stores][0]!, source: 'only', confidence: null, reason: null }
  return NO_PREDICTION
}

/**
 * Recomputes the cached learned store and purchase stats on a product row. Only history-based
 * predictions are cached: category and single-store fallbacks change whenever other products or
 * stores do, so they are computed when an item is added instead.
 */
export function refreshProduct(ctx: WriteContext, productId: string): void {
  const { db, householdId } = ctx
  const product = db.prepare('SELECT * FROM products WHERE household_id = ? AND id = ?').get(householdId, productId) as
    | ProductRow
    | undefined
  if (!product) return
  const learned = predictFromHistory(db, householdId, productId, ctx.now)
  const stats = db
    .prepare('SELECT COUNT(*) AS n, MAX(purchased_at) AS last FROM purchases WHERE household_id = ? AND product_id = ?')
    .get(householdId, productId) as { n: number; last: number | null }
  const next = {
    storeId: learned?.storeId ?? null,
    confidence: learned?.confidence == null ? null : Math.round(learned.confidence * 100) / 100,
    reason: learned?.reason ?? null,
  }
  if (
    product.predicted_store_id === next.storeId &&
    product.prediction_confidence === next.confidence &&
    product.prediction_reason === next.reason &&
    product.purchase_count === stats.n &&
    product.last_purchased_at === stats.last
  ) {
    return
  }
  db.prepare(
    `UPDATE products SET predicted_store_id = ?, prediction_confidence = ?, prediction_reason = ?,
       purchase_count = ?, last_purchased_at = ?, updated_at = ?, rev = ?
     WHERE id = ?`,
  ).run(next.storeId, next.confidence, next.reason, stats.n, stats.last, ctx.now, ctx.rev, productId)
}
