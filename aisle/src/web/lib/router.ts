import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'list'; store: string | null }
  | { name: 'capture'; shared: boolean }
  | { name: 'review'; id: string }
  | { name: 'insights' }
  | { name: 'settings' }
  | { name: 'join'; code: string }

/** Hash routes, so a static host and the share target's redirect both work without server routing. */
export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  switch (parts[0]) {
    case 'capture':
      return parts[1] ? { name: 'review', id: parts[1] } : { name: 'capture', shared: params.has('shared') }
    case 'insights':
      return { name: 'insights' }
    case 'settings':
      return { name: 'settings' }
    case 'join':
      return parts[1] ? { name: 'join', code: parts[1] } : { name: 'settings' }
    default:
      return { name: 'list', store: params.get('store') }
  }
}

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseHash(hash)
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const hash = to.startsWith('#') ? to : `#${to}`
  if (options.replace) {
    history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = hash
  }
}
