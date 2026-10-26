import { describe, expect, it } from 'vitest'
import type { Op } from '../../src/shared/ops'
import { replay } from '../../src/web/lib/replay'
import { item, product, store, tables, uuid } from './fixtures'

type AddOp = Extract<Op, { type: 'item.add' }>

const ctx = { userId: 'me', now: 1_000 }
const add = (name: string, extra: Partial<AddOp> = {}): AddOp => ({
  opId: uuid(),
  type: 'item.add',
  id: uuid(),
  name,
  at: 500,
  ...extra,
})

describe('replay', () => {
  it('returns the base tables untouched when nothing is pending', () => {
    const base = tables({ items: [item('Milk', 'Dairy & Eggs')] })
    expect(replay(base, [], ctx)).toBe(base)
  })

  it('files a known product where the server predicted it', () => {
    const costco = store('Costco')
    const tj = store("Trader Joe's")
    const milk = product('Milk', 'Dairy & Eggs', { predictedStoreId: costco.id, predictionReason: 'Usually from Costco' })
    const op = add('milk', { quantity: 2 })
    const result = replay(tables({ stores: [costco, tj], products: [milk] }), [op], ctx)
    expect(result.items.get(op.id)).toMatchObject({
      name: 'Milk',
      productId: milk.id,
      quantity: 2,
      category: 'Dairy & Eggs',
      storeId: costco.id,
      storeSource: 'learned',
      storeReason: 'Usually from Costco',
      addedBy: 'me',
      createdAt: 500,
    })
  })

  it('files a new item under the only store, or leaves it unsorted', () => {
    const only = store('Aldi')
    const op = add('dish soap')
    const one = replay(tables({ stores: [only] }), [op], ctx).items.get(op.id)
    expect(one).toMatchObject({ name: 'Dish soap', storeId: only.id, storeSource: 'only' })
    const two = replay(tables({ stores: [only, store('Target')] }), [op], ctx).items.get(op.id)
    expect(two).toMatchObject({ storeId: null, storeSource: 'none' })
  })

  it('follows a written store, and waits in Unsorted for one the server will create', () => {
    const costco = store('Costco')
    const known = add('paper towels', { storeHint: 'costco' })
    const unknown = add('batteries', { storeHint: 'Home Depot' })
    const result = replay(tables({ stores: [costco, store('Target')] }), [known, unknown], ctx)
    expect(result.items.get(known.id)).toMatchObject({ storeId: costco.id, storeSource: 'hint' })
    expect(result.items.get(unknown.id)).toMatchObject({
      storeId: null,
      storeReason: 'Going to Home Depot',
    })
  })

  it('folds a second entry into the open item, and later edits to it land there', () => {
    const milk = product('Milk', 'Dairy & Eggs')
    const open = item('Milk', 'Dairy & Eggs', { productId: milk.id, quantity: 1, note: 'organic' })
    const second = add('Milk', { quantity: 3, note: 'half gallon' })
    const check: Op = { opId: uuid(), type: 'item.check', id: second.id, checked: true, at: 900 }
    const result = replay(tables({ products: [milk], items: [open] }), [second, check], ctx)
    expect(result.items.has(second.id)).toBe(false)
    expect(result.items.get(open.id)).toMatchObject({
      quantity: 3,
      note: 'organic; half gallon',
      checkedAt: 900,
      checkedBy: 'me',
    })
  })

  it('moves an item to a store the user picks, but not to a deleted one', () => {
    const costco = store('Costco')
    const gone = store('Gone', { deletedAt: 5 })
    const eggs = item('Eggs', 'Dairy & Eggs')
    const result = replay(
      tables({ stores: [costco, gone], items: [eggs] }),
      [
        { opId: uuid(), type: 'item.setStore', id: eggs.id, storeId: costco.id },
        { opId: uuid(), type: 'item.setStore', id: eggs.id, storeId: gone.id },
      ],
      ctx,
    )
    expect(result.items.get(eggs.id)).toMatchObject({ storeId: costco.id, storeSource: 'manual', storeReason: 'You put it here' })
  })

  it('clears checked items for one store, for Unsorted, or everywhere', () => {
    const costco = store('Costco')
    const a = item('A', 'Other', { storeId: costco.id, checkedAt: 10 })
    const b = item('B', 'Other', { checkedAt: 10 })
    const c = item('C', 'Other', { storeId: costco.id })
    const base = tables({ stores: [costco], items: [a, b, c] })
    const clear = (storeId?: string | null): Op => ({ opId: uuid(), type: 'items.clearChecked', ...(storeId !== undefined ? { storeId } : {}) })
    expect([...replay(base, [clear(costco.id)], ctx).items.keys()]).toEqual([b.id, c.id])
    expect([...replay(base, [clear(null)], ctx).items.keys()]).toEqual([a.id, c.id])
    expect([...replay(base, [clear()], ctx).items.keys()]).toEqual([c.id])
  })

  it('creates stores with the next color and position, and ignores a duplicate name', () => {
    const costco = store('Costco', { color: '#059669', sortOrder: 0 })
    const id = uuid()
    const result = replay(
      tables({ stores: [costco] }),
      [
        { opId: uuid(), type: 'store.upsert', id, name: "Trader Joe's" },
        { opId: uuid(), type: 'store.upsert', id: uuid(), name: 'COSTCO' },
        { opId: uuid(), type: 'store.upsert', id: costco.id, name: 'Costco Wholesale' },
      ],
      ctx,
    )
    expect(result.stores.size).toBe(2)
    expect(result.stores.get(id)).toMatchObject({ name: "Trader Joe's", color: '#0284c7', sortOrder: 1 })
    expect(result.stores.get(costco.id)?.name).toBe('Costco Wholesale')
  })

  it('sends the items of a deleted store to Unsorted', () => {
    const costco = store('Costco')
    const towels = item('Paper towels', 'Household', { storeId: costco.id, storeSource: 'manual' })
    const result = replay(tables({ stores: [costco], items: [towels] }), [{ opId: uuid(), type: 'store.delete', id: costco.id }], ctx)
    expect(result.stores.has(costco.id)).toBe(false)
    expect(result.items.get(towels.id)).toMatchObject({ storeId: null, storeSource: 'none' })
  })

  it('is harmless to replay an operation the server already applied', () => {
    const costco = store('Costco')
    const op = add('bananas', { storeId: costco.id })
    const once = replay(tables({ stores: [costco] }), [op], ctx)
    const confirmed = { ...once.items.get(op.id)!, rev: 7 }
    const again = replay(tables({ stores: [costco], items: [confirmed] }), [op], ctx)
    expect(again.items.get(confirmed.id)).toEqual(confirmed)
    expect(again.items.size).toBe(1)
  })

  it('does not change the base tables it is given', () => {
    const eggs = item('Eggs', 'Dairy & Eggs')
    const base = tables({ items: [eggs] })
    replay(base, [{ opId: uuid(), type: 'item.delete', id: eggs.id }], ctx)
    expect(base.items.get(eggs.id)).toBe(eggs)
  })
})
