import { randomBytes, randomUUID } from 'node:crypto'
import type { Me } from '../../shared/types'
import type { DB } from '../db'
import { HttpError } from '../errors'
import type { UserRow } from '../rows'

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newInviteCode(): string {
  const bytes = randomBytes(8)
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('')
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function defaultHouseholdName(userName: string): string {
  return `${userName.trim().split(/\s+/)[0]}'s household`
}

export function createHousehold(db: DB, name: string, now = Date.now()): string {
  const id = randomUUID()
  db.prepare('INSERT INTO households (id, name, invite_code, rev, created_at) VALUES (?, ?, ?, 0, ?)').run(
    id,
    name,
    newInviteCode(),
    now,
  )
  return id
}

export function householdByInvite(db: DB, inviteCode: string): { id: string } | undefined {
  return db.prepare('SELECT id FROM households WHERE invite_code = ?').get(normalizeInviteCode(inviteCode)) as
    | { id: string }
    | undefined
}

export function bumpRev(db: DB, householdId: string): number {
  const row = db.prepare('UPDATE households SET rev = rev + 1 WHERE id = ? RETURNING rev').get(householdId) as
    | { rev: number }
    | undefined
  if (!row) throw new HttpError(404, 'Household not found')
  return row.rev
}

export function currentRev(db: DB, householdId: string): number {
  const row = db.prepare('SELECT rev FROM households WHERE id = ?').get(householdId) as { rev: number } | undefined
  return row?.rev ?? 0
}

export function memberCount(db: DB, householdId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users WHERE household_id = ?').get(householdId) as { n: number }).n
}

export function getMe(db: DB, user: Pick<UserRow, 'id' | 'name' | 'email' | 'household_id'>): Me {
  const household = db.prepare('SELECT id, name, invite_code FROM households WHERE id = ?').get(user.household_id) as {
    id: string
    name: string
    invite_code: string
  }
  const members = db
    .prepare('SELECT id, name, email FROM users WHERE household_id = ? ORDER BY created_at')
    .all(user.household_id) as Me['household']['members']
  return {
    user: { id: user.id, name: user.name, email: user.email },
    household: { id: household.id, name: household.name, inviteCode: household.invite_code, members },
  }
}

export function rotateInvite(db: DB, householdId: string): void {
  db.prepare('UPDATE households SET invite_code = ? WHERE id = ?').run(newInviteCode(), householdId)
}

export function renameHousehold(db: DB, householdId: string, name: string): void {
  db.prepare('UPDATE households SET name = ? WHERE id = ?').run(name, householdId)
}
