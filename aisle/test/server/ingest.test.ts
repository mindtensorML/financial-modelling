import { describe, expect, it } from 'vitest'
import type { AiConfig } from '../../src/server/env'
import { type AiEngine, AiError, createAiEngine } from '../../src/server/ingest/ai'
import { type ExtractContext, parseRawExtraction, type RawExtraction } from '../../src/server/ingest/extraction'
import type { OcrEngine } from '../../src/server/ingest/ocr'
import { CaptureFailure, runPipeline } from '../../src/server/ingest/pipeline'
import { extractWithRules } from '../../src/server/ingest/rules'

const ctx: ExtractContext = { hint: 'auto', stores: ["Trader Joe's", 'Costco'], products: ['Oat milk', 'Bananas'] }

const RECEIPT = `TRADER JOE'S #552
BANANAS                    1.16
ORG WHOLE MILK GAL         5.49
SUBTOTAL                   6.65
TOTAL                      6.65
01/05/2026 9:30 AM`

const extraction = (items: string[], kind: RawExtraction['kind'] = 'list'): RawExtraction => ({
  kind,
  store: null,
  purchasedAt: null,
  currency: null,
  total: null,
  notes: null,
  items: items.map((name) => ({
    name,
    rawText: null,
    quantity: null,
    unit: null,
    price: null,
    category: null,
    storeHint: null,
    note: null,
  })),
})

function fakeAi(overrides: Partial<AiEngine> = {}): AiEngine & { calls: string[] } {
  const calls: string[] = []
  return {
    model: 'fake',
    canTranscribe: true,
    calls,
    async extractText(text, context) {
      calls.push(`text:${context.hint}:${text}`)
      return extraction(['From AI'])
    },
    async extractImage(_image, mimeType) {
      calls.push(`image:${mimeType}`)
      return extraction(['From photo'])
    },
    async transcribe(_audio, mimeType) {
      calls.push(`audio:${mimeType}`)
      return 'milk and eggs'
    },
    ...overrides,
  }
}

const fakeOcr = (text: string): OcrEngine => ({ recognize: async () => text, close: async () => undefined })
const failing = (status = 500) => async (): Promise<never> => {
  throw new AiError(status === 429 ? 'The AI provider is rate limiting requests' : 'The AI provider had an error', status)
}

describe('parseRawExtraction', () => {
  it('accepts the sloppy JSON that providers without structured output return', () => {
    const raw = parseRawExtraction(
      '```json\n' +
        JSON.stringify({
          kind: 'receipt',
          store: 'Costco',
          total: '$1,299.50',
          extra: 'ignored',
          items: [
            { name: 'Eggs', quantity: '2', price: '5,99', category: 'Dairy & Eggs', unit: 12 },
            { name: '   ' },
            { name: 'Mystery gadget', category: 'Gizmos', price: -3, quantity: 0 },
            'not an item',
          ],
        }) +
        '\n```',
    )
    expect(raw).toMatchObject({ kind: 'receipt', store: 'Costco', total: 1299.5, purchasedAt: null, notes: null })
    expect(raw.items).toEqual([
      { name: 'Eggs', rawText: null, quantity: 2, unit: '12', price: 5.99, category: 'Dairy & Eggs', storeHint: null, note: null },
      { name: 'Mystery gadget', rawText: null, quantity: null, unit: null, price: null, category: null, storeHint: null, note: null },
    ])
  })

  it('finds the object in a chatty answer and falls back to a list when the kind is unknown', () => {
    expect(parseRawExtraction('Here you go: {"kind":"receipt","items":[{"name":"Milk"}]} Enjoy!')).toMatchObject({
      kind: 'receipt',
      items: [{ name: 'Milk' }],
    })
    expect(parseRawExtraction('{"kind":"menu","items":"none"}')).toMatchObject({ kind: 'list', items: [] })
  })

  it('rejects answers without a JSON object', () => {
    expect(() => parseRawExtraction('Sure! Here are your items: milk, eggs')).toThrow(/not a JSON object/)
    expect(() => parseRawExtraction('[{"name":"Milk"}]')).toThrow(/not a JSON object/)
    expect(() => parseRawExtraction('{"kind": "list", "items": [')).toThrow(/not a JSON object/)
  })
})

describe('extractWithRules', () => {
  it('reads a list with store headings', () => {
    const raw = extractWithRules('Costco:\n- paper towels\n- 2 lbs chicken thighs\noat milk', ctx)
    expect(raw.kind).toBe('list')
    expect(raw.items.map((i) => [i.name, i.quantity, i.unit, i.storeHint])).toEqual([
      ['Paper towels', null, null, 'Costco'],
      ['Chicken thighs', 2, 'lb', 'Costco'],
      ['Oat milk', null, null, 'Costco'],
    ])
  })

  it('recognizes receipts on its own and keeps the printed text', () => {
    const raw = extractWithRules(RECEIPT, ctx)
    expect(raw).toMatchObject({ kind: 'receipt', store: "Trader Joe's", total: 6.65, purchasedAt: '2026-01-05T09:30' })
    expect(raw.items.map((i) => [i.name, i.rawText, i.price])).toEqual([
      ['Bananas', 'BANANAS', 1.16],
      ['Organic whole milk', 'ORG WHOLE MILK GAL', 5.49],
    ])
  })

  it('follows the hint and treats speech as a list', () => {
    expect(extractWithRules(RECEIPT, { ...ctx, hint: 'list' }).kind).toBe('list')
    expect(extractWithRules('TOTAL 5.00 milk', { ...ctx, hint: 'auto' }, { speech: true }).kind).toBe('list')
  })
})

describe('runPipeline', () => {
  const text = (value: string) => ({ media: 'text' as const, mimeType: null, bytes: null, text: value })
  const image = { media: 'image' as const, mimeType: 'image/png', bytes: Buffer.from('png'), text: null }
  const audio = { media: 'audio' as const, mimeType: 'audio/webm', bytes: Buffer.from('webm'), text: null }

  it('uses the AI provider for text and falls back to the parser when it fails', async () => {
    const ai = fakeAi()
    expect(await runPipeline(text('milk'), { ai, ocr: null }, ctx)).toMatchObject({ engine: 'ai', warnings: [] })
    expect(ai.calls).toEqual(['text:auto:milk'])

    const broken = await runPipeline(text('milk, eggs'), { ai: fakeAi({ extractText: failing(429) }), ocr: null }, ctx)
    expect(broken.engine).toBe('rules')
    expect(broken.raw.items.map((i) => i.name)).toEqual(['Milk', 'Eggs'])
    expect(broken.warnings).toEqual(['The AI provider is rate limiting requests, so this was read with the built-in parser.'])

    expect(await runPipeline(text('milk'), { ai: null, ocr: null }, ctx)).toMatchObject({ engine: 'rules' })
  })

  it('reads photos with the AI provider, then OCR, and fails clearly with neither', async () => {
    const ai = fakeAi()
    const read = await runPipeline(image, { ai, ocr: fakeOcr('ignored') }, ctx)
    expect(read).toMatchObject({ engine: 'ai', transcript: null })
    expect(read.raw.items[0]!.name).toBe('From photo')
    expect(ai.calls).toEqual(['image:image/png'])

    const ocr = await runPipeline(image, { ai: fakeAi({ extractImage: failing() }), ocr: fakeOcr('eggs\nbread\n') }, ctx)
    expect(ocr).toMatchObject({ engine: 'ocr', transcript: 'eggs\nbread' })
    expect(ocr.raw.items.map((i) => i.name)).toEqual(['Eggs', 'Bread'])
    expect(ocr.warnings[0]).toMatch(/^The AI provider had an error, so this was read with OCR/)

    const blank = await runPipeline(image, { ai: null, ocr: fakeOcr('  \n') }, ctx)
    expect(blank.warnings).toEqual(['No text was found in this image.'])

    await expect(runPipeline(image, { ai: null, ocr: null }, ctx)).rejects.toThrow(CaptureFailure)
    await expect(runPipeline(image, { ai: fakeAi({ extractImage: failing() }), ocr: null }, ctx)).rejects.toThrow(
      'The AI provider had an error',
    )
  })

  it('transcribes voice notes and reads them as a list', async () => {
    const ai = fakeAi()
    const heard = await runPipeline(audio, { ai, ocr: null }, ctx)
    expect(heard).toMatchObject({ engine: 'ai', transcript: 'milk and eggs' })
    expect(ai.calls).toEqual(['audio:audio/webm', 'text:list:milk and eggs'])

    const parsed = await runPipeline(audio, { ai: fakeAi({ extractText: failing() }), ocr: null }, ctx)
    expect(parsed).toMatchObject({ engine: 'rules', transcript: 'milk and eggs' })
    expect(parsed.raw.items.map((i) => i.name)).toEqual(['Milk', 'Eggs'])

    const silent = await runPipeline(audio, { ai: fakeAi({ transcribe: async () => '' }), ocr: null }, ctx)
    expect(silent.raw).toMatchObject({ items: [], notes: 'No speech was found in the recording.' })

    await expect(runPipeline(audio, { ai: { ...fakeAi(), canTranscribe: false }, ocr: null }, ctx)).rejects.toThrow(
      /Voice notes need an AI provider/,
    )
    await expect(runPipeline(audio, { ai: null, ocr: null }, ctx)).rejects.toThrow(CaptureFailure)
  })
})

describe('createAiEngine', () => {
  const config: AiConfig = {
    apiKey: 'sk-test',
    baseUrl: 'https://ai.example.com/v1',
    model: 'test-model',
    transcribeModel: 'test-transcribe',
  }

  interface Call {
    url: string
    init: RequestInit
  }

  function fakeFetch(...answers: Array<Response | Error>) {
    const calls: Call[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      const answer = answers.shift()
      if (!answer) throw new Error('No more answers')
      if (answer instanceof Error) throw answer
      return answer
    }
    return { calls, fetch: fetch as typeof globalThis.fetch }
  }

  const completion = (content: unknown) =>
    Response.json({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] })
  const answer = { kind: 'list', store: null, purchasedAt: null, currency: null, total: null, notes: null, items: [{ name: 'Milk' }] }

  it('asks for structured output and passes along what the household already uses', async () => {
    const { calls, fetch } = fakeFetch(completion(answer))
    const ai = createAiEngine(config, { fetch })
    const raw = await ai.extractText('milk', { ...ctx, hint: 'list' })
    expect(raw.items.map((i) => i.name)).toEqual(['Milk'])

    expect(calls[0]!.url).toBe('https://ai.example.com/v1/chat/completions')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.model).toBe('test-model')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.messages[0].content).toContain("The household's stores: Trader Joe's; Costco.")
    expect(body.messages[0].content).toContain('Items the household already buys: Oat milk; Bananas.')
    expect(body.messages[1].content).toContain('The user says this is a shopping list.')
  })

  it('sends photos inline', async () => {
    const { calls, fetch } = fakeFetch(completion(answer))
    await createAiEngine(config, { fetch }).extractImage(Buffer.from('abc'), 'image/jpeg', ctx)
    const content = JSON.parse(calls[0]!.init.body as string).messages[1].content
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJj', detail: 'high' } })
  })

  it('falls back to JSON mode for servers without structured output', async () => {
    const rejected = Response.json({ error: { message: "Unsupported value: 'response_format.type'" } }, { status: 400 })
    const { calls, fetch } = fakeFetch(rejected, completion(`Here you go:\n${JSON.stringify(answer)}`))
    const raw = await createAiEngine(config, { fetch }).extractText('milk', ctx)
    expect(raw.items.map((i) => i.name)).toEqual(['Milk'])
    const retry = JSON.parse(calls[1]!.init.body as string)
    expect(retry.response_format).toEqual({ type: 'json_object' })
    expect(retry.messages[0].content).toContain('Answer with one JSON object')
  })

  it('does not retry other bad requests in JSON mode', async () => {
    const tooLong = Response.json({ error: { message: 'maximum context length exceeded' } }, { status: 400 })
    const { calls, fetch } = fakeFetch(tooLong)
    await expect(createAiEngine(config, { fetch }).extractText('milk', ctx)).rejects.toThrow(
      'The AI provider could not handle the request: maximum context length exceeded',
    )
    expect(calls).toHaveLength(1)
  })

  it('retries once on rate limits, server errors, and network failures', async () => {
    const busy = new Response('busy', { status: 503 })
    const { calls, fetch } = fakeFetch(busy, completion(answer))
    await createAiEngine(config, { fetch, retryDelayMs: 0 }).extractText('milk', ctx)
    expect(calls).toHaveLength(2)

    const down = fakeFetch(new TypeError('fetch failed'), new TypeError('fetch failed'))
    await expect(createAiEngine(config, { fetch: down.fetch }).extractText('milk', ctx)).rejects.toThrow(
      'Could not reach the AI provider',
    )
    expect(down.calls).toHaveLength(2)
  })

  it('explains failures in words a person can act on', async () => {
    const denied = fakeFetch(new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 }))
    const error = await createAiEngine(config, { fetch: denied.fetch })
      .extractText('milk', ctx)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ message: 'The AI provider rejected the API key', status: 401 })
    expect(denied.calls).toHaveLength(1)

    const refused = fakeFetch(Response.json({ choices: [{ message: { content: null, refusal: 'I cannot help' } }] }))
    await expect(createAiEngine(config, { fetch: refused.fetch }).extractText('x', ctx)).rejects.toThrow(
      'The model declined: I cannot help',
    )

    const empty = fakeFetch(completion('  '))
    await expect(createAiEngine(config, { fetch: empty.fetch }).extractText('x', ctx)).rejects.toThrow('empty answer')

    const prose = fakeFetch(completion('Sure! You need milk and eggs.'))
    await expect(createAiEngine(config, { fetch: prose.fetch }).extractText('x', ctx)).rejects.toThrow(
      'The AI provider answered with something other than the requested JSON',
    )
  })

  it('transcribes audio with a file name the provider can infer the format from', async () => {
    const { calls, fetch } = fakeFetch(Response.json({ text: ' Milk and eggs. ' }))
    const ai = createAiEngine(config, { fetch })
    expect(ai.canTranscribe).toBe(true)
    expect(await ai.transcribe(Buffer.from('m4a'), 'audio/mp4;codecs=mp4a', ctx)).toBe('Milk and eggs.')
    expect(calls[0]!.url).toBe('https://ai.example.com/v1/audio/transcriptions')
    const form = calls[0]!.init.body as FormData
    expect((form.get('file') as File).name).toBe('voice-note.m4a')
    expect((form.get('file') as File).type).toBe('audio/mp4')
    expect(form.get('model')).toBe('test-transcribe')
    expect(form.get('prompt')).toContain("Trader Joe's, Costco, Oat milk, Bananas")

    const noModel = createAiEngine({ ...config, transcribeModel: null }, { fetch })
    expect(noModel.canTranscribe).toBe(false)
    await expect(noModel.transcribe(Buffer.from('x'), 'audio/webm', ctx)).rejects.toThrow(AiError)
  })
})
