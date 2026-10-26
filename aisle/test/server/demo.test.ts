import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashPassword } from '../../src/server/auth'
import { DemoExistsError, seedDemo } from '../../src/server/demo'
import type { BlobStore } from '../../src/server/ingest/blobs'
import type { Insights, Me } from '../../src/shared/types'
import { Client, setup } from './helpers'

// Local time, so the simulated trips fall at the same hours whatever zone the tests run in.
const NOW = new Date(2026, 9, 26, 18, 0).getTime()
const PASSWORD = 'demo-pass-123'

const uploads: BlobStore[] = []
afterEach(async () => {
  for (const blobs of uploads.splice(0)) await rm(blobs.root, { recursive: true, force: true })
})

async function seeded() {
  const env = setup({ start: NOW })
  uploads.push(env.blobs)
  const summary = await seedDemo(env.db, { passwordHash: await hashPassword(PASSWORD), blobs: env.blobs, now: NOW })
  const alex = new Client(env.app)
  await alex.json('POST', '/api/auth/login', { email: 'alex@example.com', password: PASSWORD })
  const { stores } = await alex.sync()
  const storeId = (name: string) => stores.find((s) => s.name === name)!.id
  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name ?? null
  return { ...env, summary, alex, storeId, storeName }
}

describe('demo household', () => {
  it('plays ten weeks of shopping through the app as scripted, the same way every time', async () => {
    const { summary } = await seeded()
    expect(summary.warnings).toEqual([])
    expect(summary).toMatchObject({ stores: 4, products: 32, receipts: 20, openItems: 7, toReview: 1 })
    expect(summary.purchases).toBeGreaterThan(140)

    const again = await seeded()
    expect(again.summary).toEqual({ ...summary, householdId: again.summary.householdId })
  })

  it('opens on a list filed by learned store, by category, and in Unsorted', async () => {
    const { alex, storeName } = await seeded()
    const { items } = await alex.sync()
    const open = items.filter((i) => !i.checkedAt && !i.deletedAt)
    expect(Object.fromEntries(open.map((i) => [i.name, [storeName(i.storeId), i.storeSource]]))).toEqual({
      'Greek yogurt': ["Trader Joe's", 'learned'],
      'Sourdough bread': ["Trader Joe's", 'learned'],
      Bananas: ["Trader Joe's", 'learned'],
      'Chicken breast': ["Trader Joe's", 'learned'],
      Lemons: ["Trader Joe's", 'category'],
      'Paper towels': ['Costco', 'learned'],
      Flowers: [null, 'none'],
    })
    expect(open.find((i) => i.name === 'Greek yogurt')).toMatchObject({ quantity: 2 })
  })

  it('has something on every Insights card', async () => {
    const { alex, storeId } = await seeded()
    const insights = await alex.json<Insights>('GET', '/api/insights')

    expect(insights.dueSoon.map((d) => d.name)).toEqual(expect.arrayContaining(['Avocados', 'Baby spinach', 'Whole milk']))
    const product = (name: string) => insights.products.find((p) => p.name === name)!
    expect(product('Avocados')).toMatchObject({ storeId: storeId("Trader Joe's"), intervalDays: 7, reason: 'Bought here all 10 times' })
    // Moved to Costco by hand a month ago, and bought there since.
    expect(product('Eggs')).toMatchObject({ storeId: storeId('Costco'), reason: 'You put it here last time' })
    expect(product('Coffee beans')).toMatchObject({
      storeId: storeId('Whole Foods'),
      cheaperAt: { storeId: storeId("Trader Joe's") },
    })

    // Some stores have a trip right at the 30-day edge, where daylight saving time can tip it either way.
    const visits = new Map(insights.stores.map((s) => [s.storeId, s.visits30d]))
    expect(visits.get(storeId("Trader Joe's"))).toBe(4)
    for (const store of ['Costco', 'Target', 'Whole Foods']) expect(visits.get(storeId(store))).toBeGreaterThanOrEqual(2)

    const order = (store: string) =>
      Object.entries(insights.walkOrder[storeId(store)]?.categories ?? {})
        .sort((a, b) => a[1]! - b[1]!)
        .map(([category]) => category)
    expect(order("Trader Joe's")[0]).toBe('Produce')
    expect(order('Costco')[0]).toBe('Household')
    expect(order('Target')).toEqual(['Personal Care', 'Household'])
  })

  it('leaves a pasted text message waiting for review', async () => {
    const { alex, storeName } = await seeded()
    const { captures } = await alex.sync()
    const waiting = captures.filter((c) => c.status === 'ready')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]!.extraction!.items.map((i) => [i.name, i.quantity, storeName(i.predictedStoreId)])).toEqual([
      ['Limes', null, "Trader Joe's"],
      ['Cilantro', null, "Trader Joe's"],
      ['Avocados', 2, "Trader Joe's"],
      ['Dish soap', null, 'Target'],
    ])
  })

  it('signs both members in to the same household', async () => {
    const { app, alex } = await seeded()
    const sam = new Client(app)
    await sam.json('POST', '/api/auth/login', { email: 'sam@example.com', password: PASSWORD })
    const [a, s] = await Promise.all([alex.json<Me>('GET', '/api/me'), sam.json<Me>('GET', '/api/me')])
    expect(s.household.id).toBe(a.household.id)
    expect(a.household.members.map((m) => m.name).sort()).toEqual(['Alex Rivera', 'Sam Rivera'])
  })

  it('refuses to seed twice, and a reset replaces the household and its uploads', async () => {
    const { db, blobs, summary } = await seeded()
    const passwordHash = await hashPassword(PASSWORD)
    await expect(seedDemo(db, { passwordHash, blobs, now: NOW })).rejects.toBeInstanceOf(DemoExistsError)

    await blobs.write(blobs.key(summary.householdId, randomUUID()), new Uint8Array([1, 2, 3]))
    const replaced = await seedDemo(db, { passwordHash, blobs, now: NOW, reset: true })
    expect(replaced.warnings).toEqual([])
    expect(replaced.householdId).not.toBe(summary.householdId)
    expect(db.prepare('SELECT id FROM households').all()).toEqual([{ id: replaced.householdId }])
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE household_id = ?').get(summary.householdId)).toEqual({ n: 0 })
    expect(existsSync(join(blobs.root, summary.householdId))).toBe(false)
  })

  it('will not reset a household someone else has joined, and changes nothing', async () => {
    const { app, db, blobs, alex, summary } = await seeded()
    const me = await alex.json<Me>('GET', '/api/me')
    await new Client(app).signup('Jo', 'jo@example.com', { inviteCode: me.household.inviteCode })

    await expect(seedDemo(db, { passwordHash: 'unused', blobs, now: NOW, reset: true })).rejects.toThrow(/jo@example\.com/)
    expect(db.inTransaction).toBe(false)
    const { items } = await alex.sync()
    expect(items.filter((i) => !i.checkedAt && !i.deletedAt)).toHaveLength(summary.openItems)
  })
})
