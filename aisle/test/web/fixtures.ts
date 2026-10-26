import type { Category } from '../../src/shared/categories'
import type { Capture, Extraction, ExtractedItem, ListItem, Product, Store } from '../../src/shared/types'
import type { Tables } from '../../src/web/lib/replay'

let counter = 0
export const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

export function store(name: string, extra: Partial<Store> = {}): Store {
  return { id: uuid(), name, color: '#059669', sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, ...extra }
}

export function product(name: string, category: Category, extra: Partial<Product> = {}): Product {
  return {
    id: uuid(),
    name,
    category,
    predictedStoreId: null,
    predictionConfidence: null,
    predictionReason: null,
    purchaseCount: 0,
    lastPurchasedAt: null,
    updatedAt: 1,
    deletedAt: null,
    rev: 1,
    ...extra,
  }
}

export function item(name: string, category: Category, extra: Partial<ListItem> = {}): ListItem {
  return {
    id: uuid(),
    productId: null,
    name,
    quantity: null,
    unit: null,
    note: null,
    category,
    storeId: null,
    storeSource: 'none',
    storeReason: null,
    checkedAt: null,
    checkedBy: null,
    addedBy: null,
    captureId: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    rev: 1,
    ...extra,
  }
}

export function tables(rows: { stores?: Store[]; products?: Product[]; items?: ListItem[] }): Tables {
  return {
    stores: new Map((rows.stores ?? []).map((s) => [s.id, s])),
    products: new Map((rows.products ?? []).map((p) => [p.id, p])),
    items: new Map((rows.items ?? []).map((i) => [i.id, i])),
  }
}

export function extracted(name: string, extra: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    name,
    rawText: null,
    quantity: null,
    unit: null,
    price: null,
    category: 'Other',
    storeHint: null,
    note: null,
    productId: null,
    predictedStoreId: null,
    predictionReason: null,
    onList: false,
    ...extra,
  }
}

export function extraction(items: ExtractedItem[], extra: Partial<Extraction> = {}): Extraction {
  return {
    kind: 'list',
    store: null,
    storeId: null,
    purchasedAt: null,
    currency: null,
    total: null,
    items,
    notes: null,
    warnings: [],
    ...extra,
  }
}

export function capture(extra: Partial<Capture> = {}): Capture {
  return {
    id: uuid(),
    userId: null,
    media: 'image',
    hint: 'auto',
    status: 'ready',
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    byteSize: 1000,
    textInput: null,
    transcript: null,
    extraction: null,
    engine: 'ai',
    error: null,
    result: null,
    createdAt: new Date(2026, 9, 24, 18, 30).getTime(),
    updatedAt: 1,
    deletedAt: null,
    rev: 1,
    ...extra,
  }
}
