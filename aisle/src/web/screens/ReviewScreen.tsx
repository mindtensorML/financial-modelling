import { AlertTriangle, ArrowLeft, Check, FileText, LoaderCircle, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { storeKey } from '../../shared/stores'
import type { Capture, CaptureHint, CaptureResult, Extraction, Store } from '../../shared/types'
import { UNITS } from '../components/ItemSheet'
import { ScreenHeader } from '../components/Layout'
import { StorePicker } from '../components/StorePicker'
import { Button, Card, cx, EmptyState, Field, IconButton, Input, Segmented, Select, Spinner } from '../components/ui'
import { api, ApiError, errorMessage } from '../lib/api'
import { captureDetail, captureFileUrl, captureTitle } from '../lib/captures'
import { formatMoney, localCurrency, plural, relativeTime } from '../lib/format'
import {
  blankLine,
  buildApplyBody,
  includedLines,
  initialForm,
  linesTotal,
  NEW_STORE,
  receiptListEffect,
  receiptTime,
  type ReviewForm,
  type ReviewLine,
  type ReviewMode,
} from '../lib/review'
import { navigate } from '../lib/router'
import { sync, useSync } from '../lib/sync'
import { toast } from '../lib/toast'

const ENGINE: Record<string, string> = {
  ai: 'Read by AI',
  ocr: 'Read with OCR',
  rules: 'Read with the built-in parser',
}

const RETRY_HINTS: Array<{ value: CaptureHint; label: string }> = [
  { value: 'auto', label: 'Work it out' },
  { value: 'list', label: 'Shopping list' },
  { value: 'receipt', label: 'Receipt' },
]

async function captureAction(capture: Capture, action: 'retry' | 'dismiss', body?: unknown): Promise<Capture | null> {
  try {
    const updated = await api<Capture>('POST', `/api/captures/${capture.id}/${action}`, body ?? {})
    sync.putCapture(updated)
    return updated
  } catch (error) {
    toast(errorMessage(error), { tone: 'error' })
    return null
  }
}

async function deleteCapture(capture: Capture): Promise<void> {
  try {
    await api('DELETE', `/api/captures/${capture.id}`)
    sync.putCapture({ ...capture, deletedAt: Date.now() })
    toast('Capture deleted')
    navigate('/capture', { replace: true })
  } catch (error) {
    toast(errorMessage(error), { tone: 'error' })
  }
}

function Preview({ capture }: { capture: Capture }) {
  const [open, setOpen] = useState(false)
  if (capture.media === 'image') {
    return (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Shrink the photo' : 'Show the whole photo'}
        className="block w-full overflow-hidden rounded-2xl bg-stone-200 ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-800"
      >
        <img
          src={captureFileUrl(capture.id)}
          alt={captureTitle(capture)}
          className={cx(
            'w-full object-contain transition-[max-height]',
            // Collapsed, show the top: where a receipt names the store and a list starts.
            open ? 'max-h-[80dvh]' : 'max-h-56 object-cover object-top',
          )}
        />
      </button>
    )
  }
  const text = capture.media === 'audio' ? capture.transcript : capture.textInput
  return (
    <Card className="space-y-3 p-4">
      {capture.media === 'audio' && <audio controls preload="none" src={captureFileUrl(capture.id)} className="w-full" />}
      {text ? (
        <div>
          {capture.media === 'audio' && <p className="mb-1 text-xs font-medium text-stone-500">Transcript</p>}
          <p className={cx('text-sm whitespace-pre-wrap text-stone-700 dark:text-stone-300', !open && 'line-clamp-4')}>{text}</p>
          {text.length > 240 && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {open ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>
      ) : (
        capture.media === 'text' && <p className="flex items-center gap-2 text-sm text-stone-500"><FileText className="size-4" aria-hidden /> Text capture</p>
      )}
    </Card>
  )
}

function StatusCard({ icon, title, children, tone = 'default' }: { icon: ReactNode; title: string; children?: ReactNode; tone?: 'default' | 'error' }) {
  return (
    <Card className={cx('p-5', tone === 'error' && 'ring-rose-200 dark:ring-rose-900')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'grid size-10 shrink-0 place-items-center rounded-xl',
            tone === 'error' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {children && <div className="mt-1 space-y-3 text-sm text-stone-600 dark:text-stone-400">{children}</div>}
        </div>
      </div>
    </Card>
  )
}

function RetryControls({ capture, label }: { capture: Capture; label: string }) {
  const [hint, setHint] = useState<CaptureHint>(capture.hint)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-stone-600 dark:text-stone-400">Read it as</span>
        <Segmented label="Read it as" value={hint} options={RETRY_HINTS} onChange={setHint} />
      </div>
      <div className="flex gap-2">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true)
            await captureAction(capture, 'retry', { hint })
            setBusy(false)
          }}
        >
          <RotateCcw className="size-4" aria-hidden />
          {label}
        </Button>
        <Button variant="ghost" className="text-rose-700 dark:text-rose-400" onClick={() => void deleteCapture(capture)}>
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>
    </div>
  )
}

function summary(result: CaptureResult, stores: Map<string, Store>, newStoreName: string | null): string {
  if (result.mode === 'list') {
    const merged = result.merged ? ` (${result.merged} already on it)` : ''
    return `Added ${plural(result.added + result.merged, 'item')} to your list${merged}`
  }
  // A store the receipt created has not synced yet.
  const store = result.storeId ? (stores.get(result.storeId)?.name ?? newStoreName) : null
  const checked = result.checkedOff ? `, checked off ${result.checkedOff}` : ''
  return `Recorded ${plural(result.purchases, 'purchase')}${store ? ` at ${store}` : ''}${checked}`
}

function LineEditor({
  line,
  mode,
  storeOptions,
  currency,
  effect,
  onChange,
  onRemove,
}: {
  line: ReviewLine
  mode: ReviewMode
  storeOptions: Array<{ value: string; label: string }>
  currency: string
  /** Receipts: what recording this line does to the list. */
  effect: ReturnType<typeof receiptListEffect>
  onChange: (patch: Partial<ReviewLine>) => void
  onRemove: () => void
}) {
  const options = line.defaultStore === '' ? [{ value: '', label: 'Unsorted' }, ...storeOptions] : storeOptions
  const known = options.some((o) => o.value === line.store)
  const raw = line.rawText && line.rawText.trim().toLowerCase() !== line.name.trim().toLowerCase() ? line.rawText : null
  const reason = mode === 'list' && line.store === line.defaultStore ? line.reason : null
  const onList = mode === 'list' && line.onList
  return (
    <li className={cx('flex gap-3 px-4 py-3', !line.include && 'opacity-55')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={line.include}
        aria-label={line.include ? `Leave out ${line.name || 'this line'}` : `Include ${line.name || 'this line'}`}
        onClick={() => onChange({ include: !line.include })}
        className={cx(
          'mt-2.5 grid size-6 shrink-0 place-items-center rounded-md ring-2 transition-colors',
          line.include ? 'bg-emerald-600 ring-emerald-600 text-white' : 'ring-stone-300 dark:ring-stone-600',
        )}
      >
        {line.include && <Check className="size-4" strokeWidth={3} aria-hidden />}
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex gap-2">
          <Input
            value={line.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Item name"
            aria-label="Item name"
            maxLength={200}
            className="py-2"
          />
          {line.originalName === null && (
            <IconButton label="Remove this line" onClick={onRemove}>
              <X className="size-4" />
            </IconButton>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            inputMode="decimal"
            placeholder="Qty"
            aria-label={`Amount of ${line.name || 'this item'}`}
            className="w-16 py-1.5 text-sm"
          />
          <Input
            value={line.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
            list="review-units"
            placeholder="unit"
            aria-label={`Unit for ${line.name || 'this item'}`}
            maxLength={20}
            className="w-20 py-1.5 text-sm"
          />
          {mode === 'list' ? (
            <Select
              value={known ? line.store : ''}
              onChange={(e) => onChange({ store: e.target.value })}
              aria-label={`Store for ${line.name || 'this item'}`}
              className="h-auto min-w-0 flex-1 py-1.5 text-sm"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <div className="relative min-w-0 flex-1">
              <Input
                value={line.price}
                onChange={(e) => onChange({ price: e.target.value })}
                inputMode="decimal"
                placeholder={formatMoney(0, currency)}
                aria-label={`Price of ${line.name || 'this item'}`}
                className="py-1.5 text-right text-sm tabular-nums"
              />
            </div>
          )}
        </div>
        {(raw || reason || onList || (mode === 'receipt' && effect)) && (
          <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
            {raw && <span className="font-mono">“{raw}”</span>}
            {reason && <span>{reason}</span>}
            {onList && <span className="font-medium text-emerald-700 dark:text-emerald-400">Already on your list</span>}
            {mode === 'receipt' && effect === 'checksOff' && (
              <span className="font-medium text-emerald-700 dark:text-emerald-400">Checks it off your list</span>
            )}
            {mode === 'receipt' && effect === 'addedAfter' && <span>Stays on your list: it was added after this trip</span>}
          </p>
        )}
      </div>
    </li>
  )
}

function Editor({ capture, extraction }: { capture: Capture; extraction: Extraction }) {
  const { stores, storesById, items, products } = useSync()
  const [form, setForm] = useState<ReviewForm>(() => initialForm(capture, extraction))
  const [busy, setBusy] = useState(false)
  const currency = extraction.currency ?? localCurrency()

  const setLine = (key: string, patch: Partial<ReviewLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))

  // Stores the form may create, alongside the household's own.
  const newNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const value of [form.receiptStore, ...form.lines.map((l) => l.store), ...form.lines.map((l) => l.defaultStore)]) {
      if (!value.startsWith(NEW_STORE)) continue
      const name = value.slice(NEW_STORE.length)
      if (!stores.some((s) => storeKey(s.name) === storeKey(name))) names.set(value, name)
    }
    return names
  }, [form, stores])

  const storeOptions = [
    ...stores.map((s) => ({ value: s.id, label: s.name })),
    ...[...newNames].map(([value, name]) => ({ value, label: `${name} (new)` })),
  ]

  const pickerStores: Store[] = [
    ...stores,
    ...[...newNames]
      .filter(([value]) => value === form.receiptStore)
      .map(([value, name]) => ({
        id: value,
        name: `${name} (new)`,
        color: '#a8a29e',
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
        rev: 0,
      })),
  ]

  const included = includedLines(form.lines)
  const tripAt = receiptTime(form, capture.createdAt)
  const total = form.mode === 'receipt' ? linesTotal(form.lines) : null
  const mismatch = total !== null && extraction.total !== null && Math.abs(total - extraction.total) > 0.05
  const fileAll = (store: string) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.include ? { ...l, store } : l)) }))

  const apply = async () => {
    setBusy(true)
    try {
      const { result } = await api<{ result: CaptureResult }>('POST', `/api/captures/${capture.id}/apply`, buildApplyBody(form))
      sync.putCapture({ ...capture, status: 'applied', result, updatedAt: Date.now() })
      void sync.pull()
      const typed = form.receiptStore.startsWith(NEW_STORE) ? form.receiptStore.slice(NEW_STORE.length) : null
      toast(summary(result, storesById, typed))
      navigate('/')
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' })
      if (error instanceof ApiError && error.status === 409) void sync.pull()
      setBusy(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="What this is"
            value={form.mode}
            options={[
              { value: 'list', label: 'Shopping list' },
              { value: 'receipt', label: 'Receipt' },
            ]}
            onChange={(mode) => setForm((f) => ({ ...f, mode }))}
          />
          {capture.engine && <span className="text-xs text-stone-500">{ENGINE[capture.engine]}</span>}
        </div>

        <p className="text-sm text-stone-600 dark:text-stone-400">
          {form.mode === 'list'
            ? 'These go on your shopping list, each filed under its store. Fix anything that was misread.'
            : 'These are recorded as purchases, so Aisle learns where you buy things, how often, and at what price. Items that were on your list before this trip are checked off.'}
        </p>

        {extraction.warnings.map((warning) => (
          <p
            key={warning}
            className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {warning}
          </p>
        ))}

        {form.mode === 'receipt' && (
          <Card className="space-y-4 p-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300">Store</h3>
              <StorePicker
                stores={pickerStores}
                value={form.receiptStore || null}
                onChange={(id) => setForm((f) => ({ ...f, receiptStore: id ?? '' }))}
                onCreate={(name) => {
                  const existing = stores.find((s) => storeKey(s.name) === storeKey(name))
                  setForm((f) => ({ ...f, receiptStore: existing ? existing.id : `${NEW_STORE}${name}` }))
                }}
                noneLabel="Not sure"
              />
            </div>
            <Field label="When">
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={form.purchasedAt}
                  onChange={(e) => setForm((f) => ({ ...f, purchasedAt: e.target.value }))}
                />
              )}
            </Field>
            {(total !== null || extraction.total !== null) && (
              <p className={cx('text-sm', mismatch ? 'text-amber-800 dark:text-amber-300' : 'text-stone-600 dark:text-stone-400')}>
                {total !== null && <>Lines add up to {formatMoney(total, currency)}. </>}
                {extraction.total !== null && <>The receipt says {formatMoney(extraction.total, currency)}. </>}
                {mismatch && 'The difference is usually tax, deposits, or discounts, but check for a missed line.'}
              </p>
            )}
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2.5 dark:border-stone-800">
            <h3 className="flex-1 font-semibold">
              {plural(included.length, 'item')}
              {included.length !== form.lines.length && (
                <span className="font-normal text-stone-500"> of {form.lines.length}</span>
              )}
            </h3>
            {form.mode === 'list' && stores.length > 0 && included.length > 1 && (
              <Select
                value=""
                onChange={(e) => e.target.value && fileAll(e.target.value)}
                aria-label="File every item under one store"
                className="h-auto w-auto py-1 pr-8 text-sm"
              >
                <option value="">All to one store…</option>
                {storeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {form.lines.length === 0 ? (
            <p className="px-4 py-4 text-sm text-stone-500">No items were found. Add them below, or read it again as a different kind.</p>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {form.lines.map((line) => (
                <LineEditor
                  key={line.key}
                  line={line}
                  mode={form.mode}
                  storeOptions={storeOptions}
                  currency={currency}
                  effect={form.mode === 'receipt' ? receiptListEffect(line, items, products, tripAt) : null}
                  onChange={(patch) => setLine(line.key, patch)}
                  onRemove={() => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== line.key) }))}
                />
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}
            className="flex w-full items-center gap-2 border-t border-stone-100 px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-stone-50 dark:border-stone-800 dark:text-emerald-400 dark:hover:bg-stone-800/50"
          >
            <Plus className="size-4" aria-hidden />
            Add a line
          </button>
          <datalist id="review-units">
            {UNITS.filter(Boolean).map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Card>
        {extraction.notes && <p className="px-1 text-xs text-stone-500">Note from the reader: {extraction.notes}</p>}
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/95">
        <div className="mx-auto flex max-w-2xl gap-2 px-4 py-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              if (await captureAction(capture, 'dismiss')) navigate('/capture')
            }}
          >
            Dismiss
          </Button>
          <Button className="flex-1" size="lg" loading={busy} disabled={!included.length} onClick={() => void apply()}>
            {form.mode === 'list' ? `Add ${plural(included.length, 'item')}` : `Record ${plural(included.length, 'purchase')}`}
          </Button>
        </div>
      </div>
    </>
  )
}

export function ReviewScreen({ id }: { id: string }) {
  const { captures, ready } = useSync()
  const fromSync = captures.find((c) => c.id === id) ?? null
  const [fetched, setFetched] = useState<Capture | null | 'missing'>(null)
  const capture = fromSync ?? (fetched !== 'missing' ? fetched : null)

  useEffect(() => {
    if (fromSync || !ready) return
    let cancelled = false
    api<Capture>('GET', `/api/captures/${encodeURIComponent(id)}`)
      .then((c) => !cancelled && setFetched(c.deletedAt ? 'missing' : c))
      .catch((error: unknown) => !cancelled && setFetched(error instanceof ApiError && error.status === 404 ? 'missing' : null))
    return () => {
      cancelled = true
    }
  }, [id, fromSync, ready])

  const back = (
    <IconButton label="Back to captures" onClick={() => navigate('/capture')} className="-ml-2">
      <ArrowLeft className="size-5" />
    </IconButton>
  )

  if (!capture) {
    return (
      <>
        <ScreenHeader title="Review" leading={back} />
        {fetched === 'missing' ? (
          <EmptyState icon={<FileText className="size-7" />} title="This capture is gone">
            It was deleted, or it belongs to another household.
          </EmptyState>
        ) : (
          <div className="grid place-items-center py-24">
            <Spinner className="size-6" />
          </div>
        )}
      </>
    )
  }

  const busy = capture.status === 'pending' || capture.status === 'processing'
  return (
    <>
      <ScreenHeader title={captureTitle(capture)} subtitle={`Captured ${relativeTime(capture.createdAt)}`} leading={back} />
      <div className={cx('space-y-4 px-4', capture.status === 'ready' ? 'pb-28' : 'pb-6')}>
        <Preview capture={capture} />

        {busy && (
          <StatusCard icon={<LoaderCircle className="size-5 animate-spin" />} title="Reading it…">
            <p>This usually takes a few seconds. You can leave this screen; it will be waiting under Capture.</p>
            <Button variant="secondary" size="sm" onClick={() => void captureAction(capture, 'dismiss').then((c) => c && navigate('/capture'))}>
              Stop and dismiss
            </Button>
          </StatusCard>
        )}

        {capture.status === 'failed' && (
          <StatusCard icon={<AlertTriangle className="size-5" />} title="Aisle could not read this" tone="error">
            <p>{capture.error ?? 'Something went wrong while reading it.'}</p>
            <RetryControls capture={capture} label="Try again" />
          </StatusCard>
        )}

        {capture.status === 'dismissed' && (
          <StatusCard icon={<X className="size-5" />} title="Dismissed">
            <p>Nothing from this capture was added.</p>
            <RetryControls capture={capture} label="Read it again" />
          </StatusCard>
        )}

        {capture.status === 'applied' && (
          <StatusCard icon={<Check className="size-5" />} title="Added">
            <p>{captureDetail(capture)}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate('/')}>Go to the list</Button>
              <Button variant="ghost" className="text-rose-700 dark:text-rose-400" onClick={() => void deleteCapture(capture)}>
                <Trash2 className="size-4" aria-hidden />
                Delete the original
              </Button>
            </div>
            <p className="text-xs">Deleting removes the photo or text. What was added stays.</p>
          </StatusCard>
        )}

        {capture.status === 'ready' && capture.extraction && (
          <Editor key={`${capture.id}:${capture.rev}`} capture={capture} extraction={capture.extraction} />
        )}
      </div>
    </>
  )
}
