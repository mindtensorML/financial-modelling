const COMBINING_MARKS = /[\u0300-\u036f]/g

export function foldText(s: string): string {
  return s.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase()
}

export function tokenize(s: string): string[] {
  return foldText(s)
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9%.]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
}

const IRREGULAR_PLURALS: Record<string, string> = {
  loaves: 'loaf',
  leaves: 'leaf',
  knives: 'knife',
  halves: 'half',
  shelves: 'shelf',
  geese: 'goose',
  mice: 'mouse',
  teeth: 'tooth',
  feet: 'foot',
  children: 'child',
  people: 'person',
  cookies: 'cookie',
  brownies: 'brownie',
  pies: 'pie',
  veggies: 'veggie',
  smoothies: 'smoothie',
  ties: 'tie',
  shoes: 'shoe',
  toes: 'toe',
  cheeses: 'cheese',
}

const NEVER_SINGULAR = new Set([
  'hummus',
  'asparagus',
  'couscous',
  'swiss',
  'molasses',
  'citrus',
  'grits',
  'series',
  'species',
  'news',
  'tongs',
  'scissors',
  'pants',
  'jeans',
  'shorts',
  'its',
  'this',
  'plus',
  'less',
  'yes',
])

export function singularize(word: string): string {
  const w = word.toLowerCase()
  const irregular = IRREGULAR_PLURALS[w]
  if (irregular) return irregular
  if (w.length <= 3 || NEVER_SINGULAR.has(w) || !/[a-z]s$/.test(w)) return w
  if (w.endsWith('ss') || w.endsWith('us')) return w
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`
  if (w.endsWith('oes')) return w.slice(0, -2)
  if (w.endsWith('sses') || w.endsWith('xes') || w.endsWith('ches') || w.endsWith('shes')) return w.slice(0, -2)
  return w.slice(0, -1)
}

const KEY_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'n'])

/**
 * Order-insensitive identity for an item name: "Milk 2%" and "2% milk" share a key,
 * as do "Bananas" and "banana". Receipts often print the head noun first ("CHEESE CHEDDAR"),
 * which is why word order is ignored.
 */
export function nameKey(name: string): string {
  const tokens = tokenize(name)
    .map(singularize)
    .filter((t) => !KEY_STOPWORDS.has(t))
  if (!tokens.length) return foldText(name).trim()
  return [...new Set(tokens)].sort().join(' ')
}

const DESCRIPTORS = new Set([
  'organic', 'fresh', 'large', 'lg', 'small', 'sm', 'medium', 'med', 'jumbo', 'xl', 'family', 'size',
  'value', 'natural', 'original', 'classic', 'regular', 'pack', 'pk', 'ct', 'count', 'lb', 'oz', 'gal',
  'gallon', 'dozen', 'dz', 'bag', 'box', 'bottle', 'can', 'jar', 'bunch', 'container', 'carton', 'each', 'ea',
])

/**
 * Like nameKey, but also ignores sizes, counts, and descriptors such as "organic" or "large",
 * so a receipt's "Organic whole milk 1 gal" can still be linked to "Whole milk".
 */
export function coreKey(name: string): string {
  const tokens = tokenize(name)
    .map(singularize)
    .filter(
      (t) =>
        !KEY_STOPWORDS.has(t) &&
        !DESCRIPTORS.has(t) &&
        !/^\d+(?:\.\d+)?$/.test(t) &&
        !/^\d+(?:\.\d+)?(?:oz|lb|ct|pk|gal|ml|l|g|kg|qt|pt)$/.test(t),
    )
  return [...new Set(tokens)].sort().join(' ')
}

/** Tokens in their original order, singularized; used for phrase lookups. */
export function phraseTokens(name: string): string[] {
  return tokenize(name).map(singularize)
}

export function displayName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  const letters = s.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 4 && letters === letters.toUpperCase()) s = s.toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s\-/&])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}
