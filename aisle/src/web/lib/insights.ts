import { useEffect } from 'react'
import type { Insights } from '../../shared/types'
import { api } from './api'
import { observable, useObservable } from './observable'
import { useSync } from './sync'

const insights = observable<Insights | null>(null)
let fetchedRev = -1
let timer: ReturnType<typeof setTimeout> | null = null

function refresh(rev: number, delay: number): void {
  if (rev === fetchedRev) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    api<Insights>('GET', '/api/insights')
      .then((data) => {
        fetchedRev = rev
        insights.set(data)
      })
      .catch(() => undefined)
  }, delay)
}

export function resetInsights(): void {
  fetchedRev = -1
  insights.set(null)
}

/** Recomputed on the server; fetched again shortly after the household's data changes. */
export function useInsights(): Insights | null {
  const { rev, ready } = useSync()
  useEffect(() => {
    if (ready) refresh(rev, fetchedRev === -1 ? 0 : 1500)
  }, [rev, ready])
  return useObservable(insights)
}
