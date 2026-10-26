import { Hono } from 'hono'
import type { DB } from './db'
import type { Config } from './env'

export interface AppDeps {
  db: DB
  config: Config
}

export function createApp({ db }: AppDeps) {
  const app = new Hono()

  app.get('/api/health', (c) => {
    db.prepare('SELECT 1').get()
    return c.json({ ok: true })
  })

  return app
}
