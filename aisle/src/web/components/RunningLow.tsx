import { Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { DueSoon } from '../../shared/types'
import { useSync } from '../lib/sync'
import { addItems } from './QuickAdd'
import { Button, Card, StoreDot } from './ui'

/** Things the household buys regularly and is about due for, one tap from the list. */
export function RunningLow({ due, limit = 3 }: { due: DueSoon[]; limit?: number }) {
  const [all, setAll] = useState(false)
  const { storesById } = useSync()
  const shown = all ? due : due.slice(0, limit)
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-x-2 px-4 pt-3 pb-1">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-emerald-600" aria-hidden />
          Running low?
        </h2>
        <span className="text-sm text-stone-500">From how often you buy these</span>
      </div>
      <ul className="divide-y divide-stone-100 dark:divide-stone-800/70">
        {shown.map((d) => {
          const store = d.storeId ? storesById.get(d.storeId) : undefined
          return (
            <li key={d.productId} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{d.name}</p>
                <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                  {store && (
                    <>
                      <StoreDot color={store.color} className="mr-1 size-2" />
                      {store.name} ·{' '}
                    </>
                  )}
                  {d.reason}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Add ${d.name} to the list`}
                onClick={() => addItems([{ name: d.name, quantity: null, unit: null, note: null, storeHint: null }])}
              >
                <Plus className="size-4" aria-hidden />
                Add
              </Button>
            </li>
          )
        })}
      </ul>
      {due.length > limit && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="w-full border-t border-stone-100 px-4 py-2 text-left text-sm font-medium text-emerald-700 dark:border-stone-800 dark:text-emerald-400"
        >
          {all ? 'Show fewer' : `Show ${due.length - limit} more`}
        </button>
      )}
    </Card>
  )
}
