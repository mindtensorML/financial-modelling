import { get, set } from 'idb-keyval'

// Written by the service worker when the OS share sheet posts to /share-target,
// read by the capture screen once the app opens.
const SHARE_KEY = 'aisle-share-inbox'

export interface SharedEntry {
  id: string
  files: File[]
  text: string
  at: number
}

export async function pushSharedEntry(entry: SharedEntry): Promise<void> {
  const inbox = (await get<SharedEntry[]>(SHARE_KEY)) ?? []
  inbox.push(entry)
  await set(SHARE_KEY, inbox)
}

export async function takeSharedEntries(): Promise<SharedEntry[]> {
  const inbox = (await get<SharedEntry[]>(SHARE_KEY)) ?? []
  if (inbox.length) await set(SHARE_KEY, [])
  return inbox
}
