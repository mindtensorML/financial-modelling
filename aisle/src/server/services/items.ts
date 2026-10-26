import { randomUUID } from 'node:crypto'
import type { Category } from '../../shared/categories'
import { mergeNote, mergeQuantity } from '../../shared/merge'
import { displayName, nameKey } from '../../shared/normalize'
import { canonicalStoreName, storeKey } from '../../shared/stores'
import type { StoreSource } from '../../shared/types'
import type { DB } from '../db'
import { OpRejected } from '../errors'
import { predictStore } from '../learning/predictStore'
import type { ItemRow } from '../rows'
import type { WriteContext } from './context'
import { resolveProduct } from './products'
import { createStore, findStoreByName, getStore, learnStoreAlias } from './stores'

const MAX_PAST_MS = 30 * 86_400_000
const MAX_FUTURE_MS = 5 * 60_000

/** Device clocks drift and offline queues get old; keep client times within a sane window. */
export function clampTime(at: number | undefined, now: number): number {
  if (at === undefined || !Number.isFinite(at)) return now
  return Math.min(now + MAX_FUTURE_MS, Math.max(now - MAX_PAST_MS, at))
}

export function getItem(db: DB, householdId: string, id: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM list_items WHERE household_id = ? AND id = ?').get(householdId, id) as
    | ItemRow
    | undefined
}

function followMerges(ctx: WriteContext, id: string): ItemRow | undefined {
  let item = getItem(ctx.db, ctx.householdId, id)
  for (let hops = 0; item?.merged_into && hops < 5; hops++) item = getItem(ctx.db, ctx.householdId, item.merged_into)
  return item
}

/** The item an operation refers to, following merges; rejects items that are gone. */
function liveItem(ctx: WriteContext, id: string): ItemRow {
  const item = followMerges(ctx, id)
  if (!item || item.deleted_at) throw new OpRejected('That item is no longer on the list')
  return item
}

interface Placement {
  storeId: string
  source: Extract<StoreSource, 'manual' | 'hint'>
  reason: string
}

function recordChoice(ctx: WriteContext, productId: string, storeId: string): void {
  ctx.db
    .prepare('INSERT INTO store_choices (id, household_id, product_id, store_id, user_id, chosen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), ctx.householdId, productId, storeId, ctx.userId, ctx.now)
  ctx.touchedProducts.add(productId)
}

/** A store the user asked for: picked directly, or written next to the item ("milk @costco"). */
function explicitPlacement(ctx: WriteContext, storeId?: string | null, storeHint?: string | null): Placement | null {
  if (storeId) {
    const store = getStore(ctx.db, ctx.householdId, storeId)
    if (store && !store.deleted_at) return { storeId: store.id, source: 'manual', reason: 'You put it here' }
  }
  const hint = storeHint?.trim()
  if (!hint || storeKey(hint).length < 2) return null
  const store =
    findStoreByName(ctx.db, ctx.householdId, hint) ?? createStore(ctx, canonicalStoreName(hint), { reviveDeleted: true })
  if (storeKey(hint) !== storeKey(store.name)) learnStoreAlias(ctx, hint, store.id)
  return { storeId: store.id, source: 'hint', reason: `You wrote "${hint}"` }
}

export interface AddItemInput {
  id: string
  name: string
  quantity?: number | null
  unit?: string | null
  note?: string | null
  storeId?: string | null
  storeHint?: string | null
  category?: Category | null
  at?: number
  captureId?: string | null
}

export interface AddItemResult {
  /** The item that now holds this entry; differs from the input id when it was merged. */
  id: string
  merged: boolean
}

/**
 * Adds an item, or folds it into an open item for the same product. A merged item still gets
 * a tombstone row under its own id that points at the survivor, so clients drop their copy and
 * later operations on that id (checking it off, say) land on the right item.
 */
export function addItem(ctx: WriteContext, input: AddItemInput): AddItemResult {
  const { db, householdId } = ctx
  const owner = db.prepare('SELECT household_id FROM list_items WHERE id = ?').get(input.id) as
    | { household_id: string }
    | undefined
  if (owner) {
    if (owner.household_id !== householdId) throw new OpRejected('Unknown item')
    return { id: input.id, merged: false }
  }
  const { product, via } = resolveProduct(ctx, input.name, input.category)
  const name = via === 'core' || via === 'new' ? displayName(input.name) : product.name
  const placement = explicitPlacement(ctx, input.storeId, input.storeHint)
  const createdAt = clampTime(input.at, ctx.now)
  ctx.touchedProducts.add(product.id)

  const open = db
    .prepare(
      `SELECT * FROM list_items WHERE household_id = ? AND product_id = ? AND checked_at IS NULL AND deleted_at IS NULL
       ORDER BY created_at LIMIT 1`,
    )
    .get(householdId, product.id) as ItemRow | undefined
  if (open) {
    const { quantity, unit } = mergeQuantity(open, input.quantity, input.unit)
    const moveTo = placement && (placement.source === 'manual' || open.store_source !== 'manual') ? placement : null
    db.prepare(
      `UPDATE list_items SET quantity = ?, unit = ?, note = ?, store_id = ?, store_source = ?, store_reason = ?,
         updated_at = ?, rev = ?
       WHERE id = ?`,
    ).run(
      quantity,
      unit,
      mergeNote(open.note, input.note),
      moveTo ? moveTo.storeId : open.store_id,
      moveTo ? moveTo.source : open.store_source,
      moveTo ? moveTo.reason : open.store_reason,
      ctx.now,
      ctx.rev,
      open.id,
    )
    db.prepare(
      `INSERT INTO list_items (id, household_id, product_id, name, category, store_source, added_by, capture_id,
         merged_into, created_at, updated_at, deleted_at, rev)
       VALUES (?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      householdId,
      product.id,
      name,
      product.category,
      ctx.userId,
      input.captureId ?? null,
      open.id,
      createdAt,
      ctx.now,
      ctx.now,
      ctx.rev,
    )
    if (placement) recordChoice(ctx, product.id, placement.storeId)
    return { id: open.id, merged: true }
  }

  const store = placement ?? predictStore(db, householdId, product.id, product.category, ctx.now)
  db.prepare(
    `INSERT INTO list_items (id, household_id, product_id, name, quantity, unit, note, category, store_id,
       store_source, store_reason, added_by, capture_id, created_at, updated_at, rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    householdId,
    product.id,
    name,
    input.quantity ?? null,
    input.unit ?? null,
    input.note?.trim() || null,
    product.category,
    store.storeId,
    store.source,
    store.reason,
    ctx.userId,
    input.captureId ?? null,
    createdAt,
    ctx.now,
    ctx.rev,
  )
  if (placement) recordChoice(ctx, product.id, placement.storeId)
  return { id: input.id, merged: false }
}

export function updateItem(
  ctx: WriteContext,
  input: { id: string; name?: string; quantity?: number | null; unit?: string | null; note?: string | null },
): void {
  const item = liveItem(ctx, input.id)
  let { name, product_id: productId, category, store_id: storeId, store_source: source, store_reason: reason } = item
  if (input.name !== undefined && nameKey(input.name) !== nameKey(item.name)) {
    const { product, via } = resolveProduct(ctx, input.name)
    name = via === 'core' || via === 'new' ? displayName(input.name) : product.name
    if (product.id !== productId) {
      if (productId) ctx.touchedProducts.add(productId)
      ctx.touchedProducts.add(product.id)
      productId = product.id
      category = product.category
      if (source !== 'manual' && source !== 'hint') {
        const prediction = predictStore(ctx.db, ctx.householdId, product.id, product.category, ctx.now)
        ;({ storeId, source, reason } = prediction)
      }
      ctx.db
        .prepare(`UPDATE purchases SET product_id = ? WHERE list_item_id = ? AND source = 'checkoff'`)
        .run(product.id, item.id)
    }
  } else if (input.name !== undefined) {
    name = displayName(input.name)
  }
  ctx.db
    .prepare(
      `UPDATE list_items SET name = ?, product_id = ?, category = ?, quantity = ?, unit = ?, note = ?,
         store_id = ?, store_source = ?, store_reason = ?, updated_at = ?, rev = ?
       WHERE id = ?`,
    )
    .run(
      name,
      productId,
      category,
      input.quantity !== undefined ? input.quantity : item.quantity,
      input.unit !== undefined ? input.unit || null : item.unit,
      input.note !== undefined ? input.note?.trim() || null : item.note,
      storeId,
      source,
      reason,
      ctx.now,
      ctx.rev,
      item.id,
    )
}

/** Moving an item is the strongest signal the app gets about where something is bought. */
export function setItemStore(ctx: WriteContext, id: string, storeId: string | null): void {
  const item = liveItem(ctx, id)
  if (storeId) {
    const store = getStore(ctx.db, ctx.householdId, storeId)
    if (!store || store.deleted_at) throw new OpRejected('That store was removed')
  }
  ctx.db
    .prepare('UPDATE list_items SET store_id = ?, store_source = ?, store_reason = ?, updated_at = ?, rev = ? WHERE id = ?')
    .run(storeId, storeId ? 'manual' : 'none', storeId ? 'You put it here' : null, ctx.now, ctx.rev, item.id)
  // Already checked off: the user is correcting where it was bought.
  ctx.db.prepare(`UPDATE purchases SET store_id = ? WHERE list_item_id = ? AND source = 'checkoff'`).run(storeId, item.id)
  if (item.product_id) {
    if (storeId) recordChoice(ctx, item.product_id, storeId)
    else ctx.touchedProducts.add(item.product_id)
  }
}

/** Checking an item off records a purchase at its store, at the time it happened on the device. */
export function checkItem(ctx: WriteContext, id: string, checked: boolean, at?: number): void {
  const item = liveItem(ctx, id)
  if (checked === (item.checked_at !== null)) return
  const { db } = ctx
  if (checked) {
    const when = clampTime(at, ctx.now)
    db.prepare('UPDATE list_items SET checked_at = ?, checked_by = ?, updated_at = ?, rev = ? WHERE id = ?').run(
      when,
      ctx.userId,
      ctx.now,
      ctx.rev,
      item.id,
    )
    if (item.product_id) {
      db.prepare(
        `INSERT INTO purchases (id, household_id, product_id, store_id, purchased_at, quantity, unit, source,
           list_item_id, checked_off_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'checkoff', ?, ?, ?)`,
      ).run(randomUUID(), ctx.householdId, item.product_id, item.store_id, when, item.quantity, item.unit, item.id, when, ctx.now)
      ctx.touchedProducts.add(item.product_id)
    }
  } else {
    db.prepare('UPDATE list_items SET checked_at = NULL, checked_by = NULL, updated_at = ?, rev = ? WHERE id = ?').run(
      ctx.now,
      ctx.rev,
      item.id,
    )
    db.prepare(`DELETE FROM purchases WHERE list_item_id = ? AND source = 'checkoff'`).run(item.id)
    if (item.product_id) ctx.touchedProducts.add(item.product_id)
  }
}

/** Deleting keeps any purchase a check-off recorded: clearing a bought item is not un-buying it. */
export function deleteItem(ctx: WriteContext, id: string): void {
  const owner = ctx.db.prepare('SELECT household_id FROM list_items WHERE id = ?').get(id) as
    | { household_id: string }
    | undefined
  if (owner && owner.household_id !== ctx.householdId) throw new OpRejected('Unknown item')
  const item = followMerges(ctx, id)
  if (!item || item.deleted_at) return
  ctx.db
    .prepare('UPDATE list_items SET deleted_at = ?, updated_at = ?, rev = ? WHERE id = ?')
    .run(ctx.now, ctx.now, ctx.rev, item.id)
}

/** Removes checked items: all of them, those in one store, or (with null) those in Unsorted. */
export function clearChecked(ctx: WriteContext, storeId?: string | null): number {
  const scope = storeId === undefined ? '' : storeId === null ? 'AND store_id IS NULL' : 'AND store_id = ?'
  const params: unknown[] = [ctx.now, ctx.now, ctx.rev, ctx.householdId]
  if (storeId) params.push(storeId)
  return ctx.db
    .prepare(
      `UPDATE list_items SET deleted_at = ?, updated_at = ?, rev = ?
       WHERE household_id = ? AND checked_at IS NOT NULL AND deleted_at IS NULL ${scope}`,
    )
    .run(...params).changes
}
