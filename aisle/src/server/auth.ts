import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { DB } from './db'
import type { UserRow } from './rows'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }
const DAY = 86_400_000
export const SESSION_TTL_MS = 60 * DAY
export const SESSION_COOKIE = 'aisle_session'

function scryptAsync(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, { ...options, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(db: DB, userId: string, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    now,
    now + SESSION_TTL_MS,
  )
  return token
}

export interface SessionLookup {
  user: UserRow
  expiresAt: number
  /** True when the expiry was just extended, so the cookie should be re-issued. */
  renewed: boolean
}

/** Finds the session's user, sliding the expiry forward once half of it has passed. */
export function lookupSession(db: DB, token: string, now = Date.now()): SessionLookup | null {
  const hash = sha256(token)
  const row = db
    .prepare('SELECT u.*, s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(hash) as (UserRow & { session_expires_at: number }) | undefined
  if (!row) return null
  const { session_expires_at: expiresAt, ...user } = row
  if (expiresAt < now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash)
    return null
  }
  if (expiresAt - now < SESSION_TTL_MS / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + SESSION_TTL_MS, hash)
    return { user, expiresAt: now + SESSION_TTL_MS, renewed: true }
  }
  return { user, expiresAt, renewed: false }
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
}

export function deleteOtherSessions(db: DB, userId: string, keepToken: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(keepToken))
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt and reports whether it is within the limit. */
  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size > 10_000) this.hits.clear()
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    entry.count++
    return entry.count <= this.limit
  }

  reset(key: string): void {
    this.hits.delete(key)
  }
}
