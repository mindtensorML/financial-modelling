import { z } from 'zod'

const id = z.uuid()
const at = z.number().int().nonnegative()
const quantity = z.number().positive().max(10_000).nullable()
const unit = z.string().trim().max(20).nullable()
const note = z.string().trim().max(500).nullable()
const color = z.string().regex(/^#[0-9a-f]{6}$/i)

/**
 * Every change a client makes is one of these operations. Clients apply them locally,
 * keep them in an outbox until the server confirms, and may resend them safely:
 * the server ignores an opId it has already applied.
 */
export const opSchema = z.discriminatedUnion('type', [
  z.object({
    opId: id,
    type: z.literal('item.add'),
    id,
    name: z.string().trim().min(1).max(200),
    quantity: quantity.optional(),
    unit: unit.optional(),
    note: note.optional(),
    storeId: id.nullable().optional(),
    storeHint: z.string().trim().max(80).nullable().optional(),
    at,
  }),
  z.object({
    opId: id,
    type: z.literal('item.update'),
    id,
    name: z.string().trim().min(1).max(200).optional(),
    quantity: quantity.optional(),
    unit: unit.optional(),
    note: note.optional(),
  }),
  z.object({ opId: id, type: z.literal('item.setStore'), id, storeId: id.nullable() }),
  z.object({ opId: id, type: z.literal('item.check'), id, checked: z.boolean(), at }),
  z.object({ opId: id, type: z.literal('item.delete'), id }),
  z.object({ opId: id, type: z.literal('items.clearChecked'), storeId: id.nullable().optional() }),
  z.object({
    opId: id,
    type: z.literal('store.upsert'),
    id,
    name: z.string().trim().min(1).max(60).optional(),
    color: color.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  }),
  z.object({ opId: id, type: z.literal('store.delete'), id }),
])

export type Op = z.infer<typeof opSchema>
export type OpType = Op['type']

export const opsRequestSchema = z.object({ ops: z.array(opSchema).min(1).max(200) })
