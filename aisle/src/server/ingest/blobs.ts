import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Original uploads on disk, one folder per household so leaving data behind is one delete. */
export class BlobStore {
  constructor(readonly root: string) {}

  key(householdId: string, captureId: string): string {
    return `${householdId}/${captureId}`
  }

  private path(key: string): string {
    const [householdId, captureId, ...rest] = key.split('/')
    if (rest.length || !householdId || !captureId || !ID.test(householdId) || !ID.test(captureId)) {
      throw new Error(`Invalid blob key: ${key}`)
    }
    return join(this.root, householdId, captureId)
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key))
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }

  async removeHousehold(householdId: string): Promise<void> {
    if (!ID.test(householdId)) throw new Error(`Invalid household id: ${householdId}`)
    await rm(join(this.root, householdId), { recursive: true, force: true })
  }
}
