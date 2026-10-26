import { randomUUID } from 'node:crypto'
import { type Category, classify } from '../../shared/categories'
import { coreKey, displayName, nameKey } from '../../shared/normalize'
import { findClosest } from '../../shared/similarity'
import type { DB } from '../db'
import type { ProductRow } from '../rows'
import type { WriteContext } from './context'

/** How a name was linked to a product. `key`, `alias` and `typo` mean the same thing; `core` means a variant of it. */
export type MatchKind = 'key' | 'alias' | 'typo' | 'core'

export interface ProductMatch {
  product: ProductRow
  via: MatchKind
}

export function getProduct(db: DB, householdId: string, id: string): ProductRow | undefined {
  return db.prepare('SELECT * FROM products WHERE household_id = ? AND id = ?').get(householdId, id) as
    | ProductRow
    | undefined
}

/**
 * Finds the product an item name refers to, from strictest to loosest:
 * same key, a learned alias, a typo-level match, then the same core words.
 */
export function findProduct(db: DB, householdId: string, name: string): ProductMatch | null {
  const key = nameKey(name)
  const exact = db
    .prepare('SELECT * FROM products WHERE household_id = ? AND name_key = ? AND deleted_at IS NULL')
    .get(householdId, key) as ProductRow | undefined
  if (exact) return { product: exact, via: 'key' }
  const alias = db
    .prepare(
      `SELECT p.* FROM product_aliases a JOIN products p ON p.id = a.product_id
       WHERE a.household_id = ? AND a.alias_key = ? AND p.deleted_at IS NULL`,
    )
    .get(householdId, key) as ProductRow | undefined
  if (alias) return { product: alias, via: 'alias' }
  const all = db
    .prepare('SELECT id, name, name_key FROM products WHERE household_id = ? AND deleted_at IS NULL')
    .all(householdId) as Pick<ProductRow, 'id' | 'name' | 'name_key'>[]
  const close = findClosest(
    key,
    all.map((p) => ({ key: p.name_key, value: p.id })),
  )
  if (close) return { product: getProduct(db, householdId, close.value)!, via: 'typo' }
  const core = coreKey(name)
  const variant = core ? all.find((p) => coreKey(p.name) === core) : undefined
  return variant ? { product: getProduct(db, householdId, variant.id)!, via: 'core' } : null
}

export function resolveProduct(
  ctx: WriteContext,
  name: string,
  categoryHint?: Category | null,
): { product: ProductRow; via: MatchKind | 'new' } {
  const found = findProduct(ctx.db, ctx.householdId, name)
  if (found) return found
  const category = categoryHint && categoryHint !== 'Other' ? categoryHint : classify(name)
  const id = randomUUID()
  ctx.db
    .prepare(
      `INSERT INTO products (id, household_id, name, name_key, category, created_at, updated_at, rev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ctx.householdId, displayName(name), nameKey(name), category, ctx.now, ctx.now, ctx.rev)
  return { product: getProduct(ctx.db, ctx.householdId, id)!, via: 'new' }
}

/** Remembers that a different spelling (a receipt line, an OCR slip) means this product. */
export function learnProductAlias(
  ctx: WriteContext,
  aliasName: string,
  productId: string,
  source: 'receipt' | 'correction',
): void {
  const key = nameKey(aliasName)
  const product = getProduct(ctx.db, ctx.householdId, productId)
  if (!key || !product || product.name_key === key) return
  ctx.db
    .prepare(
      `INSERT INTO product_aliases (household_id, alias_key, product_id, source, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (household_id, alias_key) DO UPDATE SET product_id = excluded.product_id, source = excluded.source`,
    )
    .run(ctx.householdId, key, productId, source, ctx.now)
}
