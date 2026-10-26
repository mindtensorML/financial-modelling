import { type Category, defaultCategoryRank } from '../../shared/categories'
import type { ListItem, Store, WalkOrder } from '../../shared/types'

export interface CategoryGroup {
  category: Category
  items: ListItem[]
}

export interface Section {
  /** The store's id, or "unsorted". */
  key: string
  store: Store | null
  groups: CategoryGroup[]
  openCount: number
  checked: ListItem[]
}

export const UNSORTED = 'unsorted'

/**
 * Files items under their stores and orders each store the way you walk it: categories by
 * where in your trips you usually reach them there, then products by where you pick them up.
 * Without history, categories follow a typical store layout (produce first).
 */
export function buildSections(items: ListItem[], stores: Store[], walk: Record<string, WalkOrder> = {}): Section[] {
  const known = new Set(stores.map((s) => s.id))
  const byStore = new Map<string, ListItem[]>()
  for (const item of items) {
    const key = item.storeId && known.has(item.storeId) ? item.storeId : UNSORTED
    const list = byStore.get(key)
    if (list) list.push(item)
    else byStore.set(key, [item])
  }
  const sections: Section[] = []
  const unsorted = byStore.get(UNSORTED)
  if (unsorted) sections.push(section(UNSORTED, null, unsorted, undefined))
  for (const store of stores) {
    const list = byStore.get(store.id)
    if (list) sections.push(section(store.id, store, list, walk[store.id]))
  }
  return sections
}

function section(key: string, store: Store | null, items: ListItem[], walk: WalkOrder | undefined): Section {
  const rank = (category: Category) => walk?.categories[category] ?? defaultCategoryRank(category)
  const position = (item: ListItem) => (item.productId ? walk?.products[item.productId] : undefined) ?? 2
  const open = items
    .filter((i) => i.checkedAt === null)
    .sort(
      (a, b) =>
        rank(a.category) - rank(b.category) ||
        a.category.localeCompare(b.category) ||
        position(a) - position(b) ||
        a.name.localeCompare(b.name),
    )
  const groups: CategoryGroup[] = []
  for (const item of open) {
    const last = groups.at(-1)
    if (last?.category === item.category) last.items.push(item)
    else groups.push({ category: item.category, items: [item] })
  }
  const checked = items.filter((i) => i.checkedAt !== null).sort((a, b) => b.checkedAt! - a.checkedAt!)
  return { key, store, groups, openCount: open.length, checked }
}
