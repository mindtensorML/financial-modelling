import { describe, expect, it } from 'vitest'
import { parseItemText, parseListText } from '../../src/shared/parseList'

const names = (text: string, options?: Parameters<typeof parseListText>[1]) =>
  parseListText(text, options).map((i) => i.name)

describe('parseItemText', () => {
  it.each([
    ['2 avocados', 'Avocados', 2, null],
    ['1.5 lb ground beef', 'Ground beef', 1.5, 'lb'],
    ['a dozen eggs', 'Eggs', 1, 'dozen'],
    ['milk x2', 'Milk', 2, null],
    ['milk x 2', 'Milk', 2, null],
    ['chicken breast 2 lbs', 'Chicken breast', 2, 'lb'],
    ['2lb carrots', 'Carrots', 2, 'lb'],
    ['12-pack la croix', 'La croix', 12, 'pack'],
    ['2 bags of chips', 'Chips', 2, 'bag'],
    ['2% milk', '2% milk', null, null],
    ['12 rolls', 'Rolls', 12, null],
    ['half and half', 'Half and half', null, null],
    ['half a gallon of milk', 'Milk', 0.5, 'gal'],
    ['a couple of lemons', 'Lemons', 2, null],
    ['three onions', 'Onions', 3, null],
    ['1 1/2 lbs salmon', 'Salmon', 1.5, 'lb'],
    ['½ gallon orange juice', 'Orange juice', 0.5, 'gal'],
    ['7up', '7up', null, null],
    ['diapers size 4', 'Diapers size 4', null, null],
  ])('%s', (text, name, quantity, unit) => {
    const item = parseItemText(text)
    expect(item).toMatchObject({ name, quantity, unit })
  })

  it('strips filler words and politeness', () => {
    expect(parseItemText('can you grab some oat milk please')?.name).toBe('Oat milk')
    expect(parseItemText("we're out of dish soap")?.name).toBe('Dish soap')
    expect(parseItemText('Don’t forget the coffee!')?.name).toBe('Coffee')
  })

  it('turns recipe measures and parentheses into notes', () => {
    expect(parseItemText('2 cups flour')).toMatchObject({ name: 'Flour', quantity: null, note: '2 cups' })
    expect(parseItemText('milk (oat, unsweetened)')).toMatchObject({ name: 'Milk', note: 'oat, unsweetened' })
    expect(parseItemText('eggs (12)')).toMatchObject({ name: 'Eggs', quantity: 12, note: null })
    expect(parseItemText('bread - the seeded one')).toMatchObject({ name: 'Bread', note: 'the seeded one' })
  })

  it('rejects things that are not items', () => {
    expect(parseItemText('---')).toBeNull()
    expect(parseItemText('42')).toBeNull()
  })
})

describe('parseListText', () => {
  it('reads a notes-app list with bullets and checkboxes', () => {
    const text = 'Shopping list\n- milk\n• 2 avocados\n☐ paper towels\n[x] bread\n1. eggs\n'
    expect(names(text)).toEqual(['Milk', 'Avocados', 'Paper towels', 'Bread', 'Eggs'])
  })

  it('splits on commas and "and" but keeps compound names together', () => {
    expect(names('milk, eggs and bread')).toEqual(['Milk', 'Eggs', 'Bread'])
    expect(names('mac and cheese, salt and vinegar chips; half & half')).toEqual([
      'Mac and cheese',
      'Salt and vinegar chips',
      'Half and half',
    ])
  })

  it('reads a text message from a partner', () => {
    expect(names('Hey can you pick up milk and eggs on the way home?')).toEqual(['Milk', 'Eggs'])
    expect(names('Today 9:41 AM\nCan you get bananas, coffee and dish soap\nDelivered')).toEqual([
      'Bananas',
      'Coffee',
      'Dish soap',
    ])
  })

  it('files items under store headings', () => {
    const items = parseListText("Costco:\n- paper towels\n- olive oil\nTrader Joe's\n- bananas\nTarget: shampoo, toothpaste")
    expect(items.map((i) => [i.name, i.storeHint])).toEqual([
      ['Paper towels', 'Costco'],
      ['Olive oil', 'Costco'],
      ['Bananas', "Trader Joe's"],
      ['Shampoo', 'Target'],
      ['Toothpaste', 'Target'],
    ])
  })

  it('files a "Store: items" line on its own, without starting a section', () => {
    const items = parseListText("Costco: paper towels, olive oil\nTrader Joe's: bananas\nbirthday candles\nTarget:\nshampoo")
    expect(items.map((i) => [i.name, i.storeHint])).toEqual([
      ['Paper towels', 'Costco'],
      ['Olive oil', 'Costco'],
      ['Bananas', "Trader Joe's"],
      ['Birthday candles', null],
      ['Shampoo', 'Target'],
    ])
  })

  it('keeps the section store for an inline category line', () => {
    const items = parseListText('Costco:\nProduce: apples, kale\npaper towels')
    expect(items.map((i) => [i.name, i.storeHint, i.categoryHint])).toEqual([
      ['Apples', 'Costco', 'Produce'],
      ['Kale', 'Costco', 'Produce'],
      ['Paper towels', 'Costco', null],
    ])
  })

  it('uses the household store names for headings', () => {
    const items = parseListText("joe's market\nsourdough\nCostco hot dogs", { knownStores: ["Joe's Market"] })
    expect(items.map((i) => [i.name, i.storeHint])).toEqual([
      ['Sourdough', "Joe's Market"],
      ['Costco hot dogs', "Joe's Market"],
    ])
  })

  it('treats category headings as category hints', () => {
    const items = parseListText('Produce:\napples\nkale')
    expect(items.map((i) => i.categoryHint)).toEqual(['Produce', 'Produce'])
  })

  it('skips titles, dates, times, and chatter', () => {
    expect(names('Groceries\nWednesday\n10/24\n10:42 AM\nok\nthanks!\nyogurt')).toEqual(['Yogurt'])
  })

  it('splits unpunctuated dictation only when asked', () => {
    const dictated = 'milk eggs bread two avocados paper towels'
    const items = parseListText(dictated, { splitRuns: true })
    expect(items.map((i) => i.name)).toEqual(['Milk', 'Eggs', 'Bread', 'Avocados', 'Paper towels'])
    expect(items[3]?.quantity).toBe(2)
    expect(names('chocolate chip cookie dough ice cream')).toEqual(['Chocolate chip cookie dough ice cream'])
  })

  it('removes duplicates', () => {
    expect(names('milk\nMilk\nmilks')).toEqual(['Milk'])
  })
})
