import type { Category } from '../../shared/categories'
import type { WalkOrder } from '../../shared/types'
import { decay } from './predictStore'

const MINUTE = 60_000
const TRIP_GAP_MS = 90 * MINUTE
const MIN_TRIP_ITEMS = 3
/** Ticking everything off in a few seconds at home says nothing about the aisles. */
const MIN_TRIP_SPAN_MS = 3 * MINUTE

export interface Checkoff {
  storeId: string
  productId: string
  category: Category
  at: number
}

/** Check-offs at one store with less than 90 minutes between them are one shopping trip. */
export function trips(checkoffs: Checkoff[]): Checkoff[][] {
  const byStore = new Map<string, Checkoff[]>()
  for (const c of checkoffs) {
    const list = byStore.get(c.storeId) ?? []
    list.push(c)
    byStore.set(c.storeId, list)
  }
  const result: Checkoff[][] = []
  for (const list of byStore.values()) {
    list.sort((a, b) => a.at - b.at)
    let trip: Checkoff[] = []
    for (const c of list) {
      if (trip.length && c.at - trip[trip.length - 1]!.at >= TRIP_GAP_MS) {
        result.push(trip)
        trip = []
      }
      trip.push(c)
    }
    if (trip.length) result.push(trip)
  }
  return result
}

class WeightedMean {
  private sums = new Map<string, { total: number; weight: number }>()

  add(key: string, value: number, weight: number): void {
    const s = this.sums.get(key) ?? { total: 0, weight: 0 }
    s.total += value * weight
    s.weight += weight
    this.sums.set(key, s)
  }

  result(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [key, s] of this.sums) out[key] = Math.round((s.total / s.weight) * 1000) / 1000
    return out
  }
}

/**
 * Where in each store things get picked up: 0 is the first thing in the cart, 1 the last.
 * Each trip spreads its check-offs evenly over 0..1, and recent trips count more, so a store
 * that rearranges its aisles is relearned.
 */
export function walkOrders(checkoffs: Checkoff[], now: number): Record<string, WalkOrder> {
  const perStore = new Map<string, { products: WeightedMean; categories: WeightedMean }>()
  for (const trip of trips(checkoffs)) {
    if (trip.length < MIN_TRIP_ITEMS || trip[trip.length - 1]!.at - trip[0]!.at < MIN_TRIP_SPAN_MS) continue
    const storeId = trip[0]!.storeId
    const acc = perStore.get(storeId) ?? { products: new WeightedMean(), categories: new WeightedMean() }
    perStore.set(storeId, acc)
    const weight = decay(now - trip[0]!.at)
    trip.forEach((c, i) => {
      const position = i / (trip.length - 1)
      acc.products.add(c.productId, position, weight)
      acc.categories.add(c.category, position, weight)
    })
  }
  const result: Record<string, WalkOrder> = {}
  for (const [storeId, acc] of perStore) {
    result[storeId] = { products: acc.products.result(), categories: acc.categories.result() as WalkOrder['categories'] }
  }
  return result
}
