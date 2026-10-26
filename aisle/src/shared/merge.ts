export const MAX_NOTE = 500

/**
 * Folds a second entry for the same product into an open item. The same thing written twice
 * (two devices, or a photo of a list already typed in) is one need, not two, so the larger
 * amount is kept rather than adding them.
 */
export function mergeQuantity(
  open: { quantity: number | null; unit: string | null },
  quantity: number | null | undefined,
  unit: string | null | undefined,
): { quantity: number | null; unit: string | null } {
  if (quantity == null) return { quantity: open.quantity, unit: open.unit }
  if (open.quantity == null) return { quantity, unit: unit ?? open.unit }
  if ((unit ?? null) === open.unit) return { quantity: Math.max(open.quantity, quantity), unit: open.unit }
  return { quantity: open.quantity, unit: open.unit }
}

export function mergeNote(existing: string | null, incoming: string | null | undefined): string | null {
  const note = incoming?.trim()
  if (!note || existing?.toLowerCase().includes(note.toLowerCase())) return existing
  return (existing ? `${existing}; ${note}` : note).slice(0, MAX_NOTE)
}
