import Database from 'better-sqlite3'
import type { Op } from '../../shared/ops'
import type { OpResult } from '../../shared/types'
import type { DB } from '../db'
import { OpRejected } from '../errors'
import { type WriteContext, withWrite } from './context'
import { currentRev } from './households'
import { addItem, checkItem, clearChecked, deleteItem, setItemStore, updateItem } from './items'
import { deleteStore, upsertStore } from './stores'

export function applyOp(ctx: WriteContext, op: Op): void {
  switch (op.type) {
    case 'item.add':
      addItem(ctx, op)
      return
    case 'item.update':
      updateItem(ctx, op)
      return
    case 'item.setStore':
      setItemStore(ctx, op.id, op.storeId)
      return
    case 'item.check':
      checkItem(ctx, op.id, op.checked, op.at)
      return
    case 'item.delete':
      deleteItem(ctx, op.id)
      return
    case 'items.clearChecked':
      clearChecked(ctx, op.storeId)
      return
    case 'store.upsert':
      upsertStore(ctx, op)
      return
    case 'store.delete':
      deleteStore(ctx, op.id)
      return
  }
}

function rejection(error: unknown): string | null {
  if (error instanceof OpRejected) return error.message
  if (error instanceof Database.SqliteError && error.code.startsWith('SQLITE_CONSTRAINT')) {
    console.warn('Operation violated a constraint', error.message)
    return 'This change conflicts with the current list'
  }
  return null
}

/**
 * Applies a batch from one device in a single transaction with one new rev. Each operation
 * runs in its own savepoint, so one that cannot apply is reported and skipped without undoing
 * the rest. Operation IDs already seen are acknowledged as duplicates, which makes resending
 * an outbox after a lost response harmless.
 */
export function applyOps(
  db: DB,
  householdId: string,
  userId: string,
  ops: Op[],
  now: number,
): { rev: number; results: OpResult[]; applied: number } {
  const seen = db.prepare('SELECT 1 FROM applied_ops WHERE household_id = ? AND op_id = ?')
  const isNew = (op: Op, batch: Set<string>) => !batch.has(op.opId) && !seen.get(householdId, op.opId)
  const preview = new Set<string>()
  if (!ops.some((op) => isNew(op, preview))) {
    return {
      rev: currentRev(db, householdId),
      results: ops.map((op) => ({ opId: op.opId, status: 'duplicate' })),
      applied: 0,
    }
  }

  const record = db.prepare('INSERT INTO applied_ops (household_id, op_id, applied_at) VALUES (?, ?, ?)')
  const runOne = db.transaction((ctx: WriteContext, op: Op) => applyOp(ctx, op))
  let applied = 0
  const { rev, value: results } = withWrite(db, householdId, userId, now, (ctx) => {
    const batch = new Set<string>()
    return ops.map((op): OpResult => {
      if (!isNew(op, batch)) return { opId: op.opId, status: 'duplicate' }
      batch.add(op.opId)
      let result: OpResult
      try {
        runOne(ctx, op)
        applied++
        result = { opId: op.opId, status: 'ok' }
      } catch (error) {
        const message = rejection(error)
        if (message === null) throw error
        result = { opId: op.opId, status: 'rejected', error: message }
      }
      record.run(householdId, op.opId, now)
      return result
    })
  })
  return { rev, results, applied }
}
