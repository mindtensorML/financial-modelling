import {
  Camera,
  ChevronRight,
  CloudOff,
  FileText,
  ImagePlus,
  LoaderCircle,
  Mic,
  MicOff,
  Square,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { type ChangeEvent, type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Capture, CaptureHint } from '../../shared/types'
import { ScreenHeader } from '../components/Layout'
import { Button, Card, cx, EmptyState, Segmented, TextArea } from '../components/ui'
import { captureDetail, captureFileUrl, captureStatus, captureTitle, type StatusTone } from '../lib/captures'
import { plural, relativeTime } from '../lib/format'
import { useRecorder } from '../lib/recorder'
import { navigate } from '../lib/router'
import { useServerConfig } from '../lib/session'
import { takeSharedEntries } from '../lib/shareInbox'
import { useDictation } from '../lib/speech'
import { useSync } from '../lib/sync'
import { toast } from '../lib/toast'
import { type PendingUpload, uploads, useUploads } from '../lib/uploads'

const HINTS: Array<{ value: CaptureHint; label: string }> = [
  { value: 'auto', label: 'Work it out' },
  { value: 'list', label: 'Shopping list' },
  { value: 'receipt', label: 'Receipt' },
]

const ACCEPT = 'image/*,audio/*,text/plain,.txt,.m4a'

async function addFiles(files: Iterable<File>, hint: CaptureHint): Promise<number> {
  let count = 0
  for (const file of files) {
    if (!file.size) continue
    await uploads.add({ hint, file })
    count++
  }
  return count
}

function Tile({
  icon,
  title,
  detail,
  onClick,
  as = 'button',
  children,
  disabled,
  tone = 'default',
}: {
  icon: ReactNode
  title: string
  detail: string
  onClick?: () => void
  as?: 'button' | 'label'
  children?: ReactNode
  disabled?: boolean
  tone?: 'default' | 'recording'
}) {
  const className = cx(
    'relative flex min-h-28 flex-col items-start gap-2 rounded-2xl p-4 text-left shadow-sm ring-1 transition-colors focus-within:ring-2 focus-within:ring-emerald-600 focus-visible:outline-2 focus-visible:outline-emerald-600',
    tone === 'recording'
      ? 'bg-rose-600 text-white ring-rose-600'
      : 'bg-white ring-stone-200/70 hover:bg-stone-50 active:bg-stone-100 dark:bg-stone-900 dark:ring-stone-800 dark:hover:bg-stone-800/70',
    disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer',
  )
  const body = (
    <>
      <span
        className={cx(
          'grid size-10 place-items-center rounded-xl',
          tone === 'recording' ? 'bg-white/20' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className={cx('block text-xs', tone === 'recording' ? 'text-white/80' : 'text-stone-500 dark:text-stone-400')}>
          {detail}
        </span>
      </span>
      {children}
    </>
  )
  if (as === 'label') return <label className={className}>{body}</label>
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  )
}

const TONES: Record<StatusTone, string> = {
  busy: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  ready: 'bg-emerald-600 text-white',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  done: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
}

function Thumb({ capture }: { capture: Capture }) {
  const [broken, setBroken] = useState(false)
  const box = 'grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-stone-100 text-stone-500 dark:bg-stone-800'
  if (capture.media === 'image' && !broken) {
    return (
      <span className={box}>
        <img src={captureFileUrl(capture.id)} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
      </span>
    )
  }
  return (
    <span className={box}>
      {capture.media === 'audio' ? (
        <Mic className="size-6" aria-hidden />
      ) : capture.media === 'image' ? (
        <ImagePlus className="size-6" aria-hidden />
      ) : (
        <FileText className="size-6" aria-hidden />
      )}
    </span>
  )
}

function CaptureRow({ capture }: { capture: Capture }) {
  const status = captureStatus(capture)
  return (
    <a href={`#/capture/${capture.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800/50">
      <Thumb capture={capture} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{captureTitle(capture)}</span>
          <span className="shrink-0 text-xs text-stone-400">{relativeTime(capture.createdAt)}</span>
        </span>
        <span className="mt-0.5 block truncate text-sm text-stone-500 dark:text-stone-400">{captureDetail(capture)}</span>
        <span className={cx('mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TONES[status.tone])}>
          {status.tone === 'busy' && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
          {status.label}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-stone-300 dark:text-stone-600" aria-hidden />
    </a>
  )
}

function UploadRow({ upload }: { upload: PendingUpload }) {
  const online = typeof navigator === 'undefined' || navigator.onLine
  const what = upload.type?.startsWith('image/') ? 'Photo' : upload.type?.startsWith('audio/') ? 'Voice note' : 'Text'
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-500 dark:bg-stone-800">
        {upload.error ? <X className="size-6 text-rose-600" aria-hidden /> : online ? <Upload className="size-6" aria-hidden /> : <CloudOff className="size-6" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{upload.fileName ?? what}</span>
        <span className={cx('block text-sm', upload.error ? 'text-rose-700 dark:text-rose-400' : 'text-stone-500 dark:text-stone-400')}>
          {upload.error ?? (online ? 'Uploading…' : 'Saved on this device. It uploads when you are back online.')}
        </span>
      </span>
      {upload.error && (
        <Button size="sm" variant="ghost" onClick={() => void uploads.remove(upload.id)} aria-label={`Remove ${upload.fileName ?? what}`}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function CaptureScreen({ shared }: { shared: boolean }) {
  const config = useServerConfig()
  const { captures } = useSync()
  const pending = useUploads()
  const [hint, setHint] = useState<CaptureHint>('auto')
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const hintRef = useRef(hint)
  hintRef.current = hint
  const tookShare = useRef(false)

  const recorder = useRecorder((file) => {
    void uploads.add({ hint: hintRef.current, file })
    toast('Voice note saved. Reading it now.')
  })
  const dictation = useDictation((phrase) => setText((current) => (current.trim() ? `${current.trimEnd()}\n${phrase}` : phrase)))

  useEffect(() => {
    if (!shared || tookShare.current) return
    tookShare.current = true
    void (async () => {
      const entries = await takeSharedEntries()
      let count = 0
      for (const entry of entries) {
        count += await addFiles(entry.files, 'auto')
        if (entry.text.trim()) {
          await uploads.add({ hint: 'auto', text: entry.text })
          count++
        }
      }
      toast(count ? `Got ${plural(count, 'shared item')}. Reading now.` : 'Nothing came through. Try sharing again.')
      navigate('/capture', { replace: true })
    })()
  }, [shared])

  // Pasting an image anywhere on this screen captures it.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length) {
        event.preventDefault()
        void addFiles(files, hintRef.current).then((n) => n && toast(`Pasted ${plural(n, 'file')}. Reading now.`))
        return
      }
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable]')) return
      const pasted = event.clipboardData?.getData('text/plain')
      if (pasted?.trim()) {
        event.preventDefault()
        setText(pasted)
        setWriting(true)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  useEffect(() => {
    if (writing) textArea.current?.focus()
  }, [writing])

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    void addFiles(files, hint).then((n) => n && toast(n === 1 ? 'Got it. Reading now.' : `Got ${n} files. Reading now.`))
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const files = [...event.dataTransfer.files]
    if (files.length) {
      void addFiles(files, hint).then((n) => n && toast(`Got ${plural(n, 'file')}. Reading now.`))
      return
    }
    const dropped = event.dataTransfer.getData('text/plain')
    if (dropped.trim()) {
      setText(dropped)
      setWriting(true)
    }
  }

  const sendText = () => {
    if (!text.trim()) return
    if (dictation.listening) dictation.stop()
    void uploads.add({ hint, text })
    setText('')
    setWriting(false)
    toast('Got it. Reading now.')
  }

  const voiceNotes = config ? config.features.transcription : true
  const recording = recorder.state === 'recording'
  const recent = captures.slice(0, 40)
  const needsReview = recent.filter((c) => c.status === 'ready').length

  return (
    <div
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].some((t) => t === 'Files' || t === 'text/plain')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={onDrop}
      className="relative min-h-[calc(100dvh-5rem)]"
    >
      <ScreenHeader title="Capture" subtitle="Add from a photo, screenshot, receipt, voice note, or text" />

      <div className="space-y-4 px-4 pb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium text-stone-600 dark:text-stone-300">What is it?</span>
          <Segmented label="What you are capturing" value={hint} options={HINTS} onChange={setHint} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Tile as="label" icon={<Camera className="size-5" aria-hidden />} title="Take a photo" detail="A list, a note, a receipt">
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFiles} />
          </Tile>
          <Tile as="label" icon={<ImagePlus className="size-5" aria-hidden />} title="Choose files" detail="Screenshots, photos, audio">
            <input type="file" accept={ACCEPT} multiple className="sr-only" onChange={onFiles} />
          </Tile>
          {recorder.state !== 'unsupported' && (
            <Tile
              icon={recording ? <Square className="size-4 fill-current" aria-hidden /> : <Mic className="size-5" aria-hidden />}
              title={recording ? `Recording ${formatElapsed(recorder.elapsed)}` : 'Voice note'}
              detail={
                recording
                  ? 'Tap to finish'
                  : recorder.state === 'denied'
                    ? 'Microphone access is blocked'
                    : voiceNotes
                      ? 'Say what you need'
                      : 'Needs an AI provider'
              }
              tone={recording ? 'recording' : 'default'}
              disabled={!voiceNotes || recorder.state === 'starting'}
              onClick={recording ? recorder.stop : () => void recorder.start()}
            >
              {recording && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Discard recording"
                  onClick={(event) => {
                    event.stopPropagation()
                    recorder.cancel()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      recorder.cancel()
                    }
                  }}
                  className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-white/20 hover:bg-white/30"
                >
                  <X className="size-4" aria-hidden />
                </span>
              )}
            </Tile>
          )}
          <Tile
            icon={<Type className="size-5" aria-hidden />}
            title="Type or paste"
            detail="A message, an e-receipt"
            onClick={() => setWriting((v) => !v)}
          />
        </div>

        {writing && (
          <Card className="space-y-3 p-4">
            <TextArea
              ref={textArea}
              rows={6}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={'Paste a list, a text from someone, or an order email.\n\nmilk, eggs\nCostco: paper towels, olive oil'}
              aria-label="Text to read"
            />
            {dictation.interim && <p className="text-sm text-stone-500 italic">{dictation.interim}</p>}
            {dictation.error && <p className="text-sm text-rose-700 dark:text-rose-400">{dictation.error}</p>}
            <div className="flex items-center gap-2">
              {dictation.supported && (
                <Button variant={dictation.listening ? 'danger' : 'secondary'} onClick={dictation.listening ? dictation.stop : dictation.start}>
                  {dictation.listening ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
                  {dictation.listening ? 'Stop' : 'Dictate'}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setWriting(false)}>
                Cancel
              </Button>
              <Button className="ml-auto" disabled={!text.trim()} onClick={sendText}>
                Read it
              </Button>
            </div>
          </Card>
        )}

        <p className="text-xs text-stone-500 dark:text-stone-400">
          You can also paste a screenshot here, drop files on this page, or share them to Aisle from another app.
        </p>

        {pending.length > 0 && (
          <Card className="divide-y divide-stone-100 overflow-hidden dark:divide-stone-800">
            {pending.map((upload) => (
              <UploadRow key={upload.id} upload={upload} />
            ))}
          </Card>
        )}

        {recent.length > 0 ? (
          <section className="space-y-2">
            <h2 className="flex items-baseline gap-2 px-1 font-semibold">
              Recent
              {needsReview > 0 && <span className="text-sm font-normal text-emerald-700 dark:text-emerald-400">{needsReview} to review</span>}
            </h2>
            <Card className="divide-y divide-stone-100 overflow-hidden dark:divide-stone-800">
              {recent.map((capture) => (
                <CaptureRow key={capture.id} capture={capture} />
              ))}
            </Card>
          </section>
        ) : (
          !pending.length && (
            <EmptyState icon={<Camera className="size-7" />} title="Nothing captured yet">
              Snap the list on the fridge, screenshot a message, or photograph a receipt. Aisle reads it and files every item under
              its store.
            </EmptyState>
          )
        )}

        {config && (
          <p className="rounded-xl bg-stone-200/50 px-3 py-2.5 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-400">
            {config.features.ai
              ? `Captures are read by ${config.features.aiModel ?? 'an AI model'}: handwriting, receipts, and screenshots all work${config.features.transcription ? ', and so do voice notes' : ''}.`
              : config.features.ocr
                ? 'No AI provider is set up, so photos are read with OCR on the server. Screenshots and printed receipts read well; handwriting less so. Voice notes need an AI provider, but dictation works without one.'
                : 'No AI provider or OCR is set up, so only text can be read.'}
          </p>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-emerald-700/15 p-6 backdrop-blur-[1px]">
          <div className="rounded-3xl border-2 border-dashed border-emerald-600 bg-white/90 px-8 py-10 text-center font-semibold text-emerald-800 dark:bg-stone-900/90 dark:text-emerald-300">
            Drop to capture
          </div>
        </div>
      )}
    </div>
  )
}
