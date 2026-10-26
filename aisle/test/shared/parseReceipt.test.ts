import { describe, expect, it } from 'vitest'
import { cleanReceiptName, detectDate, looksLikeReceipt, parseReceiptText } from '../../src/shared/parseReceipt'

const TRADER_JOES = `TRADER JOE'S #552
610 S ARROYO PKWY
PASADENA CA 91105
(626) 568-9254
BANANAS                    1.16
  4 @ 0.29
ORG WHOLE MILK GAL         5.49
KS PAPER TWL              19.99 A
  2 @ 1.99
AVOCADO HASS               3.98
GREEK YGRT VAN             1.29
  COUPON                  -0.30
SUBTOTAL                  31.61
TAX                        1.60
TOTAL                     33.21
VISA ************1234     33.21
10/24/2026 5:42 PM
THANK YOU FOR SHOPPING`

const SAFEWAY = `SAFEWAY
Store 1234 Dir John Smith
BANANAS
2.13 lb @ 0.69 /lb        1.47
LUCERNE MILK 2% GAL       4.99 S
E 1234567 KS PAPER TWL   19.99 A
1234567 /1234567          3.00-
BALANCE DUE              23.45
Oct 3, 2026`

describe('parseReceiptText', () => {
  it('reads a Trader Joe’s style receipt', () => {
    const r = parseReceiptText(TRADER_JOES)
    expect(r.store).toBe("Trader Joe's")
    expect(r.purchasedAt).toBe('2026-10-24T17:42')
    expect(r.total).toBe(33.21)
    expect(r.items.map((i) => [i.name, i.quantity, i.price])).toEqual([
      ['Bananas', 4, 1.16],
      ['Organic whole milk', null, 5.49],
      ['Paper towels', null, 19.99],
      ['Avocado hass', 2, 3.98],
      ['Greek yogurt vanilla', null, 0.99],
    ])
  })

  it('reads weighed items, item numbers, and trailing-minus discounts', () => {
    const r = parseReceiptText(SAFEWAY)
    expect(r.store).toBe('Safeway')
    expect(r.purchasedAt).toBe('2026-10-03')
    expect(r.total).toBe(23.45)
    expect(r.items.map((i) => [i.name, i.quantity, i.unit, i.price])).toEqual([
      ['Bananas', 2.13, 'lb', 1.47],
      ['Lucerne milk 2%', null, null, 4.99],
      ['Paper towels', null, null, 16.99],
    ])
  })

  it('matches the household’s own store names', () => {
    const r = parseReceiptText("JOE'S MARKET #12\nSOURDOUGH 6.50\nTOTAL 6.50", { knownStores: ["Joe's Market"] })
    expect(r.store).toBe("Joe's Market")
    expect(r.items).toHaveLength(1)
  })

  it('falls back to the first plausible header line for unknown stores', () => {
    const r = parseReceiptText('Welcome to Corner Grocery\n12 Elm St\nAPPLES 2.00\nTOTAL 2.00')
    expect(r.store).toBe('Corner Grocery')
  })
})

describe('receipt helpers', () => {
  it('expands abbreviations and drops brands and sizes', () => {
    expect(cleanReceiptName('KS ORG BNNA 3LB')).toBe('Organic bananas')
    expect(cleanReceiptName('GV WHL MLK 007874235186 F')).toBe('Whole milk')
    expect(cleanReceiptName('BIRTHDAY CARD')).toBe('Birthday card')
  })

  it('detects dates in common formats', () => {
    expect(detectDate('2026-10-24 08:15')).toBe('2026-10-24T08:15')
    expect(detectDate('24/10/2026')).toBe('2026-10-24')
    expect(detectDate('10/24/26')).toBe('2026-10-24')
    expect(detectDate('no date here')).toBeNull()
  })

  it('tells receipts from lists', () => {
    expect(looksLikeReceipt(TRADER_JOES)).toBe(true)
    expect(looksLikeReceipt('milk\neggs\n2 avocados')).toBe(false)
  })
})
