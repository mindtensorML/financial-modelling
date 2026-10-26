export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]!
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

export const CLOSE_MATCH_THRESHOLD = 0.85

/**
 * Typo-level closeness between two name keys. The first letters must agree because
 * typos and OCR slips rarely change them, while real look-alikes often do
 * ("mustard" and "custard").
 */
export function isCloseMatch(a: string, b: string, threshold = CLOSE_MATCH_THRESHOLD): boolean {
  if (a === b) return true
  if (a[0] !== b[0]) return false
  return similarity(a, b) >= threshold
}

export function findClosest<T>(
  key: string,
  candidates: Iterable<{ key: string; value: T }>,
  threshold = CLOSE_MATCH_THRESHOLD,
): { value: T; score: number } | null {
  let best: { value: T; score: number } | null = null
  for (const candidate of candidates) {
    if (candidate.key === key) return { value: candidate.value, score: 1 }
    if (candidate.key[0] !== key[0]) continue
    const score = similarity(key, candidate.key)
    if (score >= threshold && (!best || score > best.score)) best = { value: candidate.value, score }
  }
  return best
}
