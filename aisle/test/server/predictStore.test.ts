import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/server/db'
import { decay, predictStore } from '../../src/server/learning/predictStore'
import { withWrite } from '../../src/server/services/context'
import { createHousehold } from '../../src/server/services/households'
import { resolveProduct } from '../../src/server/services/products'
import { createStore, deleteStore } from '../../src/server/services/stores'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 5, 1, 12)

function world(storeNames: string[]) {
  const db = openDatabase(':memory:')
  const householdId = createHousehold(db, 'Test', NOW)
  const write = <T>(fn: Parameters<typeof withWrite<T>>[4]) => withWrite(db, householdId, null, NOW, fn).value
  const stores = Object.fromEntries(storeNames.map((name) => [name, write((ctx) => createStore(ctx, name).id)]))
  const product = (name: string) => write((ctx) => resolveProduct(ctx, name).product)
  const bought = (productId: string, store: string, daysAgo: number, source: 'receipt' | 'checkoff' = 'receipt') =>
    db
      .prepare(
        `INSERT INTO purchases (id, household_id, product_id, store_id, purchased_at, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), householdId, productId, stores[store], NOW - daysAgo * DAY, source, NOW)
  const chose = (productId: string, store: string, daysAgo: number) =>
    db
      .prepare('INSERT INTO store_choices (id, household_id, product_id, store_id, chosen_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), householdId, productId, stores[store], NOW - daysAgo * DAY)
  const predict = (productId: string | null, category: Parameters<typeof predictStore>[3] = 'Dairy & Eggs') => {
    const p = predictStore(db, householdId, productId, category, NOW)
    const name = Object.entries(stores).find(([, id]) => id === p.storeId)?.[0] ?? null
    return { ...p, store: name }
  }
  return { db, householdId, stores, write, product, bought, chose, predict }
}

describe('decay', () => {
  it('halves a signal every 120 days', () => {
    expect(decay(0)).toBe(1)
    expect(decay(120 * DAY)).toBeCloseTo(0.5)
    expect(decay(240 * DAY)).toBeCloseTo(0.25)
    expect(decay(-5 * DAY)).toBe(1)
  })
})

describe('predictStore', () => {
  it('files a product where it is bought most, and says so', () => {
    const w = world(['Costco', "Trader Joe's"])
    const milk = w.product('Milk')
    w.bought(milk.id, 'Costco', 30)
    w.bought(milk.id, 'Costco', 20)
    w.bought(milk.id, 'Costco', 10)
    w.bought(milk.id, "Trader Joe's", 5)
    const p = w.predict(milk.id)
    expect(p).toMatchObject({ store: 'Costco', source: 'learned', reason: 'Bought here 3 of 4 times' })
    expect(p.confidence).toBeGreaterThan(0.7)
    expect(p.confidence).toBeLessThan(0.8)
  })

  it('lets the latest explicit choice win until a later receipt says otherwise', () => {
    const w = world(['Costco', "Trader Joe's"])
    const milk = w.product('Milk')
    for (const daysAgo of [60, 50, 40, 30, 20]) w.bought(milk.id, 'Costco', daysAgo)
    w.chose(milk.id, "Trader Joe's", 10)
    expect(w.predict(milk.id)).toMatchObject({ store: "Trader Joe's", reason: 'You put it here last time', confidence: 1 })
    w.bought(milk.id, "Trader Joe's", 5)
    expect(w.predict(milk.id)).toMatchObject({ store: "Trader Joe's", reason: 'You put it here last time' })
    w.bought(milk.id, 'Costco', 2)
    expect(w.predict(milk.id)).toMatchObject({ store: 'Costco', source: 'learned', reason: 'Bought here 6 of 7 times' })
  })

  it('follows a change of habit as old purchases fade', () => {
    const w = world(['Costco', 'Aldi'])
    const eggs = w.product('Eggs')
    for (const daysAgo of [760, 750, 740, 730]) w.bought(eggs.id, 'Costco', daysAgo)
    w.bought(eggs.id, 'Aldi', 7)
    expect(w.predict(eggs.id)).toMatchObject({ store: 'Aldi', reason: 'Bought here 1 of 5 times' })
  })

  it('counts a check-off as weaker evidence than a receipt', () => {
    const w = world(['Costco', 'Aldi'])
    const butter = w.product('Butter')
    w.bought(butter.id, 'Costco', 3, 'checkoff')
    w.bought(butter.id, 'Aldi', 3, 'receipt')
    expect(w.predict(butter.id).store).toBe('Aldi')
  })

  it('needs enough recent evidence before trusting history', () => {
    const w = world(['Costco', 'Aldi'])
    const yogurt = w.product('Yogurt')
    w.bought(yogurt.id, 'Costco', 200, 'checkoff')
    expect(w.predict(yogurt.id, 'Other').source).toBe('none')
    w.bought(yogurt.id, 'Costco', 1, 'checkoff')
    expect(w.predict(yogurt.id, 'Other')).toMatchObject({ store: 'Costco', source: 'learned', reason: 'Bought here all 2 times' })
  })

  it('falls back to where the category is usually bought', () => {
    const w = world(['Costco', "Trader Joe's"])
    for (const name of ['Bananas', 'Spinach', 'Avocados']) w.bought(w.product(name).id, "Trader Joe's", 4)
    w.bought(w.product('Paper towels').id, 'Costco', 4)
    const kiwi = w.product('Kiwis')
    expect(kiwi.category).toBe('Produce')
    expect(w.predict(kiwi.id, 'Produce')).toMatchObject({
      store: "Trader Joe's",
      source: 'category',
      reason: 'You usually buy produce here',
    })
    expect(w.predict(null, 'Frozen').source).toBe('none')
    expect(w.predict(null, 'Other').source).toBe('none')
  })

  it('does not guess a category store when the category is split', () => {
    const w = world(['Costco', "Trader Joe's", 'Aldi'])
    w.bought(w.product('Bananas').id, "Trader Joe's", 4)
    w.bought(w.product('Spinach').id, 'Costco', 4)
    w.bought(w.product('Apples').id, 'Aldi', 4)
    expect(w.predict(null, 'Produce').source).toBe('none')
  })

  it('uses the only store when there is one, and nothing when there are none', () => {
    expect(world(['Costco']).predict(null)).toMatchObject({ store: 'Costco', source: 'only' })
    expect(world([]).predict(null)).toMatchObject({ storeId: null, source: 'none' })
  })

  it('ignores history at stores that were removed', () => {
    const w = world(['Costco', 'Aldi', 'Lidl'])
    const milk = w.product('Milk')
    w.bought(milk.id, 'Costco', 5)
    w.write((ctx) => deleteStore(ctx, w.stores.Costco!))
    expect(w.predict(milk.id).source).toBe('none')
  })
})
