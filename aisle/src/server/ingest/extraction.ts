import { z } from 'zod'
import { CATEGORIES, type Category, isCategory } from '../../shared/categories'
import type { CaptureHint } from '../../shared/types'

/** What an engine (AI, OCR plus rules, or rules alone) reads from a capture, before matching. */
export interface RawItem {
  name: string
  rawText: string | null
  quantity: number | null
  unit: string | null
  price: number | null
  category: Category | null
  storeHint: string | null
  note: string | null
}

export interface RawExtraction {
  kind: 'list' | 'receipt' | 'other'
  store: string | null
  purchasedAt: string | null
  currency: string | null
  total: number | null
  items: RawItem[]
  notes: string | null
}

export interface ExtractContext {
  hint: CaptureHint
  /** The household's store names, so engines reuse them instead of inventing variants. */
  stores: string[]
  /** Product names the household already uses, most frequent first. */
  products: string[]
}

const nullableString = { type: ['string', 'null'] }
const nullableNumber = { type: ['number', 'null'] }

/** JSON Schema for structured output. Strict mode needs every property listed as required. */
export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'store', 'purchasedAt', 'currency', 'total', 'items', 'notes'],
  properties: {
    kind: { type: 'string', enum: ['list', 'receipt', 'other'] },
    store: { ...nullableString, description: 'Receipts: the store or chain name without store numbers' },
    purchasedAt: { ...nullableString, description: 'Receipts: ISO 8601 date, with time if printed' },
    currency: { ...nullableString, description: 'ISO 4217 code if shown, for example USD' },
    total: { ...nullableNumber, description: 'Receipts: the amount paid' },
    notes: { ...nullableString, description: 'Anything the user should know, such as unreadable parts' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'rawText', 'quantity', 'unit', 'price', 'category', 'storeHint', 'note'],
        properties: {
          name: { type: 'string', description: 'Plain item name with abbreviations expanded, in sentence case' },
          rawText: { ...nullableString, description: 'The text exactly as written or printed' },
          quantity: nullableNumber,
          unit: { ...nullableString, description: 'lb, oz, kg, g, l, ml, gal, dozen, pack, bag, box, can, bottle, bunch' },
          price: { ...nullableNumber, description: 'Receipts: line total after discounts on that line' },
          category: { type: 'string', enum: [...CATEGORIES] },
          storeHint: { ...nullableString, description: 'Lists: a store written as a heading above the item or next to it' },
          note: { ...nullableString, description: 'Remarks such as "the big one" or "if on sale"' },
        },
      },
    },
  },
} as const

/** "$1,299.00", "4,99", and "12" all come back from models that ignore the schema. */
function numberFromText(text: string): number | null {
  let s = text.replace(/[^0-9.,-]/g, '')
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (/,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  if (!/\d/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const looseNumber = z.preprocess(
  (v) => (typeof v === 'string' ? numberFromText(v) : v),
  z.number().finite().nullable().catch(null),
)

const looseString = z.preprocess(
  (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() || null : v),
  z.string().max(300).nullable().catch(null),
)

const rawItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  rawText: looseString.default(null),
  quantity: looseNumber.default(null).transform((n) => (n !== null && n > 0 && n <= 10_000 ? n : null)),
  unit: looseString.default(null).transform((u) => u?.slice(0, 20) ?? null),
  price: looseNumber.default(null).transform((n) => (n !== null && n >= 0 && n <= 100_000 ? n : null)),
  category: z
    .unknown()
    .optional()
    .transform((c) => (isCategory(c) ? c : null)),
  storeHint: looseString.default(null).transform((s) => s?.slice(0, 80) ?? null),
  note: looseString.default(null),
})

/**
 * Validates model output leniently: providers without strict structured output return numbers
 * as strings, unknown categories, or extra fields, and none of that should fail a capture.
 */
const rawExtractionSchema = z.object({
  kind: z.enum(['list', 'receipt', 'other']).catch('list'),
  store: looseString.default(null),
  purchasedAt: looseString.default(null),
  currency: looseString.default(null),
  total: looseNumber.default(null),
  notes: looseString.default(null),
  items: z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = rawItemSchema.safeParse(item)
        return parsed.success ? [parsed.data as RawItem] : []
      }),
    ),
})

function parseJson(content: string): unknown {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(text)
  } catch {
    // JSON mode is a request, not a guarantee: some models wrap the object in a sentence.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

/** Throws when the answer holds no JSON object at all. */
export function parseRawExtraction(content: string): RawExtraction {
  const value = parseJson(content)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The answer is not a JSON object')
  return rawExtractionSchema.parse(value) as RawExtraction
}

export function emptyExtraction(kind: RawExtraction['kind'], notes: string | null = null): RawExtraction {
  return { kind, store: null, purchasedAt: null, currency: null, total: null, items: [], notes }
}
