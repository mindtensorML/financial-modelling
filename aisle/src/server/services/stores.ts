import { randomUUID } from 'node:crypto'
import { similarity } from '../../shared/similarity'
import { canonicalStoreName, matchKnownChain, nextStoreColor, storeKey } from '../../shared/stores'
import type { DB } from '../db'
import { OpRejected } from '../errors'
import type { StoreRow } from '../rows'
import type { WriteContext } from './context'

export function activeStores(db: DB, householdId: string): StoreRow[] {
  return db
    .prepare('SELECT * FROM stores WHERE household_id = ? AND deleted_at IS NULL ORDER BY sort_order, name')
    .all(householdId) as StoreRow[]
}

export function getStore(db: DB, householdId: string, id: string): StoreRow | undefined {
  return db.prepare('SELECT * FROM stores WHERE household_id = ? AND id = ?').get(householdId, id) as
    | StoreRow
    | undefined
}

/** Finds an existing store from free text: a list heading, an AI answer, or a receipt header. */
export function findStoreByName(db: DB, householdId: string, name: string): StoreRow | null {
  const key = storeKey(name)
  if (!key) return null
  const stores = activeStores(db, householdId)
  const exact = stores.find((s) => storeKey(s.name) === key)
  if (exact) return exact
  const alias = db
    .prepare(
      'SELECT s.* FROM store_aliases a JOIN stores s ON s.id = a.store_id WHERE a.household_id = ? AND a.alias_key = ? AND s.deleted_at IS NULL',
    )
    .get(householdId, key) as StoreRow | undefined
  if (alias) return alias
  const chain = matchKnownChain(name)
  if (chain) {
    const sameChain = stores.find((s) => matchKnownChain(s.name) === chain)
    if (sameChain) return sameChain
  }
  const canonicalKey = storeKey(canonicalStoreName(name))
  const canonical = stores.find((s) => storeKey(s.name) === canonicalKey)
  if (canonical) return canonical
  let best: { store: StoreRow; score: number } | null = null
  for (const store of stores) {
    const score = similarity(canonicalKey, storeKey(store.name))
    if (score >= 0.8 && (!best || score > best.score)) best = { store, score }
  }
  return best?.store ?? null
}

export function createStore(
  ctx: WriteContext,
  name: string,
  options: { id?: string; color?: string; sortOrder?: number; reviveDeleted?: boolean } = {},
): StoreRow {
  const { db, householdId } = ctx
  const key = storeKey(name)
  const stores = activeStores(db, householdId)
  const clash = stores.find((s) => storeKey(s.name) === key)
  if (clash) throw new OpRejected(`You already have a store called ${clash.name}`)
  if (options.reviveDeleted) {
    const removed = (
      db.prepare('SELECT * FROM stores WHERE household_id = ? AND deleted_at IS NOT NULL').all(householdId) as StoreRow[]
    ).find((s) => storeKey(s.name) === key)
    if (removed) {
      db.prepare('UPDATE stores SET deleted_at = NULL, updated_at = ?, rev = ? WHERE id = ?').run(ctx.now, ctx.rev, removed.id)
      return getStore(db, householdId, removed.id)!
    }
  }
  const id = options.id ?? randomUUID()
  const color = options.color ?? nextStoreColor(stores.map((s) => s.color))
  const sortOrder = options.sortOrder ?? stores.reduce((max, s) => Math.max(max, s.sort_order + 1), 0)
  db.prepare(
    `INSERT INTO stores (id, household_id, name, color, sort_order, created_at, updated_at, deleted_at, rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(id, householdId, name.trim(), color, sortOrder, ctx.now, ctx.now, ctx.rev)
  return getStore(db, householdId, id)!
}

export function learnStoreAlias(ctx: WriteContext, rawName: string, storeId: string): void {
  const key = storeKey(rawName)
  if (!key) return
  ctx.db
    .prepare(
      `INSERT INTO store_aliases (household_id, alias_key, store_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (household_id, alias_key) DO UPDATE SET store_id = excluded.store_id`,
    )
    .run(ctx.householdId, key, storeId, ctx.now)
}

export function upsertStore(
  ctx: WriteContext,
  input: { id: string; name?: string; color?: string; sortOrder?: number },
): void {
  const { db, householdId } = ctx
  const owner = db.prepare('SELECT household_id FROM stores WHERE id = ?').get(input.id) as
    | { household_id: string }
    | undefined
  if (owner && owner.household_id !== householdId) throw new OpRejected('Unknown store')
  if (!owner) {
    if (!input.name) throw new OpRejected('A new store needs a name')
    createStore(ctx, input.name, { id: input.id, color: input.color, sortOrder: input.sortOrder })
    return
  }
  const current = getStore(db, householdId, input.id)!
  if (current.deleted_at) throw new OpRejected('That store was removed')
  if (input.name && storeKey(input.name) !== storeKey(current.name)) {
    const clash = activeStores(db, householdId).find((s) => s.id !== current.id && storeKey(s.name) === storeKey(input.name!))
    if (clash) throw new OpRejected(`You already have a store called ${clash.name}`)
  }
  db.prepare(
    `UPDATE stores SET name = ?, color = ?, sort_order = ?, updated_at = ?, rev = ?
     WHERE id = ? AND household_id = ?`,
  ).run(
    input.name?.trim() ?? current.name,
    input.color ?? current.color,
    input.sortOrder ?? current.sort_order,
    ctx.now,
    ctx.rev,
    current.id,
    householdId,
  )
}

/** Removing a store sends its items back to Unsorted and re-learns products that pointed at it. */
export function deleteStore(ctx: WriteContext, id: string): void {
  const { db, householdId } = ctx
  const store = getStore(db, householdId, id)
  if (!store) throw new OpRejected('Unknown store')
  if (store.deleted_at) return
  db.prepare('UPDATE stores SET deleted_at = ?, updated_at = ?, rev = ? WHERE id = ?').run(ctx.now, ctx.now, ctx.rev, id)
  db.prepare(
    `UPDATE list_items SET store_id = NULL, store_source = 'none', store_reason = NULL, updated_at = ?, rev = ?
     WHERE household_id = ? AND store_id = ? AND deleted_at IS NULL`,
  ).run(ctx.now, ctx.rev, householdId, id)
  const affected = db
    .prepare('SELECT id FROM products WHERE household_id = ? AND predicted_store_id = ?')
    .all(householdId, id) as { id: string }[]
  for (const { id: productId } of affected) ctx.touchedProducts.add(productId)
}
