import { Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { POPULAR_STORES, storeKey } from '../../shared/stores'
import { sync, useSync } from '../lib/sync'
import { toast } from '../lib/toast'
import { cx, Input } from './ui'

/** One tap per store you shop at; tapping an added one removes it again. */
export function PopularStores() {
  const { stores, items } = useSync()
  const [name, setName] = useState('')
  const byKey = new Map(stores.map((s) => [storeKey(s.name), s]))
  const custom = stores.filter((s) => !POPULAR_STORES.some((p) => storeKey(p) === storeKey(s.name)))

  const toggle = (storeName: string) => {
    const existing = byKey.get(storeKey(storeName))
    if (!existing) {
      sync.enqueue({ type: 'store.upsert', id: crypto.randomUUID(), name: storeName })
      return
    }
    if (items.some((i) => i.storeId === existing.id)) {
      toast(`${existing.name} has items on the list. You can remove it in Settings.`)
      return
    }
    sync.enqueue({ type: 'store.delete', id: existing.id })
  }

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!byKey.has(storeKey(trimmed))) sync.enqueue({ type: 'store.upsert', id: crypto.randomUUID(), name: trimmed })
    setName('')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[...POPULAR_STORES, ...custom.map((s) => s.name)].map((storeName) => {
          const store = byKey.get(storeKey(storeName))
          return (
            <button
              key={storeName}
              type="button"
              aria-pressed={Boolean(store)}
              onClick={() => toggle(storeName)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors',
                store
                  ? 'bg-emerald-700 text-white ring-emerald-700'
                  : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-700',
              )}
            >
              {store ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
              {storeName}
            </button>
          )
        })}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Another store" aria-label="Another store" maxLength={60} />
        <button
          type="submit"
          disabled={!name.trim()}
          className="shrink-0 rounded-xl bg-white px-4 text-sm font-medium ring-1 ring-stone-200 hover:bg-stone-50 disabled:opacity-50 dark:bg-stone-800 dark:ring-stone-700"
        >
          Add
        </button>
      </form>
    </div>
  )
}
