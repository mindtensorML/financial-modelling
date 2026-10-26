import { Hono } from 'hono'
import { type AppEnv, requireUser, type ServerContext } from '../http'
import { buildInsights } from '../learning/insights'

export function insightsRoutes(server: ServerContext) {
  const app = new Hono<AppEnv>()

  app.get('/insights', (c) => {
    const user = requireUser(c)
    return c.json(buildInsights(server.db, user.household_id, server.now()))
  })

  return app
}
