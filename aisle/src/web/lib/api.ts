export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** The server could not be reached: no connection, or it is down. */
export class OfflineError extends Error {
  constructor() {
    super('You are offline')
  }
}

let onUnauthorized: (() => void) | null = null

/** Called whenever the server says the session is gone, so the app can show the sign-in screen. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

export async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { 'X-Aisle': '1' }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new OfflineError()
  }
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) {
    // A proxy answering for a server that is down is the same as being offline.
    if ((res.status === 502 || res.status === 503 || res.status === 504) && !data?.error) throw new OfflineError()
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.()
    throw new ApiError(res.status, data?.error ?? `The server answered ${res.status}`)
  }
  return data as T
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof OfflineError) return error.message
  return 'Something went wrong. Try again.'
}

/** Worth retrying later, as opposed to a request the server will never accept. */
export function isTransient(error: unknown): boolean {
  return error instanceof OfflineError || (error instanceof ApiError && (error.status >= 500 || error.status === 429 || error.status === 408))
}
