import { parseListText } from '../../shared/parseList'
import { looksLikeReceipt, parseReceiptText } from '../../shared/parseReceipt'
import type { ExtractContext, RawExtraction } from './extraction'

/** The offline engine: the shared list and receipt parsers, as used for OCR text and pastes. */
export function extractWithRules(text: string, ctx: ExtractContext, options: { speech?: boolean } = {}): RawExtraction {
  const asReceipt = ctx.hint === 'receipt' || (ctx.hint === 'auto' && !options.speech && looksLikeReceipt(text))
  if (asReceipt) {
    const receipt = parseReceiptText(text, { knownStores: ctx.stores })
    return {
      kind: 'receipt',
      store: receipt.store,
      purchasedAt: receipt.purchasedAt,
      currency: null,
      total: receipt.total,
      notes: null,
      items: receipt.items.map((line) => ({
        name: line.name,
        rawText: line.rawText,
        quantity: line.quantity,
        unit: line.unit,
        price: line.price,
        category: null,
        storeHint: null,
        note: null,
      })),
    }
  }
  const items = parseListText(text, {
    knownStores: ctx.stores,
    knownProducts: ctx.products,
    people: ctx.people,
    splitRuns: options.speech,
  })
  return {
    kind: 'list',
    store: null,
    purchasedAt: null,
    currency: null,
    total: null,
    notes: null,
    items: items.map((item) => ({
      name: item.name,
      rawText: item.raw,
      quantity: item.quantity,
      unit: item.unit,
      price: null,
      category: item.categoryHint,
      storeHint: item.storeHint,
      note: item.note,
    })),
  }
}
