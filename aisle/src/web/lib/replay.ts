import { classify } from '../../shared/categories'
import { mergeNote, mergeQuantity } from '../../shared/merge'
import { coreKey, displayName, nameKey } from '../../shared/normalize'
import type { Op } from '../../shared/ops'
import { matchKnownChain, nextStoreColor, storeKey } from '../../shared/stores'
import type { ListItem, Product, Store, StoreSource } from '../../shared/types'

export interface Tables {
  stores: Map<string, Store>
  products: Map<string, Product>
  items: Map<string, ListItem>
}

export interface ReplayContext {
  userId: string | null
  now: number
}

interface Placement {
  storeId: string | null
  storeSource: StoreSource
  storeReason: string | null
}

const liveStores = (t: Tables) => [...t.stores.values()].filter((s) => !s.deletedAt)

/** Mirrors the server's matching closely enough for the moment before it answers. */
export function findLocalProduct(products: Iterable<Product>, name: string): { product: Product; exact: boolean } | null {
  const key = nameKey(name)
  const core = coreKey(name)
  let variant: Product | null = null
  for (const product of products) {
    if (product.deletedAt) continue
    if (nameKey(product.name) === key) return { product, exact: true }
    if (!variant && core && coreKey(product.name) === core) variant = product
  }
  return variant ? { product: variant, exact: false } : null
}

export function findLocalStore(stores: Iterable<Store>, name: string): Store | null {
  const key = storeKey(name)
  if (!key) return null
  const live = [...stores].filter((s) => !s.deletedAt)
  const exact = live.find((s) => storeKey(s.name) === key)
  if (exact) return exact
  const chain = matchKnownChain(name)
  return (chain && live.find((s) => matchKnownChain(s.name) === chain)) || null
}

function explicitPlacement(t: Tables, storeId?: string | null, storeHint?: string | null): Placement | null {
  if (storeId) {
    const store = t.stores.get(storeId)
    if (store && !store.deletedAt) return { storeId, storeSource: 'manual', storeReason: 'You put it here' }
  }
  const hint = storeHint?.trim()
  if (!hint || storeKey(hint).length < 2) return null
  const store = findLocalStore(t.stores.values(), hint)
  // The server creates the store; until it answers the item waits in Unsorted.
  if (!store) return { storeId: null, storeSource: 'none', storeReason: `Going to ${hint}` }
  return { storeId: store.id, storeSource: 'hint', storeReason: `You wrote "${hint}"` }
}

function predictedPlacement(t: Tables, product: Product | null): Placement {
  const stores = liveStores(t)
  const predicted = product?.predictedStoreId ? t.stores.get(product.predictedStoreId) : undefined
  if (predicted && !predicted.deletedAt) {
    return { storeId: predicted.id, storeSource: 'learned', storeReason: product!.predictionReason }
  }
  if (stores.length === 1) return { storeId: stores[0]!.id, storeSource: 'only', storeReason: null }
  return { storeId: null, storeSource: 'none', storeReason: null }
}

function applyOne(t: Tables, op: Op, ctx: ReplayContext, merged: Map<string, string>): void {
  const live = (id: string) => {
    const item = t.items.get(merged.get(id) ?? id)
    return item && !item.deletedAt ? item : null
  }
  const put = (item: ListItem, changes: Partial<ListItem>) =>
    t.items.set(item.id, { ...item, ...changes, updatedAt: ctx.now })

  switch (op.type) {
    case 'item.add': {
      if (t.items.has(op.id)) return
      const match = findLocalProduct(t.products.values(), op.name)
      const product = match?.product ?? null
      const key = nameKey(op.name)
      const open = [...t.items.values()].find(
        (i) => !i.deletedAt && !i.checkedAt && (product ? i.productId === product.id : !i.productId && nameKey(i.name) === key),
      )
      const placement = explicitPlacement(t, op.storeId, op.storeHint)
      if (open) {
        merged.set(op.id, open.id)
        const move = placement?.storeId && (placement.storeSource === 'manual' || open.storeSource !== 'manual')
        put(open, {
          ...mergeQuantity(open, op.quantity, op.unit),
          note: mergeNote(open.note, op.note),
          ...(move ? placement : {}),
        })
        return
      }
      const store = placement?.storeId ? placement : (placement ?? predictedPlacement(t, product))
      t.items.set(op.id, {
        id: op.id,
        productId: product?.id ?? null,
        name: product && match!.exact ? product.name : displayName(op.name),
        quantity: op.quantity ?? null,
        unit: op.unit ?? null,
        note: op.note?.trim() || null,
        category: product?.category ?? classify(op.name),
        ...store,
        checkedAt: null,
        checkedBy: null,
        addedBy: ctx.userId,
        captureId: null,
        createdAt: op.at,
        updatedAt: ctx.now,
        deletedAt: null,
        rev: 0,
      })
      return
    }
    case 'item.update': {
      const item = live(op.id)
      if (!item) return
      put(item, {
        ...(op.name !== undefined ? { name: displayName(op.name) } : {}),
        ...(op.quantity !== undefined ? { quantity: op.quantity } : {}),
        ...(op.unit !== undefined ? { unit: op.unit || null } : {}),
        ...(op.note !== undefined ? { note: op.note?.trim() || null } : {}),
      })
      return
    }
    case 'item.setStore': {
      const item = live(op.id)
      if (!item) return
      const store = op.storeId ? t.stores.get(op.storeId) : null
      if (op.storeId && (!store || store.deletedAt)) return
      put(item, {
        storeId: op.storeId,
        storeSource: op.storeId ? 'manual' : 'none',
        storeReason: op.storeId ? 'You put it here' : null,
      })
      return
    }
    case 'item.check': {
      const item = live(op.id)
      if (!item || op.checked === (item.checkedAt !== null)) return
      put(item, op.checked ? { checkedAt: op.at, checkedBy: ctx.userId } : { checkedAt: null, checkedBy: null })
      return
    }
    case 'item.delete': {
      const item = live(op.id)
      if (item) t.items.delete(item.id)
      return
    }
    case 'items.clearChecked': {
      for (const item of [...t.items.values()]) {
        if (!item.checkedAt || item.deletedAt) continue
        if (op.storeId === undefined || item.storeId === op.storeId) t.items.delete(item.id)
      }
      return
    }
    case 'store.upsert': {
      const existing = t.stores.get(op.id)
      if (existing) {
        if (existing.deletedAt) return
        t.stores.set(op.id, {
          ...existing,
          name: op.name?.trim() ?? existing.name,
          color: op.color ?? existing.color,
          sortOrder: op.sortOrder ?? existing.sortOrder,
          updatedAt: ctx.now,
        })
        return
      }
      if (!op.name) return
      const stores = liveStores(t)
      if (stores.some((s) => storeKey(s.name) === storeKey(op.name!))) return
      t.stores.set(op.id, {
        id: op.id,
        name: op.name.trim(),
        color: op.color ?? nextStoreColor(stores.map((s) => s.color)),
        sortOrder: op.sortOrder ?? stores.reduce((max, s) => Math.max(max, s.sortOrder + 1), 0),
        createdAt: ctx.now,
        updatedAt: ctx.now,
        deletedAt: null,
        rev: 0,
      })
      return
    }
    case 'store.delete': {
      if (!t.stores.has(op.id)) return
      t.stores.delete(op.id)
      for (const item of [...t.items.values()]) {
        if (item.storeId === op.id) t.items.set(item.id, { ...item, storeId: null, storeSource: 'none', storeReason: null })
      }
      return
    }
  }
}

/**
 * Applies operations the server has not confirmed yet on top of its last known state, so the
 * list shows a change the moment it is made. Each operation is safe to apply to a state that
 * already includes it, which happens briefly after the server confirms it.
 */
export function replay(base: Tables, ops: readonly Op[], ctx: ReplayContext): Tables {
  if (!ops.length) return base
  const tables: Tables = { stores: new Map(base.stores), products: base.products, items: new Map(base.items) }
  const merged = new Map<string, string>()
  for (const op of ops) applyOne(tables, op, ctx, merged)
  return tables
}
