const DAY = 86_400_000

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/** "2", "1.5 lb", "1 dozen"; nothing for a single unit-less item. */
export function formatQuantity(quantity: number | null, unit: string | null): string | null {
  if (quantity === null) return unit
  if (!unit) return quantity === 1 ? null : trimNumber(quantity)
  return `${trimNumber(quantity)} ${unit}`
}

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR',
  AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', AU: 'AUD', NZ: 'NZD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', JP: 'JPY', IN: 'INR', MX: 'MXN', BR: 'BRL', ZA: 'ZAR', SG: 'SGD', HK: 'HKD', KR: 'KRW', IL: 'ILS',
}

export function localCurrency(locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language): string {
  try {
    const region = new Intl.Locale(locale).maximize().region
    return (region && REGION_CURRENCY[region]) || 'USD'
  } catch {
    return 'USD'
  }
}

export function formatMoney(amount: number, currency: string = localCurrency()): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return amount.toFixed(2)
  }
}

export const formatCents = (cents: number, currency?: string) => formatMoney(cents / 100, currency)

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function relativeDay(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60 && startOfDay(at) === startOfDay(now)) return `${Math.round(minutes / 60)} h ago`
  return relativeDay(at, now)
}

export function describeInterval(days: number): string {
  if (days < 1.5) return 'daily'
  if (days < 12) return `every ${Math.round(days)} days`
  if (days < 26) return `every ${Math.round(days / 7)} weeks`
  if (days < 45) return 'monthly'
  return `every ${Math.round(days / 30)} months`
}

/**
 * Receipts print local times without a zone ("2026-10-24T17:42" or "2026-10-24"); this gives
 * the value for a datetime-local input, assuming midday when there is no time.
 */
export function toDateTimeInput(value: string | number | null, fallback = Date.now()): string {
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(value)
    if (m) return `${m[1]}T${m[2] ?? '12:00'}`
  }
  const d = new Date(typeof value === 'number' ? value : fallback)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Reads a datetime-local value in the device's time zone. */
export function fromDateTimeInput(value: string): number | null {
  const at = new Date(value).getTime()
  return Number.isFinite(at) ? at : null
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
