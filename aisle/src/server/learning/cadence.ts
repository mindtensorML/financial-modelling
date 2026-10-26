const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A receipt and a check-off from the same trip are one purchase, not two. */
const SAME_PURCHASE_MS = 12 * HOUR
const MIN_PURCHASE_DAYS = 3
/** Only recent gaps count, so a change of habit shows up within a couple of months. */
const RECENT_GAPS = 8

export interface Cadence {
  intervalDays: number
  lastPurchasedAt: number
  purchaseDays: number
}

export interface DueStatus {
  daysSinceLast: number
  /** How far through the usual interval we are: 1 means exactly one interval since the last purchase. */
  progress: number
  due: boolean
}

export function purchaseDays(times: number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b)
  const days: number[] = []
  for (const t of sorted) if (!days.length || t - days[days.length - 1]! >= SAME_PURCHASE_MS) days.push(t)
  return days
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * The usual gap between purchases: the median of recent gaps, which ignores the odd week of
 * buying twice or forgetting. Needs at least three purchase days to say anything.
 */
export function cadence(times: number[]): Cadence | null {
  const days = purchaseDays(times)
  if (days.length < MIN_PURCHASE_DAYS) return null
  const gaps = days.slice(1).map((t, i) => (t - days[i]!) / DAY)
  return {
    intervalDays: Math.round(median(gaps.slice(-RECENT_GAPS)) * 10) / 10,
    lastPurchasedAt: days[days.length - 1]!,
    purchaseDays: days.length,
  }
}

/**
 * Suggests an item a little before it is due (up to three days early for long intervals) and
 * stops once it is so overdue that the household has probably stopped buying it.
 */
export function dueStatus(c: Cadence, now: number): DueStatus {
  const daysSinceLast = Math.max(0, (now - c.lastPurchasedAt) / DAY)
  const lead = Math.min(3, Math.max(1, c.intervalDays * 0.15))
  const abandoned = daysSinceLast > c.intervalDays * 3 + 14
  return {
    daysSinceLast,
    progress: daysSinceLast / c.intervalDays,
    due: !abandoned && daysSinceLast >= c.intervalDays - lead,
  }
}

export function describeInterval(days: number): string {
  if (days < 1.5) return 'about every day'
  if (days < 10) return `about every ${Math.round(days)} days`
  if (days < 56) {
    const weeks = Math.round(days / 7)
    return weeks === 1 ? 'about every week' : `about every ${weeks} weeks`
  }
  const months = Math.round(days / 30)
  return months === 1 ? 'about every month' : `about every ${months} months`
}

export function describeAgo(days: number): string {
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 14) return `${Math.floor(days)} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}
