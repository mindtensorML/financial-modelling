import { useCallback, useEffect, useRef, useState } from 'react'

const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
const EXTENSIONS: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' }

export type RecorderState = 'idle' | 'starting' | 'recording' | 'denied' | 'unsupported'

export const recordingSupported = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

/** Records a voice note; stops by itself after `maxMs`. */
export function useRecorder(onDone: (file: File) => void, maxMs = 180_000) {
  const [state, setState] = useState<RecorderState>(recordingSupported() ? 'idle' : 'unsupported')
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const discard = useRef(false)
  const done = useRef(onDone)
  done.current = onDone

  const finish = useCallback((cancel: boolean) => {
    discard.current = cancel
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  const start = useCallback(async () => {
    if (!recordingSupported()) return
    setState('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setState('denied')
      return
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    const startedAt = Date.now()
    const ticker = setInterval(() => {
      const ms = Date.now() - startedAt
      setElapsed(ms)
      if (ms >= maxMs) finish(false)
    }, 250)
    r.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    r.onstop = () => {
      clearInterval(ticker)
      for (const track of stream.getTracks()) track.stop()
      recorder.current = null
      setState('idle')
      setElapsed(0)
      if (discard.current || !chunks.length) return
      const type = (r.mimeType || mimeType || 'audio/webm').split(';')[0]!
      const file = new File(chunks, `voice-note.${EXTENSIONS[type] ?? 'webm'}`, { type })
      done.current(file)
    }
    discard.current = false
    recorder.current = r
    r.start(1000)
    setState('recording')
  }, [finish, maxMs])

  useEffect(() => () => finish(true), [finish])

  return { state, elapsed, start, stop: () => finish(false), cancel: () => finish(true) }
}
