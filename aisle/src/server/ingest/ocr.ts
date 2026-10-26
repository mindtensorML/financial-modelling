import { mkdirSync } from 'node:fs'
import { createWorker, type Worker } from 'tesseract.js'

export interface OcrEngine {
  recognize(image: Buffer): Promise<string>
  close(): Promise<void>
}

/**
 * Tesseract in WebAssembly. One worker handles jobs one at a time; it starts on first use and
 * downloads the English model (about 5 MB) into the cache directory the first time.
 */
export class TesseractOcr implements OcrEngine {
  private worker: Promise<Worker> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly cacheDir: string) {}

  private start(): Promise<Worker> {
    if (!this.worker) {
      mkdirSync(this.cacheDir, { recursive: true })
      this.worker = createWorker('eng', 1, { cachePath: this.cacheDir }).catch((error: unknown) => {
        this.worker = null
        throw new Error(`OCR could not start: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    return this.worker
  }

  recognize(image: Buffer): Promise<string> {
    const job = this.queue.then(async () => {
      const worker = await this.start()
      const { data } = await worker.recognize(image)
      return data.text
    })
    this.queue = job.catch(() => undefined)
    return job
  }

  async close(): Promise<void> {
    const worker = this.worker
    this.worker = null
    if (worker) await (await worker.catch(() => null))?.terminate()
  }
}
