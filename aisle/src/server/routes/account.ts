import { Hono } from 'hono'
import { z } from 'zod'
import type { JoinResponse } from '../../shared/types'
import { deleteOtherSessions, hashPassword, verifyPassword } from '../auth'
import { HttpError } from '../errors'
import { type AppEnv, readJson, requireUser, type ServerContext } from '../http'
import type { UserRow } from '../rows'
import { getMe, renameHousehold, rotateInvite } from '../services/households'
import { joinWithInvite, leaveHousehold } from '../services/membership'
import { passwordSchema, personNameSchema } from './auth'

export function accountRoutes(server: ServerContext) {
  const { db, hub, limits } = server
  const app = new Hono<AppEnv>()
  const reload = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow

  app.get('/me', (c) => c.json(getMe(db, requireUser(c))))

  app.patch('/me', async (c) => {
    const user = requireUser(c)
    const { name } = await readJson(c, z.object({ name: personNameSchema }))
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id)
    return c.json(getMe(db, reload(user.id)))
  })

  app.post('/me/password', async (c) => {
    const user = requireUser(c)
    const body = await readJson(
      c,
      z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }),
    )
    if (!limits.login.allow(`password|${user.id}`, server.now())) {
      throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.')
    }
    if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
      throw new HttpError(403, 'Your current password is not right')
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.newPassword), user.id)
    deleteOtherSessions(db, user.id, c.get('sessionToken')!)
    return c.body(null, 204)
  })

  app.patch('/household', async (c) => {
    const user = requireUser(c)
    const { name } = await readJson(c, z.object({ name: z.string().trim().min(1).max(60) }))
    renameHousehold(db, user.household_id, name)
    return c.json(getMe(db, user))
  })

  app.post('/household/invite', (c) => {
    const user = requireUser(c)
    rotateInvite(db, user.household_id)
    return c.json(getMe(db, user))
  })

  app.post('/household/join', async (c) => {
    const user = requireUser(c)
    if (!limits.join.allow(user.id, server.now())) {
      throw new HttpError(429, 'Too many invite codes tried. Wait a few minutes and try again.')
    }
    const { inviteCode } = await readJson(c, z.object({ inviteCode: z.string().trim().min(4).max(40) }))
    const change = joinWithInvite(db, user, inviteCode, server.now())
    if (change.rev !== null) hub.publish(change.householdId, change.rev)
    return c.json({ ...getMe(db, reload(user.id)), carried: change.carried } satisfies JoinResponse)
  })

  app.post('/household/leave', (c) => {
    const user = requireUser(c)
    leaveHousehold(db, user, server.now())
    return c.json(getMe(db, reload(user.id)))
  })

  return app
}
