import { Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ListItem } from '../../shared/types'
import { formatQuantity, relativeDay } from '../lib/format'
import { sync, useSync } from '../lib/sync'
import { toast } from '../lib/toast'
import { StorePicker } from './StorePicker'
import { Button, Field, Input, Select, Sheet } from './ui'

export const UNITS = ['', 'lb', 'oz', 'kg', 'g', 'l', 'ml', 'gal', 'dozen', 'pack', 'bag', 'box', 'can', 'bottle', 'bunch', 'jar']

/**
 * Removing an item offers an undo that puts the same thing back. Only a store the user picked is
 * sent again: the server counts an explicit store as a fresh choice, and the others come back
 * from the same prediction.
 */
export function deleteWithUndo(item: ListItem): void {
  sync.enqueue({ type: 'item.delete', id: item.id })
  toast(`Removed ${item.name}`, {
    action: {
      label: 'Undo',
      run: () =>
        sync.enqueue({
          type: 'item.add',
          id: crypto.randomUUID(),
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          note: item.note,
          ...(item.storeSource === 'manual' ? { storeId: item.storeId } : {}),
          at: item.createdAt,
        }),
    },
  })
}

export function ItemSheet({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const { items, stores, products } = useSync()
  const item = items.find((i) => i.id === itemId) ?? null
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!item) return
    setName(item.name)
    setQuantity(item.quantity === null ? '' : String(item.quantity))
    setUnit(item.unit ?? '')
    setNote(item.note ?? '')
    // Only when a different item opens; edits from other devices should not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  if (!item) return <Sheet open={false} title="" onClose={onClose}>{null}</Sheet>
  const product = item.productId ? products.get(item.productId) : undefined

  const save = () => {
    const q = quantity.trim() === '' ? null : Number(quantity)
    const changes = {
      ...(name.trim() && name.trim() !== item.name ? { name: name.trim() } : {}),
      ...((Number.isFinite(q) && q !== null && q > 0 ? q : null) !== item.quantity
        ? { quantity: Number.isFinite(q) && q !== null && q > 0 ? q : null }
        : {}),
      ...((unit || null) !== item.unit ? { unit: unit || null } : {}),
      ...((note.trim() || null) !== item.note ? { note: note.trim() || null } : {}),
    }
    if (Object.keys(changes).length) sync.enqueue({ type: 'item.update', id: item.id, ...changes })
    onClose()
  }

  const moveTo = (storeId: string | null) => {
    if (storeId === item.storeId) return
    sync.enqueue({ type: 'item.setStore', id: item.id, storeId })
    const store = stores.find((s) => s.id === storeId)
    if (store) toast(`${item.name} goes to ${store.name} from now on`)
  }

  const createStore = (storeName: string) => {
    const id = crypto.randomUUID()
    sync.enqueue({ type: 'store.upsert', id, name: storeName }, { type: 'item.setStore', id: item.id, storeId: id })
    toast(`Added ${storeName}`)
  }

  const units = unit && !UNITS.includes(unit) ? [...UNITS, unit] : UNITS

  return (
    <Sheet
      open
      title={item.name}
      onClose={save}
      footer={
        <div className="flex gap-2 pb-3">
          <Button
            variant="ghost"
            className="text-rose-700 dark:text-rose-400"
            onClick={() => {
              deleteWithUndo(item)
              onClose()
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            Remove
          </Button>
          <Button className="ml-auto min-w-28" onClick={save}>
            Done
          </Button>
        </div>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(',', '.'))}
                placeholder="1"
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <Select id={id} value={unit} onChange={(e) => setUnit(e.target.value)}>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u || 'each'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Note">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Brand, size, “if on sale”…" maxLength={500} />}
        </Field>
        <button type="submit" hidden />
      </form>

      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300">Store</h3>
        <StorePicker stores={stores} value={item.storeId} onChange={moveTo} onCreate={createStore} />
        <p className="flex items-start gap-1.5 pt-1 text-xs text-stone-500 dark:text-stone-400">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
          <span>
            {item.storeReason ? `${item.storeReason}. ` : ''}
            Moving an item teaches Aisle where you buy it.
          </span>
        </p>
      </div>

      {product && product.purchaseCount > 0 && (
        <p className="mt-5 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          Bought {product.purchaseCount === 1 ? 'once' : `${product.purchaseCount} times`}
          {product.lastPurchasedAt ? `, last ${relativeDay(product.lastPurchasedAt)}` : ''}.
          {item.quantity !== null && ` On the list: ${formatQuantity(item.quantity, item.unit) ?? '1'}.`}
        </p>
      )}
    </Sheet>
  )
}
