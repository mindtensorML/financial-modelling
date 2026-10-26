import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app'
import { openDatabase } from '../../src/server/db'
import { loadConfig } from '../../src/server/env'

describe('server scaffold', () => {
  it('migrates a fresh database and answers the health check', async () => {
    const db = openDatabase(':memory:')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['households', 'users', 'stores', 'products', 'list_items', 'captures', 'purchases']),
    )
    const app = createApp({ db, config: loadConfig({}) })
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
