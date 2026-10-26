import type { SyncResponse } from '../../shared/types'
import type { DB } from '../db'
import { type CaptureRow, type ItemRow, type ProductRow, type StoreRow, toCapture, toItem, toProduct, toStore } from '../rows'
import { currentRev } from './households'

const SNAPSHOT_CAPTURES = 100

/**
 * Everything that changed after `since`, deletions included. A client with no rev, or one
 * ahead of the server (a restored database, another household), gets a full snapshot instead.
 */
export function pull(db: DB, householdId: string, since: number): SyncResponse {
  const rev = currentRev(db, householdId)
  const full = since <= 0 || since > rev
  const after = full ? 0 : since
  const live = full ? 'AND deleted_at IS NULL' : ''
  const rows = <T>(table: string, order: string, limit = -1) =>
    db
      .prepare(`SELECT * FROM ${table} WHERE household_id = ? AND rev > ? ${live} ORDER BY ${order} LIMIT ?`)
      .all(householdId, after, limit) as T[]
  return {
    householdId,
    rev,
    full,
    stores: rows<StoreRow>('stores', 'sort_order, name').map(toStore),
    products: rows<ProductRow>('products', 'name').map(toProduct),
    items: rows<ItemRow>('list_items', 'created_at').map(toItem),
    captures: rows<CaptureRow>('captures', 'created_at DESC', full ? SNAPSHOT_CAPTURES : -1).map(toCapture),
  }
}
