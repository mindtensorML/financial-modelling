import { foldText } from '../../shared/normalize'
import { parseListText } from '../../shared/parseList'
import type { Product } from '../../shared/types'

export interface QuickAddItem {
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
  storeHint: string | null
}

/**
 * Reads the quick-add box: everything the list parser understands ("2 avocados, oat milk",
 * "Costco: paper towels"), plus a trailing "@store" that files every item there. Dictated text
 * sets `splitRuns`, because speech has no commas between items.
 */
export function parseQuickAdd(
  text: string,
  knownStores: string[] = [],
  knownProducts: string[] = [],
  options: { splitRuns?: boolean; people?: string[] } = {},
): QuickAddItem[] {
  let body = text
  let hint: string | null = null
  const at = /(?:^|\s)@\s*([^@,;\n]{2,40}?)\s*$/.exec(text)
  if (at) {
    hint = at[1]!.trim()
    body = text.slice(0, at.index)
  }
  return parseListText(body, { knownStores, knownProducts, people: options.people, splitRuns: options.splitRuns }).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    note: item.note,
    storeHint: hint ?? item.storeHint,
  }))
}

/** The part of the box being typed now, for autocomplete: after the last comma or newline. */
export function currentSegment(text: string): { start: number; query: string } {
  const start = Math.max(text.lastIndexOf(','), text.lastIndexOf('\n'), text.lastIndexOf(';')) + 1
  const query = text.slice(start).replace(/\s@.*$/, '')
  return { start: start + (query.length - query.trimStart().length), query: query.trim() }
}

const AMOUNT =
  /^(?:\d+\/\d+|\d+(?:[.,]\d+)?|an|a|one|two|three|four|five|six)\s*(?:x\s+)?(?:(?:lbs?|oz|kg|g|l|ml|gal|dozen|packs?|bags?|box(?:es)?|cans?|bottles?|bunch(?:es)?|jars?)\.?\s+(?:of\s+)?)?/i

/** "2 lb ban" is an amount ("2 lb ") followed by what to look up ("ban"). */
export function splitAmount(segment: string): { amount: string; rest: string } {
  const m = AMOUNT.exec(segment)
  if (!m || m[0].length === segment.length || !/\s$/.test(m[0])) return { amount: '', rest: segment }
  return { amount: m[0], rest: segment.slice(m[0].length) }
}

export interface Suggestion {
  product: Product
  onList: boolean
}

/**
 * Products the household has had before that match what is being typed: names starting with it
 * first, then a word starting with it, then anywhere. Things bought often come first, and items
 * already on the list sink to the end.
 */
export function suggestProducts(
  query: string,
  products: Iterable<Product>,
  openProductIds: ReadonlySet<string>,
  limit = 5,
): Suggestion[] {
  const q = foldText(splitAmount(query).rest).trim()
  if (!q) return []
  const scored: Array<{ suggestion: Suggestion; score: number }> = []
  for (const product of products) {
    if (product.deletedAt) continue
    const name = foldText(product.name)
    if (name === q) continue
    const score = name.startsWith(q) ? 0 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1
    if (score < 0) continue
    const onList = openProductIds.has(product.id)
    scored.push({ suggestion: { product, onList }, score: score + (onList ? 10 : 0) })
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.suggestion.product.purchaseCount - a.suggestion.product.purchaseCount ||
        a.suggestion.product.name.localeCompare(b.suggestion.product.name),
    )
    .slice(0, limit)
    .map((s) => s.suggestion)
}

/** Replaces the segment being typed with a suggestion, keeping its amount and any "@store". */
export function applySuggestion(text: string, name: string): string {
  const { start } = currentSegment(text)
  const segment = text.slice(start)
  const at = /\s@.*$/.exec(segment)
  const body = at ? segment.slice(0, at.index) : segment
  return text.slice(0, start) + splitAmount(body.trim()).amount + name + (at ? at[0] : '')
}
