import { useEffect, useRef } from 'react'
import type { CaptureStatus } from '../shared/types'
import { TabBar } from './components/Layout'
import { Spinner, Toaster } from './components/ui'
import { captureTitle } from './lib/captures'
import { navigate, type Route, useRoute } from './lib/router'
import { useSession } from './lib/session'
import { useSync } from './lib/sync'
import { toast } from './lib/toast'
import { AuthScreen } from './screens/AuthScreen'
import { CaptureScreen } from './screens/CaptureScreen'
import { InsightsScreen } from './screens/InsightsScreen'
import { ListScreen } from './screens/ListScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'

const RECENT_MS = 10 * 60_000

/** Says so when a capture finishes reading, wherever in the app you are. */
function useCaptureNotices(route: Route): void {
  const { captures, ready } = useSync()
  const seen = useRef<Map<string, CaptureStatus> | null>(null)
  const reviewing = route.name === 'review' ? route.id : null
  useEffect(() => {
    if (!ready) return
    const previous = seen.current
    seen.current = new Map(captures.map((c) => [c.id, c.status]))
    if (!previous) return
    for (const capture of captures) {
      const before = previous.get(capture.id)
      if (before === capture.status || capture.id === reviewing) continue
      const fresh = before === 'pending' || before === 'processing' || (before === undefined && Date.now() - capture.updatedAt < RECENT_MS)
      if (!fresh) continue
      const open = { label: capture.status === 'ready' ? 'Review' : 'See why', run: () => navigate(`/capture/${capture.id}`) }
      if (capture.status === 'ready') toast(`${captureTitle(capture)} is ready to review`, { action: open })
      else if (capture.status === 'failed') toast(`Could not read your ${captureTitle(capture).toLowerCase()}`, { tone: 'error', action: open })
    }
  }, [captures, ready, reviewing])
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'list':
      return <ListScreen storeFilter={route.store} />
    case 'capture':
      return <CaptureScreen shared={route.shared} />
    case 'review':
      return <ReviewScreen id={route.id} />
    case 'insights':
      return <InsightsScreen />
    case 'settings':
      return <SettingsScreen joinCode={null} />
    case 'join':
      return <SettingsScreen joinCode={route.code} />
  }
}

function SignedIn({ route }: { route: Route }) {
  useCaptureNotices(route)
  const place = JSON.stringify(route)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [place])
  return (
    <>
      <main className="mx-auto min-h-dvh max-w-2xl pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <Screen route={route} />
      </main>
      {route.name !== 'review' && <TabBar route={route} />}
    </>
  )
}

export function App() {
  const current = useSession()
  const route = useRoute()
  return (
    <>
      {current.status === 'loading' ? (
        <div className="grid min-h-dvh place-items-center">
          <div className="flex flex-col items-center gap-4">
            <img src="/icon.svg" alt="Aisle" className="size-14" />
            <Spinner />
          </div>
        </div>
      ) : current.status === 'signedOut' ? (
        <AuthScreen joinCode={route.name === 'join' ? route.code : null} />
      ) : (
        <SignedIn route={route} />
      )}
      <Toaster />
    </>
  )
}
