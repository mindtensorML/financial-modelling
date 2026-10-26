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
  /** Read the client address from X-Forwarded-For / Fly-Client-IP; only safe behind a proxy that sets them. */
  trustProxy: boolean
  signupMode: SignupMode
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
    trustProxy: flag(env.TRUST_PROXY, false),
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
