import { join } from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { ZodError } from 'zod'
import type { ServerConfig } from '../shared/types'
import { lookupSession, RateLimiter, SESSION_COOKIE } from './auth'
import type { DB } from './db'
import type { Config } from './env'
import { HttpError } from './errors'
import { type AppEnv, type ServerContext, setSessionCookie } from './http'
import { BlobStore } from './ingest/blobs'
import { createEngines } from './ingest/pipeline'
import { CaptureQueue } from './ingest/queue'
import { RealtimeHub } from './realtime'
import { accountRoutes } from './routes/account'
import { authRoutes } from './routes/auth'
import { captureRoutes } from './routes/captures'
import { insightsRoutes } from './routes/insights'
import { syncRoutes } from './routes/sync'

export interface AppDeps {
  db: DB
  config: Config
  hub?: RealtimeHub
  now?: () => number
  heartbeatMs?: number
  /** Where uploads are kept; defaults to `<dataDir>/uploads`. */
  blobs?: BlobStore
  /** Must share `hub`, `blobs`, and `now` with the app; defaults to one using the engines in `config`. */
  queue?: CaptureQueue
}

const MINUTE = 60_000
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const JSON_LIMIT = 1024 * 1024

export function createApp(deps: AppDeps) {
  const { db, config } = deps
  const hub = deps.hub ?? new RealtimeHub()
  const now = deps.now ?? Date.now
  const blobs = deps.blobs ?? new BlobStore(join(config.dataDir, 'uploads'))
  const server: ServerContext = {
    db,
    config,
    hub,
    blobs,
    queue: deps.queue ?? new CaptureQueue({ db, blobs, hub, now, engines: createEngines(config) }),
    now,
    limits: {
      login: new RateLimiter(10, 15 * MINUTE),
      loginAccount: new RateLimiter(30, 15 * MINUTE),
      signup: new RateLimiter(20, 60 * MINUTE),
      join: new RateLimiter(10, 15 * MINUTE),
      captures: new RateLimiter(120, 60 * MINUTE),
    },
  }
  const app = new Hono<AppEnv>()

  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: config.cookieSecure ? 'max-age=15552000' : false,
      referrerPolicy: 'same-origin',
    }),
  )

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    // A cross-site form or image tag cannot set custom headers, so requiring one on every
    // state-changing request rules out cross-site request forgery.
    if (!SAFE_METHODS.has(c.req.method) && c.req.header('x-aisle') !== '1') {
      throw new HttpError(403, 'Missing the X-Aisle request header')
    }
    const token = getCookie(c, SESSION_COOKIE) ?? null
    const session = token ? lookupSession(db, token, server.now()) : null
    c.set('user', session?.user ?? null)
    c.set('sessionToken', session ? token : null)
    if (token && session?.renewed) setSessionCookie(c, config, token, session.expiresAt, server.now())
    await next()
  })

  const jsonLimit = bodyLimit({
    maxSize: JSON_LIMIT,
    onError: (c) => c.json({ error: 'That request is too large' }, 413),
  })
  // Uploads have their own, larger limit on the capture route.
  app.use('/api/*', (c, next) => (c.req.method === 'POST' && c.req.path === '/api/captures' ? next() : jsonLimit(c, next)))

  app.get('/api/health', (c) => {
    db.prepare('SELECT 1').get()
    return c.json({ ok: true })
  })

  app.get('/api/config', (c) =>
    c.json({
      features: {
        ai: config.ai !== null,
        aiModel: config.ai?.model ?? null,
        transcription: Boolean(config.ai?.transcribeModel),
        ocr: config.ocrEnabled,
      },
      signupMode: config.signupMode,
    } satisfies ServerConfig),
  )

  app.route('/api/auth', authRoutes(server))
  app.route('/api', accountRoutes(server))
  app.route('/api', syncRoutes(server, deps.heartbeatMs ?? 25_000))
  app.route('/api', insightsRoutes(server))
  app.route('/api', captureRoutes(server))

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status)
    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
        .join('; ')
      return c.json({ error: message }, 400)
    }
    console.error(error)
    return c.json({ error: 'Something went wrong on the server' }, 500)
  })

  return app
}
