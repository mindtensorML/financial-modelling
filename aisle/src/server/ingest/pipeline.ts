import { join } from 'node:path'
import type { CaptureEngine, CaptureMedia } from '../../shared/types'
import type { Config } from '../env'
import { type AiEngine, AiError, createAiEngine } from './ai'
import { emptyExtraction, type ExtractContext, type RawExtraction } from './extraction'
import { type OcrEngine, TesseractOcr } from './ocr'
import { extractWithRules } from './rules'

export interface Engines {
  ai: AiEngine | null
  ocr: OcrEngine | null
}

export function createEngines(config: Config): Engines {
  return {
    ai: config.ai ? createAiEngine(config.ai) : null,
    ocr: config.ocrEnabled ? new TesseractOcr(join(config.dataDir, 'tesseract')) : null,
  }
}

export interface PipelineInput {
  media: CaptureMedia
  mimeType: string | null
  bytes: Buffer | null
  text: string | null
}

export interface PipelineOutput {
  raw: RawExtraction
  engine: CaptureEngine
  /** Speech-to-text for voice notes, or the text OCR found in an image. */
  transcript: string | null
  warnings: string[]
}

/** A failure the user can act on; its message is shown on the capture. */
export class CaptureFailure extends Error {}

const reason = (error: unknown) => (error instanceof AiError ? error.message : 'The AI provider failed')

/**
 * Reads a capture with the best engine available: the AI provider when configured, falling
 * back to OCR and the rule-based parsers when it is missing or fails.
 */
export async function runPipeline(input: PipelineInput, engines: Engines, ctx: ExtractContext): Promise<PipelineOutput> {
  const warnings: string[] = []
  const { ai, ocr } = engines

  if (input.media === 'text') {
    const text = input.text ?? ''
    if (ai) {
      try {
        return { raw: await ai.extractText(text, ctx), engine: 'ai', transcript: null, warnings }
      } catch (error) {
        warnings.push(`${reason(error)}, so this was read with the built-in parser.`)
      }
    }
    return { raw: extractWithRules(text, ctx), engine: 'rules', transcript: null, warnings }
  }

  if (input.media === 'image') {
    if (!input.bytes || !input.mimeType) throw new CaptureFailure('The image is missing')
    if (ai) {
      try {
        return { raw: await ai.extractImage(input.bytes, input.mimeType, ctx), engine: 'ai', transcript: null, warnings }
      } catch (error) {
        if (!ocr) throw new CaptureFailure(reason(error))
        warnings.push(`${reason(error)}, so this was read with OCR. Check it carefully.`)
      }
    }
    if (!ocr) throw new CaptureFailure('Reading photos needs an AI provider or OCR, and both are off on this server')
    let text: string
    try {
      text = await ocr.recognize(input.bytes)
    } catch (error) {
      throw new CaptureFailure(error instanceof Error ? error.message : 'OCR failed')
    }
    const raw = extractWithRules(text, ctx)
    if (!raw.items.length) {
      warnings.push(
        text.trim()
          ? 'No items were recognized. Handwriting is hard to read without an AI provider; add the items here by hand.'
          : 'No text was found in this image.',
      )
    }
    return { raw, engine: 'ocr', transcript: text.trim() || null, warnings }
  }

  if (!input.bytes || !input.mimeType) throw new CaptureFailure('The recording is missing')
  if (!ai?.canTranscribe) {
    throw new CaptureFailure(
      'Voice notes need an AI provider that can transcribe. Dictation (the microphone in the text box) works without one.',
    )
  }
  let transcript: string
  try {
    transcript = await ai.transcribe(input.bytes, input.mimeType, ctx)
  } catch (error) {
    throw new CaptureFailure(reason(error))
  }
  if (!transcript) return { raw: emptyExtraction('list', 'No speech was found in the recording.'), engine: 'ai', transcript: null, warnings }
  const spoken = { ...ctx, hint: ctx.hint === 'receipt' ? ctx.hint : ('list' as const) }
  try {
    return { raw: await ai.extractText(transcript, spoken), engine: 'ai', transcript, warnings }
  } catch (error) {
    warnings.push(`${reason(error)}, so the transcript was read with the built-in parser.`)
    return { raw: extractWithRules(transcript, spoken, { speech: true }), engine: 'rules', transcript, warnings }
  }
}
