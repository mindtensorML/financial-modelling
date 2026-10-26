import type { DB } from './db'

const DAY = 86_400_000
/** Clients resend unconfirmed operations; remembering IDs for a month covers any realistic outage. */
const APPLIED_OPS_RETENTION = 30 * DAY

export function runMaintenance(db: DB, now = Date.now()): { ops: number; sessions: number } {
  const ops = db.prepare('DELETE FROM applied_ops WHERE applied_at < ?').run(now - APPLIED_OPS_RETENTION).changes
  const sessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes
  return { ops, sessions }
}
