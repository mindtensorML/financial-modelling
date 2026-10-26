import type { Category } from '../shared/categories'
import type {
  Capture,
  CaptureEngine,
  CaptureHint,
  CaptureMedia,
  CaptureStatus,
  ListItem,
  Product,
  Store,
  StoreSource,
} from '../shared/types'

export interface UserRow {
  id: string
  email: string
  name: string
  password_hash: string
  household_id: string
  created_at: number
}

export interface StoreRow {
  id: string
  household_id: string
  name: string
  color: string
  sort_order: number
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

export interface ProductRow {
  id: string
  household_id: string
  name: string
  name_key: string
  category: Category
  predicted_store_id: string | null
  prediction_confidence: number | null
  prediction_reason: string | null
  purchase_count: number
  last_purchased_at: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

export interface ItemRow {
  id: string
  household_id: string
  product_id: string | null
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
  category: Category
  store_id: string | null
  store_source: StoreSource
  store_reason: string | null
  checked_at: number | null
  checked_by: string | null
  added_by: string | null
  capture_id: string | null
  /** Set on the tombstone of an item that was merged into an existing one on arrival. */
  merged_into: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

export interface CaptureRow {
  id: string
  household_id: string
  user_id: string | null
  media: CaptureMedia
  hint: CaptureHint
  status: CaptureStatus
  mime_type: string | null
  blob_key: string | null
  byte_size: number | null
  file_name: string | null
  text_input: string | null
  transcript: string | null
  extraction: string | null
  engine: CaptureEngine | null
  error: string | null
  result: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
}

export interface PurchaseRow {
  id: string
  household_id: string
  product_id: string
  store_id: string | null
  purchased_at: number
  quantity: number | null
  unit: string | null
  price_cents: number | null
  source: 'receipt' | 'checkoff'
  capture_id: string | null
  list_item_id: string | null
  created_at: number
}

export function toStore(r: StoreRow): Store {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    rev: r.rev,
  }
}

export function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    predictedStoreId: r.predicted_store_id,
    predictionConfidence: r.prediction_confidence,
    predictionReason: r.prediction_reason,
    purchaseCount: r.purchase_count,
    lastPurchasedAt: r.last_purchased_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    rev: r.rev,
  }
}

export function toItem(r: ItemRow): ListItem {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    quantity: r.quantity,
    unit: r.unit,
    note: r.note,
    category: r.category,
    storeId: r.store_id,
    storeSource: r.store_source,
    storeReason: r.store_reason,
    checkedAt: r.checked_at,
    checkedBy: r.checked_by,
    addedBy: r.added_by,
    captureId: r.capture_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    rev: r.rev,
  }
}

export function toCapture(r: CaptureRow): Capture {
  return {
    id: r.id,
    userId: r.user_id,
    media: r.media,
    hint: r.hint,
    status: r.status,
    mimeType: r.mime_type,
    fileName: r.file_name,
    byteSize: r.byte_size,
    textInput: r.text_input,
    transcript: r.transcript,
    extraction: r.extraction ? JSON.parse(r.extraction) : null,
    engine: r.engine,
    error: r.error,
    result: r.result ? JSON.parse(r.result) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    rev: r.rev,
  }
}
