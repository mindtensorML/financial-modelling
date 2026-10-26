/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { pushSharedEntry } from './lib/shareInbox'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/share-target/],
  }),
)

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(receiveShare(event.request))
  }
})

async function receiveShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData()
    const files = form.getAll('media').filter((v): v is File => v instanceof File && v.size > 0)
    const text = ['title', 'text', 'url']
      .map((key) => form.get(key))
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .join('\n')
    if (files.length || text) {
      await pushSharedEntry({ id: crypto.randomUUID(), files, text, at: Date.now() })
    }
  } catch (err) {
    console.error('Could not read shared content', err)
  }
  return Response.redirect('/#/capture?shared=1', 303)
}
