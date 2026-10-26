import { Check, Sparkles } from 'lucide-react'
import type { ListItem } from '../../shared/types'
import { formatQuantity } from '../lib/format'
import { cx } from './ui'

const LEARNED = new Set(['learned', 'category', 'receipt'])

export function ItemRow({
  item,
  onToggle,
  onEdit,
}: {
  item: ListItem
  onToggle: (item: ListItem) => void
  onEdit: (item: ListItem) => void
}) {
  const checked = item.checkedAt !== null
  const quantity = formatQuantity(item.quantity, item.unit)
  const detail = item.note ?? (item.storeId === null ? item.storeReason : null)
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? `Put ${item.name} back on the list` : `Mark ${item.name} as bought`}
        onClick={() => onToggle(item)}
        className={cx(
          'grid size-7 shrink-0 place-items-center rounded-full ring-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
          checked
            ? 'bg-emerald-600 ring-emerald-600 dark:bg-emerald-500 dark:ring-emerald-500'
            : 'ring-stone-300 hover:ring-emerald-500 dark:ring-stone-600',
        )}
      >
        {checked && <Check className="size-4 text-white" strokeWidth={3} aria-hidden />}
      </button>
      <button type="button" onClick={() => onEdit(item)} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left">
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              'block truncate text-[15px] leading-snug',
              checked ? 'text-stone-400 line-through dark:text-stone-500' : 'text-stone-900 dark:text-stone-100',
            )}
          >
            {item.name}
          </span>
          {detail && !checked && <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{detail}</span>}
        </span>
        {!checked && LEARNED.has(item.storeSource) && item.storeReason && (
          <Sparkles className="size-3.5 shrink-0 text-emerald-600/70" aria-label={item.storeReason} />
        )}
        {quantity && (
          <span
            className={cx(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
              checked ? 'text-stone-400' : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
            )}
          >
            {quantity}
          </span>
        )}
      </button>
    </div>
  )
}
