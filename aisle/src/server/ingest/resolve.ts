import { classify } from '../../shared/categories'
import { displayName } from '../../shared/normalize'
import { canonicalStoreName } from '../../shared/stores'
import type { CaptureResult, ExtractedItem, Extraction } from '../../shared/types'
import type { DB } from '../db'
import { predictStore } from '../learning/predictStore'
import { findProduct, findProductByAlias } from '../services/products'
import { activeStores, findStoreByName } from '../services/stores'
import type { ExtractContext, RawExtraction } from './extraction'

const DAY = 86_400_000

/** What engines are told about the household so they reuse its names. */
export function extractContext(db: DB, householdId: string, hint: ExtractContext['hint']): ExtractContext {
  const products = db
    .prepare(
      `SELECT name FROM products WHERE household_id = ? AND deleted_at IS NULL
       ORDER BY purchase_count DESC, updated_at DESC LIMIT 150`,
    )
    .all(householdId) as { name: string }[]
  const people = db.prepare('SELECT name FROM users WHERE household_id = ? ORDER BY created_at').all(householdId) as { name: string }[]
  return {
    hint,
    stores: activeStores(db, householdId).map((s) => s.name),
    products: products.map((p) => p.name),
    people: people.map((p) => p.name),
  }
}

function sameDay(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.slice(0, 10) === b.slice(0, 10))
}

function looksAlreadyAdded(db: DB, householdId: string, raw: RawExtraction, storeId: string | null, now: number): boolean {
  if (raw.kind !== 'receipt' || raw.total === null || !storeId) return false
  const applied = db
    .prepare(
      `SELECT extraction, result FROM captures
       WHERE household_id = ? AND status = 'applied' AND deleted_at IS NULL AND created_at > ?`,
    )
    .all(householdId, now - 120 * DAY) as { extraction: string | null; result: string | null }[]
  return applied.some((row) => {
    const previous = row.extraction ? (JSON.parse(row.extraction) as Extraction) : null
    const result = row.result ? (JSON.parse(row.result) as CaptureResult) : null
    return (
      previous?.kind === 'receipt' &&
      result?.storeId === storeId &&
      previous.total === raw.total &&
      sameDay(previous.purchasedAt, raw.purchasedAt)
    )
  })
}

/**
 * Matches what an engine read against what the household already knows: existing products
 * (a receipt line's learned alias first), categories, stores, and where each item would be filed.
 */
export function resolveExtraction(
  db: DB,
  householdId: string,
  raw: RawExtraction,
  warnings: string[],
  now: number,
): Extraction {
  const store = raw.store ? findStoreByName(db, householdId, raw.store) : null
  const onList = new Set(
    (
      db
        .prepare(
          `SELECT product_id FROM list_items
           WHERE household_id = ? AND deleted_at IS NULL AND checked_at IS NULL AND product_id IS NOT NULL`,
        )
        .all(householdId) as { product_id: string }[]
    ).map((r) => r.product_id),
  )

  const items: ExtractedItem[] = raw.items.map((item) => {
    const aliased = raw.kind === 'receipt' && item.rawText ? findProductByAlias(db, householdId, item.rawText) : null
    const match = aliased ? { product: aliased, via: 'alias' as const } : findProduct(db, householdId, item.name)
    const product = match?.product ?? null
    const name = product && match!.via !== 'core' ? product.name : displayName(item.name)
    const category = product?.category ?? item.category ?? classify(item.name)
    let predictedStoreId: string | null = null
    let predictionReason: string | null = null
    if (raw.kind !== 'receipt') {
      const hinted = item.storeHint ? findStoreByName(db, householdId, item.storeHint) : null
      if (hinted) {
        predictedStoreId = hinted.id
        predictionReason = `You wrote "${item.storeHint}"`
      } else if (!item.storeHint) {
        const prediction = predictStore(db, householdId, product?.id ?? null, category, now)
        predictedStoreId = prediction.storeId
        predictionReason = prediction.reason
      }
    }
    return {
      name,
      rawText: item.rawText,
      quantity: item.quantity,
      unit: item.unit,
      price: item.price,
      category,
      storeHint: item.storeHint,
      note: item.note,
      productId: product?.id ?? null,
      predictedStoreId,
      predictionReason,
      onList: product ? onList.has(product.id) : false,
    }
  })

  const allWarnings = [...warnings]
  if (looksAlreadyAdded(db, householdId, raw, store?.id ?? null, now)) {
    allWarnings.push('You may have added this receipt already: same store, date, and total.')
  }
  return {
    kind: raw.kind,
    store: store?.name ?? (raw.store ? canonicalStoreName(raw.store) : null),
    storeId: store?.id ?? null,
    purchasedAt: raw.purchasedAt,
    currency: raw.currency,
    total: raw.total,
    items,
    notes: raw.notes,
    warnings: allWarnings,
  }
}
