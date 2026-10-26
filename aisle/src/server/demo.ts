import { randomUUID } from 'node:crypto'
import type { Category } from '../shared/categories'
import type { Op } from '../shared/ops'
import type { CaptureHint } from '../shared/types'
import type { DB } from './db'
import { type ApplyInput, applyCapture, applySchema } from './ingest/apply'
import type { BlobStore } from './ingest/blobs'
import { CaptureQueue } from './ingest/queue'
import { RealtimeHub } from './realtime'
import type { CaptureRow } from './rows'
import { getCapture, insertCapture } from './services/captures'
import { withWrite } from './services/context'
import { createHousehold } from './services/households'
import { applyOps } from './services/ops'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const DEMO_MEMBERS = [
  { key: 'alex', name: 'Alex Rivera', email: 'alex@example.com' },
  { key: 'sam', name: 'Sam Rivera', email: 'sam@example.com' },
] as const
const HOUSEHOLD_NAME = 'The Riveras'

type Member = (typeof DEMO_MEMBERS)[number]['key']
type StoreKey = 'tj' | 'costco' | 'target' | 'wf'

interface StoreSpec {
  key: StoreKey
  name: string
  receiptHeader: string
  /** A trip every `every` days, the latest `last` days ago, `trips` in all. */
  every: number
  last: number
  trips: number
  hour: number
  minute: number
  /** The order the household walks the store in. */
  aisles: Category[]
  shopper: (trip: number) => Member
  receipt: (trip: number) => boolean
}

const STORES: StoreSpec[] = [
  {
    key: 'tj',
    name: "Trader Joe's",
    receiptHeader: "TRADER JOE'S #552",
    every: 7,
    last: 6,
    trips: 10,
    hour: 9,
    minute: 50,
    aisles: ['Produce', 'Bakery', 'Snacks', 'Frozen', 'Meat & Seafood', 'Dairy & Eggs', 'Beverages'],
    shopper: (trip) => (trip % 2 === 0 ? 'alex' : 'sam'),
    receipt: (trip) => trip % 2 === 0,
  },
  {
    key: 'costco',
    name: 'Costco',
    receiptHeader: 'COSTCO WHOLESALE #1024',
    every: 14,
    last: 9,
    trips: 5,
    hour: 10,
    minute: 45,
    aisles: ['Household', 'Snacks', 'Pantry', 'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Frozen'],
    shopper: () => 'alex',
    receipt: () => true,
  },
  {
    key: 'target',
    name: 'Target',
    receiptHeader: 'TARGET T-2087',
    every: 21,
    last: 4,
    trips: 4,
    hour: 18,
    minute: 20,
    aisles: ['Personal Care', 'Household'],
    shopper: () => 'sam',
    receipt: () => true,
  },
  {
    key: 'wf',
    name: 'Whole Foods',
    receiptHeader: 'WHOLE FOODS MARKET',
    every: 14,
    last: 2,
    trips: 5,
    hour: 17,
    minute: 35,
    aisles: ['Produce', 'Bakery', 'Meat & Seafood', 'Pantry', 'Beverages'],
    shopper: () => 'sam',
    receipt: () => true,
  },
]

interface Purchase {
  store: StoreKey
  /** Days between purchases. */
  every: number
  price: number
  receipt: string
  quantity?: number
  unit?: string
}

interface ProductSpec extends Purchase {
  name: string
  category: Category
  /** Bought once at another store, on that store's `trip`-th latest trip, without being on the list. */
  elsewhere?: Omit<Purchase, 'every'> & { trip: number }
  /** Moved to another store by hand this many days ago, and bought there since. */
  moved?: Purchase & { daysAgo: number }
}

const PRODUCTS: ProductSpec[] = [
  { name: 'Bananas', category: 'Produce', store: 'tj', every: 7, price: 1.16, receipt: 'BANANAS' },
  { name: 'Avocados', category: 'Produce', store: 'tj', every: 7, price: 3.99, receipt: 'AVOCADOS HASS BAG' },
  { name: 'Baby spinach', category: 'Produce', store: 'tj', every: 7, price: 2.99, receipt: 'ORG BABY SPINACH' },
  { name: 'Blueberries', category: 'Produce', store: 'tj', every: 14, price: 4.99, receipt: 'BLUEBERRIES 18 OZ' },
  { name: 'Sourdough bread', category: 'Bakery', store: 'tj', every: 7, price: 4.49, receipt: 'SOURDOUGH ROUND' },
  { name: 'Dark chocolate', category: 'Snacks', store: 'tj', every: 14, price: 1.99, receipt: 'DARK CHOCOLATE BAR' },
  { name: 'Frozen dumplings', category: 'Frozen', store: 'tj', every: 14, price: 3.99, receipt: 'CHICKEN GYOZA POTSTICKERS' },
  { name: 'Chicken breast', category: 'Meat & Seafood', store: 'tj', every: 7, price: 7.49, receipt: 'CHICKEN BREAST BNLS' },
  { name: 'Whole milk', category: 'Dairy & Eggs', store: 'tj', every: 7, price: 3.49, receipt: 'ORG WHOLE MILK HALF GAL' },
  { name: 'Greek yogurt', category: 'Dairy & Eggs', store: 'tj', every: 7, price: 4.99, receipt: 'GREEK YOGURT PLAIN' },
  { name: 'Cheddar cheese', category: 'Dairy & Eggs', store: 'tj', every: 14, price: 4.49, receipt: 'UNEXPECTED CHEDDAR' },
  {
    name: 'Eggs',
    category: 'Dairy & Eggs',
    store: 'tj',
    every: 7,
    price: 3.99,
    receipt: 'EGGS BROWN LARGE DOZ',
    quantity: 1,
    unit: 'dozen',
    moved: { daysAgo: 30, store: 'costco', every: 14, price: 7.99, receipt: 'KS ORG EGGS 24 CT', quantity: 2, unit: 'dozen' },
  },
  { name: 'Paper towels', category: 'Household', store: 'costco', every: 28, price: 21.99, receipt: 'KS PAPER TOWEL 12 ROLL' },
  { name: 'Toilet paper', category: 'Household', store: 'costco', every: 28, price: 22.99, receipt: 'KS BATH TISSUE 30 ROLL' },
  { name: 'Almonds', category: 'Snacks', store: 'costco', every: 28, price: 15.49, receipt: 'KS ALMONDS 3 LB' },
  { name: 'Olive oil', category: 'Pantry', store: 'costco', every: 28, price: 19.99, receipt: 'KS ORGANIC EVOO 2 L' },
  { name: 'Strawberries', category: 'Produce', store: 'costco', every: 14, price: 5.99, receipt: 'STRAWBERRIES 2 LB' },
  { name: 'Chicken thighs', category: 'Meat & Seafood', store: 'costco', every: 14, price: 17.49, receipt: 'KS CHICKEN THIGHS BNLS' },
  { name: 'Butter', category: 'Dairy & Eggs', store: 'costco', every: 28, price: 12.99, receipt: 'KS UNSALTED BUTTER' },
  { name: 'Frozen berries', category: 'Frozen', store: 'costco', every: 28, price: 13.49, receipt: 'KS ORG BERRY BLEND' },
  { name: 'Toothpaste', category: 'Personal Care', store: 'target', every: 42, price: 4.79, receipt: 'CREST PRO HEALTH TP' },
  { name: 'Shampoo', category: 'Personal Care', store: 'target', every: 42, price: 9.99, receipt: 'NATIVE SHAMPOO' },
  { name: 'Dish soap', category: 'Household', store: 'target', every: 21, price: 3.79, receipt: 'DAWN ULTRA DISH SOAP' },
  { name: 'Trash bags', category: 'Household', store: 'target', every: 42, price: 10.49, receipt: 'GLAD TALL KITCHEN BAGS' },
  { name: 'Laundry detergent', category: 'Household', store: 'target', every: 42, price: 13.99, receipt: 'TIDE PODS FREE CLEAR' },
  { name: 'Croissants', category: 'Bakery', store: 'wf', every: 14, price: 6.99, receipt: 'BUTTER CROISSANTS 4 CT' },
  { name: 'Salmon', category: 'Meat & Seafood', store: 'wf', every: 14, price: 13.99, receipt: 'SOCKEYE SALMON FILLET' },
  { name: 'Maple syrup', category: 'Pantry', store: 'wf', every: 28, price: 11.99, receipt: '365 MAPLE SYRUP' },
  {
    name: 'Coffee beans',
    category: 'Beverages',
    store: 'wf',
    every: 14,
    price: 15.99,
    receipt: 'ALLEGRO WHOLE BEAN COFFEE',
    elsewhere: { store: 'tj', trip: 2, price: 8.99, receipt: 'TJ WHOLE BEAN COFFEE' },
  },
  {
    name: 'Kombucha',
    category: 'Beverages',
    store: 'wf',
    every: 14,
    price: 3.99,
    receipt: "GT'S KOMBUCHA GINGERADE",
    elsewhere: { store: 'tj', trip: 4, price: 2.99, receipt: "GT'S KOMBUCHA" },
  },
]

/** The trip whose list Sam texted and Alex pasted in, instead of adding items one by one. */
const TEXTED_TRIP = { store: 'tj' as StoreKey, trip: 1 }
const WAITING_MESSAGE = "Sam: can you grab limes, cilantro and 2 avocados on your way home? also we're out of dish soap"

interface Trip {
  store: StoreSpec
  /** 0 is the latest trip to this store. */
  index: number
  daysAgo: number
  start: number
  /** The first trip to each store, recorded from its receipt before the household kept lists. */
  firstReceipt: boolean
  products: ProductSpec[]
  extras: ProductSpec[]
}

export interface DemoSummary {
  householdId: string
  stores: number
  products: number
  purchases: number
  receipts: number
  openItems: number
  toReview: number
  /** Things that did not go as scripted; empty unless the app's behavior changed. */
  warnings: string[]
}

/** Deterministic, so the demo looks the same every time it is seeded. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

function receiptDate(at: number): string {
  const d = new Date(at)
  const hour = d.getHours() % 12 || 12
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${hour}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

function receiptText(store: StoreSpec, lines: Array<{ text: string; price: number }>, at: number): string {
  const row = (label: string, amount: number) => `${label.padEnd(30)} ${amount.toFixed(2).padStart(7)}`
  const total = lines.reduce((sum, line) => sum + Math.round(line.price * 100), 0) / 100
  return [store.receiptHeader, ...lines.map((l) => row(l.text, l.price)), row('SUBTOTAL', total), row('TOTAL', total), receiptDate(at)].join('\n')
}

/** Where a product was bought `daysAgo` days ago, and how often. */
function homeOf(product: ProductSpec, daysAgo: number): Purchase {
  return product.moved && daysAgo < product.moved.daysAgo ? product.moved : product
}

type NewOp = Op extends infer T ? (T extends Op ? Omit<T, 'opId'> : never) : never

export class DemoExistsError extends Error {
  constructor(readonly emails: string[]) {
    super(`The demo accounts already exist (${emails.join(', ')})`)
  }
}

/** Removes the demo household and its members; returns the household ids, whose uploads must go too. */
export function removeDemoHousehold(db: DB): string[] {
  const emails = DEMO_MEMBERS.map((m) => m.email)
  const households = (
    db.prepare(`SELECT DISTINCT household_id FROM users WHERE email IN (${emails.map(() => '?').join(', ')})`).all(...emails) as {
      household_id: string
    }[]
  ).map((r) => r.household_id)
  for (const householdId of households) {
    const others = db
      .prepare(`SELECT email FROM users WHERE household_id = ? AND email NOT IN (${emails.map(() => '?').join(', ')})`)
      .all(householdId, ...emails) as { email: string }[]
    if (others.length) {
      throw new Error(`The demo household has other members (${others.map((o) => o.email).join(', ')}); not removing it`)
    }
  }
  db.transaction(() => {
    for (const householdId of households) {
      db.prepare('DELETE FROM users WHERE household_id = ?').run(householdId)
      db.prepare('DELETE FROM applied_ops WHERE household_id = ?').run(householdId)
      db.prepare('DELETE FROM households WHERE id = ?').run(householdId)
    }
  })()
  return households
}

export interface SeedOptions {
  passwordHash: string
  blobs: BlobStore
  now?: number
  /** Replace the demo household if it is already there. */
  reset?: boolean
}

/**
 * Creates a household with ten weeks of shopping at four stores, so store predictions, "Running
 * low?", walking order, and price comparisons have something to show. Everything goes through the
 * same code as real use (operations, captures read by the rule-based parser, receipts applied),
 * at simulated local times leading up to `now`. It all happens in one transaction, so a failure
 * leaves the database as it was.
 */
export async function seedDemo(db: DB, options: SeedOptions): Promise<DemoSummary> {
  let removed: string[] = []
  let summary: DemoSummary
  db.exec('BEGIN IMMEDIATE')
  try {
    if (options.reset) removed = removeDemoHousehold(db)
    summary = await simulate(db, options)
    db.exec('COMMIT')
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }
  for (const householdId of removed) await options.blobs.removeHousehold(householdId)
  return summary
}

async function simulate(db: DB, options: SeedOptions): Promise<DemoSummary> {
  const now = options.now ?? Date.now()
  const rand = random(20261026)
  const between = (min: number, max: number) => min + rand() * (max - min)
  const warnings: string[] = []
  const today = new Date(now)
  const localTime = (daysAgo: number, hour: number, minute: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).getTime()

  const taken = db
    .prepare(`SELECT email FROM users WHERE email IN (${DEMO_MEMBERS.map(() => '?').join(', ')})`)
    .all(...DEMO_MEMBERS.map((m) => m.email)) as { email: string }[]
  if (taken.length) throw new DemoExistsError(taken.map((t) => t.email))

  const oldest = Math.max(...STORES.map((s) => s.last + s.every * (s.trips - 1)))
  const start = localTime(oldest + 1, 20, 0)
  const householdId = createHousehold(db, HOUSEHOLD_NAME, start)
  const users = {} as Record<Member, string>
  for (const [i, member] of DEMO_MEMBERS.entries()) {
    users[member.key] = randomUUID()
    db.prepare('INSERT INTO users (id, email, name, password_hash, household_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      users[member.key],
      member.email,
      member.name,
      options.passwordHash,
      householdId,
      start + i * HOUR,
    )
  }

  const send = (member: Member, at: number, ...ops: NewOp[]) => {
    const { results } = applyOps(db, householdId, users[member], ops.map((op) => ({ ...op, opId: randomUUID() }) as Op), at)
    for (const [i, result] of results.entries()) {
      if (result.status !== 'ok') warnings.push(`${ops[i]!.type} was ${result.status}: ${result.error ?? ''}`)
    }
  }

  const storeIds = {} as Record<StoreKey, string>
  send(
    'alex',
    start,
    ...STORES.map((store, sortOrder) => {
      storeIds[store.key] = randomUUID()
      return { type: 'store.upsert' as const, id: storeIds[store.key], name: store.name, sortOrder }
    }),
  )
  const storeByKey = new Map(STORES.map((s) => [s.key, s]))

  // Captures are read by the rule-based parser, as on a server without an AI provider.
  let clock = start
  const queue = new CaptureQueue({ db, blobs: options.blobs, hub: new RealtimeHub(), engines: { ai: null, ocr: null }, now: () => clock })
  const capture = async (member: Member, at: number, text: string, hint: CaptureHint): Promise<CaptureRow> => {
    const id = randomUUID()
    withWrite(db, householdId, users[member], at, (ctx) =>
      insertCapture(ctx, { id, media: 'text', hint, mimeType: null, blobKey: null, byteSize: null, fileName: null, textInput: text }),
    )
    clock = at + 3_000
    queue.enqueue(id)
    await queue.idle()
    const read = getCapture(db, householdId, id)!
    if (read.status !== 'ready') warnings.push(`A ${hint} capture ended up ${read.status}: ${read.error ?? ''}`)
    return read
  }
  const apply = (member: Member, at: number, row: CaptureRow, input: ApplyInput) =>
    withWrite(db, householdId, users[member], at, (ctx) => applyCapture(ctx, row, applySchema.parse(input)))

  const productId = (name: string) =>
    (db.prepare('SELECT id FROM products WHERE household_id = ? AND name = ?').get(householdId, name) as { id: string } | undefined)?.id
  const openItem = (name: string) =>
    db
      .prepare(
        `SELECT i.id, i.store_id FROM list_items i JOIN products p ON p.id = i.product_id
         WHERE i.household_id = ? AND p.name = ? AND i.checked_at IS NULL AND i.deleted_at IS NULL`,
      )
      .get(householdId, name) as { id: string; store_id: string | null } | undefined

  const hasChoice = (name: string) =>
    Boolean(
      db
        .prepare('SELECT 1 FROM store_choices c JOIN products p ON p.id = c.product_id WHERE c.household_id = ? AND p.name = ?')
        .get(householdId, name),
    )

  /**
   * Moves an item the app filed somewhere else, the way a person would on the list. That is
   * expected only when the app had to guess: a product it has never seen, or the first time
   * eggs go on the Costco list. After that it should have learned.
   */
  const fileUnder = (member: Member, at: number, name: string, store: StoreKey, options: { guess?: boolean } = {}) => {
    const item = openItem(name)
    if (!item) {
      warnings.push(`${name} was not on the list after adding it`)
      return
    }
    if (item.store_id === storeIds[store]) return
    if (!options.guess) warnings.push(`${name} was filed somewhere other than ${storeByKey.get(store)!.name}`)
    send(member, at + MINUTE, { type: 'item.setStore', id: item.id, storeId: storeIds[store] })
  }

  // Plan every trip first: which products each one buys, and when.
  const trips: Trip[] = []
  for (const store of STORES) {
    const storeProducts = PRODUCTS.filter((p) => p.store === store.key || p.moved?.store === store.key)
    for (let index = store.trips - 1; index >= 0; index--) {
      const daysAgo = store.last + index * store.every
      const fromOldest = store.trips - 1 - index
      const firstReceipt = fromOldest === 0
      const products = storeProducts.filter((product, offset) => {
        const home = homeOf(product, daysAgo)
        if (home.store !== store.key) return false
        const ratio = Math.max(1, Math.round(home.every / store.every))
        if ((fromOldest + offset) % ratio !== 0) return false
        // Now and then a weekly item is still in the fridge.
        return firstReceipt || !(home.every === 7 && index > 0 && rand() < 0.08)
      })
      const extras = PRODUCTS.filter((p) => p.elsewhere?.store === store.key && p.elsewhere.trip === index)
      const start = localTime(daysAgo, store.hour, store.minute + Math.round(between(0, 30)))
      trips.push({ store, index, daysAgo, start, firstReceipt, products, extras })
    }
  }
  const lastBought = new Map<string, number>()
  const tripOrder = [...trips].sort((a, b) => a.start - b.start)

  type Event = { at: number; run: () => void | Promise<void> }
  const events: Event[] = []
  const previousTrip = (trip: Trip) => trips.find((t) => t.store === trip.store && t.index === trip.index + 1)

  for (const trip of tripOrder) {
    const { store } = trip
    const shopper = store.shopper(trip.index)
    if (!trip.firstReceipt) {
      const texted = store.key === TEXTED_TRIP.store && trip.index === TEXTED_TRIP.trip
      const after = (product: ProductSpec) => Math.max(previousTrip(trip)!.start, lastBought.get(product.name) ?? 0) + 4 * HOUR
      if (texted) {
        const at = trip.start - 14 * HOUR
        const names = trip.products.map((p) => p.name.toLowerCase())
        const message = `Sam: we need ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
        events.push({
          at,
          run: async () => {
            const row = await capture('alex', at, message, 'list')
            const items = (row.extraction ? JSON.parse(row.extraction) : { items: [] }).items as Array<Record<string, unknown>>
            const read = items.map((i) => String(i.name))
            const missing = trip.products.filter((p) => !read.includes(p.name)).map((p) => p.name)
            if (missing.length) warnings.push(`The texted list did not read as expected; missing ${missing.join(', ')}`)
            const reviewed = items.map((i) => ({
              name: String(i.name),
              rawText: i.rawText as string | null,
              quantity: i.quantity as number | null,
              unit: i.unit as string | null,
              note: i.note as string | null,
              category: i.category as Category | null,
              storeHint: i.storeHint as string | null,
            }))
            apply('alex', at + 2 * MINUTE, row, { mode: 'list', items: reviewed })
            for (const product of trip.products) fileUnder('alex', at + 3 * MINUTE, product.name, store.key)
          },
        })
      } else {
        for (const product of trip.products) {
          const earliest = after(product)
          const latest = trip.start - HOUR
          let at = latest
          for (let attempt = 0; attempt < 12; attempt++) {
            const t = between(Math.min(earliest, latest), latest)
            const hour = new Date(t).getHours()
            if (hour >= 7 && hour < 23) {
              at = t
              break
            }
          }
          const member: Member = rand() < 0.55 ? 'alex' : 'sam'
          events.push({
            at,
            run: () => {
              const guess = !productId(product.name) || (product.moved?.store === store.key && !hasChoice(product.name))
              send(member, at, { type: 'item.add', id: randomUUID(), name: product.name, at })
              fileUnder(member, at, product.name, store.key, { guess })
            },
          })
        }
      }
    }
    for (const product of [...trip.products, ...trip.extras]) lastBought.set(product.name, trip.start)

    events.push({
      at: trip.start,
      run: async () => {
        const priceOf = (product: ProductSpec): Omit<Purchase, 'every'> =>
          product.elsewhere && trip.extras.includes(product) ? product.elsewhere : homeOf(product, trip.daysAgo)
        const aisle = (product: ProductSpec) => store.aisles.indexOf(product.category) * 100 + PRODUCTS.indexOf(product)
        let bought: ProductSpec[]
        let t = trip.start
        if (trip.firstReceipt) {
          bought = [...trip.products].sort((a, b) => aisle(a) - aisle(b))
          t += bought.length * 2 * MINUTE
        } else {
          const open = db
            .prepare(
              `SELECT i.id, p.name FROM list_items i JOIN products p ON p.id = i.product_id
               WHERE i.household_id = ? AND i.store_id = ? AND i.checked_at IS NULL AND i.deleted_at IS NULL`,
            )
            .all(householdId, storeIds[store.key]) as { id: string; name: string }[]
          const planned = new Set(trip.products.map((p) => p.name))
          const unexpected = open.filter((i) => !planned.has(i.name)).map((i) => i.name)
          if (unexpected.length) warnings.push(`Unplanned items at ${store.name}: ${unexpected.join(', ')}`)
          const missing = trip.products.filter((p) => !open.some((i) => i.name === p.name)).map((p) => p.name)
          if (missing.length) warnings.push(`Planned for ${store.name} but not on the list: ${missing.join(', ')}`)
          const ordered = open
            .flatMap((item) => {
              const product = PRODUCTS.find((p) => p.name === item.name)
              return product ? [{ item, product }] : []
            })
            .sort((a, b) => aisle(a.product) - aisle(b.product))
          // People do not walk a store in exactly the same order every time.
          for (let i = 0; i + 1 < ordered.length; i++) {
            if (rand() < 0.12) [ordered[i], ordered[i + 1]] = [ordered[i + 1]!, ordered[i]!]
          }
          for (const { item } of ordered) {
            send(shopper, t, { type: 'item.check', id: item.id, checked: true, at: t })
            t += Math.round(between(90, 240)) * 1000
          }
          bought = ordered.map((x) => x.product)
        }

        if (trip.firstReceipt || store.receipt(trip.index) || trip.extras.length) {
          const paidAt = t + 3 * MINUTE
          const lines = [...bought, ...trip.extras].map((product) => {
            const purchase = priceOf(product)
            const sale = rand() < 0.1 ? 0.85 : 1
            const price = Math.round(purchase.price * sale * (1 + between(-0.03, 0.03)) * 100) / 100
            return { product, purchase, price, text: purchase.receipt }
          })
          const capturedAt = paidAt + Math.round(between(8, 40)) * MINUTE
          const row = await capture(shopper, capturedAt, receiptText(store, lines, paidAt), 'receipt')
          apply(shopper, capturedAt + Math.round(between(1, 5)) * MINUTE, row, {
            mode: 'receipt',
            storeId: storeIds[store.key],
            purchasedAt: paidAt,
            items: lines.map(({ product, purchase, price, text }) => ({
              name: product.name,
              rawText: text,
              price,
              quantity: purchase.quantity ?? null,
              unit: purchase.unit ?? null,
              category: product.category,
            })),
          })
        }
        if (!trip.firstReceipt) send(shopper, t + Math.round(between(90, 150)) * MINUTE, { type: 'items.clearChecked', storeId: storeIds[store.key] })
      },
    })
  }

  events.sort((a, b) => a.at - b.at)
  for (const event of events) await event.run()

  // What is on the list today: the next Trader Joe's run, something for Costco, and things the
  // app has never seen (lemons are filed by category, flowers wait in Unsorted).
  const costco = trips.filter((t) => t.store.key === 'costco')
  const nextAtCostco = PRODUCTS.find(
    (p) => homeOf(p, 0).store === 'costco' && costco[costco.length - 2]!.products.includes(p) && !costco[costco.length - 1]!.products.includes(p),
  )
  send(
    'sam',
    now - 22 * HOUR,
    { type: 'item.add', id: randomUUID(), name: 'Greek yogurt', quantity: 2, at: now - 22 * HOUR },
    { type: 'item.add', id: randomUUID(), name: 'Sourdough bread', note: 'Sliced, if they have it', at: now - 22 * HOUR },
  )
  send('sam', now - 21 * HOUR, { type: 'item.add', id: randomUUID(), name: 'Bananas', at: now - 21 * HOUR })
  send(
    'alex',
    now - 3 * HOUR,
    ...['Chicken breast', 'Lemons', ...(nextAtCostco ? [nextAtCostco.name] : []), 'Flowers'].map((name) => ({
      type: 'item.add' as const,
      id: randomUUID(),
      name,
      at: now - 3 * HOUR,
    })),
  )
  await capture('alex', now - 35 * MINUTE, WAITING_MESSAGE, 'auto')

  const count = (sql: string) => (db.prepare(sql).get(householdId) as { n: number }).n
  return {
    householdId,
    stores: STORES.length,
    products: count('SELECT COUNT(*) AS n FROM products WHERE household_id = ?'),
    purchases: count('SELECT COUNT(*) AS n FROM purchases WHERE household_id = ?'),
    receipts: count(`SELECT COUNT(*) AS n FROM captures WHERE household_id = ? AND status = 'applied' AND hint = 'receipt'`),
    openItems: count('SELECT COUNT(*) AS n FROM list_items WHERE household_id = ? AND checked_at IS NULL AND deleted_at IS NULL'),
    toReview: count(`SELECT COUNT(*) AS n FROM captures WHERE household_id = ? AND status = 'ready'`),
    warnings,
  }
}
