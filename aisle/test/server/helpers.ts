import { randomUUID } from 'node:crypto'
import { createApp } from '../../src/server/app'
import { openDatabase } from '../../src/server/db'
import { loadConfig } from '../../src/server/env'
import { RealtimeHub } from '../../src/server/realtime'
import type { Op } from '../../src/shared/ops'
import type { Me, OpsResponse, SyncResponse } from '../../src/shared/types'

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

type App = ReturnType<typeof createApp>

export function setup(options: { env?: NodeJS.ProcessEnv; start?: number } = {}) {
  const db = openDatabase(':memory:')
  let now = options.start ?? Date.UTC(2026, 0, 5, 15)
  const clock = {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
  const hub = new RealtimeHub()
  const app = createApp({ db, config: loadConfig(options.env ?? {}), hub, now: clock.now, heartbeatMs: 50 })
  return { db, app, hub, clock }
}

type OpInput = Op extends infer T ? (T extends Op ? Omit<T, 'opId'> & { opId?: string } : never) : never

/** Talks to the app like a browser would: keeps the session cookie and sends the CSRF header. */
export class Client {
  cookie = ''

  constructor(private readonly app: App) {}

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const all: Record<string, string> = { 'X-Aisle': '1', ...headers }
    if (this.cookie) all.cookie = this.cookie
    if (body !== undefined) all['content-type'] = 'application/json'
    const res = await this.app.request(path, {
      method,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const pair = setCookie.split(';')[0]!
      this.cookie = pair.endsWith('=') ? '' : pair
    }
    return res
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, body)
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${await res.text()}`)
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  signup(name: string, email: string, extra: Record<string, string> = {}): Promise<Me> {
    return this.json<Me>('POST', '/api/auth/signup', { name, email, password: 'correct horse battery', ...extra })
  }

  ops(...ops: OpInput[]): Promise<OpsResponse> {
    return this.json<OpsResponse>('POST', '/api/ops', {
      ops: ops.map((op) => ({ opId: randomUUID(), ...op })),
    })
  }

  sync(since = 0): Promise<SyncResponse> {
    return this.json<SyncResponse>('GET', `/api/sync?since=${since}`)
  }
}

export const uuid = () => randomUUID()
