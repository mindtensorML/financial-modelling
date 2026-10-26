export interface PricedPurchase {
  productId: string
  storeId: string
  at: number
  priceCents: number
  quantity: number | null
  unit: string | null
}

export interface StorePrice {
  storeId: string
  /** Prices are per this unit ("lb", "oz"), or per item when null. */
  unit: string | null
  averageCents: number
  lastCents: number
  samples: number
}

/** Smaller differences than this are noise from sales and rounding, not a reason to switch stores. */
const MIN_SAVING_SHARE = 0.1
const MIN_SAVING_CENTS = 20

function unitCents(p: PricedPurchase): number {
  const quantity = p.quantity && p.quantity > 0 ? p.quantity : 1
  return p.priceCents / quantity
}

/** Average and latest unit price of each product at each store, from receipt lines. */
export function priceStats(purchases: PricedPurchase[]): Map<string, StorePrice[]> {
  const groups = new Map<string, PricedPurchase[]>()
  for (const p of purchases) {
    if (p.priceCents <= 0) continue
    const key = `${p.productId}\u0000${p.storeId}\u0000${p.unit ?? ''}`
    const list = groups.get(key) ?? []
    list.push(p)
    groups.set(key, list)
  }
  const result = new Map<string, StorePrice[]>()
  for (const list of groups.values()) {
    list.sort((a, b) => a.at - b.at)
    const first = list[0]!
    const unitPrices = list.map(unitCents)
    const stats: StorePrice = {
      storeId: first.storeId,
      unit: first.unit,
      averageCents: Math.round(unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length),
      lastCents: Math.round(unitPrices[unitPrices.length - 1]!),
      samples: list.length,
    }
    const forProduct = result.get(first.productId) ?? []
    forProduct.push(stats)
    result.set(first.productId, forProduct)
  }
  for (const list of result.values()) list.sort((a, b) => b.samples - a.samples || a.averageCents - b.averageCents)
  return result
}

/** A store where the same unit of this product has cost clearly less than at the usual store. */
export function cheaperAt(prices: StorePrice[], usualStoreId: string | null): { storeId: string; savingsCents: number } | null {
  if (!usualStoreId) return null
  let best: { storeId: string; savingsCents: number } | null = null
  for (const usual of prices.filter((p) => p.storeId === usualStoreId)) {
    for (const other of prices) {
      if (other.storeId === usualStoreId || other.unit !== usual.unit) continue
      const saving = usual.averageCents - other.averageCents
      if (saving >= MIN_SAVING_CENTS && saving >= usual.averageCents * MIN_SAVING_SHARE && (!best || saving > best.savingsCents)) {
        best = { storeId: other.storeId, savingsCents: saving }
      }
    }
  }
  return best
}
