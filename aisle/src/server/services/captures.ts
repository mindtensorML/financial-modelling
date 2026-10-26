import type { CaptureHint, CaptureMedia } from '../../shared/types'
import type { DB } from '../db'
import type { CaptureRow } from '../rows'
import type { WriteContext } from './context'

type Updatable = Pick<
  CaptureRow,
  'status' | 'hint' | 'extraction' | 'engine' | 'error' | 'transcript' | 'text_input' | 'result' | 'blob_key' | 'deleted_at'
>

export function getCapture(db: DB, householdId: string, id: string): CaptureRow | undefined {
  return db.prepare('SELECT * FROM captures WHERE household_id = ? AND id = ?').get(householdId, id) as
    | CaptureRow
    | undefined
}

export function insertCapture(
  ctx: WriteContext,
  input: {
    id: string
    media: CaptureMedia
    hint: CaptureHint
    mimeType: string | null
    blobKey: string | null
    byteSize: number | null
    fileName: string | null
    textInput: string | null
  },
): void {
  ctx.db
    .prepare(
      `INSERT INTO captures (id, household_id, user_id, media, hint, status, mime_type, blob_key, byte_size, file_name,
         text_input, created_at, updated_at, rev)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      ctx.householdId,
      ctx.userId,
      input.media,
      input.hint,
      input.mimeType,
      input.blobKey,
      input.byteSize,
      input.fileName,
      input.textInput,
      ctx.now,
      ctx.now,
      ctx.rev,
    )
}

export function updateCapture(ctx: WriteContext, id: string, fields: Partial<Updatable>): void {
  const entries = Object.entries(fields)
  const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
  ctx.db
    .prepare(`UPDATE captures SET ${assignments}, updated_at = ?, rev = ? WHERE household_id = ? AND id = ?`)
    .run(...entries.map(([, value]) => value ?? null), ctx.now, ctx.rev, ctx.householdId, id)
}
