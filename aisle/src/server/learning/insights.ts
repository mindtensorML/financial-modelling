import type { DueSoon, Insights, ProductInsight, StoreInsight } from '../../shared/types'
import type { DB } from '../db'
import type { ProductRow } from '../rows'
import { type Cadence, cadence, describeAgo, describeInterval, dueStatus } from './cadence'
import { predictStore } from './predictStore'
import { cheaperAt, priceStats } from './prices'
import { walkOrders } from './walkOrder'

const DAY = 86_400_000
const VISIT_GAP_MS = 90 * 60_000
const MAX_DUE = 12
const MAX_PRODUCTS = 300

interface PurchaseFact {
  product_id: string
  store_id: string | null
  purchased_at: number
  price_cents: number | null
  quantity: number | null
  unit: string | null
  source: 'receipt' | 'checkoff'
}

function countVisits(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  let visits = 0
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i]! - sorted[i - 1]! >= VISIT_GAP_MS) visits++
  return visits
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Everything the app has learned about a household's shopping, computed from its purchases. */
export function buildInsights(db: DB, householdId: string, now: number): Insights {
  const products = db
    .prepare('SELECT * FROM products WHERE household_id = ? AND deleted_at IS NULL')
    .all(householdId) as ProductRow[]
  const productById = new Map(products.map((p) => [p.id, p]))
  const storeIds = (
    db.prepare('SELECT id FROM stores WHERE household_id = ? AND deleted_at IS NULL ORDER BY sort_order, name').all(householdId) as {
      id: string
    }[]
  ).map((s) => s.id)
  const activeStores = new Set(storeIds)
  const facts = db
    .prepare('SELECT product_id, store_id, purchased_at, price_cents, quantity, unit, source FROM purchases WHERE household_id = ?')
    .all(householdId) as PurchaseFact[]
  const onList = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT product_id FROM list_items
           WHERE household_id = ? AND deleted_at IS NULL AND checked_at IS NULL AND product_id IS NOT NULL`,
        )
        .all(householdId) as { product_id: string }[]
    ).map((r) => r.product_id),
  )

  const timesByProduct = new Map<string, number[]>()
  for (const f of facts) {
    const times = timesByProduct.get(f.product_id) ?? []
    times.push(f.purchased_at)
    timesByProduct.set(f.product_id, times)
  }
  const cadences = new Map<string, Cadence>()
  for (const [productId, times] of timesByProduct) {
    const c = cadence(times)
    if (c) cadences.set(productId, c)
  }

  const due: Array<DueSoon & { progress: number }> = []
  for (const [productId, c] of cadences) {
    const product = productById.get(productId)
    if (!product || onList.has(productId)) continue
    const status = dueStatus(c, now)
    if (!status.due) continue
    due.push({
      productId,
      name: product.name,
      category: product.category,
      storeId: null,
      intervalDays: c.intervalDays,
      daysSinceLast: Math.round(status.daysSinceLast * 10) / 10,
      lastPurchasedAt: c.lastPurchasedAt,
      reason: `${capitalize(describeInterval(c.intervalDays))}; last bought ${describeAgo(status.daysSinceLast)}`,
      progress: status.progress,
    })
  }
  const dueSoon: DueSoon[] = due
    .sort((a, b) => b.progress - a.progress)
    .slice(0, MAX_DUE)
    .map(({ progress: _, ...d }) => ({ ...d, storeId: predictStore(db, householdId, d.productId, d.category, now).storeId }))

  const prices = priceStats(
    facts
      .filter((f) => f.source === 'receipt' && f.price_cents !== null && f.store_id !== null && activeStores.has(f.store_id))
      .map((f) => ({
        productId: f.product_id,
        storeId: f.store_id!,
        at: f.purchased_at,
        priceCents: f.price_cents!,
        quantity: f.quantity,
        unit: f.unit,
      })),
  )

  const productInsights: ProductInsight[] = products
    .filter((p) => p.purchase_count > 0)
    .sort((a, b) => b.purchase_count - a.purchase_count || a.name.localeCompare(b.name))
    .slice(0, MAX_PRODUCTS)
    .map((p) => {
      const productPrices = prices.get(p.id) ?? []
      return {
        productId: p.id,
        name: p.name,
        category: p.category,
        purchaseCount: p.purchase_count,
        storeId: p.predicted_store_id,
        confidence: p.prediction_confidence,
        reason: p.prediction_reason,
        intervalDays: cadences.get(p.id)?.intervalDays ?? null,
        lastPurchasedAt: p.last_purchased_at,
        prices: productPrices,
        cheaperAt: cheaperAt(productPrices, p.predicted_store_id),
      }
    })

  const recentByStore = new Map<string, PurchaseFact[]>()
  for (const f of facts) {
    if (!f.store_id || !activeStores.has(f.store_id) || f.purchased_at < now - 30 * DAY) continue
    const list = recentByStore.get(f.store_id) ?? []
    list.push(f)
    recentByStore.set(f.store_id, list)
  }
  const stores: StoreInsight[] = storeIds.map((storeId) => {
    const recent = recentByStore.get(storeId) ?? []
    return {
      storeId,
      visits30d: countVisits(recent.map((f) => f.purchased_at)),
      spend30dCents: recent.reduce((sum, f) => sum + (f.source === 'receipt' ? (f.price_cents ?? 0) : 0), 0),
      productCount: products.filter((p) => p.predicted_store_id === storeId).length,
    }
  })

  const walkOrder = walkOrders(
    facts
      .filter((f) => f.source === 'checkoff' && f.store_id !== null && activeStores.has(f.store_id) && productById.has(f.product_id))
      .map((f) => ({
        storeId: f.store_id!,
        productId: f.product_id,
        category: productById.get(f.product_id)!.category,
        at: f.purchased_at,
      })),
    now,
  )

  return { generatedAt: now, dueSoon, products: productInsights, stores, walkOrder }
}
