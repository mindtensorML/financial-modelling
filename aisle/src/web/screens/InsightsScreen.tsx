import { BarChart3, Search, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { foldText } from '../../shared/normalize'
import type { ProductInsight } from '../../shared/types'
import { ScreenHeader } from '../components/Layout'
import { RunningLow } from '../components/RunningLow'
import { Card, EmptyState, Input, Spinner, StoreDot } from '../components/ui'
import { describeInterval, formatCents, plural, relativeDay } from '../lib/format'
import { useInsights } from '../lib/insights'
import { useSync } from '../lib/sync'

const perUnit = (unit: string | null) => (unit ? `/${unit}` : '')

function ProductRow({ product }: { product: ProductInsight }) {
  const { storesById } = useSync()
  const store = product.storeId ? storesById.get(product.storeId) : undefined
  const facts = [
    product.intervalDays !== null ? describeInterval(product.intervalDays) : null,
    product.lastPurchasedAt ? `last ${relativeDay(product.lastPurchasedAt)}` : null,
  ].filter(Boolean)
  const prices = product.prices
    .filter((p) => storesById.has(p.storeId))
    .sort((a, b) => a.averageCents - b.averageCents)
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{product.name}</span>
        <span className="shrink-0 text-xs text-stone-500 tabular-nums" title={`Bought ${plural(product.purchaseCount, 'time')}`}>
          {product.purchaseCount}×
        </span>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-stone-600 dark:text-stone-400">
        {store && (
          <span className="inline-flex items-center gap-1.5">
            <StoreDot color={store.color} />
            {store.name}
            {product.confidence !== null && <span className="text-stone-400">{Math.round(product.confidence * 100)}%</span>}
          </span>
        )}
        {store && facts.length > 0 && <span aria-hidden>·</span>}
        {facts.join(' · ')}
      </p>
      {prices.length > 0 && (
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          {prices
            .map((p) => `${formatCents(p.averageCents)}${perUnit(p.unit)} at ${storesById.get(p.storeId)!.name}`)
            .join(' · ')}
        </p>
      )}
    </li>
  )
}

export function InsightsScreen() {
  const insights = useInsights()
  const { storesById, items, status } = useSync()
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)

  const open = useMemo(() => new Set(items.filter((i) => !i.checkedAt).map((i) => i.productId)), [items])
  const products = useMemo(() => {
    const q = foldText(query.trim())
    return (insights?.products ?? []).filter((p) => !q || foldText(p.name).includes(q))
  }, [insights, query])

  if (!insights) {
    return (
      <>
        <ScreenHeader title="Insights" />
        {status === 'offline' ? (
          <EmptyState icon={<BarChart3 className="size-7" />} title="Insights need a connection">
            They are worked out on the server from everything your household has bought.
          </EmptyState>
        ) : (
          <div className="grid place-items-center py-24">
            <Spinner className="size-6" />
          </div>
        )}
      </>
    )
  }

  const due = insights.dueSoon.filter((d) => !open.has(d.productId))
  const stores = insights.stores.filter((s) => storesById.has(s.storeId) && (s.visits30d > 0 || s.productCount > 0))
  const deals = insights.products.filter((p) => p.cheaperAt && storesById.has(p.cheaperAt.storeId)).slice(0, 5)
  const learnedNothing = insights.products.length === 0

  return (
    <>
      <ScreenHeader title="Insights" subtitle="What Aisle has learned from your shopping" />
      <div className="space-y-4 px-4 pb-6">
        {learnedNothing && (
          <EmptyState icon={<BarChart3 className="size-7" />} title="Nothing learned yet">
            Capture a receipt, or check items off while you shop. After a few trips Aisle knows where you buy each thing, how often,
            and what it costs.
          </EmptyState>
        )}

        {due.length > 0 && <RunningLow due={due} limit={5} />}

        {stores.length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 font-semibold">Your stores, last 30 days</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {stores.map((s) => {
                const store = storesById.get(s.storeId)!
                return (
                  <Card key={s.storeId} className="p-4">
                    <p className="flex items-center gap-2 font-medium">
                      <StoreDot color={store.color} className="size-3" />
                      {store.name}
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <dt className="text-[11px] text-stone-500 uppercase">Trips</dt>
                        <dd className="text-lg font-semibold tabular-nums">{s.visits30d}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-stone-500 uppercase">Spent</dt>
                        <dd className="text-lg font-semibold tabular-nums">{s.spend30dCents ? formatCents(s.spend30dCents) : '–'}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-stone-500 uppercase">Usual for</dt>
                        <dd className="text-lg font-semibold tabular-nums">{s.productCount}</dd>
                      </div>
                    </dl>
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {deals.length > 0 && (
          <Card>
            <h2 className="flex items-center gap-2 px-4 pt-3 pb-1 font-semibold">
              <TrendingDown className="size-4 text-emerald-600" aria-hidden />
              Cheaper elsewhere
            </h2>
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {deals.map((p) => {
                const cheaper = storesById.get(p.cheaperAt!.storeId)!
                const usual = p.storeId ? storesById.get(p.storeId) : undefined
                const unit = p.prices.find((x) => x.storeId === cheaper.id)?.unit ?? null
                return (
                  <li key={p.productId} className="px-4 py-2.5 text-sm">
                    <span className="font-medium">{p.name}</span> costs {formatCents(p.cheaperAt!.savingsCents)}
                    {perUnit(unit)} less at {cheaper.name}
                    {usual ? ` than at ${usual.name}` : ''}.
                  </li>
                )
              })}
            </ul>
          </Card>
        )}

        {insights.products.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-3 px-1">
              <h2 className="flex-1 font-semibold">What you buy</h2>
              <div className="relative w-44">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find"
                  aria-label="Find a product"
                  className="py-1.5 pl-9 text-sm"
                />
              </div>
            </div>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {(all || query ? products : products.slice(0, 20)).map((p) => (
                  <ProductRow key={p.productId} product={p} />
                ))}
              </ul>
              {products.length === 0 && <p className="px-4 py-3 text-sm text-stone-500">Nothing matches “{query}”.</p>}
              {!all && !query && products.length > 20 && (
                <button
                  type="button"
                  onClick={() => setAll(true)}
                  className="w-full border-t border-stone-100 px-4 py-2.5 text-left text-sm font-medium text-emerald-700 dark:border-stone-800 dark:text-emerald-400"
                >
                  Show all {products.length}
                </button>
              )}
            </Card>
          </section>
        )}

        <Card className="p-4 text-sm text-stone-600 dark:text-stone-400">
          <h2 className="mb-2 font-semibold text-stone-900 dark:text-stone-100">How Aisle learns</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-medium text-stone-800 dark:text-stone-200">Receipts</strong> say where you bought each thing,
              when, and for how much.
            </li>
            <li>
              <strong className="font-medium text-stone-800 dark:text-stone-200">Checking items off</strong> in a store records the
              trip, and the order you pick things up sorts that store’s list next time.
            </li>
            <li>
              <strong className="font-medium text-stone-800 dark:text-stone-200">Moving an item</strong> to another store counts
              most: your latest choice wins.
            </li>
          </ul>
        </Card>
      </div>
    </>
  )
}
