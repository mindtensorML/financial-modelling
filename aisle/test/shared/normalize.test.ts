import { describe, expect, it } from 'vitest'
import { classify } from '../../src/shared/categories'
import { coreKey, displayName, nameKey, singularize } from '../../src/shared/normalize'
import { findClosest, isCloseMatch } from '../../src/shared/similarity'
import { canonicalStoreName, matchKnownChain, storeKey } from '../../src/shared/stores'

describe('singularize', () => {
  it.each([
    ['bananas', 'banana'],
    ['berries', 'berry'],
    ['tomatoes', 'tomato'],
    ['cookies', 'cookie'],
    ['peaches', 'peach'],
    ['boxes', 'box'],
    ['glasses', 'glass'],
    ['hummus', 'hummus'],
    ['asparagus', 'asparagus'],
    ['kiwis', 'kiwi'],
    ['loaves', 'loaf'],
    ['eggs', 'egg'],
    ['cheeses', 'cheese'],
    ['cases', 'case'],
    ['chips', 'chip'],
    ['milk', 'milk'],
  ])('%s -> %s', (plural, singular) => {
    expect(singularize(plural)).toBe(singular)
  })
})

describe('nameKey and coreKey', () => {
  it('ignores word order, plurals, case, and connectives', () => {
    expect(nameKey('Milk 2%')).toBe(nameKey('2% milk'))
    expect(nameKey('Bananas')).toBe(nameKey('banana'))
    expect(nameKey('Mac & Cheese')).toBe(nameKey('mac and cheese'))
    expect(nameKey('The Eggs')).toBe(nameKey('eggs'))
    expect(nameKey('almond milk')).not.toBe(nameKey('milk'))
  })

  it('coreKey also drops sizes and descriptors', () => {
    expect(coreKey('Organic whole milk 1 gal')).toBe(coreKey('Whole milk'))
    expect(coreKey('Eggs large')).toBe(coreKey('eggs'))
    expect(coreKey('2% milk')).not.toBe(coreKey('milk'))
  })
})

describe('displayName', () => {
  it('turns shouting into sentence case and capitalizes', () => {
    expect(displayName('ORGANIC BANANAS')).toBe('Organic bananas')
    expect(displayName('oat  milk')).toBe('Oat milk')
    expect(displayName("TJ'S")).toBe("TJ'S")
  })
})

describe('similarity', () => {
  it('accepts typos but not look-alike words', () => {
    expect(isCloseMatch('banana', 'bananna')).toBe(true)
    expect(isCloseMatch('greek yogurt', 'greek yoghurt')).toBe(true)
    expect(isCloseMatch('mustard', 'custard')).toBe(false)
    expect(isCloseMatch('milk', 'silk')).toBe(false)
    expect(isCloseMatch('beer', 'beet')).toBe(false)
  })

  it('returns the closest candidate above the threshold', () => {
    const candidates = [
      { key: 'tomato', value: 'Tomatoes' },
      { key: 'potato', value: 'Potatoes' },
    ]
    expect(findClosest('tomatoe', candidates)?.value).toBe('Tomatoes')
    expect(findClosest('carrot', candidates)).toBeNull()
  })
})

describe('classify', () => {
  it.each([
    ['Bananas', 'Produce'],
    ['Oat milk', 'Dairy & Eggs'],
    ['Milk 2%', 'Dairy & Eggs'],
    ['peanut butter', 'Pantry'],
    ['hot dog buns', 'Bakery'],
    ['hot dogs', 'Meat & Seafood'],
    ['frozen peas', 'Frozen'],
    ['chicken soup', 'Pantry'],
    ['dog food', 'Pet'],
    ['paper towels', 'Household'],
    ['Baby wipes', 'Baby'],
    ['mac & cheese', 'Pantry'],
    ['vanilla ice cream', 'Frozen'],
    ['chocolate chip cookies', 'Snacks'],
    ['sparkling water', 'Beverages'],
    ['toothpaste', 'Personal Care'],
    ['ibuprofen', 'Health'],
    ['flux capacitor', 'Other'],
    // Receipt order: product first, flavor last.
    ['Greek yogurt vanilla', 'Dairy & Eggs'],
    ['Sparkling water lemon', 'Beverages'],
    ['Tomatoes cherry', 'Produce'],
    ['milk chocolate', 'Snacks'],
    ['hot chocolate', 'Beverages'],
    ['vanilla', 'Pantry'],
    ['lemons', 'Produce'],
  ])('%s is %s', (name, category) => {
    expect(classify(name)).toBe(category)
  })
})

describe('stores', () => {
  it('recognizes chains through receipt noise', () => {
    expect(matchKnownChain("TRADER JOE'S #552")).toBe("Trader Joe's")
    expect(matchKnownChain('WHOLEFDS MKT 10234')).toBe('Whole Foods')
    expect(matchKnownChain('Giant marshmallows')).toBeNull()
  })

  it('canonicalizes unknown store names', () => {
    expect(canonicalStoreName("JOE'S MARKET #12")).toBe("Joe's Market")
    expect(canonicalStoreName('Welcome to Corner Grocery Store 0042')).toBe('Corner Grocery')
    expect(storeKey("Trader Joe's")).toBe(storeKey('TRADER JOES'))
  })
})
