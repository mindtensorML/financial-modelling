import { useEffect, useRef } from 'react'
import type { Insights } from '../../shared/types'
import { api } from './api'
import { observable, useObservable } from './observable'
import { useSync } from './sync'

const insights = observable<Insights | null>(null)
let fetchedRev = -1
let wantedRev = -1
let generation = 0
let timer: ReturnType<typeof setTimeout> | null = null
let dueAt = 0

function refresh(rev: number, delay: number): void {
  wantedRev = rev
  if (rev === fetchedRev) return
  const at = Date.now() + delay
  if (timer) {
    if (dueAt <= at) return
    clearTimeout(timer)
  }
  dueAt = at
  timer = setTimeout(() => {
    timer = null
    const fetching = wantedRev
    const current = generation
    api<Insights>('GET', '/api/insights')
      .then((data) => {
        if (current !== generation) return
        fetchedRev = fetching
        insights.set(data)
      })
      .catch(() => undefined)
  }, delay)
}

export function resetInsights(): void {
  generation++
  if (timer) clearTimeout(timer)
  timer = null
  fetchedRev = wantedRev = -1
  insights.set(null)
}

/**
 * Recomputed on the server. A screen that opens with stale numbers fetches them at once; while it
 * stays open, a burst of edits is fetched once, shortly after it starts.
 */
export function useInsights(): Insights | null {
  const { rev, ready } = useSync()
  const opened = useRef(false)
  useEffect(() => {
    if (!ready) return
    refresh(rev, opened.current && fetchedRev !== -1 ? 1500 : 0)
    opened.current = true
  }, [rev, ready])
  return useObservable(insights)
}
