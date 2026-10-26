import { resolve } from 'node:path'

export interface AiConfig {
  apiKey: string
  baseUrl: string
  model: string
  transcribeModel: string | null
}

export interface Config {
  dataDir: string
  port: number
  cookieSecure: boolean
  webDir: string
  ai: AiConfig | null
  ocrEnabled: boolean
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || ''
  return {
    dataDir: resolve(env.DATA_DIR || './data'),
    port: Number(env.PORT || 8787),
    cookieSecure: flag(env.COOKIE_SECURE, false),
    webDir: resolve(env.WEB_DIR || './dist/web'),
    ai: apiKey
      ? {
          apiKey,
          baseUrl: (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
          model: env.AI_MODEL || 'gpt-4.1-mini',
          transcribeModel: env.AI_TRANSCRIBE_MODEL === undefined ? 'gpt-4o-mini-transcribe' : env.AI_TRANSCRIBE_MODEL || null,
        }
      : null,
    ocrEnabled: flag(env.OCR_ENABLED, true),
  }
}
