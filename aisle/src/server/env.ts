import { resolve } from 'node:path'
import type { SignupMode } from '../shared/types'

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
  /**
   * Header the proxy in front of the app puts the visitor's address in, for rate limits. Null uses
   * the connection's address. Only safe for a header that proxy overwrites, or visitors can fake it.
   */
  clientIpHeader: string | null
  signupMode: SignupMode
  webDir: string
  ai: AiConfig | null
  ocrEnabled: boolean
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

/** TRUST_PROXY is either a yes/no flag (yes means X-Forwarded-For) or the name of a header. */
function clientIpHeader(value: string | undefined): string | null {
  const text = value?.trim().toLowerCase() ?? ''
  if (['', '0', 'false', 'no', 'off'].includes(text)) return null
  if (['1', 'true', 'yes', 'on'].includes(text)) return 'x-forwarded-for'
  if (!/^[a-z0-9-]+$/.test(text)) {
    throw new Error(`TRUST_PROXY must be true, false, or a header name such as cf-connecting-ip, not "${value}"`)
  }
  return text
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || ''
  return {
    dataDir: resolve(env.DATA_DIR || './data'),
    port: Number(env.PORT || 8787),
    cookieSecure: flag(env.COOKIE_SECURE, false),
    clientIpHeader: clientIpHeader(env.TRUST_PROXY),
    signupMode: env.SIGNUP_MODE?.trim().toLowerCase() === 'invite' ? 'invite' : 'open',
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
