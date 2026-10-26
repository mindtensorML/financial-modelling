import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AiEngine, AiError } from '../../src/server/ingest/ai'
import type { RawExtraction } from '../../src/server/ingest/extraction'
import type { Engines } from '../../src/server/ingest/pipeline'
import { CaptureQueue } from '../../src/server/ingest/queue'
import { extractWithRules } from '../../src/server/ingest/rules'
import type { Capture, CaptureResult, ExtractedItem } from '../../src/shared/types'
import { Client, HOUR, setup, uuid } from './helpers'

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c10000000049454e44ae426082',
  'hex',
)

const RECEIPT = `TRADER JOE'S #552
BANANAS                    1.16
ORG WHOLE MILK GAL         5.49
AVOCADO HASS               3.98
SUBTOTAL                  10.63
TOTAL                     10.63
01/05/2026 9:30 AM`

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function env(engines?: Engines) {
  const e = setup({ engines })
  roots.push(e.blobs.root)
  return e
}

/** An AI provider that reads text with the built-in parser and photos as a fixed list. */
function fakeAi(overrides: Partial<AiEngine> = {}): AiEngine {
  const photo: RawExtraction = {
    kind: 'list',
    store: null,
    purchasedAt: null,
    currency: null,
    total: null,
    notes: 'The last line was smudged.',
    items: [
      { name: 'Oat milk', rawText: 'oat milk', quantity: 2, unit: null, price: null, category: 'Dairy & Eggs', storeHint: null, note: null },
      { name: 'Paper towels', rawText: 'paper towels', quantity: null, unit: null, price: null, category: 'Household', storeHint: 'Costco', note: null },
    ],
  }
  return {
    model: 'fake',
    canTranscribe: true,
    extractText: async (text, ctx) => extractWithRules(text, ctx),
    extractImage: async () => photo,
    transcribe: async () => 'we need bananas and a dozen eggs',
    ...overrides,
  }
}

const png = (bytes: Buffer = PNG, type = 'image/png', name = 'list.png') => new File([new Uint8Array(bytes)], name, { type })

async function signedIn(app: ReturnType<typeof setup>['app'], name = 'Ana') {
  const client = new Client(app)
  const me = await client.signup(name, `${name.toLowerCase()}@example.com`)
  return { client, me }
}

async function capture(client: Client, fields: Record<string, string | Blob>): Promise<Capture> {
  const res = await client.upload({ id: uuid(), ...fields })
  if (res.status !== 201) throw new Error(`Upload answered ${res.status}: ${await res.text()}`)
  return (await res.json()) as Capture
}

/** The review screen sends the items back as the user left them. */
const reviewed = (items: ExtractedItem[]) =>
  items.map((i) => ({ name: i.name, rawText: i.rawText, quantity: i.quantity, unit: i.unit, price: i.price, category: i.category, storeHint: i.storeHint }))

describe('captures', () => {
  it('reads a pasted list, then files the reviewed items by store', async () => {
    const { app, queue } = env()
    const { client } = await signedIn(app)
    // With a single store everything would be filed there; two leave room for "unsorted".
    await client.ops({ type: 'store.upsert', id: uuid(), name: "Trader Joe's" })
    const created = await capture(client, { text: 'Costco:\n- paper towels\n- olive oil\nmilk x2' })
    expect(created).toMatchObject({ media: 'text', status: 'pending', hint: 'auto', textInput: expect.stringContaining('Costco') })

    await queue.idle()
    const ready = await client.json<Capture>('GET', `/api/captures/${created.id}`)
    expect(ready).toMatchObject({ status: 'ready', engine: 'rules', error: null })
    expect(ready.extraction!.kind).toBe('list')
    expect(ready.extraction!.items.map((i) => [i.name, i.quantity, i.storeHint, i.onList])).toEqual([
      ['Paper towels', null, 'Costco', false],
      ['Olive oil', null, 'Costco', false],
      ['Milk', 2, 'Costco', false],
    ])

    const items = reviewed(ready.extraction!.items)
    items[2]!.storeHint = null
    const { result } = await client.json<{ result: CaptureResult }>('POST', `/api/captures/${created.id}/apply`, {
      mode: 'list',
      items,
    })
    expect(result).toEqual({ mode: 'list', added: 3, merged: 0, purchases: 0, checkedOff: 0, storeId: null })

    const sync = await client.sync()
    const costco = sync.stores.find((s) => s.name === 'Costco')!
    expect(sync.items.map((i) => [i.name, i.storeId === costco.id, i.captureId])).toEqual([
      ['Paper towels', true, created.id],
      ['Olive oil', true, created.id],
      ['Milk', false, created.id],
    ])
    expect(sync.captures.find((c) => c.id === created.id)).toMatchObject({ status: 'applied', result })

    const again = await client.request('POST', `/api/captures/${created.id}/apply`, { mode: 'list', items })
    expect(again.status).toBe(409)
  })

  it('marks items already on the list and merges them instead of adding duplicates', async () => {
    const { app, queue } = env()
    const { client } = await signedIn(app)
    await client.ops({ type: 'item.add', id: uuid(), name: 'Milk', at: 0 })
    const created = await capture(client, { text: 'milk, eggs', hint: 'list' })
    await queue.idle()
    const ready = await client.json<Capture>('GET', `/api/captures/${created.id}`)
    expect(ready.extraction!.items.map((i) => [i.name, i.onList, Boolean(i.productId)])).toEqual([
      ['Milk', true, true],
      ['Eggs', false, false],
    ])
    const { result } = await client.json<{ result: CaptureResult }>('POST', `/api/captures/${created.id}/apply`, {
      mode: 'list',
      items: reviewed(ready.extraction!.items),
    })
    expect(result).toMatchObject({ added: 1, merged: 1 })
    expect((await client.sync()).items.filter((i) => !i.deletedAt).map((i) => i.name)).toEqual(['Milk', 'Eggs'])
  })

  it('reads photos with the AI provider and serves the original back only to the household', async () => {
    const { app, queue, blobs } = env({ ai: fakeAi(), ocr: null })
    const { client, me } = await signedIn(app)
    const created = await capture(client, { file: png(), hint: 'list' })
    expect(created).toMatchObject({ media: 'image', mimeType: 'image/png', fileName: 'list.png', byteSize: PNG.length })
    await queue.idle()

    const ready = await client.json<Capture>('GET', `/api/captures/${created.id}`)
    expect(ready).toMatchObject({ status: 'ready', engine: 'ai' })
    expect(ready.extraction).toMatchObject({ kind: 'list', notes: 'The last line was smudged.', warnings: [] })
    expect(ready.extraction!.items.map((i) => [i.name, i.quantity, i.category, i.storeHint])).toEqual([
      ['Oat milk', 2, 'Dairy & Eggs', null],
      ['Paper towels', null, 'Household', 'Costco'],
    ])

    const file = await client.request('GET', `/api/captures/${created.id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/png')
    expect(file.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(file.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true)
    expect(existsSync(join(blobs.root, me.household.id, created.id))).toBe(true)

    const { client: stranger } = await signedIn(app, 'Eve')
    expect((await stranger.request('GET', `/api/captures/${created.id}/file`)).status).toBe(404)
    expect((await stranger.request('GET', `/api/captures/${created.id}`)).status).toBe(404)
    expect((await stranger.request('POST', `/api/captures/${created.id}/dismiss`)).status).toBe(404)
  })

  it('turns away files it cannot read, with a reason', async () => {
    const { app } = env()
    const { client } = await signedIn(app)
    const reject = async (fields: Record<string, string | Blob>) => {
      const res = await client.upload({ id: uuid(), ...fields })
      return { status: res.status, error: ((await res.json()) as { error: string }).error }
    }
    expect(await reject({ file: png(PNG, 'image/heic', 'IMG_0001.HEIC') })).toMatchObject({ status: 415, error: /HEIC/ })
    expect(await reject({ file: png(PNG, 'application/pdf', 'receipt.pdf') })).toMatchObject({ status: 415, error: /screenshot/ })
    expect(await reject({ file: png(Buffer.from('<script>alert(1)</script>'), 'image/png') })).toMatchObject({
      status: 415,
      error: 'That file is not a valid image',
    })
    expect(await reject({ file: png(Buffer.from('<html></html>'), 'text/html', 'x.html') })).toMatchObject({ status: 415 })
    expect(await reject({ file: png(Buffer.alloc(0)) })).toMatchObject({ status: 400, error: 'That file is empty' })
    expect(await reject({ text: '   ' })).toMatchObject({ status: 400, error: 'Send a file or some text' })
    expect(await reject({ file: png(Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)])) })).toMatchObject({
      status: 413,
      error: 'That file is too large (the limit is 15 MB)',
    })
    expect(await reject({ file: png(Buffer.alloc(27 * 1024 * 1024)) })).toMatchObject({ status: 413, error: 'That file is too large' })

    const badId = await client.upload({ id: 'nope', text: 'milk' })
    expect(badId.status).toBe(400)
    const forged = await client.upload({ id: uuid(), text: 'milk' }, {})
    expect(forged.status).toBe(403)
    const anonymous = await new Client(app).upload({ id: uuid(), text: 'milk' })
    expect(anonymous.status).toBe(401)

    // Bigger than the JSON limit, but within the photo limit.
    const big = await client.upload({ id: uuid(), file: png(Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)])) })
    expect(big.status).toBe(201)
    const tooBigJson = await client.request('POST', '/api/ops', { ops: [], padding: 'x'.repeat(1024 * 1024 + 1) })
    expect(tooBigJson.status).toBe(413)
  })

  it('treats a repeated upload as the same capture', async () => {
    const { app, db, queue } = env()
    const { client } = await signedIn(app)
    const id = uuid()
    const first = await client.upload({ id, text: 'milk' })
    const second = await client.upload({ id, text: 'milk' })
    expect([first.status, second.status]).toEqual([201, 200])
    expect(((await second.json()) as Capture).id).toBe(id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM captures').get()).toEqual({ n: 1 })

    const { client: stranger } = await signedIn(app, 'Eve')
    expect((await stranger.upload({ id, text: 'milk' })).status).toBe(409)
    await queue.idle()
  })

  it('records a receipt: purchases, ticks off the list, and learns its abbreviations', async () => {
    const { app, db, queue, clock } = env()
    const { client } = await signedIn(app)
    const bananas = uuid()
    await client.ops(
      { type: 'item.add', id: bananas, name: 'Bananas', at: 0 },
      { type: 'item.add', id: uuid(), name: 'Whole milk', at: 0 },
    )
    clock.advance(3 * HOUR)

    const created = await capture(client, { text: RECEIPT })
    await queue.idle()
    const ready = await client.json<Capture>('GET', `/api/captures/${created.id}`)
    expect(ready.extraction).toMatchObject({ kind: 'receipt', store: "Trader Joe's", storeId: null, total: 10.63 })
    expect(ready.extraction!.purchasedAt).toBe('2026-01-05T09:30')
    const listed = (await client.sync()).products
    const milk = listed.find((p) => p.name === 'Whole milk')!
    // "Organic whole milk" is a variant of the whole milk on the list, so it is linked to it.
    expect(ready.extraction!.items.map((i) => [i.name, i.rawText, i.price, i.onList, i.productId])).toEqual([
      ['Bananas', 'BANANAS', 1.16, true, listed.find((p) => p.name === 'Bananas')!.id],
      ['Organic whole milk', 'ORG WHOLE MILK GAL', 5.49, true, milk.id],
      ['Avocado hass', 'AVOCADO HASS', 3.98, false, null],
    ])

    // During review the user tidies up the avocado line.
    const items = reviewed(ready.extraction!.items)
    items[2]!.name = 'Avocados'
    const purchasedAt = clock.now() - 2 * HOUR
    const { result } = await client.json<{ result: CaptureResult }>('POST', `/api/captures/${created.id}/apply`, {
      mode: 'receipt',
      storeName: "TRADER JOE'S",
      purchasedAt,
      items,
    })
    expect(result).toMatchObject({ mode: 'receipt', purchases: 3, checkedOff: 2 })

    const sync = await client.sync()
    const tj = sync.stores.find((s) => s.id === result.storeId)!
    expect(tj.name).toBe("Trader Joe's")
    const checked = sync.items.filter((i) => i.checkedAt !== null)
    expect(checked.map((i) => [i.name, i.checkedAt, i.storeId, i.storeReason])).toEqual([
      ['Bananas', purchasedAt, tj.id, 'On your receipt'],
      ['Whole milk', purchasedAt, tj.id, 'On your receipt'],
    ])
    expect(sync.products.find((p) => p.name === 'Bananas')).toMatchObject({ predictedStoreId: tj.id, purchaseCount: 1 })
    expect(db.prepare('SELECT price_cents FROM purchases ORDER BY price_cents').all()).toEqual([
      { price_cents: 116 },
      { price_cents: 398 },
      { price_cents: 549 },
    ])

    // The next receipt from there uses the household's names for the printed lines.
    clock.advance(7 * 24 * HOUR)
    const next = await capture(client, { text: RECEIPT.replace('01/05/2026', '01/12/2026') })
    await queue.idle()
    const nextReady = await client.json<Capture>('GET', `/api/captures/${next.id}`)
    const avocados = sync.products.find((p) => p.name === 'Avocados')!
    expect(nextReady.extraction!.storeId).toBe(tj.id)
    expect(nextReady.extraction!.items.map((i) => [i.name, i.productId])).toEqual([
      ['Bananas', expect.any(String)],
      ['Whole milk', milk.id],
      ['Avocados', avocados.id],
    ])
    expect(nextReady.extraction!.warnings).toEqual([])
  })

  it('upgrades a check-off from the same trip instead of counting the purchase twice', async () => {
    const { app, db, queue, clock } = env()
    const { client } = await signedIn(app)
    const eggs = uuid()
    await client.ops({ type: 'item.add', id: eggs, name: 'Eggs', at: 0 })
    const checkedAt = clock.now()
    await client.ops({ type: 'item.check', id: eggs, checked: true, at: checkedAt })
    clock.advance(HOUR)

    const created = await capture(client, { text: 'COSTCO\nEGGS 24CT  7.99\nTOTAL 7.99', hint: 'receipt' })
    await queue.idle()
    const ready = await client.json<Capture>('GET', `/api/captures/${created.id}`)
    const { result } = await client.json<{ result: CaptureResult }>('POST', `/api/captures/${created.id}/apply`, {
      mode: 'receipt',
      storeName: 'Costco',
      purchasedAt: checkedAt + 10 * 60_000,
      items: reviewed(ready.extraction!.items).map((i) => ({ ...i, name: 'Eggs' })),
    })
    expect(result).toMatchObject({ purchases: 1, checkedOff: 0 })
    expect(db.prepare('SELECT source, price_cents, purchased_at, store_id FROM purchases').all()).toEqual([
      { source: 'receipt', price_cents: 799, purchased_at: checkedAt, store_id: result.storeId },
    ])
  })

  it('warns when the same receipt is added twice', async () => {
    const { app, queue } = env()
    const { client } = await signedIn(app)
    const first = await capture(client, { text: RECEIPT })
    await queue.idle()
    const ready = await client.json<Capture>('GET', `/api/captures/${first.id}`)
    await client.json('POST', `/api/captures/${first.id}/apply`, {
      mode: 'receipt',
      storeName: ready.extraction!.store,
      items: reviewed(ready.extraction!.items),
    })

    const second = await capture(client, { text: RECEIPT })
    await queue.idle()
    const again = await client.json<Capture>('GET', `/api/captures/${second.id}`)
    expect(again.extraction!.warnings).toEqual(['You may have added this receipt already: same store, date, and total.'])
  })

  it('transcribes voice notes, and says what is missing when it cannot', async () => {
    const audio = new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], 'note.webm', { type: 'audio/webm;codecs=opus' })

    const withAi = env({ ai: fakeAi(), ocr: null })
    const { client } = await signedIn(withAi.app)
    const note = await capture(client, { file: audio })
    expect(note).toMatchObject({ media: 'audio', mimeType: 'audio/webm' })
    await withAi.queue.idle()
    const heard = await client.json<Capture>('GET', `/api/captures/${note.id}`)
    expect(heard).toMatchObject({ status: 'ready', transcript: 'we need bananas and a dozen eggs' })
    expect(heard.extraction!.items.map((i) => [i.name, i.quantity, i.unit])).toEqual([
      ['Bananas', null, null],
      ['Eggs', 1, 'dozen'],
    ])

    const without = env()
    const { client: offline } = await signedIn(without.app)
    const unheard = await capture(offline, { file: audio })
    await without.queue.idle()
    expect(await offline.json<Capture>('GET', `/api/captures/${unheard.id}`)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/^Voice notes need an AI provider that can transcribe/),
      extraction: null,
    })
  })

  it('lets a failed capture be retried', async () => {
    let attempts = 0
    const ai = fakeAi({
      extractImage: async () => {
        attempts++
        if (attempts === 1) throw new AiError('The AI provider is rate limiting requests or the account is out of credit', 429)
        return { kind: 'list', store: null, purchasedAt: null, currency: null, total: null, notes: null, items: [] }
      },
    })
    const { app, queue } = env({ ai, ocr: null })
    const { client } = await signedIn(app)
    const created = await capture(client, { file: png() })
    await queue.idle()
    expect(await client.json<Capture>('GET', `/api/captures/${created.id}`)).toMatchObject({
      status: 'failed',
      error: 'The AI provider is rate limiting requests or the account is out of credit',
    })
    const applyFailed = await client.request('POST', `/api/captures/${created.id}/apply`, { mode: 'list', items: [] })
    expect(applyFailed.status).toBe(409)

    const retried = await client.json<Capture>('POST', `/api/captures/${created.id}/retry`, { hint: 'receipt' })
    expect(retried).toMatchObject({ status: 'pending', hint: 'receipt', error: null })
    await queue.idle()
    expect(await client.json<Capture>('GET', `/api/captures/${created.id}`)).toMatchObject({ status: 'ready', hint: 'receipt' })
    expect(attempts).toBe(2)
  })

  it('keeps a capture dismissed even if it was still being read', async () => {
    let finish: () => void = () => undefined
    const ai = fakeAi({
      extractImage: () =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: 'list', store: null, purchasedAt: null, currency: null, total: null, notes: null, items: [] })
        }),
    })
    const { app, queue } = env({ ai, ocr: null })
    const { client } = await signedIn(app)
    const created = await capture(client, { file: png() })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await client.json<Capture>('GET', `/api/captures/${created.id}`)).status).toBe('processing')

    expect(await client.json<Capture>('POST', `/api/captures/${created.id}/dismiss`)).toMatchObject({ status: 'dismissed' })
    finish()
    await queue.idle()
    expect(await client.json<Capture>('GET', `/api/captures/${created.id}`)).toMatchObject({ status: 'dismissed', extraction: null })
  })

  it('deletes the original file and contents, and syncs the deletion', async () => {
    const { app, queue, blobs } = env({ ai: fakeAi(), ocr: null })
    const { client, me } = await signedIn(app)
    const created = await capture(client, { file: png() })
    await queue.idle()
    const before = (await client.sync()).rev
    const path = join(blobs.root, me.household.id, created.id)
    expect(existsSync(path)).toBe(true)

    expect((await client.request('DELETE', `/api/captures/${created.id}`)).status).toBe(204)
    expect(existsSync(path)).toBe(false)
    expect((await client.request('GET', `/api/captures/${created.id}`)).status).toBe(404)
    expect((await client.request('GET', `/api/captures/${created.id}/file`)).status).toBe(404)
    const delta = await client.sync(before)
    expect(delta.captures).toEqual([
      expect.objectContaining({ id: created.id, status: 'dismissed', extraction: null, deletedAt: expect.any(Number) }),
    ])
    expect((await client.request('DELETE', `/api/captures/${created.id}`)).status).toBe(204)
  })

  it('picks up captures that a restart interrupted', async () => {
    const { app, db, blobs, hub, clock, queue } = env()
    const { client } = await signedIn(app)
    const created = await capture(client, { text: 'milk' })
    await queue.idle()
    db.prepare("UPDATE captures SET status = 'processing', extraction = NULL").run()

    const restarted = new CaptureQueue({ db, blobs, hub, now: clock.now, engines: { ai: null, ocr: null } })
    expect(restarted.resume()).toBe(1)
    await restarted.idle()
    expect(await client.json<Capture>('GET', `/api/captures/${created.id}`)).toMatchObject({ status: 'ready' })
  })

  it('removes the uploads of a household deleted when its last member joins another', async () => {
    const { app, queue, blobs } = env({ ai: fakeAi(), ocr: null })
    const { client: ana, me: anaMe } = await signedIn(app, 'Ana')
    const { me: benMe } = await signedIn(app, 'Ben')
    await capture(ana, { file: png() })
    await queue.idle()
    const folder = join(blobs.root, anaMe.household.id)
    expect(existsSync(folder)).toBe(true)

    await ana.json('POST', '/api/household/join', { inviteCode: benMe.household.inviteCode })
    expect(existsSync(folder)).toBe(false)
  })
})
