import { describe, expect, it } from 'vitest'
import type { JoinResponse, Me } from '../../src/shared/types'
import { Client, setup, uuid } from './helpers'

describe('households', () => {
  it('lets a partner sign up straight into a household with its invite code', async () => {
    const { app } = setup()
    const ana = new Client(app)
    const me = await ana.signup('Ana', 'ana@example.com')
    const ben = new Client(app)
    const benMe = await ben.signup('Ben', 'ben@example.com', { inviteCode: me.household.inviteCode })
    expect(benMe.household.id).toBe(me.household.id)
    const itemId = uuid()
    await ana.ops({ type: 'item.add', id: itemId, name: 'Milk', at: Date.now() })
    expect((await ben.sync()).items.map((i) => i.id)).toEqual([itemId])
  })

  it('rejects unknown invite codes', async () => {
    const { app } = setup()
    const res = await new Client(app).request('POST', '/api/auth/signup', {
      name: 'Ben',
      email: 'ben@example.com',
      password: 'correct horse battery',
      inviteCode: 'NOPE1234',
    })
    expect(res.status).toBe(404)
  })

  it('brings your open items along when you join another household', async () => {
    const { app, db } = setup()
    const ana = new Client(app)
    const anaMe = await ana.signup('Ana', 'ana@example.com')
    const sharedCostco = uuid()
    await ana.ops({ type: 'store.upsert', id: sharedCostco, name: 'Costco', color: '#059669', sortOrder: 0 })

    const ben = new Client(app)
    const benMe = await ben.signup('Ben', 'ben@example.com')
    const benCostco = uuid()
    const benBakery = uuid()
    await ben.ops(
      { type: 'store.upsert', id: benCostco, name: 'COSTCO', color: '#0284c7', sortOrder: 0 },
      { type: 'store.upsert', id: benBakery, name: 'Bread Bros', color: '#d97706', sortOrder: 1 },
      { type: 'item.add', id: uuid(), name: 'Paper towels', quantity: 2, storeId: benCostco, at: Date.now() },
      { type: 'item.add', id: uuid(), name: 'Sourdough', storeId: benBakery, at: Date.now() },
      { type: 'item.add', id: uuid(), name: 'Bananas', at: Date.now() },
    )
    const checked = uuid()
    await ben.ops(
      { type: 'item.add', id: checked, name: 'Coffee', at: Date.now() },
      { type: 'item.check', id: checked, checked: true, at: Date.now() },
    )

    const joined = await ben.json<JoinResponse>('POST', '/api/household/join', { inviteCode: anaMe.household.inviteCode })
    expect(joined.carried).toBe(3)
    expect(joined.household.id).toBe(anaMe.household.id)
    expect(joined.household.members.map((m) => m.name)).toEqual(['Ana', 'Ben'])

    const shared = await ana.sync()
    const byName = Object.fromEntries(shared.items.map((i) => [i.name, i]))
    expect(Object.keys(byName).sort()).toEqual(['Bananas', 'Paper towels', 'Sourdough'])
    expect(byName['Paper towels']).toMatchObject({ storeId: sharedCostco, quantity: 2 })
    const breadBros = shared.stores.find((s) => s.name === 'Bread Bros')!
    expect(byName.Sourdough!.storeId).toBe(breadBros.id)
    expect(byName.Bananas!.storeId).toBeNull()

    const gone = db.prepare('SELECT COUNT(*) AS n FROM households WHERE id = ?').get(benMe.household.id) as { n: number }
    expect(gone.n).toBe(0)
  })

  it('leaves the shared list behind when someone leaves', async () => {
    const { app } = setup()
    const ana = new Client(app)
    const me = await ana.signup('Ana', 'ana@example.com')
    const ben = new Client(app)
    await ben.signup('Ben', 'ben@example.com', { inviteCode: me.household.inviteCode })
    await ana.ops({ type: 'item.add', id: uuid(), name: 'Milk', at: Date.now() })

    const left = await ben.json<Me>('POST', '/api/household/leave')
    expect(left.household.id).not.toBe(me.household.id)
    expect(left.household.name).toBe("Ben's household")
    expect((await ben.sync()).items).toEqual([])
    expect((await ana.sync()).items).toHaveLength(1)
    expect((await ana.request('POST', '/api/household/leave')).status).toBe(409)
  })

  it('renames the household and rotates the invite code', async () => {
    const { app } = setup()
    const ana = new Client(app)
    const me = await ana.signup('Ana', 'ana@example.com')
    const renamed = await ana.json<Me>('PATCH', '/api/household', { name: 'Lima-Okafor home' })
    expect(renamed.household.name).toBe('Lima-Okafor home')
    const rotated = await ana.json<Me>('POST', '/api/household/invite')
    expect(rotated.household.inviteCode).not.toBe(me.household.inviteCode)
    const stale = await new Client(app).request('POST', '/api/auth/signup', {
      name: 'Ben',
      email: 'ben@example.com',
      password: 'correct horse battery',
      inviteCode: me.household.inviteCode,
    })
    expect(stale.status).toBe(404)
  })

  it('rate limits invite code guessing', async () => {
    const { app } = setup()
    const ben = new Client(app)
    await ben.signup('Ben', 'ben@example.com')
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await ben.request('POST', '/api/household/join', { inviteCode: `GUESS${i}XYZ` })).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
