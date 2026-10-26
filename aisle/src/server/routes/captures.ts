import Database from 'better-sqlite3'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Capture, CaptureMedia, CaptureResult } from '../../shared/types'
import { HttpError } from '../errors'
import { type AppEnv, readJson, requireUser, type ServerContext } from '../http'
import { applyCapture, applySchema } from '../ingest/apply'
import { toCapture } from '../rows'
import { getCapture, insertCapture, updateCapture } from '../services/captures'
import { type WriteContext, withWrite } from '../services/context'

const MB = 1024 * 1024
export const UPLOAD_LIMIT = 26 * MB
const MAX_BYTES: Record<CaptureMedia, number> = { image: 15 * MB, audio: 25 * MB, text: 512 * 1024 }
const MAX_TEXT = 100_000

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/flac',
])

/** Checks the file's first bytes, so a script cannot be stored and served back as an "image". */
function hasImageSignature(bytes: Buffer, type: string): boolean {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (type === 'image/gif') return bytes.subarray(0, 4).toString('latin1') === 'GIF8'
  return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
}

function unsupported(type: string, name: string): HttpError {
  if (/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(name)) {
    return new HttpError(415, 'HEIC photos are not supported. Pick the photo again from the app, or take a screenshot of it.')
  }
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
    return new HttpError(415, 'PDFs are not supported yet. Take a screenshot of the receipt instead.')
  }
  return new HttpError(415, `Files of type ${type || 'unknown'} cannot be read. Use a photo, screenshot, audio recording, or text.`)
}

const hintSchema = z.enum(['auto', 'list', 'receipt']).catch('auto')

export function captureRoutes(server: ServerContext) {
  const { db, hub, blobs, queue, limits } = server
  const app = new Hono<AppEnv>()

  function write<T>(householdId: string, userId: string, fn: (ctx: WriteContext) => T): T {
    const { rev, value } = withWrite(db, householdId, userId, server.now(), fn)
    hub.publish(householdId, rev)
    return value
  }

  function load(householdId: string, id: string) {
    const capture = getCapture(db, householdId, id)
    if (!capture || capture.deleted_at) throw new HttpError(404, 'That capture is gone')
    return capture
  }

  app.post(
    '/captures',
    bodyLimit({ maxSize: UPLOAD_LIMIT, onError: (c) => c.json({ error: 'That file is too large' }, 413) }),
    async (c) => {
      const user = requireUser(c)
      const householdId = user.household_id
      let form: Record<string, string | File | (string | File)[]>
      try {
        form = await c.req.parseBody({ all: false })
      } catch {
        throw new HttpError(400, 'Expected a form upload')
      }
      const id = z.uuid('Each capture needs an id').parse(form.id)
      const hint = hintSchema.parse(form.hint)
      const owner = db.prepare('SELECT household_id FROM captures WHERE id = ?').get(id) as { household_id: string } | undefined
      if (owner) {
        if (owner.household_id !== householdId) throw new HttpError(409, 'That capture id is taken')
        return c.json(toCapture(getCapture(db, householdId, id)!) satisfies Capture)
      }
      if (!limits.captures.allow(householdId, server.now())) {
        throw new HttpError(429, 'That is a lot of captures for one hour. Try again in a little while.')
      }

      const file = form.file instanceof File ? form.file : null
      const typed = typeof form.text === 'string' ? form.text.trim() : ''
      let media: CaptureMedia
      let mimeType: string | null = null
      let bytes: Buffer | null = null
      let textInput: string | null = null
      let fileName: string | null = null
      if (file) {
        mimeType = file.type.split(';')[0]!.trim().toLowerCase()
        fileName = file.name.slice(0, 200) || null
        if (IMAGE_TYPES.has(mimeType)) media = 'image'
        else if (AUDIO_TYPES.has(mimeType)) media = 'audio'
        else if (mimeType === 'text/plain' || (!mimeType && /\.txt$/i.test(file.name))) media = 'text'
        else throw unsupported(mimeType, file.name)
        if (file.size > MAX_BYTES[media]) throw new HttpError(413, `That file is too large (the limit is ${MAX_BYTES[media] / MB} MB)`)
        if (!file.size) throw new HttpError(400, 'That file is empty')
        bytes = Buffer.from(await file.arrayBuffer())
        if (media === 'image' && !hasImageSignature(bytes, mimeType)) throw new HttpError(415, 'That file is not a valid image')
        if (media === 'text') {
          textInput = bytes.toString('utf8').slice(0, MAX_TEXT)
          bytes = null
          mimeType = 'text/plain'
        }
      } else if (typed) {
        media = 'text'
        textInput = typed.slice(0, MAX_TEXT)
      } else {
        throw new HttpError(400, 'Send a file or some text')
      }

      const blobKey = bytes ? blobs.key(householdId, id) : null
      if (bytes && blobKey) await blobs.write(blobKey, bytes)
      try {
        write(householdId, user.id, (ctx) =>
          insertCapture(ctx, { id, media, hint, mimeType, blobKey, byteSize: file?.size ?? null, fileName, textInput }),
        )
      } catch (error) {
        // The same upload retried while the first attempt was still being stored.
        if (error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
          return c.json(toCapture(load(householdId, id)))
        }
        throw error
      }
      const created = toCapture(getCapture(db, householdId, id)!)
      queue.enqueue(id)
      return c.json(created satisfies Capture, 201)
    },
  )

  app.get('/captures/:id', (c) => {
    const user = requireUser(c)
    return c.json(toCapture(load(user.household_id, c.req.param('id'))) satisfies Capture)
  })

  app.get('/captures/:id/file', async (c) => {
    const user = requireUser(c)
    const capture = load(user.household_id, c.req.param('id'))
    if (!capture.blob_key) throw new HttpError(404, 'This capture has no file')
    const bytes = await blobs.read(capture.blob_key).catch(() => null)
    if (!bytes) throw new HttpError(404, 'The original file is gone')
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': capture.mime_type ?? 'application/octet-stream',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    })
  })

  app.post('/captures/:id/apply', async (c) => {
    const user = requireUser(c)
    const input = await readJson(c, applySchema)
    const capture = load(user.household_id, c.req.param('id'))
    if (capture.status === 'applied') throw new HttpError(409, 'This capture was already added')
    if (capture.status !== 'ready') throw new HttpError(409, 'This capture is not ready to review yet')
    const result = write(user.household_id, user.id, (ctx) => applyCapture(ctx, capture, input))
    return c.json({ result } satisfies { result: CaptureResult })
  })

  app.post('/captures/:id/retry', async (c) => {
    const user = requireUser(c)
    const body = await readJson(c, z.object({ hint: z.enum(['auto', 'list', 'receipt']).optional() }))
    const capture = load(user.household_id, c.req.param('id'))
    if (capture.status === 'applied') throw new HttpError(409, 'This capture was already added')
    if (capture.status === 'pending' || capture.status === 'processing') return c.json(toCapture(capture))
    write(user.household_id, user.id, (ctx) =>
      updateCapture(ctx, capture.id, { status: 'pending', hint: body.hint ?? capture.hint, error: null, extraction: null }),
    )
    const pending = toCapture(getCapture(db, user.household_id, capture.id)!)
    queue.enqueue(capture.id)
    return c.json(pending)
  })

  app.post('/captures/:id/dismiss', (c) => {
    const user = requireUser(c)
    const capture = load(user.household_id, c.req.param('id'))
    if (capture.status !== 'applied') {
      write(user.household_id, user.id, (ctx) => updateCapture(ctx, capture.id, { status: 'dismissed' }))
    }
    return c.json(toCapture(getCapture(db, user.household_id, capture.id)!))
  })

  // Removes what was captured; items and purchases already added from it stay.
  app.delete('/captures/:id', async (c) => {
    const user = requireUser(c)
    const capture = getCapture(db, user.household_id, c.req.param('id'))
    if (!capture || capture.deleted_at) return c.body(null, 204)
    write(user.household_id, user.id, (ctx) =>
      updateCapture(ctx, capture.id, {
        deleted_at: ctx.now,
        status: capture.status === 'applied' ? 'applied' : 'dismissed',
        blob_key: null,
        text_input: null,
        transcript: null,
        extraction: null,
      }),
    )
    if (capture.blob_key) await blobs.remove(capture.blob_key)
    return c.body(null, 204)
  })

  return app
}
