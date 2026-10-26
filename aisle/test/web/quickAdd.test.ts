import { describe, expect, it } from 'vitest'
import { applySuggestion, currentSegment, parseQuickAdd, splitAmount, suggestProducts } from '../../src/web/lib/quickAdd'
import { product } from './fixtures'

describe('parseQuickAdd', () => {
  it('reads several items and files them all under a trailing @store', () => {
    expect(parseQuickAdd('2 avocados, oat milk @costco')).toEqual([
      { name: 'Avocados', quantity: 2, unit: null, note: null, storeHint: 'costco' },
      { name: 'Oat milk', quantity: null, unit: null, note: null, storeHint: 'costco' },
    ])
  })

  it('understands store headings', () => {
    const items = parseQuickAdd('Costco: paper towels, olive oil', ['Costco'])
    expect(items.map((i) => [i.name, i.storeHint])).toEqual([
      ['Paper towels', 'Costco'],
      ['Olive oil', 'Costco'],
    ])
  })

  it('splits unpunctuated dictation only when asked to', () => {
    expect(parseQuickAdd('milk eggs bread two avocados')).toHaveLength(1)
    const spoken = parseQuickAdd('milk eggs bread two avocados', [], [], { splitRuns: true })
    expect(spoken.map((i) => [i.name, i.quantity])).toEqual([
      ['Milk', null],
      ['Eggs', null],
      ['Bread', null],
      ['Avocados', 2],
    ])
  })

  it('keeps an email-like "@" inside an item name out of the store hint', () => {
    expect(parseQuickAdd('milk @ ')).toEqual([expect.objectContaining({ name: 'Milk', storeHint: null })])
  })
})

describe('currentSegment', () => {
  it.each([
    ['milk', 0, 'milk'],
    ['milk, egg', 6, 'egg'],
    ['milk,  2 avo @costco', 7, '2 avo'],
    ['milk\nbre', 5, 'bre'],
    ['milk, ', 6, ''],
  ])('%j', (text, start, query) => {
    expect(currentSegment(text)).toEqual({ start, query })
  })
})

describe('splitAmount', () => {
  it.each([
    ['2 avo', '2 ', 'avo'],
    ['2 lb ban', '2 lb ', 'ban'],
    ['1.5 kg apples', '1.5 kg ', 'apples'],
    ['1/2 lb ham', '1/2 lb ', 'ham'],
    ['two bananas', 'two ', 'bananas'],
    ['an apple', 'an ', 'apple'],
    ['6x yogurt', '6x ', 'yogurt'],
    ['avocado', '', 'avocado'],
    ['2', '', '2'],
    ['2% milk', '', '2% milk'],
  ])('%j', (segment, amount, rest) => {
    expect(splitAmount(segment)).toEqual({ amount, rest })
  })
})

describe('suggestProducts', () => {
  const milk = product('Milk', 'Dairy & Eggs', { purchaseCount: 9 })
  const oatMilk = product('Oat milk', 'Dairy & Eggs', { purchaseCount: 4 })
  const milkChocolate = product('Milk chocolate', 'Snacks', { purchaseCount: 1 })
  const buttermilk = product('Buttermilk', 'Dairy & Eggs', { purchaseCount: 20 })
  const mints = product('Mints', 'Snacks', { purchaseCount: 50 })
  const gone = product('Milkweed', 'Other', { deletedAt: 5 })
  const all = [milk, oatMilk, milkChocolate, buttermilk, mints, gone]

  it('ranks names starting with the text, then words starting with it, then anywhere', () => {
    const names = suggestProducts('mil', all, new Set()).map((s) => s.product.name)
    expect(names).toEqual(['Milk', 'Milk chocolate', 'Oat milk', 'Buttermilk'])
  })

  it('looks past an amount, sinks items already on the list, and skips an exact match', () => {
    const result = suggestProducts('2 milk', all, new Set([oatMilk.id]))
    expect(result.map((s) => [s.product.name, s.onList])).toEqual([
      ['Milk chocolate', false],
      ['Buttermilk', false],
      ['Oat milk', true],
    ])
  })

  it('suggests nothing for an empty segment', () => {
    expect(suggestProducts('  ', all, new Set())).toEqual([])
    expect(suggestProducts('2 ', all, new Set())).toEqual([])
  })
})

describe('applySuggestion', () => {
  it.each([
    ['avo', 'Avocados', 'Avocados'],
    ['milk, 2 avo', 'Avocados', 'milk, 2 Avocados'],
    ['2 lb ban @costco', 'Bananas', '2 lb Bananas @costco'],
    ['eggs\nbre', 'Bread', 'eggs\nBread'],
  ])('%j', (text, name, expected) => {
    expect(applySuggestion(text, name)).toBe(expected)
  })
})
