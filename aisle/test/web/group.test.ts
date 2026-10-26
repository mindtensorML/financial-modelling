import { describe, expect, it } from 'vitest'
import { buildSections, UNSORTED } from '../../src/web/lib/group'
import { item, store } from './fixtures'

const names = (section: ReturnType<typeof buildSections>[number]) => section.groups.flatMap((g) => g.items.map((i) => i.name))

describe('buildSections', () => {
  it('puts Unsorted first, then stores in their order, skipping stores with nothing on the list', () => {
    const costco = store('Costco', { sortOrder: 0 })
    const tj = store("Trader Joe's", { sortOrder: 1 })
    const target = store('Target', { sortOrder: 2 })
    const sections = buildSections(
      [
        item('Bananas', 'Produce', { storeId: tj.id }),
        item('Paper towels', 'Household', { storeId: costco.id }),
        item('Batteries', 'Household'),
        item('Lost', 'Other', { storeId: 'deleted-store' }),
      ],
      [costco, tj, target],
    )
    expect(sections.map((s) => s.key)).toEqual([UNSORTED, costco.id, tj.id])
    expect(names(sections[0]!)).toEqual(['Batteries', 'Lost'])
  })

  it('orders a store by typical layout until it has a learned walking order', () => {
    const tj = store("Trader Joe's")
    const items = [
      item('Oat milk', 'Dairy & Eggs', { storeId: tj.id }),
      item('Bananas', 'Produce', { storeId: tj.id }),
      item('Frozen peas', 'Frozen', { storeId: tj.id }),
      item('Apples', 'Produce', { storeId: tj.id }),
    ]
    const [typical] = buildSections(items, [tj])
    expect(typical!.groups.map((g) => g.category)).toEqual(['Produce', 'Dairy & Eggs', 'Frozen'])
    expect(names(typical!)).toEqual(['Apples', 'Bananas', 'Oat milk', 'Frozen peas'])

    const bananas = items[1]!
    const apples = items[3]!
    bananas.productId = 'p-bananas'
    apples.productId = 'p-apples'
    const [learned] = buildSections(items, [tj], {
      [tj.id]: { categories: { Frozen: 0.1, Produce: 0.5, 'Dairy & Eggs': 0.9 }, products: { 'p-bananas': 0.2, 'p-apples': 0.6 } },
    })
    expect(learned!.groups.map((g) => g.category)).toEqual(['Frozen', 'Produce', 'Dairy & Eggs'])
    expect(names(learned!)).toEqual(['Frozen peas', 'Bananas', 'Apples', 'Oat milk'])
  })

  it('keeps checked items apart, most recent first', () => {
    const costco = store('Costco')
    const [section] = buildSections(
      [
        item('Eggs', 'Dairy & Eggs', { storeId: costco.id, checkedAt: 100 }),
        item('Butter', 'Dairy & Eggs', { storeId: costco.id, checkedAt: 300 }),
        item('Rice', 'Pantry', { storeId: costco.id }),
      ],
      [costco],
    )
    expect(section!.openCount).toBe(1)
    expect(names(section!)).toEqual(['Rice'])
    expect(section!.checked.map((i) => i.name)).toEqual(['Butter', 'Eggs'])
  })
})
