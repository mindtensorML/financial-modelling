import { randomUUID } from 'node:crypto'
import type { DB } from '../db'
import { HttpError } from '../errors'
import type { UserRow } from '../rows'
import { withWrite } from './context'
import { createHousehold, defaultHouseholdName, householdByInvite, memberCount } from './households'
import { addItem } from './items'

export interface MembershipChange {
  householdId: string
  /** The new rev of the household that received carried-over items, if any were carried. */
  rev: number | null
  carried: number
  /** The household that was deleted because its last member left; its uploads must be removed too. */
  deletedHouseholdId: string | null
}

interface CarriedItem {
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
  created_at: number
  store_name: string | null
}

/**
 * Moves a user into the household that owns the invite code. A household left with no members
 * is deleted, but its open items are added to the shared list first (filed by store name), so
 * someone who started a list before being invited does not lose it.
 */
export function joinWithInvite(db: DB, user: UserRow, inviteCode: string, now: number): MembershipChange {
  const target = householdByInvite(db, inviteCode)
  if (!target) throw new HttpError(404, 'No household has that invite code')
  if (target.id === user.household_id) return { householdId: target.id, rev: null, carried: 0, deletedHouseholdId: null }
  return db.transaction((): MembershipChange => {
    const previous = user.household_id
    const lastMember = memberCount(db, previous) === 1
    const carry = lastMember
      ? (db
          .prepare(
            `SELECT i.name, i.quantity, i.unit, i.note, i.created_at, s.name AS store_name
             FROM list_items i LEFT JOIN stores s ON s.id = i.store_id AND s.deleted_at IS NULL
             WHERE i.household_id = ? AND i.deleted_at IS NULL AND i.checked_at IS NULL
             ORDER BY i.created_at, i.rowid`,
          )
          .all(previous) as CarriedItem[])
      : []
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(target.id, user.id)
    if (lastMember) db.prepare('DELETE FROM households WHERE id = ?').run(previous)
    const deletedHouseholdId = lastMember ? previous : null
    if (!carry.length) return { householdId: target.id, rev: null, carried: 0, deletedHouseholdId }
    const { rev } = withWrite(db, target.id, user.id, now, (ctx) => {
      for (const item of carry) {
        addItem(ctx, {
          id: randomUUID(),
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          note: item.note,
          storeHint: item.store_name,
          at: item.created_at,
        })
      }
    })
    return { householdId: target.id, rev, carried: carry.length, deletedHouseholdId }
  })()
}

/** Leaves for a new household of one; the shared list stays with the people still in it. */
export function leaveHousehold(db: DB, user: UserRow, now: number): MembershipChange {
  if (memberCount(db, user.household_id) <= 1) throw new HttpError(409, 'You are the only member of this household')
  return db.transaction((): MembershipChange => {
    const householdId = createHousehold(db, defaultHouseholdName(user.name), now)
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, user.id)
    return { householdId, rev: null, carried: 0, deletedHouseholdId: null }
  })()
}
