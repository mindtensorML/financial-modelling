import { LoaderCircle, X } from 'lucide-react'
import { type ButtonHTMLAttributes, type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react'
import { twMerge } from 'tailwind-merge'
import { useObservable } from '../lib/observable'
import { dismissToast, toasts } from '../lib/toast'

/** Joins class names; a later utility overrides an earlier one for the same property, so `className` props win. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return twMerge(classes)
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 active:bg-emerald-900 disabled:bg-emerald-700/50',
  secondary:
    'bg-white text-stone-800 ring-1 ring-stone-200 hover:bg-stone-50 active:bg-stone-100 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-700 dark:hover:bg-stone-700',
  ghost: 'text-stone-600 hover:bg-stone-200/60 active:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-600/50',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-stone-600 transition-colors hover:bg-stone-200/70 active:bg-stone-200 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800',
        className,
      )}
    >
      {children}
    </button>
  )
}

const fieldClass =
  'w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-[15px] text-stone-900 ring-1 ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-600 focus:outline-none dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-700'

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={cx(fieldClass, className)} />
}

export function TextArea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea {...rest} className={cx(fieldClass, 'resize-none', className)} />
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return (
    <select
      {...rest}
      className={cx(
        'h-[46px] w-full rounded-xl border-0 bg-white px-3 text-[15px] text-stone-900 ring-1 ring-stone-200 focus:ring-2 focus:ring-emerald-600 focus:outline-none dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-700',
        className,
      )}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('animate-spin text-emerald-700', className ?? 'size-5')} aria-label="Loading" />
}

export function StoreDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block size-2.5 shrink-0 rounded-full', !color && 'bg-stone-300 dark:bg-stone-600', className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx('rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-900 dark:ring-stone-800', className)}>
      {children}
    </section>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-stone-200/70 p-1 dark:bg-stone-800">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            option.value === value
              ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white'
              : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A bottom sheet on phones, a centered dialog on larger screens. */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select')
    first?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.({ preventScroll: true })
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-stone-950/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[90dvh] w-full max-w-lg animate-slide-up flex-col rounded-t-3xl bg-stone-50 shadow-xl sm:rounded-3xl dark:bg-stone-900"
      >
        <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-stone-200 px-5 pt-3 pb-safe dark:border-stone-800">{footer}</div>}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        {icon}
      </div>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      {children && <div className="mt-1 max-w-xs text-sm text-stone-500 dark:text-stone-400">{children}</div>}
    </div>
  )
}

export function Toaster() {
  const list = useObservable(toasts)
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex max-w-md animate-slide-up items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-lg',
            t.tone === 'error' ? 'bg-rose-700 text-white' : 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900',
          )}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="font-semibold text-emerald-300 dark:text-emerald-700"
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
