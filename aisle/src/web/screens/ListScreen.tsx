import { ArrowLeft, Camera, ChevronDown, ChevronRight, LoaderCircle, ShoppingBasket, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ListItem } from '../../shared/types'
import { ItemRow } from '../components/ItemRow'
import { ItemSheet } from '../components/ItemSheet'
import { ScreenHeader } from '../components/Layout'
import { PopularStores } from '../components/PopularStores'
import { QuickAdd } from '../components/QuickAdd'
import { RunningLow } from '../components/RunningLow'
import { Button, Card, EmptyState, IconButton, Spinner, StoreDot } from '../components/ui'
import { plural } from '../lib/format'
import { buildSections, type Section, UNSORTED } from '../lib/group'
import { useInsights } from '../lib/insights'
import { navigate } from '../lib/router'
import { useMe } from '../lib/session'
import { sync, useSync } from '../lib/sync'
import { toast } from '../lib/toast'

function toggle(item: ListItem): void {
  const checked = item.checkedAt === null
  sync.enqueue({ type: 'item.check', id: item.id, checked, at: Date.now() })
  if (checked) navigator.vibrate?.(8)
}

function clearChecked(section: Section): void {
  sync.enqueue({ type: 'items.clearChecked', storeId: section.store?.id ?? null })
  toast(`Cleared ${plural(section.checked.length, 'item')} from ${section.store?.name ?? 'Unsorted'}`)
}

function StoreSection({
  section,
  focused,
  onEdit,
}: {
  section: Section
  focused: boolean
  onEdit: (item: ListItem) => void
}) {
  const [showChecked, setShowChecked] = useState(false)
  const { store } = section
  const title = store?.name ?? 'Unsorted'
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-stone-100 py-1.5 pr-2 pl-4 dark:border-stone-800">
        <button
          type="button"
          disabled={focused}
          onClick={() => navigate(`/?store=${section.key}`)}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left disabled:cursor-default"
          aria-label={focused ? title : `Shop at ${title}: show only this store`}
        >
          <StoreDot color={store?.color} className="size-3" />
          <span className="truncate font-semibold">{title}</span>
          <span className="text-sm text-stone-500 tabular-nums">{section.openCount || ''}</span>
          {!focused && <ChevronRight className="size-4 text-stone-300 dark:text-stone-600" aria-hidden />}
        </button>
        {section.checked.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => clearChecked(section)}>
            Clear {section.checked.length}
          </Button>
        )}
      </div>

      {section.key === UNSORTED && section.openCount > 0 && (
        <p className="flex items-start gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Tap an item to choose its store. Aisle remembers, and files it there next time.
        </p>
      )}

      {section.openCount === 0 && (
        <p className="px-4 py-3 text-sm text-stone-500 dark:text-stone-400">All done here.</p>
      )}

      <div className="divide-y divide-stone-100 dark:divide-stone-800/70">
        {section.groups.map((group) => (
          <div key={group.category}>
            {section.groups.length > 1 && (
              <h3 className="px-4 pt-2.5 text-[11px] font-semibold tracking-wider text-stone-400 uppercase dark:text-stone-500">
                {group.category}
              </h3>
            )}
            {group.items.map((item) => (
              <ItemRow key={item.id} item={item} onToggle={toggle} onEdit={onEdit} />
            ))}
          </div>
        ))}
      </div>

      {section.checked.length > 0 && (
        <div className="border-t border-stone-100 dark:border-stone-800">
          <button
            type="button"
            aria-expanded={showChecked}
            onClick={() => setShowChecked((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-stone-500 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800/50"
          >
            {showChecked ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
            {section.checked.length} in the cart
          </button>
          {showChecked && (
            <div className="pb-1">
              {section.checked.map((item) => (
                <ItemRow key={item.id} item={item} onToggle={toggle} onEdit={onEdit} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function CaptureBanner() {
  const { captures } = useSync()
  const ready = captures.filter((c) => c.status === 'ready')
  const reading = captures.filter((c) => c.status === 'pending' || c.status === 'processing').length
  if (!ready.length && !reading) return null
  return (
    <a
      href={ready.length === 1 ? `#/capture/${ready[0]!.id}` : '#/capture'}
      className="flex items-center gap-3 rounded-2xl bg-emerald-700 px-4 py-3 text-white shadow-sm hover:bg-emerald-800"
    >
      {ready.length ? <Camera className="size-5" aria-hidden /> : <LoaderCircle className="size-5 animate-spin" aria-hidden />}
      <span className="flex-1 text-sm font-medium">
        {ready.length
          ? `${plural(ready.length, 'capture')} ready to review`
          : `Reading ${plural(reading, 'capture')}…`}
      </span>
      <ChevronRight className="size-5 opacity-70" aria-hidden />
    </a>
  )
}

export function ListScreen({ storeFilter }: { storeFilter: string | null }) {
  const me = useMe()
  const { ready, items, stores, storesById } = useSync()
  const insights = useInsights()
  const [editing, setEditing] = useState<string | null>(null)
  const [onboarding, setOnboarding] = useState(false)

  const filter = storeFilter === UNSORTED || (storeFilter && storesById.has(storeFilter)) ? storeFilter : null
  const sections = useMemo(() => buildSections(items, stores, insights?.walkOrder), [items, stores, insights])
  const shown = filter ? sections.filter((s) => s.key === filter) : sections
  const openItems = items.filter((i) => i.checkedAt === null)
  const openProducts = new Set(openItems.map((i) => i.productId))
  const due = (insights?.dueSoon ?? []).filter(
    (d) => !openProducts.has(d.productId) && (!filter || d.storeId === filter),
  )
  const filterStore = filter && filter !== UNSORTED ? storesById.get(filter) : undefined
  // Stays open after the first store is added, so several can be picked in a row.
  useEffect(() => {
    if (ready && stores.length === 0) setOnboarding(true)
  }, [ready, stores.length])
  const showOnboarding = ready && (stores.length === 0 || onboarding)

  const chips = sections.filter((s) => s.openCount > 0 || s.key === filter)
  return (
    <>
      <ScreenHeader
        title={filter ? (filterStore?.name ?? 'Unsorted') : 'Shopping list'}
        subtitle={
          filter
            ? `${plural(shown[0]?.openCount ?? 0, 'item')} left`
            : `${openItems.length ? plural(openItems.length, 'item') : 'Nothing yet'} · ${me.household.name}`
        }
        leading={
          filter && (
            <IconButton label="All stores" onClick={() => navigate('/')} className="-ml-2">
              <ArrowLeft className="size-5" />
            </IconButton>
          )
        }
      >
        <QuickAdd storeId={filterStore?.id ?? null} />
        {!filter && chips.length > 1 && (
          <nav className="flex gap-2 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none]" aria-label="Stores">
            {chips.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => navigate(`/?store=${s.key}`)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:ring-stone-700"
              >
                <StoreDot color={s.store?.color} />
                {s.store?.name ?? 'Unsorted'}
                <span className="text-stone-400 tabular-nums">{s.openCount}</span>
              </button>
            ))}
          </nav>
        )}
      </ScreenHeader>

      <div className="space-y-3 px-4 pt-1 pb-6">
        {!ready ? (
          <div className="grid place-items-center py-20">
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            {showOnboarding && (
              <Card className="p-4">
                <h2 className="font-semibold">Where do you shop?</h2>
                <p className="mt-0.5 mb-3 text-sm text-stone-500 dark:text-stone-400">
                  Aisle groups your list by store and learns which store you buy each thing at. Pick the ones you go to.
                </p>
                <PopularStores />
                {stores.length > 0 && (
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        setOnboarding(false)
                        toast('Add items above, or capture a list or receipt')
                      }}
                    >
                      Done
                    </Button>
                  </div>
                )}
              </Card>
            )}

            {!filter && <CaptureBanner />}
            {due.length > 0 && <RunningLow due={due} />}

            {shown.map((section) => (
              <StoreSection key={section.key} section={section} focused={Boolean(filter)} onEdit={(item) => setEditing(item.id)} />
            ))}

            {shown.length === 0 && !showOnboarding && (
              <EmptyState icon={<ShoppingBasket className="size-7" />} title={filter ? 'Nothing on the list here' : 'Your list is empty'}>
                {filter ? (
                  <p>Items you add while this store is open are filed under it.</p>
                ) : (
                  <p>Type what you need above, dictate it, or capture a photo of a list, a screenshot, or a receipt.</p>
                )}
                <div className="mt-4 flex justify-center gap-2">
                  {filter ? (
                    <Button variant="secondary" onClick={() => navigate('/')}>
                      All stores
                    </Button>
                  ) : (
                    <Button onClick={() => navigate('/capture')}>
                      <Camera className="size-4" aria-hidden />
                      Capture
                    </Button>
                  )}
                </div>
              </EmptyState>
            )}

            {filter && (shown[0]?.checked.length ?? 0) > 0 && (
              <Button variant="secondary" size="lg" className="w-full" onClick={() => clearChecked(shown[0]!)}>
                Done shopping: clear {plural(shown[0]!.checked.length, 'item')}
              </Button>
            )}
          </>
        )}
      </div>

      <ItemSheet itemId={editing} onClose={() => setEditing(null)} />
    </>
  )
}
