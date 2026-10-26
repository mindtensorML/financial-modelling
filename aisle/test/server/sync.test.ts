import { describe, expect, it } from 'vitest'
import type { ListItem } from '../../src/shared/types'
import { Client, DAY, HOUR, setup, uuid } from './helpers'

async function household() {
  const env = setup()
  const ana = new Client(env.app)
  const me = await ana.signup('Ana', 'ana@example.com')
  const ben = new Client(env.app)
  await ben.signup('Ben', 'ben@example.com', { inviteCode: me.household.inviteCode })
  return { ...env, ana, ben, me }
}

function sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    async next(): Promise<string> {
      while (!buffer.includes('\n\n')) {
        const { value, done } = await reader.read()
        if (done) throw new Error('The event stream ended')
        buffer += decoder.decode(value, { stream: true })
      }
      const end = buffer.indexOf('\n\n')
      const event = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      return event
    },
    cancel: () => reader.cancel(),
  }
}

const purchases = (db: ReturnType<typeof setup>['db']) =>
  db.prepare('SELECT product_id, store_id, purchased_at, source, list_item_id FROM purchases ORDER BY purchased_at').all() as {
    product_id: string
    store_id: string | null
    purchased_at: number
    source: string
    list_item_id: string | null
  }[]

describe('operations and sync', () => {
  it('applies an add, classifies it, and makes it visible to the whole household', async () => {
    const { ana, ben, clock } = await household()
    const id = uuid()
    const res = await ana.ops({ type: 'item.add', id, name: 'organic bananas', quantity: 6, at: clock.now() })
    expect(res.results).toEqual([{ opId: expect.any(String), status: 'ok' }])
    const snapshot = await ben.sync()
    expect(snapshot.full).toBe(true)
    expect(snapshot.rev).toBe(res.rev)
    expect(snapshot.items).toEqual([
      expect.objectContaining({ id, name: 'Organic bananas', quantity: 6, category: 'Produce', storeId: null, storeSource: 'none' }),
    ])
    expect(snapshot.products).toEqual([expect.objectContaining({ name: 'Organic bananas', category: 'Produce' })])
  })

  it('treats a resent operation as a duplicate and does not move the rev', async () => {
    const { ana, clock } = await household()
    const op = { opId: uuid(), type: 'item.add' as const, id: uuid(), name: 'Milk', at: clock.now() }
    const first = await ana.json<{ rev: number }>('POST', '/api/ops', { ops: [op] })
    const again = await ana.json<{ rev: number; results: unknown[] }>('POST', '/api/ops', { ops: [op, op] })
    expect(again.rev).toBe(first.rev)
    expect(again.results).toEqual([
      { opId: op.opId, status: 'duplicate' },
      { opId: op.opId, status: 'duplicate' },
    ])
    expect((await ana.sync()).items).toHaveLength(1)
  })

  it('pulls only what changed, including deletions', async () => {
    const { ana, ben, clock } = await household()
    const milk = uuid()
    const eggs = uuid()
    const { rev } = await ana.ops(
      { type: 'item.add', id: milk, name: 'Milk', at: clock.now() },
      { type: 'item.add', id: eggs, name: 'Eggs', at: clock.now() },
    )
    const base = await ben.sync()
    expect(base.rev).toBe(rev)
    await ana.ops({ type: 'item.delete', id: milk })
    const delta = await ben.sync(base.rev)
    expect(delta.full).toBe(false)
    expect(delta.items).toEqual([expect.objectContaining({ id: milk, deletedAt: expect.any(Number) })])
    expect(delta.products).toEqual([])
    const nothing = await ben.sync(delta.rev)
    expect(nothing.items).toEqual([])
    // A client that is somehow ahead of the server (restored backup, other household) starts over.
    const reset = await ben.sync(delta.rev + 100)
    expect(reset.full).toBe(true)
    expect(reset.items.map((i) => i.id)).toEqual([eggs])
  })

  it('merges two adds of the same thing and redirects later operations', async () => {
    const { ana, ben, db, clock } = await household()
    const fromAna = uuid()
    const fromBen = uuid()
    await ana.ops({ type: 'item.add', id: fromAna, name: 'Milk', at: clock.now() })
    const merged = await ben.ops(
      { type: 'item.add', id: fromBen, name: 'milk', quantity: 2, unit: 'gal', note: 'the big ones', at: clock.now() },
      { type: 'item.check', id: fromBen, checked: true, at: clock.now() },
    )
    expect(merged.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    const { items } = await ana.sync()
    expect(items).toEqual([
      expect.objectContaining({ id: fromAna, quantity: 2, unit: 'gal', note: 'the big ones', checkedAt: clock.now() }),
    ])
    const tombstone = db.prepare('SELECT merged_into, deleted_at FROM list_items WHERE id = ?').get(fromBen)
    expect(tombstone).toEqual({ merged_into: fromAna, deleted_at: clock.now() })
  })

  it('does not merge into an item that was already checked off', async () => {
    const { ana, clock } = await household()
    const first = uuid()
    await ana.ops(
      { type: 'item.add', id: first, name: 'Milk', at: clock.now() },
      { type: 'item.check', id: first, checked: true, at: clock.now() },
      { type: 'item.add', id: uuid(), name: 'Milk', at: clock.now() },
    )
    const { items } = await ana.sync()
    expect(items).toHaveLength(2)
  })

  it('records a check-off as a purchase at the time it happened, and undoes it on uncheck', async () => {
    const { ana, db, clock } = await household()
    const costco = uuid()
    const milk = uuid()
    const boughtAt = clock.now() - 2 * HOUR
    await ana.ops(
      { type: 'store.upsert', id: costco, name: 'Costco', color: '#059669', sortOrder: 0 },
      { type: 'item.add', id: milk, name: 'Milk', storeId: costco, at: clock.now() - 3 * HOUR },
      { type: 'item.check', id: milk, checked: true, at: boughtAt },
    )
    expect(purchases(db)).toEqual([
      expect.objectContaining({ store_id: costco, purchased_at: boughtAt, source: 'checkoff', list_item_id: milk }),
    ])
    const product = (await ana.sync()).products[0]!
    expect(product).toMatchObject({ purchaseCount: 1, lastPurchasedAt: boughtAt, predictedStoreId: costco })

    await ana.ops({ type: 'item.check', id: milk, checked: false, at: clock.now() })
    expect(purchases(db)).toEqual([])
    expect((await ana.sync()).products[0]).toMatchObject({ purchaseCount: 0, lastPurchasedAt: null })
  })

  it('clamps device times that are far in the past or future', async () => {
    const { ana, db, clock } = await household()
    const a = uuid()
    const b = uuid()
    await ana.ops(
      { type: 'item.add', id: a, name: 'Milk', at: clock.now() },
      { type: 'item.add', id: b, name: 'Bread', at: clock.now() },
      { type: 'item.check', id: a, checked: true, at: clock.now() + 3 * DAY },
      { type: 'item.check', id: b, checked: true, at: 0 },
    )
    const times = purchases(db).map((p) => p.purchased_at)
    expect(times).toEqual([clock.now() - 30 * DAY, clock.now() + 5 * 60_000])
  })

  it('rejects operations on items that are gone without blocking the rest of the batch', async () => {
    const { ana, clock } = await household()
    const milk = uuid()
    await ana.ops({ type: 'item.add', id: milk, name: 'Milk', at: clock.now() }, { type: 'item.delete', id: milk })
    const eggs = uuid()
    const res = await ana.ops(
      { type: 'item.check', id: milk, checked: true, at: clock.now() },
      { type: 'item.add', id: eggs, name: 'Eggs', at: clock.now() },
      { type: 'item.setStore', id: eggs, storeId: uuid() },
    )
    expect(res.results).toEqual([
      expect.objectContaining({ status: 'rejected', error: 'That item is no longer on the list' }),
      expect.objectContaining({ status: 'ok' }),
      expect.objectContaining({ status: 'rejected', error: 'That store was removed' }),
    ])
    expect((await ana.sync()).items.map((i) => i.name)).toEqual(['Eggs'])
  })

  it('keeps households apart', async () => {
    const { ana, app, clock } = await household()
    const milk = uuid()
    await ana.ops({ type: 'item.add', id: milk, name: 'Milk', at: clock.now() })
    const eve = new Client(app)
    await eve.signup('Eve', 'eve@example.com')
    const res = await eve.ops(
      { type: 'item.check', id: milk, checked: true, at: clock.now() },
      { type: 'item.update', id: milk, name: 'Hacked' },
      { type: 'item.delete', id: milk },
      { type: 'item.add', id: milk, name: 'Collision', at: clock.now() },
    )
    expect(res.results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected'])
    expect((await eve.sync()).items).toEqual([])
    expect((await ana.sync()).items).toEqual([expect.objectContaining({ id: milk, name: 'Milk', checkedAt: null })])
  })

  it('validates operations', async () => {
    const { ana } = await household()
    const res = await ana.request('POST', '/api/ops', { ops: [{ opId: 'nope', type: 'item.add', id: uuid(), name: '' }] })
    expect(res.status).toBe(400)
    expect((await ana.request('POST', '/api/ops', { ops: [] })).status).toBe(400)
  })

  it('renames an item, re-files it unless the user placed it, and keeps notes', async () => {
    const { ana, clock } = await household()
    const costco = uuid()
    const tj = uuid()
    await ana.ops(
      { type: 'store.upsert', id: costco, name: 'Costco', color: '#059669', sortOrder: 0 },
      { type: 'store.upsert', id: tj, name: "Trader Joe's", color: '#0284c7', sortOrder: 1 },
    )
    const learn = uuid()
    await ana.ops(
      { type: 'item.add', id: learn, name: 'Oat milk', storeId: tj, at: clock.now() },
      { type: 'item.check', id: learn, checked: true, at: clock.now() },
    )
    const item = uuid()
    await ana.ops({ type: 'item.add', id: item, name: 'Mlk', at: clock.now() })
    await ana.ops({ type: 'item.update', id: item, name: 'oat milk', note: 'barista edition' })
    const updated = (await ana.sync()).items.find((i) => i.id === item)!
    expect(updated).toMatchObject({ name: 'Oat milk', note: 'barista edition', storeId: tj, storeSource: 'learned' })

    const placed = uuid()
    await ana.ops({ type: 'item.add', id: placed, name: 'Paper towels', storeId: costco, at: clock.now() })
    await ana.ops({ type: 'item.update', id: placed, name: 'Oat milk barista' })
    expect((await ana.sync()).items.find((i) => i.id === placed)).toMatchObject({ storeId: costco, storeSource: 'manual' })
  })

  it('clears checked items in one store, in Unsorted, or everywhere', async () => {
    const { ana, clock } = await household()
    const costco = uuid()
    const ids = { milk: uuid(), towels: uuid(), bread: uuid(), soap: uuid() }
    await ana.ops(
      { type: 'store.upsert', id: costco, name: 'Costco', color: '#059669', sortOrder: 0 },
      { type: 'store.upsert', id: uuid(), name: 'Aldi', color: '#d97706', sortOrder: 1 },
      { type: 'item.add', id: ids.milk, name: 'Milk', storeId: costco, at: clock.now() },
      { type: 'item.add', id: ids.towels, name: 'Paper towels', at: clock.now() },
      { type: 'item.add', id: ids.bread, name: 'Bread', at: clock.now() },
      { type: 'item.check', id: ids.milk, checked: true, at: clock.now() },
      { type: 'item.check', id: ids.towels, checked: true, at: clock.now() },
    )
    const names = async () => (await ana.sync()).items.map((i: ListItem) => i.name).sort()
    await ana.ops({ type: 'items.clearChecked', storeId: costco })
    expect(await names()).toEqual(['Bread', 'Paper towels'])
    await ana.ops({ type: 'items.clearChecked', storeId: null })
    expect(await names()).toEqual(['Bread'])
    await ana.ops(
      { type: 'item.add', id: ids.soap, name: 'Dish soap', storeId: costco, at: clock.now() },
      { type: 'item.check', id: ids.soap, checked: true, at: clock.now() },
      { type: 'item.check', id: ids.bread, checked: true, at: clock.now() },
      { type: 'items.clearChecked' },
    )
    expect(await names()).toEqual([])
  })
})

describe('stores', () => {
  it('creates, renames, and orders stores, refusing duplicate names', async () => {
    const { ana } = await household()
    const costco = uuid()
    const tj = uuid()
    await ana.ops(
      { type: 'store.upsert', id: costco, name: 'Costco', color: '#059669', sortOrder: 1 },
      { type: 'store.upsert', id: tj, name: "Trader Joe's", color: '#0284c7', sortOrder: 0 },
    )
    const dup = await ana.ops({ type: 'store.upsert', id: uuid(), name: 'costco', color: '#d97706', sortOrder: 2 })
    expect(dup.results[0]).toMatchObject({ status: 'rejected', error: 'You already have a store called Costco' })
    await ana.ops({ type: 'store.upsert', id: costco, name: 'Costco Wholesale' })
    const { stores } = await ana.sync()
    expect(stores.map((s) => [s.name, s.color])).toEqual([
      ["Trader Joe's", '#0284c7'],
      ['Costco Wholesale', '#059669'],
    ])
  })

  it('files items under a store written next to them, creating it if needed', async () => {
    const { ana, clock } = await household()
    const eggs = uuid()
    const res = await ana.ops({ type: 'item.add', id: eggs, name: 'Eggs', storeHint: 'COSTCO WHOLESALE #482', at: clock.now() })
    expect(res.results[0]!.status).toBe('ok')
    const { stores, items } = await ana.sync()
    expect(stores.map((s) => s.name)).toEqual(['Costco'])
    expect(items[0]).toMatchObject({ storeId: stores[0]!.id, storeSource: 'hint', storeReason: 'You wrote "COSTCO WHOLESALE #482"' })
    await ana.ops({ type: 'item.add', id: uuid(), name: 'Butter', storeHint: 'costco', at: clock.now() })
    expect((await ana.sync()).stores).toHaveLength(1)
  })

  it('sends items back to Unsorted when their store is removed', async () => {
    const { ana, clock } = await household()
    const costco = uuid()
    const aldi = uuid()
    const milk = uuid()
    await ana.ops(
      { type: 'store.upsert', id: costco, name: 'Costco', color: '#059669', sortOrder: 0 },
      { type: 'store.upsert', id: aldi, name: 'Aldi', color: '#0284c7', sortOrder: 1 },
      { type: 'item.add', id: milk, name: 'Milk', storeId: costco, at: clock.now() },
    )
    const before = await ana.sync()
    expect(before.products[0]!.predictedStoreId).toBe(costco)
    await ana.ops({ type: 'store.delete', id: costco })
    const after = await ana.sync(before.rev)
    expect(after.stores).toEqual([expect.objectContaining({ id: costco, deletedAt: expect.any(Number) })])
    expect(after.items).toEqual([expect.objectContaining({ id: milk, storeId: null, storeSource: 'none' })])
    expect(after.products[0]).toMatchObject({ predictedStoreId: null })
    const edit = await ana.ops({ type: 'store.upsert', id: costco, color: '#000000' })
    expect(edit.results[0]).toMatchObject({ status: 'rejected', error: 'That store was removed' })
  })
})

describe('realtime events', () => {
  it('streams the current rev on connect and every new rev after a write', async () => {
    const { ana, ben, app, clock } = await household()
    const res = await app.request('/api/events', { headers: { cookie: ben.cookie } })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const events = sseEvents(res.body!)
    expect(await events.next()).toBe('event: rev\ndata: {"rev":0}\nretry: 5000')
    const { rev } = await ana.ops({ type: 'item.add', id: uuid(), name: 'Milk', at: clock.now() })
    let event = await events.next()
    while (event.startsWith('event: ping')) event = await events.next()
    expect(event).toBe(`event: rev\ndata: {"rev":${rev}}`)
    await events.cancel()
  })

  it('stops notifying a connection once it closes', async () => {
    const { ben, app, hub, me } = await household()
    const res = await app.request('/api/events', { headers: { cookie: ben.cookie } })
    const reader = res.body!.getReader()
    await reader.read()
    expect(hub.connectionCount(me.household.id)).toBe(1)
    await reader.cancel()
    await new Promise((r) => setTimeout(r, 120))
    expect(hub.connectionCount(me.household.id)).toBe(0)
  })
})
