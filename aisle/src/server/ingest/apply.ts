import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CATEGORIES } from '../../shared/categories'
import { canonicalStoreName, storeKey } from '../../shared/stores'
import type { CaptureResult } from '../../shared/types'
import type { CaptureRow, ItemRow, PurchaseRow, StoreRow } from '../rows'
import { updateCapture } from '../services/captures'
import type { WriteContext } from '../services/context'
import { addItem } from '../services/items'
import { findProductByAlias, learnProductAlias, resolveProduct } from '../services/products'
import { createStore, findStoreByName, getStore, learnStoreAlias } from '../services/stores'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** A check-off and a receipt line this close together are the same purchase. */
const SAME_TRIP_MS = 12 * HOUR

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()

export const applySchema = z.object({
  mode: z.enum(['list', 'receipt']),
  /** Receipts: an existing store, or a name to find or create one. */
  storeId: z.uuid().nullable().optional(),
  storeName: optionalText(80),
  /** Receipts: when the purchase happened, in epoch milliseconds (the client knows the time zone). */
  purchasedAt: z.number().int().positive().nullable().optional(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        rawText: optionalText(300),
        quantity: z.number().positive().max(10_000).nullable().optional(),
        unit: optionalText(20),
        price: z.number().min(0).max(100_000).nullable().optional(),
        note: optionalText(500),
        category: z.enum(CATEGORIES).nullable().optional(),
        /** Lists: set only when the user picked a store during review. */
        storeId: z.uuid().nullable().optional(),
        storeHint: optionalText(80),
      }),
    )
    .max(300),
})

export type ApplyInput = z.infer<typeof applySchema>

function applyList(ctx: WriteContext, capture: CaptureRow, input: ApplyInput): CaptureResult {
  let added = 0
  let merged = 0
  for (const item of input.items) {
    const result = addItem(ctx, {
      id: randomUUID(),
      name: item.name,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      note: item.note ?? null,
      category: item.category ?? null,
      storeId: item.storeId ?? null,
      storeHint: item.storeId ? null : (item.storeHint ?? null),
      captureId: capture.id,
      at: ctx.now,
    })
    if (result.merged) merged++
    else added++
  }
  return { mode: 'list', added, merged, purchases: 0, checkedOff: 0, storeId: null }
}

function receiptStore(ctx: WriteContext, input: ApplyInput): StoreRow | null {
  if (input.storeId) {
    const store = getStore(ctx.db, ctx.householdId, input.storeId)
    if (store && !store.deleted_at) return store
  }
  const name = input.storeName?.trim()
  if (!name || storeKey(name).length < 2) return null
  const store = findStoreByName(ctx.db, ctx.householdId, name) ?? createStore(ctx, canonicalStoreName(name), { reviveDeleted: true })
  if (storeKey(name) !== storeKey(store.name)) learnStoreAlias(ctx, name, store.id)
  return store
}

function applyReceipt(ctx: WriteContext, capture: CaptureRow, input: ApplyInput): CaptureResult {
  const { db, householdId } = ctx
  const store = receiptStore(ctx, input)
  const requested = input.purchasedAt ?? capture.created_at
  // OCR misreads years; a purchase cannot be in the future or from long before the app existed for you.
  const at = requested > ctx.now + HOUR || requested < ctx.now - 400 * DAY ? capture.created_at : requested
  let purchases = 0
  let checkedOff = 0

  for (const item of input.items) {
    const product =
      (item.rawText ? findProductByAlias(db, householdId, item.rawText) : null) ??
      resolveProduct(ctx, item.name, item.category).product
    if (item.rawText) learnProductAlias(ctx, item.rawText, product.id, 'receipt')
    const priceCents = item.price == null ? null : Math.round(item.price * 100)

    const sameTrip = db
      .prepare(
        `SELECT * FROM purchases
         WHERE household_id = ? AND product_id = ? AND source = 'checkoff' AND purchased_at BETWEEN ? AND ?
           AND (? IS NULL OR store_id IS NULL OR store_id = ?)
         ORDER BY ABS(purchased_at - ?) LIMIT 1`,
      )
      .get(householdId, product.id, at - SAME_TRIP_MS, at + SAME_TRIP_MS, store?.id ?? null, store?.id ?? null, at) as
      | PurchaseRow
      | undefined
    let purchaseId: string
    if (sameTrip) {
      purchaseId = sameTrip.id
      db.prepare(
        `UPDATE purchases SET source = 'receipt', store_id = COALESCE(?, store_id), price_cents = ?,
           quantity = COALESCE(?, quantity), unit = COALESCE(?, unit), capture_id = ?
         WHERE id = ?`,
      ).run(store?.id ?? null, priceCents, item.quantity ?? null, item.unit ?? null, capture.id, purchaseId)
    } else {
      purchaseId = randomUUID()
      db.prepare(
        `INSERT INTO purchases (id, household_id, product_id, store_id, purchased_at, quantity, unit, price_cents,
           source, capture_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'receipt', ?, ?)`,
      ).run(
        purchaseId,
        householdId,
        product.id,
        store?.id ?? null,
        at,
        item.quantity ?? null,
        item.unit ?? null,
        priceCents,
        capture.id,
        ctx.now,
      )
    }
    purchases++

    // It was bought, so tick it off, unless it went on the list after this shopping trip.
    const open = sameTrip
      ? undefined
      : (db
          .prepare(
            `SELECT * FROM list_items
             WHERE household_id = ? AND product_id = ? AND checked_at IS NULL AND deleted_at IS NULL AND created_at <= ?
             ORDER BY created_at LIMIT 1`,
          )
          .get(householdId, product.id, at + HOUR) as ItemRow | undefined)
    if (open) {
      db.prepare(
        `UPDATE list_items SET checked_at = ?, checked_by = ?, store_id = COALESCE(?, store_id),
           store_source = CASE WHEN ? IS NULL THEN store_source ELSE 'receipt' END,
           store_reason = CASE WHEN ? IS NULL THEN store_reason ELSE 'On your receipt' END,
           updated_at = ?, rev = ?
         WHERE id = ?`,
      ).run(Math.min(at, ctx.now), ctx.userId, store?.id ?? null, store?.id ?? null, store?.id ?? null, ctx.now, ctx.rev, open.id)
      db.prepare('UPDATE purchases SET list_item_id = ? WHERE id = ?').run(open.id, purchaseId)
      checkedOff++
    }
    ctx.touchedProducts.add(product.id)
  }
  return { mode: 'receipt', added: 0, merged: 0, purchases, checkedOff, storeId: store?.id ?? null }
}

/** Turns a reviewed capture into list items, or into purchases for a receipt. */
export function applyCapture(ctx: WriteContext, capture: CaptureRow, input: ApplyInput): CaptureResult {
  const result = input.mode === 'list' ? applyList(ctx, capture, input) : applyReceipt(ctx, capture, input)
  updateCapture(ctx, capture.id, { status: 'applied', result: JSON.stringify(result) })
  return result
}
