import { describe, expect, it } from 'vitest'
import {
  describeInterval,
  formatMoney,
  formatQuantity,
  fromDateTimeInput,
  localCurrency,
  plural,
  relativeDay,
  relativeTime,
  toDateTimeInput,
} from '../../src/web/lib/format'

const at = (day: number, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

describe('formatQuantity', () => {
  it.each([
    [null, null, null],
    [1, null, null],
    [2, null, '2'],
    [1.5, 'lb', '1.5 lb'],
    [1, 'dozen', '1 dozen'],
    [0.3333, 'kg', '0.33 kg'],
    [null, 'bunch', 'bunch'],
  ])('%j %j', (quantity, unit, expected) => {
    expect(formatQuantity(quantity, unit)).toBe(expected)
  })
})

describe('relative times', () => {
  const now = at(26, 15)
  it.each([
    [at(26, 9), 'today'],
    [at(25, 23), 'yesterday'],
    [at(21), '5 days ago'],
    [at(5), '3 weeks ago'],
  ])('day %#', (when, expected) => {
    expect(relativeDay(when, now)).toBe(expected)
  })

  it('counts minutes and hours today, then days', () => {
    expect(relativeTime(now - 20_000, now)).toBe('just now')
    expect(relativeTime(now - 12 * 60_000, now)).toBe('12 min ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(relativeTime(at(25, 22), now)).toBe('yesterday')
  })
})

describe('describeInterval', () => {
  it.each([
    [1, 'daily'],
    [7, 'every 7 days'],
    [14, 'every 2 weeks'],
    [30, 'monthly'],
    [90, 'every 3 months'],
  ])('%d days', (days, expected) => {
    expect(describeInterval(days)).toBe(expected)
  })
})

describe('datetime-local values', () => {
  it('keeps the local time a receipt printed, assuming midday without one', () => {
    expect(toDateTimeInput('2026-10-24T17:42:10')).toBe('2026-10-24T17:42')
    expect(toDateTimeInput('2026-10-24 08:05')).toBe('2026-10-24T08:05')
    expect(toDateTimeInput('2026-10-24')).toBe('2026-10-24T12:00')
  })

  it('formats epoch times and the fallback in this time zone', () => {
    expect(toDateTimeInput(at(3, 9, 7))).toBe('2026-10-03T09:07')
    expect(toDateTimeInput(null, at(4, 18, 30))).toBe('2026-10-04T18:30')
    expect(toDateTimeInput('not a date', at(4, 18, 30))).toBe('2026-10-04T18:30')
  })

  it('reads a value back in this time zone', () => {
    expect(fromDateTimeInput('2026-10-24T17:42')).toBe(at(24, 17, 42))
    expect(fromDateTimeInput('')).toBeNull()
  })
})

describe('money', () => {
  it('picks a currency from the locale', () => {
    expect(localCurrency('en-US')).toBe('USD')
    expect(localCurrency('en-GB')).toBe('GBP')
    expect(localCurrency('de-DE')).toBe('EUR')
    expect(localCurrency('xx')).toBe('USD')
  })

  it('formats amounts, and survives an unknown currency code', () => {
    expect(formatMoney(3.5, 'USD')).toMatch(/3\.50/)
    expect(formatMoney(3.5, 'NOT-A-CODE')).toBe('3.50')
  })
})

it('pluralizes', () => {
  expect(plural(1, 'item')).toBe('1 item')
  expect(plural(3, 'item')).toBe('3 items')
  expect(plural(2, 'box', 'boxes')).toBe('2 boxes')
})
