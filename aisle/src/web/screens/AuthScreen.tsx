import { Camera, ListChecks, Sparkles } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button, Field, Input, Segmented } from '../components/ui'
import { errorMessage } from '../lib/api'
import { signIn, signUp, useServerConfig } from '../lib/session'

type Mode = 'signIn' | 'signUp'

const POINTS = [
  { icon: Camera, text: 'Snap a list, a screenshot, or a receipt. Aisle reads it.' },
  { icon: ListChecks, text: 'Every item is filed under the store you buy it at.' },
  { icon: Sparkles, text: 'It learns your stores, your aisles, and when you run low.' },
]

export function AuthScreen({ joinCode }: { joinCode: string | null }) {
  const config = useServerConfig()
  const inviteOnly = config?.signupMode === 'invite'
  const [mode, setMode] = useState<Mode>(joinCode ? 'signUp' : 'signIn')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState(joinCode ?? '')
  const [showInvite, setShowInvite] = useState(Boolean(joinCode))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signIn') await signIn(email, password)
      else await signUp({ name, email, password, ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}) })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const needsInvite = mode === 'signUp' && (inviteOnly || showInvite)
  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <img src="/icon.svg" alt="" className="size-14" />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Aisle</h1>
        <p className="mt-1 text-stone-600 dark:text-stone-400">Your shopping list, sorted by store.</p>
        <ul className="mt-5 space-y-2.5">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-stone-700 dark:text-stone-300">
              <Icon className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-900 dark:ring-stone-800">
        <Segmented
          label="Sign in or create an account"
          value={mode}
          options={[
            { value: 'signIn', label: 'Sign in' },
            { value: 'signUp', label: 'Create account' },
          ]}
          onChange={(next) => {
            setMode(next)
            setError(null)
          }}
        />
        <form className="mt-5 space-y-4" onSubmit={submit}>
          {mode === 'signUp' && (
            <Field label="Your name">
              {(id) => <Input id={id} autoComplete="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          )}
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Password" hint={mode === 'signUp' ? 'At least 8 characters.' : undefined}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signUp' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {needsInvite ? (
            <Field
              label="Invite code"
              hint={inviteOnly ? 'This server only takes new accounts with an invite from someone already on it.' : 'Joins their household, so you share one list.'}
            >
              {(id) => (
                <Input
                  id={id}
                  required={inviteOnly}
                  autoCapitalize="characters"
                  maxLength={40}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              )}
            </Field>
          ) : (
            mode === 'signUp' && (
              <button type="button" onClick={() => setShowInvite(true)} className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Have an invite code?
              </button>
            )
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {mode === 'signIn' ? 'Sign in' : inviteCode.trim() ? 'Create account and join' : 'Create account'}
          </Button>
        </form>
      </div>
    </main>
  )
}
