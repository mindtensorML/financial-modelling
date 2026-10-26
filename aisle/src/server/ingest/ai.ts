import { CATEGORIES } from '../../shared/categories'
import type { AiConfig } from '../env'
import { EXTRACTION_JSON_SCHEMA, type ExtractContext, parseRawExtraction, type RawExtraction } from './extraction'

const TIMEOUT_MS = 90_000
const RETRY_DELAY_MS = 1_500

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

export interface AiEngine {
  readonly model: string
  readonly canTranscribe: boolean
  extractText(text: string, ctx: ExtractContext): Promise<RawExtraction>
  extractImage(image: Buffer, mimeType: string, ctx: ExtractContext): Promise<RawExtraction>
  transcribe(audio: Buffer, mimeType: string, ctx: ExtractContext): Promise<string>
}

const INSTRUCTIONS = `You read shopping lists and receipts for a household shopping-list app and return the items as JSON.

Decide the kind first:
- "list": things to buy. Handwritten notes, typed lists, screenshots of notes or messages, recipe ingredient lists, voice-note transcripts.
- "receipt": proof of a purchase, printed or electronic.
- "other": neither. Return no items and say what you saw in notes.

For lists:
- One item per thing to buy. Split "eggs, milk and bread" into three items.
- Put amounts in quantity and unit: "2 lbs apples" is quantity 2, unit "lb", name "Apples"; "a dozen eggs" is quantity 1, unit "dozen".
- Keep brands and varieties that are written ("Oat milk", "Barilla penne"). Drop filler such as "get" or "we need".
- Put remarks such as "the big one" or "if on sale" in note.
- If items are grouped under a store heading ("Costco:") or a store is written next to an item ("milk from TJ's"), set storeHint to that store.
- Skip crossed-out items and anything that is not a thing to buy.

For receipts:
- One item per purchased line. Expand abbreviations into plain names ("ORG BNNA" is "Organic bananas", "KS PPR TWL" is "Kirkland paper towels") and keep the printed text in rawText.
- price is the line total after any discount printed under that line. Do not list subtotal, tax, total, payment, change, deposits, bag fees, or coupons as items.
- Use quantity and unit for weighed or multi-count lines ("2.13 lb @ 0.69/lb" is quantity 2.13, unit "lb").
- store is the store or chain name without store numbers or addresses. purchasedAt is the date, with the time if printed.

Always:
- category is one of: ${CATEGORIES.join(', ')}.
- When an item is one the household already buys, use the household's name for it.
- Never invent items. If part of the image is unreadable, skip it and say so in notes.`

const JSON_SHAPE = `Answer with one JSON object and nothing else, with exactly these fields:
{"kind": "list" | "receipt" | "other", "store": string|null, "purchasedAt": string|null, "currency": string|null,
 "total": number|null, "notes": string|null, "items": [{"name": string, "rawText": string|null, "quantity": number|null,
 "unit": string|null, "price": number|null, "category": string, "storeHint": string|null, "note": string|null}]}`

const HINTS: Record<ExtractContext['hint'], string> = {
  auto: 'The user did not say whether this is a list or a receipt.',
  list: 'The user says this is a shopping list.',
  receipt: 'The user says this is a receipt.',
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
}

function householdContext(ctx: ExtractContext): string {
  const stores = ctx.stores.length ? ctx.stores.join('; ') : 'none yet'
  const products = ctx.products.length ? ctx.products.slice(0, 150).join('; ') : 'none yet'
  return `The household's stores: ${stores}.\nItems the household already buys: ${products}.`
}

function describeFailure(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'The AI provider rejected the API key'
  if (status === 404) return 'The AI provider does not know that model or endpoint'
  if (status === 413) return 'The file is too large for the AI provider'
  if (status === 429) return 'The AI provider is rate limiting requests or the account is out of credit'
  if (status >= 500) return 'The AI provider had an error'
  const message = /"message"\s*:\s*"([^"]{1,200})/.exec(detail)?.[1]
  return `The AI provider could not handle the request${message ? `: ${message}` : ''}`
}

/** Talks to OpenAI, OpenRouter, Ollama, or anything else that implements the OpenAI API. */
export function createAiEngine(
  config: AiConfig,
  options: { fetch?: typeof fetch; retryDelayMs?: number } = {},
): AiEngine {
  const fetchImpl = options.fetch ?? fetch
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS

  async function post(path: string, body: BodyInit, headers: Record<string, string>, attempt = 0): Promise<Response> {
    let res: Response
    try {
      res = await fetchImpl(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, ...headers },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      if (attempt === 0) return post(path, body, headers, 1)
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      throw new AiError(timedOut ? 'The AI provider took too long to answer' : 'Could not reach the AI provider')
    }
    if (res.ok) return res
    const detail = await res.text().catch(() => '')
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      return post(path, body, headers, 1)
    }
    throw new AiError(describeFailure(res.status, detail), res.status)
  }

  async function complete(userContent: unknown, ctx: ExtractContext): Promise<RawExtraction> {
    const request = async (mode: 'json_schema' | 'json_object') => {
      const system = `${INSTRUCTIONS}\n\n${householdContext(ctx)}${mode === 'json_object' ? `\n\n${JSON_SHAPE}` : ''}`
      const body = {
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        response_format:
          mode === 'json_schema'
            ? { type: 'json_schema', json_schema: { name: 'shopping_extraction', strict: true, schema: EXTRACTION_JSON_SCHEMA } }
            : { type: 'json_object' },
      }
      const res = await post('/chat/completions', JSON.stringify(body), { 'content-type': 'application/json' })
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown; refusal?: string | null } }>
      }
      const message = data.choices?.[0]?.message
      if (message?.refusal) throw new AiError(`The model declined: ${message.refusal}`)
      const content =
        typeof message?.content === 'string'
          ? message.content
          : Array.isArray(message?.content)
            ? message.content.map((part: { text?: string }) => part.text ?? '').join('')
            : ''
      if (!content.trim()) throw new AiError('The AI provider returned an empty answer')
      try {
        return parseRawExtraction(content)
      } catch {
        throw new AiError('The AI provider answered with something other than the requested JSON')
      }
    }
    try {
      return await request('json_schema')
    } catch (error) {
      // Some OpenAI-compatible servers only support plain JSON mode.
      if (error instanceof AiError && error.status === 400 && /response_format|json_schema|schema/i.test(error.message)) {
        return request('json_object')
      }
      throw error
    }
  }

  return {
    model: config.model,
    canTranscribe: Boolean(config.transcribeModel),

    extractText(text, ctx) {
      return complete(`${HINTS[ctx.hint]}\n\n---\n${text.slice(0, 20_000)}`, ctx)
    },

    extractImage(image, mimeType, ctx) {
      return complete(
        [
          { type: 'text', text: `${HINTS[ctx.hint]} Read every item in this image.` },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}`, detail: 'high' } },
        ],
        ctx,
      )
    },

    async transcribe(audio, mimeType, ctx) {
      if (!config.transcribeModel) throw new AiError('No transcription model is configured')
      const type = mimeType.split(';')[0]!.trim().toLowerCase()
      const form = new FormData()
      // OpenAI infers the audio format from the file extension, so it has to match.
      form.append('file', new Blob([new Uint8Array(audio)], { type }), `voice-note.${AUDIO_EXTENSIONS[type] ?? 'webm'}`)
      form.append('model', config.transcribeModel)
      form.append('response_format', 'json')
      const vocabulary = [...ctx.stores, ...ctx.products.slice(0, 60)].join(', ')
      if (vocabulary) form.append('prompt', `A spoken shopping list. Names that may come up: ${vocabulary}.`.slice(0, 900))
      const res = await post('/audio/transcriptions', form, {})
      const data = (await res.json()) as { text?: unknown }
      return typeof data.text === 'string' ? data.text.trim() : ''
    },
  }
}
