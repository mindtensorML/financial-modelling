import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { opsRequestSchema } from '../../shared/ops'
import type { OpsResponse } from '../../shared/types'
import { type AppEnv, readJson, requireUser, type ServerContext } from '../http'
import { currentRev } from '../services/households'
import { applyOps } from '../services/ops'
import { pull } from '../services/sync'

export function syncRoutes(server: ServerContext, heartbeatMs: number) {
  const { db, hub } = server
  const app = new Hono<AppEnv>()

  app.get('/sync', (c) => {
    const user = requireUser(c)
    const since = Number(c.req.query('since') ?? 0)
    return c.json(pull(db, user.household_id, Number.isFinite(since) ? Math.max(0, Math.floor(since)) : 0))
  })

  app.post('/ops', async (c) => {
    const user = requireUser(c)
    const { ops } = await readJson(c, opsRequestSchema)
    const { rev, results, applied } = applyOps(db, user.household_id, user.id, ops, server.now())
    if (applied) hub.publish(user.household_id, rev)
    return c.json({ rev, results } satisfies OpsResponse)
  })

  // Devices hold this open and pull as soon as the household's rev moves past theirs.
  app.get('/events', (c) => {
    const user = requireUser(c)
    c.header('X-Accel-Buffering', 'no')
    return streamSSE(c, async (stream) => {
      const householdId = user.household_id
      const send = (rev: number) => stream.writeSSE({ event: 'rev', data: JSON.stringify({ rev }) })
      const unsubscribe = hub.subscribe(householdId, (rev) => void send(rev))
      stream.onAbort(unsubscribe)
      await stream.writeSSE({ event: 'rev', data: JSON.stringify({ rev: currentRev(db, householdId) }), retry: 5000 })
      // Comments would be enough to keep proxies from timing the connection out, but a named
      // event also lets the client notice a silently dead connection.
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(heartbeatMs)
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '' })
      }
      unsubscribe()
    })
  })

  return app
}
