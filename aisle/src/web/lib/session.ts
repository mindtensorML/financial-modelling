import { del, get, set } from 'idb-keyval'
import type { Me, ServerConfig } from '../../shared/types'
import { api, OfflineError, setUnauthorizedHandler } from './api'
import { resetInsights } from './insights'
import { observable, useObservable } from './observable'
import { sync } from './sync'
import { uploads } from './uploads'

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; me: Me; offline: boolean }

const ME_KEY = 'aisle-me'
const CONFIG_KEY = 'aisle-config'

function cachedConfig(): ServerConfig | null {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as ServerConfig | null
  } catch {
    return null
  }
}

export const session = observable<Session>({ status: 'loading' })
export const serverConfig = observable<ServerConfig | null>(cachedConfig())

export const useSession = () => useObservable(session)
export const useServerConfig = () => useObservable(serverConfig)

/** The signed-in user; only for screens rendered after sign-in. */
export function useMe(): Me {
  const current = useSession()
  if (current.status !== 'signedIn') throw new Error('Not signed in')
  return current.me
}

async function loadConfig(): Promise<void> {
  try {
    const config = await api<ServerConfig>('GET', '/api/config')
    serverConfig.set(config)
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    // The cached copy will do until the server is reachable.
  }
}

async function enter(me: Me, offline = false): Promise<void> {
  const previous = session.get()
  session.set({ status: 'signedIn', me, offline })
  void set(ME_KEY, me).catch(() => undefined)
  const restart =
    previous.status !== 'signedIn' || previous.me.household.id !== me.household.id || previous.me.user.id !== me.user.id
  if (restart) {
    resetInsights()
    await sync.start(me)
  }
  void uploads.process()
}

export async function boot(): Promise<void> {
  // An expired session shows the sign-in screen but keeps this device's unsent changes:
  // signing in again as the same person sends them.
  setUnauthorizedHandler(() => {
    sync.stop()
    session.set({ status: 'signedOut' })
  })
  void loadConfig()
  try {
    await enter(await api<Me>('GET', '/api/me'))
  } catch (error) {
    const cached = error instanceof OfflineError ? await get<Me>(ME_KEY).catch(() => undefined) : undefined
    if (cached) {
      await enter(cached, true)
      window.addEventListener('online', () => void refreshMe(), { once: true })
    } else if (session.get().status === 'loading') {
      session.set({ status: 'signedOut' })
    }
  }
}

export async function refreshMe(): Promise<Me | null> {
  try {
    const me = await api<Me>('GET', '/api/me')
    await enter(me)
    return me
  } catch {
    return null
  }
}

/** For responses that already carry the new account state (renames, joins). */
export function updateMe(me: Me): Promise<void> {
  return enter(me)
}

export async function signIn(email: string, password: string): Promise<void> {
  await enter(await api<Me>('POST', '/api/auth/login', { email, password }))
}

export async function signUp(input: {
  name: string
  email: string
  password: string
  inviteCode?: string
  householdName?: string
}): Promise<void> {
  await enter(await api<Me>('POST', '/api/auth/signup', input))
}

export async function signOut(): Promise<void> {
  await api('POST', '/api/auth/logout').catch(() => undefined)
  await Promise.all([sync.clear(), uploads.clear(), del(ME_KEY).catch(() => undefined)])
  resetInsights()
  session.set({ status: 'signedOut' })
}
