import { describe, expect, it } from 'vitest'
import { cadence, describeAgo, describeInterval, dueStatus, purchaseDays } from '../../src/server/learning/cadence'
import { cheaperAt, priceStats } from '../../src/server/learning/prices'
import { type Checkoff, trips, walkOrders } from '../../src/server/learning/walkOrder'
import type { Insights } from '../../src/shared/types'
import { Client, DAY, HOUR, setup, uuid } from './helpers'

const MIN = 60_000
const T0 = Date.UTC(2026, 2, 1, 17)

describe('cadence', () => {
  it('treats purchases within 12 hours as one', () => {
    expect(purchaseDays([T0, T0 + 2 * HOUR, T0 + DAY, T0 + DAY + 11 * HOUR])).toEqual([T0, T0 + DAY])
  })

  it('needs three purchase days and uses the median gap', () => {
    expect(cadence([T0, T0 + 7 * DAY])).toBeNull()
    const c = cadence([T0, T0 + 7 * DAY, T0 + 14 * DAY, T0 + 28 * DAY, T0 + 35 * DAY])!
    expect(c).toEqual({ intervalDays: 7, lastPurchasedAt: T0 + 35 * DAY, purchaseDays: 5 })
  })

  it('follows recent gaps when habits change', () => {
    const monthly = Array.from({ length: 6 }, (_, i) => T0 + i * 30 * DAY)
    const last = monthly[monthly.length - 1]!
    const weekly = Array.from({ length: 9 }, (_, i) => last + (i + 1) * 7 * DAY)
    expect(cadence([...monthly, ...weekly])!.intervalDays).toBe(7)
  })

  it('suggests an item shortly before it is due and gives up on abandoned ones', () => {
    const c = { intervalDays: 7, lastPurchasedAt: T0, purchaseDays: 4 }
    expect(dueStatus(c, T0 + 5 * DAY).due).toBe(false)
    expect(dueStatus(c, T0 + 6 * DAY)).toMatchObject({ due: true, daysSinceLast: 6 })
    expect(dueStatus(c, T0 + 20 * DAY).due).toBe(true)
    expect(dueStatus(c, T0 + 36 * DAY).due).toBe(false)
    const monthly = { intervalDays: 30, lastPurchasedAt: T0, purchaseDays: 4 }
    expect(dueStatus(monthly, T0 + 26 * DAY).due).toBe(false)
    expect(dueStatus(monthly, T0 + 27 * DAY).due).toBe(true)
  })

  it('describes intervals and ages in plain words', () => {
    expect(describeInterval(1)).toBe('about every day')
    expect(describeInterval(6.6)).toBe('about every 7 days')
    expect(describeInterval(10)).toBe('about every week')
    expect(describeInterval(14)).toBe('about every 2 weeks')
    expect(describeInterval(61)).toBe('about every 2 months')
    expect(describeAgo(0.3)).toBe('today')
    expect(describeAgo(1.2)).toBe('yesterday')
    expect(describeAgo(8.9)).toBe('8 days ago')
    expect(describeAgo(21)).toBe('3 weeks ago')
    expect(describeAgo(95)).toBe('3 months ago')
  })
})

describe('walking order', () => {
  const trip = (storeId: string, start: number, items: Array<[string, Checkoff['category']]>, stepMs = 4 * MIN): Checkoff[] =>
    items.map(([productId, category], i) => ({ storeId, productId, category, at: start + i * stepMs }))

  it('splits check-offs into trips per store at 90-minute gaps', () => {
    const all = [
      ...trip('a', T0, [['x', 'Produce'], ['y', 'Dairy & Eggs']]),
      ...trip('a', T0 + 2 * HOUR, [['z', 'Frozen']]),
      ...trip('b', T0 + 5 * MIN, [['w', 'Pantry']]),
    ]
    expect(trips(all).map((t) => t.map((c) => c.productId))).toEqual([['x', 'y'], ['z'], ['w']])
  })

  it('learns where things are picked up in each store', () => {
    const order = walkOrders(
      [
        ...trip('costco', T0, [['bananas', 'Produce'], ['milk', 'Dairy & Eggs'], ['peas', 'Frozen']]),
        ...trip('costco', T0 + 7 * DAY, [['apples', 'Produce'], ['milk', 'Dairy & Eggs'], ['peas', 'Frozen']]),
        ...trip('tj', T0 + 3 * DAY, [['peas', 'Frozen'], ['milk', 'Dairy & Eggs'], ['bananas', 'Produce']]),
      ],
      T0 + 8 * DAY,
    )
    expect(order.costco!.categories).toEqual({ Produce: 0, 'Dairy & Eggs': 0.5, Frozen: 1 })
    expect(order.costco!.products).toEqual({ bananas: 0, apples: 0, milk: 0.5, peas: 1 })
    expect(order.tj!.categories).toEqual({ Frozen: 0, 'Dairy & Eggs': 0.5, Produce: 1 })
  })

  it('ignores ticking everything off at once and very short trips', () => {
    const order = walkOrders(
      [
        ...trip('costco', T0, [['a', 'Produce'], ['b', 'Frozen'], ['c', 'Pantry']], 3_000),
        ...trip('costco', T0 + DAY, [['a', 'Produce'], ['b', 'Frozen']]),
      ],
      T0 + 2 * DAY,
    )
    expect(order).toEqual({})
  })

  it('lets recent trips outweigh old ones after a store is rearranged', () => {
    const order = walkOrders(
      [
        ...trip('aldi', T0 - 400 * DAY, [['bread', 'Bakery'], ['milk', 'Dairy & Eggs'], ['soap', 'Household']]),
        ...trip('aldi', T0, [['soap', 'Household'], ['milk', 'Dairy & Eggs'], ['bread', 'Bakery']]),
      ],
      T0,
    )
    expect(order.aldi!.products.soap).toBeLessThan(0.2)
    expect(order.aldi!.products.bread).toBeGreaterThan(0.8)
  })
})

describe('prices', () => {
  const at = (days: number) => T0 + days * DAY

  it('averages unit prices per store and unit', () => {
    const stats = priceStats([
      { productId: 'milk', storeId: 'costco', at: at(0), priceCents: 798, quantity: 2, unit: null },
      { productId: 'milk', storeId: 'costco', at: at(7), priceCents: 419, quantity: null, unit: null },
      { productId: 'milk', storeId: 'tj', at: at(3), priceCents: 349, quantity: 1, unit: null },
      { productId: 'apples', storeId: 'tj', at: at(3), priceCents: 597, quantity: 3, unit: 'lb' },
      { productId: 'apples', storeId: 'tj', at: at(4), priceCents: 0, quantity: 3, unit: 'lb' },
    ])
    expect(stats.get('milk')).toEqual([
      { storeId: 'costco', unit: null, averageCents: 409, lastCents: 419, samples: 2 },
      { storeId: 'tj', unit: null, averageCents: 349, lastCents: 349, samples: 1 },
    ])
    expect(stats.get('apples')).toEqual([{ storeId: 'tj', unit: 'lb', averageCents: 199, lastCents: 199, samples: 1 }])
  })

  it('points out a store that is clearly cheaper for the same unit', () => {
    const prices = [
      { storeId: 'costco', unit: null, averageCents: 499, lastCents: 499, samples: 3 },
      { storeId: 'tj', unit: null, averageCents: 399, lastCents: 379, samples: 2 },
      { storeId: 'aldi', unit: 'lb', averageCents: 99, lastCents: 99, samples: 1 },
    ]
    expect(cheaperAt(prices, 'costco')).toEqual({ storeId: 'tj', savingsCents: 100 })
    expect(cheaperAt(prices, 'tj')).toBeNull()
    expect(cheaperAt(prices, null)).toBeNull()
    const close = [
      { storeId: 'costco', unit: null, averageCents: 499, lastCents: 499, samples: 3 },
      { storeId: 'tj', unit: null, averageCents: 479, lastCents: 479, samples: 2 },
    ]
    expect(cheaperAt(close, 'costco')).toBeNull()
  })
})

describe('insights API', () => {
  it('suggests what is running low, filed at the right store, and learns the walking order', async () => {
    const { app, clock } = setup({ start: T0 })
    const ana = new Client(app)
    await ana.signup('Ana', 'ana@example.com')
    const costco = uuid()
    const tj = uuid()
    await ana.ops(
      { type: 'store.upsert', id: costco, name: 'Costco', color: '#059669', sortOrder: 0 },
      { type: 'store.upsert', id: tj, name: "Trader Joe's", color: '#0284c7', sortOrder: 1 },
    )
    for (let week = 0; week < 4; week++) {
      const ids = [uuid(), uuid(), uuid()]
      await ana.ops(
        { type: 'item.add', id: ids[0]!, name: 'Bananas', storeId: costco, at: clock.now() },
        { type: 'item.add', id: ids[1]!, name: 'Milk', storeId: costco, at: clock.now() },
        { type: 'item.add', id: ids[2]!, name: 'Frozen peas', storeId: costco, at: clock.now() },
      )
      clock.advance(HOUR)
      for (const [i, id] of ids.entries()) {
        await ana.ops({ type: 'item.check', id, checked: true, at: clock.now() + i * 6 * MIN })
      }
      await ana.ops({ type: 'items.clearChecked' })
      clock.advance(7 * DAY - HOUR)
    }
    clock.advance(-2 * DAY)
    let insights = await ana.json<Insights>('GET', '/api/insights')
    expect(insights.dueSoon).toEqual([])

    clock.advance(DAY + 12 * HOUR)
    insights = await ana.json<Insights>('GET', '/api/insights')
    expect(insights.dueSoon.map((d) => d.name).sort()).toEqual(['Bananas', 'Frozen peas', 'Milk'])
    expect(insights.dueSoon[0]).toMatchObject({
      storeId: costco,
      intervalDays: 7,
      reason: 'About every 7 days; last bought 6 days ago',
    })
    const order = insights.walkOrder[costco]!
    expect(Object.values(order.categories)).toHaveLength(3)
    expect(order.categories.Produce).toBe(0)
    expect(order.categories.Frozen).toBe(1)
    expect(insights.stores.find((s) => s.storeId === costco)).toMatchObject({ visits30d: 4, productCount: 3 })
    expect(insights.products.find((p) => p.name === 'Milk')).toMatchObject({ purchaseCount: 4, intervalDays: 7, storeId: costco })

    await ana.ops({ type: 'item.add', id: uuid(), name: 'milk', at: clock.now() })
    insights = await ana.json<Insights>('GET', '/api/insights')
    expect(insights.dueSoon.map((d) => d.name).sort()).toEqual(['Bananas', 'Frozen peas'])
  })
})
