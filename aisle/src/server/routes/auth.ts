import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { Hono } from 'hono'
import { z } from 'zod'
import { createSession, deleteSession, hashPassword, SESSION_TTL_MS, verifyPassword } from '../auth'
import { HttpError } from '../errors'
import {
  type AppContext,
  type AppEnv,
  clearSessionCookie,
  clientIp,
  readJson,
  type ServerContext,
  setSessionCookie,
} from '../http'
import type { UserRow } from '../rows'
import { createHousehold, defaultHouseholdName, getMe, householdByInvite } from '../services/households'

export const emailSchema = z.string().trim().toLowerCase().max(200).pipe(z.email('Enter a valid email address'))
export const passwordSchema = z.string().min(8, 'Use at least 8 characters for your password').max(200)
export const personNameSchema = z.string().trim().min(1, 'Enter your name').max(60)

const signupSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  householdName: z.string().trim().min(1).max(60).optional(),
  inviteCode: z.string().trim().max(40).optional(),
})

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(200) })

export function authRoutes(server: ServerContext) {
  const { db, config, limits } = server
  const app = new Hono<AppEnv>()
  // Comparing against a throwaway hash when the email is unknown keeps response times from
  // revealing which emails have accounts.
  let decoyHash: Promise<string> | null = null

  function startSession(c: AppContext, user: UserRow): void {
    const now = server.now()
    setSessionCookie(c, config, createSession(db, user.id, now), now + SESSION_TTL_MS, now)
  }

  app.post('/signup', async (c) => {
    if (!limits.signup.allow(clientIp(c, config.trustProxy), server.now())) {
      throw new HttpError(429, 'Too many sign-ups from this network. Try again later.')
    }
    const body = await readJson(c, signupSchema)
    const invite = body.inviteCode ? householdByInvite(db, body.inviteCode) : undefined
    if (body.inviteCode && !invite) throw new HttpError(404, 'No household has that invite code')
    if (config.signupMode === 'invite' && !invite) {
      throw new HttpError(403, 'Sign-up here needs an invite code from someone who already uses Aisle')
    }
    const taken = () => new HttpError(409, 'An account with that email already exists')
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) throw taken()
    const passwordHash = await hashPassword(body.password)
    const now = server.now()
    let user: UserRow
    try {
      user = db.transaction(() => {
        const householdId = invite?.id ?? createHousehold(db, body.householdName ?? defaultHouseholdName(body.name), now)
        const id = randomUUID()
        db.prepare(
          'INSERT INTO users (id, email, name, password_hash, household_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, body.email, body.name, passwordHash, householdId, now)
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow
      })()
    } catch (error) {
      if (error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw taken()
      throw error
    }
    startSession(c, user)
    return c.json(getMe(db, user), 201)
  })

  app.post('/login', async (c) => {
    const body = await readJson(c, loginSchema)
    const now = server.now()
    const key = `${clientIp(c, config.trustProxy)}|${body.email}`
    if (!limits.login.allow(key, now) || !limits.loginAccount.allow(body.email, now)) {
      throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.')
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) as UserRow | undefined
    const valid = user
      ? await verifyPassword(body.password, user.password_hash)
      : await verifyPassword(body.password, await (decoyHash ??= hashPassword(randomUUID()))).then(() => false)
    if (!user || !valid) throw new HttpError(401, 'That email and password do not match an account')
    limits.login.reset(key)
    startSession(c, user)
    return c.json(getMe(db, user))
  })

  app.post('/logout', (c) => {
    const token = c.get('sessionToken')
    if (token) deleteSession(db, token)
    clearSessionCookie(c, config)
    return c.body(null, 204)
  })

  return app
}
