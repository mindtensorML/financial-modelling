type Listener = (rev: number) => void

/** Fans "this household changed" notifications out to every connected device. */
export class RealtimeHub {
  private listeners = new Map<string, Set<Listener>>()

  subscribe(householdId: string, listener: Listener): () => void {
    let set = this.listeners.get(householdId)
    if (!set) {
      set = new Set()
      this.listeners.set(householdId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (!set.size) this.listeners.delete(householdId)
    }
  }

  publish(householdId: string, rev: number): void {
    for (const listener of this.listeners.get(householdId) ?? []) listener(rev)
  }

  connectionCount(householdId: string): number {
    return this.listeners.get(householdId)?.size ?? 0
  }
}
