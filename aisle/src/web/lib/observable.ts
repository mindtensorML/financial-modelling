import { useSyncExternalStore } from 'react'

export interface Observable<T> {
  get(): T
  set(next: T | ((current: T) => T)): void
  subscribe(listener: () => void): () => void
}

export function observable<T>(initial: T): Observable<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (current: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useObservable<T>(source: Pick<Observable<T>, 'get' | 'subscribe'>): T {
  return useSyncExternalStore(source.subscribe, source.get)
}
