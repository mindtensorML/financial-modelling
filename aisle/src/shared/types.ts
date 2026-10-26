import type { Category } from './categories'

/** Why a list item is filed under its store; shown to the user next to the item. */
export type StoreSource = 'learned' | 'manual' | 'category' | 'hint' | 'only' | 'receipt' | 'none'

export interface Store {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  rev: number
}

export interface Product {
  id: string
  name: string
  category: Category
  predictedStoreId: string | null
  predictionConfidence: number | null
  predictionReason: string | null
  purchaseCount: number
  lastPurchasedAt: number | null
  updatedAt: number
  deletedAt: number | null
  rev: number
}

export interface ListItem {
  id: string
  productId: string | null
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
  category: Category
  storeId: string | null
  storeSource: StoreSource
  storeReason: string | null
  checkedAt: number | null
  checkedBy: string | null
  addedBy: string | null
  captureId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  rev: number
}

export type CaptureMedia = 'text' | 'image' | 'audio'
export type CaptureHint = 'auto' | 'list' | 'receipt'
export type CaptureStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'applied' | 'dismissed'
export type CaptureEngine = 'ai' | 'ocr' | 'rules'

export interface ExtractedItem {
  name: string
  rawText: string | null
  quantity: number | null
  unit: string | null
  price: number | null
  category: Category
  storeHint: string | null
  note: string | null
  /** Filled in by the server after matching against what the household already knows. */
  productId: string | null
  predictedStoreId: string | null
  predictionReason: string | null
  onList: boolean
}

export interface Extraction {
  kind: 'list' | 'receipt' | 'other'
  store: string | null
  storeId: string | null
  purchasedAt: string | null
  currency: string | null
  total: number | null
  items: ExtractedItem[]
  notes: string | null
  warnings: string[]
}

export interface CaptureResult {
  mode: 'list' | 'receipt'
  added: number
  merged: number
  purchases: number
  checkedOff: number
  storeId: string | null
}

export interface Capture {
  id: string
  userId: string | null
  media: CaptureMedia
  hint: CaptureHint
  status: CaptureStatus
  mimeType: string | null
  fileName: string | null
  byteSize: number | null
  textInput: string | null
  transcript: string | null
  extraction: Extraction | null
  engine: CaptureEngine | null
  error: string | null
  result: CaptureResult | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  rev: number
}

export interface SyncResponse {
  householdId: string
  rev: number
  /** A full snapshot replaces the client's copy; otherwise only rows changed after `since`, including deletions. */
  full: boolean
  stores: Store[]
  products: Product[]
  items: ListItem[]
  captures: Capture[]
}

export interface Member {
  id: string
  name: string
  email: string
}

export interface Me {
  user: Member
  household: { id: string; name: string; inviteCode: string; members: Member[] }
}

export interface JoinResponse extends Me {
  /** Open items brought over from the household the user left, when they were its last member. */
  carried: number
}

export type OpStatus = 'ok' | 'duplicate' | 'rejected'

export interface OpResult {
  opId: string
  status: OpStatus
  error?: string
}

export interface OpsResponse {
  rev: number
  results: OpResult[]
}

export interface ServerFeatures {
  ai: boolean
  aiModel: string | null
  transcription: boolean
  ocr: boolean
}

export type SignupMode = 'open' | 'invite'

export interface ServerConfig {
  features: ServerFeatures
  signupMode: SignupMode
}

export interface DueSoon {
  productId: string
  name: string
  category: Category
  storeId: string | null
  intervalDays: number
  daysSinceLast: number
  lastPurchasedAt: number
  reason: string
}

export interface ProductInsight {
  productId: string
  name: string
  category: Category
  purchaseCount: number
  storeId: string | null
  confidence: number | null
  reason: string | null
  intervalDays: number | null
  lastPurchasedAt: number | null
  prices: Array<{ storeId: string; averageCents: number; lastCents: number; samples: number }>
  cheaperAt: { storeId: string; savingsCents: number } | null
}

export interface StoreInsight {
  storeId: string
  visits30d: number
  spend30dCents: number
  productCount: number
}

export interface WalkOrder {
  products: Record<string, number>
  categories: Partial<Record<Category, number>>
}

export interface Insights {
  generatedAt: number
  dueSoon: DueSoon[]
  products: ProductInsight[]
  stores: StoreInsight[]
  walkOrder: Record<string, WalkOrder>
}
