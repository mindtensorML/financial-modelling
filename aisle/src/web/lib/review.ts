import type { Category } from '../../shared/categories'
import type { Capture, Extraction } from '../../shared/types'
import { fromDateTimeInput, toDateTimeInput } from './format'

export type ReviewMode = 'list' | 'receipt'

/** A store choice in the review form: a store id, `new:<name>` for one to create, or "" for none. */
export type StoreChoice = string

export const NEW_STORE = 'new:'

export interface ReviewLine {
  key: string
  include: boolean
  name: string
  /** What the engine called it; null for lines the user added. Renaming drops its category. */
  originalName: string | null
  rawText: string | null
  quantity: string
  unit: string
  price: string
  note: string | null
  category: Category | null
  store: StoreChoice
  /** Where the server would file it if left alone. */
  defaultStore: StoreChoice
  storeHint: string | null
  reason: string | null
  onList: boolean
}

export interface ReviewForm {
  mode: ReviewMode
  lines: ReviewLine[]
  receiptStore: StoreChoice
  purchasedAt: string
}

interface ApplyItem {
  name: string
  rawText: string | null
  quantity: number | null
  unit: string | null
  note: string | null
  category: Category | null
  price?: number | null
  storeId?: string
  storeHint?: string | null
}

export interface ApplyBody {
  mode: ReviewMode
  storeId?: string | null
  storeName?: string | null
  purchasedAt?: number | null
  items: ApplyItem[]
}

const numberText = (n: number | null) => (n === null ? '' : String(Math.round(n * 1000) / 1000))

export function blankLine(store: StoreChoice = ''): ReviewLine {
  return {
    key: crypto.randomUUID(),
    include: true,
    name: '',
    originalName: null,
    rawText: null,
    quantity: '',
    unit: '',
    price: '',
    note: null,
    category: null,
    store,
    defaultStore: '',
    storeHint: null,
    reason: null,
    onList: false,
  }
}

export function initialForm(capture: Capture, extraction: Extraction): ReviewForm {
  const mode: ReviewMode =
    extraction.kind === 'receipt' || (extraction.kind === 'other' && capture.hint === 'receipt') ? 'receipt' : 'list'
  const lines = extraction.items.map((item, index): ReviewLine => {
    const defaultStore = item.predictedStoreId ?? (item.storeHint ? `${NEW_STORE}${item.storeHint}` : '')
    return {
      key: `${index}`,
      include: true,
      name: item.name,
      originalName: item.name,
      rawText: item.rawText,
      quantity: numberText(item.quantity),
      unit: item.unit ?? '',
      price: item.price === null ? '' : item.price.toFixed(2),
      note: item.note,
      category: item.category,
      store: defaultStore,
      defaultStore,
      storeHint: item.storeHint,
      reason: item.predictionReason,
      onList: item.onList,
    }
  })
  return {
    mode,
    lines,
    receiptStore: extraction.storeId ?? (extraction.store ? `${NEW_STORE}${extraction.store}` : ''),
    purchasedAt: toDateTimeInput(extraction.purchasedAt, capture.createdAt),
  }
}

/** "1,5" and "1.5" are both one and a half; zero, negatives, and junk mean "not given". */
export function parseAmount(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() && Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : null
}

/** "$3.49", "4,99 €", and "1,299.00" (a comma with a dot is a thousands separator). */
export function parsePrice(text: string): number | null {
  const kept = text.replace(/[^\d.,-]/g, '')
  const cleaned = kept.includes('.') ? kept.replace(/,/g, '') : kept.replace(',', '.')
  const n = Number(cleaned)
  return /\d/.test(cleaned) && Number.isFinite(n) && n >= 0 ? Math.min(n, 100_000) : null
}

export function includedLines(lines: ReviewLine[]): ReviewLine[] {
  return lines.filter((l) => l.include && l.name.trim())
}

/** The sum of the included receipt lines that have a price, or null when none do. */
export function linesTotal(lines: ReviewLine[]): number | null {
  const prices = includedLines(lines)
    .map((l) => parsePrice(l.price))
    .filter((p): p is number => p !== null)
  return prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) * 100) / 100 : null
}

/**
 * Turns the form into an apply request. A list line's store is only sent as a store id when the
 * user changed it, because the server records an explicit store as a choice to learn from; left
 * alone, the line goes back with its hint and is filed the way the review showed.
 */
export function buildApplyBody(form: ReviewForm): ApplyBody {
  const items = includedLines(form.lines).map((line): ApplyItem => {
    const name = line.name.trim().slice(0, 200)
    const renamed = line.originalName === null || name !== line.originalName
    const base: ApplyItem = {
      name,
      rawText: line.rawText,
      quantity: parseAmount(line.quantity),
      unit: line.unit.trim().slice(0, 20) || null,
      note: line.note,
      category: renamed ? null : line.category,
    }
    if (form.mode === 'receipt') return { ...base, price: parsePrice(line.price) }
    if (line.store === line.defaultStore) return { ...base, storeHint: line.storeHint }
    if (line.store.startsWith(NEW_STORE)) return { ...base, storeHint: line.store.slice(NEW_STORE.length) }
    return line.store ? { ...base, storeId: line.store } : base
  })
  if (form.mode === 'list') return { mode: 'list', items }
  const store = form.receiptStore
  return {
    mode: 'receipt',
    storeId: store && !store.startsWith(NEW_STORE) ? store : null,
    storeName: store.startsWith(NEW_STORE) ? store.slice(NEW_STORE.length) : null,
    purchasedAt: fromDateTimeInput(form.purchasedAt),
    items,
  }
}
