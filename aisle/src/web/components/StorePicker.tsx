import { Plus } from 'lucide-react'
import { useState } from 'react'
import { storeKey } from '../../shared/stores'
import type { Store } from '../../shared/types'
import { cx, Input, StoreDot } from './ui'

/**
 * Chips for choosing a store, with "Unsorted" and a way to add a store on the spot.
 * `onCreate` receives the new store's name; the caller creates it and selects it.
 */
export function StorePicker({
  stores,
  value,
  onChange,
  onCreate,
  allowNone = true,
  noneLabel = 'Unsorted',
}: {
  stores: Store[]
  value: string | null
  onChange: (storeId: string | null) => void
  onCreate?: (name: string) => void
  allowNone?: boolean
  noneLabel?: string
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const existing = stores.find((s) => storeKey(s.name) === storeKey(name))

  const chip = (selected: boolean) =>
    cx(
      'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors',
      selected
        ? 'bg-emerald-700 text-white ring-emerald-700'
        : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-700',
    )

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (existing) onChange(existing.id)
    else onCreate?.(trimmed)
    setName('')
    setAdding(false)
  }

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Store">
      {stores.map((store) => (
        <button
          key={store.id}
          type="button"
          role="radio"
          aria-checked={value === store.id}
          className={chip(value === store.id)}
          onClick={() => onChange(store.id)}
        >
          <StoreDot color={store.color} className={value === store.id ? 'ring-2 ring-white/70' : undefined} />
          {store.name}
        </button>
      ))}
      {allowNone && (
        <button type="button" role="radio" aria-checked={value === null} className={chip(value === null)} onClick={() => onChange(null)}>
          {noneLabel}
        </button>
      )}
      {onCreate &&
        (adding ? (
          <form
            className="flex w-full gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Store name"
              aria-label="New store name"
              maxLength={60}
              onBlur={() => !name.trim() && setAdding(false)}
            />
            <button type="submit" className={chip(false)} disabled={!name.trim()}>
              {existing ? `Use ${existing.name}` : 'Add'}
            </button>
          </form>
        ) : (
          <button type="button" className={cx(chip(false), 'border-dashed')} onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            New store
          </button>
        ))}
    </div>
  )
}
