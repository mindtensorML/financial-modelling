import { useCallback, useEffect, useRef, useState } from 'react'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}

interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}

interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = new () => Recognition

function recognitionClass(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const dictationSupported = () => recognitionClass() !== null

/**
 * Live dictation through the browser's speech recognition, which works without an AI
 * provider. Each finished phrase (a pause) arrives as its own line.
 */
export function useDictation(onPhrase: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const callback = useRef(onPhrase)
  callback.current = onPhrase

  const stop = useCallback(() => recognition.current?.stop(), [])

  const start = useCallback(() => {
    const Recognition = recognitionClass()
    if (!Recognition) return
    recognition.current?.abort()
    const r = new Recognition()
    r.continuous = true
    r.interimResults = true
    r.lang = navigator.language || 'en-US'
    r.onresult = (event) => {
      let pending = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!
        const text = result[0].transcript.trim()
        if (result.isFinal) {
          if (text) callback.current(text)
        } else {
          pending += `${text} `
        }
      }
      setInterim(pending.trim())
    }
    r.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone access is blocked. Allow it in your browser settings to dictate.')
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError('Dictation stopped. Try again.')
      }
    }
    r.onend = () => {
      setListening(false)
      setInterim('')
      recognition.current = null
    }
    recognition.current = r
    setError(null)
    setListening(true)
    try {
      r.start()
    } catch {
      setListening(false)
    }
  }, [])

  useEffect(() => () => recognition.current?.abort(), [])

  return { supported: dictationSupported(), listening, interim, error, start, stop }
}
