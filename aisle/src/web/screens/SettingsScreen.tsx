import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, Download, LogOut, RefreshCw, Share2, Trash2, Users } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { STORE_COLORS } from '../../shared/stores'
import type { JoinResponse, Me, Store } from '../../shared/types'
import { ScreenHeader } from '../components/Layout'
import { PopularStores } from '../components/PopularStores'
import { Button, Card, cx, Field, Input, Sheet, StoreDot } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { plural } from '../lib/format'
import { isIos, isStandalone, useInstall } from '../lib/install'
import { navigate } from '../lib/router'
import { signOut, updateMe, useMe, useServerConfig } from '../lib/session'
import { sync, useSync } from '../lib/sync'
import { toast } from '../lib/toast'
import { useUploads } from '../lib/uploads'

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Confirm({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 pb-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">{children}</div>
    </Sheet>
  )
}

/** Saves a single text field: shows Save only once it differs from what is stored. */
function InlineEdit({
  label,
  value,
  maxLength,
  onSave,
}: {
  label: string
  value: string
  maxLength: number
  onSave: (value: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(value), [value])
  const changed = draft.trim() !== value && draft.trim() !== ''
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!changed) return
        setBusy(true)
        await onSave(draft.trim())
        setBusy(false)
      }}
    >
      <div className="min-w-0 flex-1">
        <Field label={label}>{(id) => <Input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={maxLength} />}</Field>
      </div>
      {changed && (
        <Button type="submit" loading={busy} className="h-[46px]">
          Save
        </Button>
      )}
    </form>
  )
}

function StoreSheet({ store, onClose }: { store: Store | null; onClose: () => void }) {
  const { stores, items } = useSync()
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (store) setName(store.name)
    setConfirming(false)
  }, [store?.id])
  if (!store) return null
  const index = stores.findIndex((s) => s.id === store.id)
  const filed = items.filter((i) => i.storeId === store.id && !i.checkedAt).length

  const move = (delta: number) => {
    const order = [...stores]
    const [moved] = order.splice(index, 1)
    order.splice(index + delta, 0, moved!)
    sync.enqueue(...order.flatMap((s, i) => (s.sortOrder === i ? [] : [{ type: 'store.upsert' as const, id: s.id, sortOrder: i }])))
  }

  const close = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== store.name) sync.enqueue({ type: 'store.upsert', id: store.id, name: trimmed })
    onClose()
  }

  return (
    <>
      <Sheet
        open={!confirming}
        title={store.name}
        onClose={close}
        footer={
          <div className="flex gap-2 pb-3">
            <Button variant="ghost" className="text-rose-700 dark:text-rose-400" onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" aria-hidden />
              Delete store
            </Button>
            <Button className="ml-auto min-w-28" onClick={close}>
              Done
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && close()}
                maxLength={60}
              />
            )}
          </Field>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300">Color</h3>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
              {STORE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={store.color === color}
                  aria-label={color}
                  onClick={() => sync.enqueue({ type: 'store.upsert', id: store.id, color })}
                  className={cx(
                    'grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-stone-50 transition-shadow dark:ring-offset-stone-900',
                    store.color === color && 'ring-2 ring-stone-900 dark:ring-white',
                  )}
                  style={{ backgroundColor: color }}
                >
                  {store.color === color && <Check className="size-4 text-white" strokeWidth={3} aria-hidden />}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300">Order on the list</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={index <= 0} onClick={() => move(-1)}>
                <ArrowUp className="size-4" aria-hidden />
                Move up
              </Button>
              <Button variant="secondary" size="sm" disabled={index === stores.length - 1} onClick={() => move(1)}>
                <ArrowDown className="size-4" aria-hidden />
                Move down
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
      <Confirm
        open={confirming}
        title={`Delete ${store.name}?`}
        confirmLabel="Delete"
        danger
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          sync.enqueue({ type: 'store.delete', id: store.id })
          toast(`Deleted ${store.name}`)
          onClose()
        }}
      >
        <p>
          {filed
            ? `${plural(filed, 'item')} filed there move${filed === 1 ? 's' : ''} to Unsorted.`
            : 'Nothing on the list is filed there.'}{' '}
          Purchases already recorded there are kept.
        </p>
      </Confirm>
    </>
  )
}

function StoresSection() {
  const { stores, items } = useSync()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const open = (id: string) => items.filter((i) => i.storeId === id && !i.checkedAt).length
  return (
    <Section
      title="Stores"
      action={
        <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Done' : 'Add stores'}
        </Button>
      }
    >
      <Card className="overflow-hidden">
        {stores.length === 0 && !adding && (
          <p className="px-4 py-3 text-sm text-stone-500">No stores yet. Add the ones you shop at, and Aisle files items under them.</p>
        )}
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {stores.map((store) => (
            <li key={store.id}>
              <button
                type="button"
                onClick={() => setEditing(store.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
              >
                <StoreDot color={store.color} className="size-3" />
                <span className="flex-1 font-medium">{store.name}</span>
                <span className="text-sm text-stone-500 tabular-nums">{open(store.id) || ''}</span>
                <ChevronRight className="size-4 text-stone-300 dark:text-stone-600" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        {adding && (
          <div className="border-t border-stone-100 p-4 dark:border-stone-800">
            <PopularStores />
          </div>
        )}
      </Card>
      <StoreSheet store={stores.find((s) => s.id === editing) ?? null} onClose={() => setEditing(null)} />
    </Section>
  )
}

function HouseholdSection({ joinCode }: { joinCode: string | null }) {
  const me = useMe()
  const { household, user } = me
  const [code, setCode] = useState(joinCode ?? '')
  const [confirm, setConfirm] = useState<'join' | 'leave' | 'rotate' | null>(null)
  const [busy, setBusy] = useState(false)
  const link = `${location.origin}/#/join/${encodeURIComponent(household.inviteCode)}`
  const alone = household.members.length <= 1

  useEffect(() => {
    if (!joinCode) return
    // Also where someone lands right after signing up with this invite link.
    if (joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '') === household.inviteCode) {
      toast(`You’re in ${household.name}`)
      navigate('/', { replace: true })
      return
    }
    setCode(joinCode)
    setConfirm('join')
  }, [joinCode, household.inviteCode, household.name])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      setConfirm(null)
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const join = () =>
    run(async () => {
      const res = await api<JoinResponse>('POST', '/api/household/join', { inviteCode: code.trim() })
      await updateMe(res)
      toast(`You joined ${res.household.name}${res.carried ? `, and brought ${plural(res.carried, 'item')} with you` : ''}`)
      navigate('/', { replace: true })
    })

  const leave = () =>
    run(async () => {
      const res = await api<Me>('POST', '/api/household/leave')
      await updateMe(res)
      toast(`You left ${household.name}. This is your own list now.`)
    })

  const rotate = () =>
    run(async () => {
      await updateMe(await api<Me>('POST', '/api/household/invite'))
      toast('New invite code made. The old one no longer works.')
    })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast('Invite link copied')
    } catch {
      toast(`Invite code: ${household.inviteCode}`)
    }
  }

  const share = async () => {
    try {
      await navigator.share({
        title: 'Join my shopping list on Aisle',
        text: `Join “${household.name}” on Aisle so we share one shopping list. Invite code: ${household.inviteCode}`,
        url: link,
      })
    } catch {
      // Closing the share sheet is not an error worth showing.
    }
  }

  return (
    <Section title="Household">
      <Card className="space-y-5 p-4">
        <InlineEdit
          label="Name"
          value={household.name}
          maxLength={60}
          onSave={async (name) => {
            try {
              await updateMe(await api<Me>('PATCH', '/api/household', { name }))
              toast('Household renamed')
            } catch (error) {
              toast(errorMessage(error), { tone: 'error' })
            }
          }}
        />

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
            <Users className="size-4" aria-hidden />
            {plural(household.members.length, 'member')}
          </h3>
          <ul className="space-y-1.5">
            {household.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 text-sm">
                <span className="grid size-8 place-items-center rounded-full bg-emerald-100 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {m.name}
                  {m.id === user.id && <span className="text-stone-500"> (you)</span>}
                </span>
                <span className="truncate text-stone-500">{m.email}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl bg-stone-100 p-3 dark:bg-stone-800/60">
          <p className="text-sm text-stone-600 dark:text-stone-300">Invite someone to share this list. They sign up or join with this code:</p>
          <p className="my-2 font-mono text-2xl font-semibold tracking-widest select-all">{household.inviteCode}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <Copy className="size-4" aria-hidden />
              Copy link
            </Button>
            {'share' in navigator && (
              <Button size="sm" variant="secondary" onClick={() => void share()}>
                <Share2 className="size-4" aria-hidden />
                Share
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setConfirm('rotate')}>
              <RefreshCw className="size-4" aria-hidden />
              New code
            </Button>
          </div>
        </div>

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (code.trim()) setConfirm('join')
          }}
        >
          <Field label="Join another household" hint="Use the invite code someone shared with you.">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" autoCapitalize="characters" maxLength={40} />
                <Button type="submit" variant="secondary" disabled={code.trim().length < 4} className="h-[46px]">
                  Join
                </Button>
              </div>
            )}
          </Field>
        </form>

        {!alone && (
          <Button variant="ghost" size="sm" className="text-rose-700 dark:text-rose-400" onClick={() => setConfirm('leave')}>
            Leave {household.name}
          </Button>
        )}
      </Card>

      <Confirm
        open={confirm === 'join'}
        title="Join this household?"
        confirmLabel="Join"
        busy={busy}
        onClose={() => {
          setConfirm(null)
          if (joinCode) navigate('/settings', { replace: true })
        }}
        onConfirm={() => void join()}
      >
        <p>You will share one list with everyone in the household that uses the code {code.trim().toUpperCase()}.</p>
        <p>
          {alone
            ? `You are the only member of ${household.name}, so it is closed and its open items come with you.`
            : `You leave ${household.name}; its list stays with the others.`}
        </p>
      </Confirm>
      <Confirm
        open={confirm === 'leave'}
        title={`Leave ${household.name}?`}
        confirmLabel="Leave"
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void leave()}
      >
        <p>The shared list stays with the others. You start a new, empty list of your own.</p>
      </Confirm>
      <Confirm
        open={confirm === 'rotate'}
        title="Make a new invite code?"
        confirmLabel="New code"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void rotate()}
      >
        <p>The current code and links stop working. People already in the household stay.</p>
      </Confirm>
    </Section>
  )
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) {
      setCurrent('')
      setNext('')
      setError(null)
    }
  }, [open])
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('POST', '/api/me/password', { currentPassword: current, newPassword: next })
      toast('Password changed. Your other devices were signed out.')
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      title="Change password"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 pb-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!current || next.length < 8} onClick={() => void submit()}>
            Change password
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (current && next.length >= 8) void submit()
        }}
      >
        <Field label="Current password">
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

function AccountSection() {
  const { user } = useMe()
  const { pending } = useSync()
  const uploadsWaiting = useUploads().length
  const [password, setPassword] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const unsent = pending + uploadsWaiting
  return (
    <Section title="Account">
      <Card className="space-y-4 p-4">
        <InlineEdit
          label="Your name"
          value={user.name}
          maxLength={60}
          onSave={async (name) => {
            try {
              await updateMe(await api<Me>('PATCH', '/api/me', { name }))
              toast('Name saved')
            } catch (error) {
              toast(errorMessage(error), { tone: 'error' })
            }
          }}
        />
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Signed in as <span className="font-medium text-stone-800 dark:text-stone-200">{user.email}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPassword(true)}>
            Change password
          </Button>
          <Button variant="ghost" onClick={() => (unsent ? setConfirmOut(true) : void signOut())}>
            <LogOut className="size-4" aria-hidden />
            Sign out
          </Button>
        </div>
      </Card>
      <PasswordSheet open={password} onClose={() => setPassword(false)} />
      <Confirm
        open={confirmOut}
        title="Sign out now?"
        confirmLabel="Sign out anyway"
        danger
        onClose={() => setConfirmOut(false)}
        onConfirm={() => void signOut()}
      >
        <p>
          {plural(unsent, 'change')} on this device {unsent === 1 ? 'has' : 'have'} not reached the server yet. Signing out deletes
          {unsent === 1 ? ' it' : ' them'} from this device.
        </p>
      </Confirm>
    </Section>
  )
}

function AboutSection() {
  const config = useServerConfig()
  const install = useInstall()
  const standalone = isStandalone()
  const rows: Array<[string, string]> = config
    ? [
        ['Photos and receipts', config.features.ai ? `Read by ${config.features.aiModel ?? 'AI'}` : config.features.ocr ? 'Read with OCR' : 'Not available'],
        ['Voice notes', config.features.transcription ? 'Transcribed by the AI provider' : 'Need an AI provider; dictation still works'],
        ['New accounts', config.signupMode === 'invite' ? 'Need an invite code' : 'Anyone can sign up'],
      ]
    : []
  return (
    <Section title="This app">
      <Card className="space-y-4 p-4">
        {!standalone && (install.canPrompt || isIos()) && (
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/40">
            <Download className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Install Aisle</p>
              <p className="text-stone-600 dark:text-stone-400">
                {install.canPrompt
                  ? 'Open it from your home screen, use it offline, and share screenshots straight to it.'
                  : 'In Safari, tap Share, then Add to Home Screen.'}
              </p>
              {install.canPrompt && (
                <Button size="sm" className="mt-2" onClick={() => void install.prompt()}>
                  Install
                </Button>
              )}
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <dl className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                <dt className="text-stone-600 dark:text-stone-400">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </Section>
  )
}

export function SettingsScreen({ joinCode }: { joinCode: string | null }) {
  return (
    <>
      <ScreenHeader title="Settings" />
      <div className="space-y-6 px-4 pb-8">
        <StoresSection />
        <HouseholdSection joinCode={joinCode} />
        <AccountSection />
        <AboutSection />
      </div>
    </>
  )
}
