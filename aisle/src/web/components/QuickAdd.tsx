import { Mic, MicOff, Plus } from 'lucide-react'
import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react'
import type { ListItem } from '../../shared/types'
import { plural } from '../lib/format'
import { applySuggestion, currentSegment, parseQuickAdd, type QuickAddItem, suggestProducts } from '../lib/quickAdd'
import { useDictation } from '../lib/speech'
import { sync, useSync } from '../lib/sync'
import { toast } from '../lib/toast'
import { cx, StoreDot } from './ui'

/** Adds items and says where each one was filed, which is how people discover the grouping. */
export function addItems(entries: QuickAddItem[], storeId: string | null = null): void {
  if (!entries.length) return
  const ids = entries.map(() => crypto.randomUUID())
  sync.enqueue(
    ...entries.map((entry, i) => ({
      type: 'item.add' as const,
      id: ids[i]!,
      name: entry.name,
      quantity: entry.quantity,
      unit: entry.unit,
      note: entry.note,
      ...(storeId && !entry.storeHint ? { storeId } : {}),
      storeHint: entry.storeHint,
      at: Date.now(),
    })),
  )
  const { items, storesById } = sync.state.get()
  const placed = ids.map((id) => items.find((i) => i.id === id))
  // A store named with "@" that does not exist yet is created by the server.
  const where = (item: ListItem) =>
    (item.storeId ? storesById.get(item.storeId)?.name : item.storeReason?.replace(/^Going to /, '')) ?? 'Unsorted'
  if (placed.every((item) => !item)) {
    toast(`Already on the list: ${entries.map((e) => e.name).join(', ')}`)
    return
  }
  if (entries.length === 1) {
    const item = placed[0]!
    toast(where(item) === 'Unsorted' ? `Added ${item.name} to Unsorted. Tap it to pick its store.` : `Added ${item.name} to ${where(item)}`)
    return
  }
  const counts = new Map<string, number>()
  let merged = 0
  for (const item of placed) {
    if (!item) merged++
    else counts.set(where(item), (counts.get(where(item)) ?? 0) + 1)
  }
  const added = plural(entries.length - merged, 'item')
  const already = merged ? ` (${merged} already on the list)` : ''
  if (counts.size === 1) {
    const [place] = counts.keys()
    toast(
      place === 'Unsorted'
        ? `Added ${added} to Unsorted${already}. Tap one to pick its store.`
        : `Added ${added} to ${place}${already}`,
    )
    return
  }
  toast(`Added ${added}: ${[...counts].map(([name, n]) => `${n} to ${name}`).join(', ')}${already}`)
}

export function QuickAdd({ storeId }: { storeId: string | null }) {
  const { products, items, stores, storesById } = useSync()
  const [text, setText] = useState('')
  const [dictated, setDictated] = useState(false)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  const dictation = useDictation((phrase) => {
    setDictated(true)
    setText((current) => (current.trim() ? `${current.replace(/[\s,]+$/, '')}, ${phrase}` : phrase))
  })

  const openProducts = useMemo(
    () => new Set(items.filter((i) => !i.checkedAt && i.productId).map((i) => i.productId!)),
    [items],
  )
  const query = currentSegment(text).query
  const suggestions = useMemo(
    () => (focused && query ? suggestProducts(query, products.values(), openProducts) : []),
    [focused, query, products, openProducts],
  )

  const submit = (value = text) => {
    if (dictation.listening) dictation.stop()
    const entries = parseQuickAdd(
      value,
      stores.map((s) => s.name),
      [...products.values()].map((p) => p.name),
      { splitRuns: dictated },
    )
    if (!entries.length) return
    addItems(entries, storeId)
    setText('')
    setDictated(false)
    setActive(-1)
  }

  const choose = (index: number) => {
    const suggestion = suggestions[index]
    if (!suggestion) return
    submit(applySuggestion(text, suggestion.product.name))
    input.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (event.key === 'Escape') {
      setActive(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active >= 0 && suggestions[active]) choose(active)
      else submit()
    }
  }

  const showList = suggestions.length > 0
  return (
    <div className="relative px-4 pb-2">
      <form
        className="flex items-center gap-1 rounded-2xl bg-white py-1 pr-1 pl-3.5 shadow-sm ring-1 ring-stone-200 focus-within:ring-2 focus-within:ring-emerald-600 dark:bg-stone-900 dark:ring-stone-700"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Plus className="size-5 shrink-0 text-stone-400" aria-hidden />
        <input
          ref={input}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setActive(-1)
            if (!event.target.value) setDictated(false)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={
            dictation.listening ? 'Listening…' : storeId ? `Add to ${storesById.get(storeId)?.name ?? 'this store'}…` : 'Add items…'
          }
          aria-label="Add items"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="on"
          className="h-10 min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-stone-400 focus:outline-none"
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={dictation.listening ? dictation.stop : dictation.start}
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate items'}
            aria-pressed={dictation.listening}
            className={cx(
              'grid size-9 shrink-0 place-items-center rounded-xl transition-colors',
              dictation.listening
                ? 'animate-pulse bg-rose-600 text-white'
                : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800',
            )}
          >
            {dictation.listening ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim()}
          className="h-9 shrink-0 rounded-xl bg-emerald-700 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:bg-stone-200 disabled:text-stone-400 dark:disabled:bg-stone-800 dark:disabled:text-stone-500"
        >
          Add
        </button>
      </form>
      {dictation.interim || dictation.error ? (
        <p className={cx('px-2 pt-1.5 text-xs', dictation.error ? 'text-rose-700 dark:text-rose-400' : 'text-stone-500 italic')}>
          {dictation.error ?? dictation.interim}
        </p>
      ) : (
        focused &&
        !text && (
          <p className="px-2 pt-1.5 text-xs text-stone-500 dark:text-stone-400">
            Separate items with commas, like <span className="font-medium">2 avocados, oat milk</span>. End with{' '}
            <span className="font-medium">@store</span> to file them there.
          </p>
        )
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-4 top-full z-40 -mt-1 overflow-hidden rounded-2xl bg-white py-1 shadow-lg ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700"
        >
          {suggestions.map(({ product, onList }, index) => {
            const store = product.predictedStoreId ? storesById.get(product.predictedStoreId) : undefined
            return (
              <li
                key={product.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                className={cx(
                  'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[15px]',
                  index === active ? 'bg-emerald-50 dark:bg-emerald-950/60' : 'hover:bg-stone-50 dark:hover:bg-stone-800',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                {onList ? (
                  <span className="text-xs text-stone-400">on the list</span>
                ) : (
                  store && (
                    <span className="flex items-center gap-1.5 text-xs text-stone-500">
                      <StoreDot color={store.color} />
                      {store.name}
                    </span>
                  )
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
