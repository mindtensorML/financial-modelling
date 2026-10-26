import type { IncomingMessage } from 'node:http'
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { z } from 'zod'
import { type RateLimiter, SESSION_COOKIE } from './auth'
import type { DB } from './db'
import type { Config } from './env'
import { HttpError } from './errors'
import type { RealtimeHub } from './realtime'
import type { UserRow } from './rows'

export interface ServerContext {
  db: DB
  config: Config
  hub: RealtimeHub
  now: () => number
  limits: { login: RateLimiter; loginAccount: RateLimiter; signup: RateLimiter; join: RateLimiter }
}

export interface AppEnv {
  Variables: { user: UserRow | null; sessionToken: string | null }
}

export type AppContext = Context<AppEnv>

export async function readJson<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HttpError(400, 'Expected a JSON body')
  }
  return schema.parse(body)
}

export function requireUser(c: AppContext): UserRow {
  const user = c.get('user')
  if (!user) throw new HttpError(401, 'Please sign in')
  return user
}

export function clientIp(c: AppContext, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]
    if (forwarded?.trim()) return forwarded.trim()
  }
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming
  return incoming?.socket?.remoteAddress ?? 'local'
}

export function setSessionCookie(c: AppContext, config: Config, token: string, expiresAt: number, now: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: Math.max(0, Math.floor((expiresAt - now) / 1000)),
  })
}

export function clearSessionCookie(c: AppContext, config: Config): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.cookieSecure })
}
