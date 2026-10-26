import { BarChart3, Camera, CloudOff, ListChecks, RefreshCw, Settings } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { Route } from '../lib/router'
import { useSync } from '../lib/sync'
import { useUploads } from '../lib/uploads'
import { cx } from './ui'

/** A value that only turns true after it has stayed true for `ms`, so quick saves do not flash. */
function useSettled(value: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!value) {
      setSettled(false)
      return
    }
    const timer = setTimeout(() => setSettled(true), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export function SyncBadge() {
  const { status, pending, ready } = useSync()
  const saving = useSettled(status === 'online' && pending > 0, 800)
  const waiting = useSettled(status === 'connecting' && !ready, 600)
  const pill = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium'
  if (status === 'offline') {
    return (
      <span className={cx(pill, 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300')} role="status">
        <CloudOff className="size-3.5" aria-hidden />
        Offline{pending > 0 ? ` · ${pending} to sync` : ''}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span
        className={cx(pill, 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200')}
        role="status"
        title="Aisle keeps your changes on this device and tries again."
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Can’t sync yet{pending > 0 ? ` · ${pending} waiting` : ''}
      </span>
    )
  }
  if (saving || waiting) {
    return (
      <span className={cx(pill, 'text-stone-500 dark:text-stone-400')} role="status">
        <RefreshCw className="size-3.5 animate-spin" aria-hidden />
        {saving ? 'Saving' : 'Connecting'}
      </span>
    )
  }
  return null
}

export function ScreenHeader({
  title,
  subtitle,
  leading,
  actions,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="pt-safe sticky top-0 z-30 bg-stone-100/90 backdrop-blur-md dark:bg-stone-950/90">
      <div className="flex min-h-14 items-center gap-2 px-4 pt-3 pb-2">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>}
        </div>
        <SyncBadge />
        {actions}
      </div>
      {children}
    </header>
  )
}

const TABS = [
  { name: 'list', href: '#/', label: 'List', icon: ListChecks },
  { name: 'capture', href: '#/capture', label: 'Capture', icon: Camera },
  { name: 'insights', href: '#/insights', label: 'Insights', icon: BarChart3 },
  { name: 'settings', href: '#/settings', label: 'Settings', icon: Settings },
] as const

export function TabBar({ route }: { route: Route }) {
  const { captures } = useSync()
  const pendingUploads = useUploads().length
  const ready = captures.filter((c) => c.status === 'ready').length
  const reading = pendingUploads + captures.filter((c) => c.status === 'pending' || c.status === 'processing').length
  const active = route.name === 'review' ? 'capture' : route.name === 'join' ? 'settings' : route.name
  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/90 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/90"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-4">
        {TABS.map(({ name, href, label, icon: Icon }) => {
          const selected = active === name
          return (
            <a
              key={name}
              href={href}
              aria-current={selected ? 'page' : undefined}
              className={cx(
                'relative flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-medium transition-colors',
                selected ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-500 hover:text-stone-800 dark:text-stone-400',
              )}
            >
              <span className="relative">
                <Icon className="size-6" strokeWidth={selected ? 2.25 : 1.75} aria-hidden />
                {name === 'capture' && ready > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-stone-900">
                    {ready}
                  </span>
                )}
                {name === 'capture' && ready === 0 && reading > 0 && (
                  <span className="absolute -top-0.5 -right-1 size-2.5 animate-pulse rounded-full bg-amber-500 ring-2 ring-white dark:ring-stone-900" />
                )}
              </span>
              {label}
              {name === 'capture' && ready > 0 && <span className="sr-only">, {ready} ready to review</span>}
            </a>
          )
        })}
      </div>
    </nav>
  )
}
