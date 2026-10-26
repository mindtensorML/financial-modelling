import { describe, expect, it } from 'vitest'
import { buildApplyBody, initialForm, linesTotal, parseAmount, parsePrice, type ReviewForm } from '../../src/web/lib/review'
import { capture, extracted, extraction } from './fixtures'

const COSTCO = '00000000-0000-4000-8000-00000000c057'
const TJ = '00000000-0000-4000-8000-00000000071a'

function listForm(): ReviewForm {
  return initialForm(
    capture(),
    extraction([
      extracted('Paper towels', { category: 'Household', predictedStoreId: COSTCO, predictionReason: 'Usually from Costco' }),
      extracted('Olive oil', { category: 'Pantry', storeHint: 'Costco', predictedStoreId: COSTCO, predictionReason: 'You wrote "Costco"' }),
      extracted('Batteries', { category: 'Household', storeHint: 'Home Depot' }),
      extracted('Birthday candles', { category: 'Other', quantity: 2 }),
    ]),
  )
}

describe('initialForm', () => {
  it('opens as a receipt when the engine read one, or when it was captured as one', () => {
    expect(initialForm(capture(), extraction([], { kind: 'receipt' })).mode).toBe('receipt')
    expect(initialForm(capture({ hint: 'receipt' }), extraction([], { kind: 'other' })).mode).toBe('receipt')
    expect(initialForm(capture({ hint: 'receipt' }), extraction([], { kind: 'list' })).mode).toBe('list')
    expect(initialForm(capture(), extraction([], { kind: 'other' })).mode).toBe('list')
  })

  it('starts each line at the store the server would file it under', () => {
    expect(listForm().lines.map((l) => l.store)).toEqual([COSTCO, COSTCO, 'new:Home Depot', ''])
    expect(listForm().lines[3]!.quantity).toBe('2')
  })

  it('takes the receipt store and date, falling back to when it was captured', () => {
    const known = initialForm(capture(), extraction([], { kind: 'receipt', store: 'Costco', storeId: COSTCO, purchasedAt: '2026-10-20T17:42:00' }))
    expect(known.receiptStore).toBe(COSTCO)
    expect(known.purchasedAt).toBe('2026-10-20T17:42')
    const fresh = initialForm(capture(), extraction([], { kind: 'receipt', store: 'Corner Market' }))
    expect(fresh.receiptStore).toBe('new:Corner Market')
    expect(fresh.purchasedAt).toBe('2026-10-24T18:30')
  })
})

describe('buildApplyBody for a list', () => {
  it('sends untouched lines back with their hints, so no store choice is recorded for them', () => {
    const body = buildApplyBody(listForm())
    expect(body.mode).toBe('list')
    expect(body.items.map((i) => [i.name, i.storeId, i.storeHint])).toEqual([
      ['Paper towels', undefined, null],
      ['Olive oil', undefined, 'Costco'],
      ['Batteries', undefined, 'Home Depot'],
      ['Birthday candles', undefined, null],
    ])
    expect(body.items[3]).toMatchObject({ quantity: 2, category: 'Other' })
  })

  it('sends a store the user picked as an explicit choice', () => {
    const form = listForm()
    form.lines[0]!.store = TJ
    form.lines[3]!.store = 'new:Party City'
    const body = buildApplyBody(form)
    expect(body.items[0]).toMatchObject({ storeId: TJ })
    expect(body.items[3]).toMatchObject({ storeHint: 'Party City' })
    expect(body.items[3]!.storeId).toBeUndefined()
  })

  it('leaves out unticked and empty lines, and lets the server re-categorize renamed ones', () => {
    const form = listForm()
    form.lines[1]!.include = false
    form.lines[2]!.name = '  '
    form.lines[0]!.name = 'Kitchen towels'
    form.lines[3]!.quantity = '1,5'
    form.lines[3]!.unit = ' lb '
    const body = buildApplyBody(form)
    expect(body.items.map((i) => i.name)).toEqual(['Kitchen towels', 'Birthday candles'])
    expect(body.items[0]!.category).toBeNull()
    expect(body.items[1]).toMatchObject({ quantity: 1.5, unit: 'lb', category: 'Other' })
  })
})

describe('buildApplyBody for a receipt', () => {
  const form = (): ReviewForm =>
    initialForm(
      capture(),
      extraction(
        [
          extracted('Organic bananas', { rawText: 'ORG BNNA', price: 1.99, category: 'Produce', onList: true }),
          extracted('Paper towels', { rawText: 'KS PPR TWL', price: 19.99, category: 'Household' }),
        ],
        { kind: 'receipt', store: 'Costco', storeId: COSTCO, purchasedAt: '2026-10-20T17:42', total: 23.6 },
      ),
    )

  it('sends the store, the time in this time zone, and each line with its price and receipt text', () => {
    const body = buildApplyBody(form())
    expect(body).toMatchObject({ mode: 'receipt', storeId: COSTCO, storeName: null, purchasedAt: new Date(2026, 9, 20, 17, 42).getTime() })
    expect(body.items).toEqual([
      expect.objectContaining({ name: 'Organic bananas', rawText: 'ORG BNNA', price: 1.99, category: 'Produce' }),
      expect.objectContaining({ name: 'Paper towels', rawText: 'KS PPR TWL', price: 19.99 }),
    ])
    expect(body.items[0]!.storeId).toBeUndefined()
  })

  it('names a store to create when the receipt is from somewhere new', () => {
    const f = form()
    f.receiptStore = 'new:Corner Market'
    expect(buildApplyBody(f)).toMatchObject({ storeId: null, storeName: 'Corner Market' })
    f.receiptStore = ''
    expect(buildApplyBody(f)).toMatchObject({ storeId: null, storeName: null })
  })

  it('adds up the included lines that have prices', () => {
    const f = form()
    expect(linesTotal(f.lines)).toBe(21.98)
    f.lines[1]!.include = false
    expect(linesTotal(f.lines)).toBe(1.99)
    f.lines[0]!.price = ''
    expect(linesTotal(f.lines)).toBeNull()
  })
})

describe('number fields', () => {
  it.each([
    ['2', 2],
    ['1,5', 1.5],
    [' 0.25 ', 0.25],
    ['0', null],
    ['-1', null],
    ['abc', null],
    ['', null],
  ])('amount %j', (text, value) => {
    expect(parseAmount(text)).toBe(value)
  })

  it.each([
    ['3.49', 3.49],
    ['$3.49', 3.49],
    ['4,99 €', 4.99],
    ['$1,299.00', 1299],
    ['0', 0],
    ['', null],
    ['free', null],
  ])('price %j', (text, value) => {
    expect(parsePrice(text)).toBe(value)
  })
})
