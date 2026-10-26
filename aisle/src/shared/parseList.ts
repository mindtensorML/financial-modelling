import { CATEGORIES, type Category, groceryLexicon, MAX_PHRASE_WORDS } from './categories'
import { displayName, foldText, nameKey, phraseTokens, singularize, tokenize } from './normalize'
import { matchKnownChain, storeKey } from './stores'

export interface ParsedItem {
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
  storeHint: string | null
  categoryHint: Category | null
  raw: string
}

export interface ParseOptions {
  /** Names of the household's stores, so "Costco:" headings file the lines below them. */
  knownStores?: string[]
  /** Names of products already seen, to help split unpunctuated dictation. */
  knownProducts?: string[]
  /** Names of the household's members: "Sam: milk and eggs" is a message from Sam, not a store called Sam. */
  people?: string[]
  /**
   * Split long unpunctuated runs ("milk eggs bread two avocados") at known grocery words.
   * Only for speech: typed and OCR text has real separators, and splitting it would break
   * long product names apart.
   */
  splitRuns?: boolean
}

const UNIT_ALIASES: Record<string, string> = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  g: 'g', gr: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', l: 'l', ltr: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  qt: 'qt', quart: 'qt', quarts: 'qt',
  pt: 'pt', pint: 'pt', pints: 'pt',
  dozen: 'dozen', doz: 'dozen', dz: 'dozen',
  pack: 'pack', packs: 'pack', pk: 'pack', pkg: 'pack', package: 'pack', packages: 'pack', packet: 'pack', packets: 'pack',
  bag: 'bag', bags: 'bag',
  box: 'box', boxes: 'box',
  bottle: 'bottle', bottles: 'bottle',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  jar: 'jar', jars: 'jar',
  bunch: 'bunch', bunches: 'bunch',
  head: 'head', heads: 'head',
  loaf: 'loaf', loaves: 'loaf',
  carton: 'carton', cartons: 'carton',
  bar: 'bar', bars: 'bar',
  roll: 'roll', rolls: 'roll',
  tub: 'tub', tubs: 'tub',
  container: 'container', containers: 'container',
  case: 'case', cases: 'case',
  ct: 'ct', count: 'ct',
  stick: 'stick', sticks: 'stick',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  clove: 'clove', cloves: 'clove',
  pinch: 'pinch', dash: 'dash', sprig: 'sprig', sprigs: 'sprig',
  slice: 'slice', slices: 'slice',
}

// Recipe measures say how much to cook with, not how much to buy, so they become a note.
const RECIPE_UNITS = new Set(['cup', 'tbsp', 'tsp', 'clove', 'pinch', 'dash', 'sprig', 'slice'])

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, couple: 2, half: 0.5,
}

const FRACTION_CHARS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }

const LEADING_FILLERS = [
  "don't forget to get", 'dont forget to get', "don't forget", 'dont forget', 'remember to get',
  'remember to buy', 'can you get', 'can you grab', 'can you pick up', 'can you buy', 'could you get',
  'could you grab', 'could you pick up', 'please get', 'please grab', 'please buy', 'please pick up',
  'we need to get', 'we also need', 'we need', 'i need to get', 'i need', 'need to get', 'need to buy', 'need',
  "i'll get", "i'll grab", "i'll pick up", "i'll buy", 'i will get', "let's get", 'lets get',
  "we're out of", 'we are out of', 'were out of', 'out of', 'running low on', 'running out of', 'low on',
  'pick up', 'pickup', 'get me', 'get', 'buy', 'grab', 'add', 'also', 'and', 'plus', 'oh', 'um', 'uh',
  'then', 'maybe', 'some more', 'some', 'more', 'a few', 'a lot of', 'lots of', 'any', 'please', 'hey',
  'hi', 'and also', 'the',
].sort((a, b) => b.length - a.length)

const TRAILING_FILLER =
  /\s+(?:on (?:the|your) way (?:home|back)|when you(?:'re| are) out|if you (?:have|get) (?:a )?(?:chance|time)|before you come home|if they have (?:it|them|any)|for (?:dinner|lunch|breakfast|tonight|tomorrow|the party|the week)|tonight|today|tomorrow|this week|please|thanks?|thank you|too|as well|also)\s*[.!?]*$/i

const GENERIC_TITLES = new Set([
  'shopping list', 'grocery list', 'groceries', 'grocery', 'shopping', 'list', 'to buy', 'to get',
  'todo', 'to do', 'things to buy', 'things to get', 'need', 'needs', 'buy', 'items', 'notes',
  'hey', 'hi', 'hello', 'thanks', 'thank you', 'ok', 'okay', 'sure', 'yes', 'yep', 'no', 'lol',
  'love you', 'ty', 'thx', 'k', 'delivered', 'read', 'imessage', 'text message', 'today', 'yesterday',
])

/** Labels before a colon that say who or what a list is for, never which store: "Mom:", "Dinner:". */
const NOT_STORE_LABELS = new Set([
  'note', 'reminder', 'ps', 'p.s', 'p.s.', 'fyi', 'btw', 'important', 'urgent', 'update', 'edit', 'also',
  'me', 'mom', 'mum', 'dad', 'honey', 'babe', 'love', 'lunch', 'dinner', 'dessert', 'tonight', 'tomorrow',
  'weekend', 'this week', 'next week', 'party', 'recipe', 'ingredients', 'menu', 'meal plan',
])

/** The start of a message to someone rather than a list ("Mom: can you grab milk?"). */
const CHAT_OPENER =
  /^(?:hey|hi|hello|yo|can (?:you|u)|could (?:you|u)|would you|will you|please|pls|plz|don'?t forget|remember|we need|we're|we are|i need|i'm|need you|if you|when you|on your way|ok|okay|thanks|thank you|btw|fyi)\b/i

/** Leftovers of chat once the items are split out ("we're", "it's", "you too"); never an item alone. */
const CHAT_WORDS = new Set([
  'i', 'im', 'ill', 'ive', 'me', 'my', 'we', 'were', 'weve', 'well', 'us', 'our', 'you', 'youre', 'u', 'your',
  'they', 'theyre', 'it', 'its', 'that', 'thats', 'this', 'is', 'are', 'am', 'was', 'be', 'been', 'so', 'just',
  'still', 'too', 'also', 'really', 'need', 'needs', 'want', 'wants', 'have', 'has', 'had', 'got', 'gonna',
  'will', 'would', 'could', 'can', 'should', 'almost', 'already', 'totally', 'completely', 'again', 'now', 'soon',
  'here', 'there', 'ok', 'okay', 'yes', 'no', 'yeah', 'yep', 'nope', 'lol', 'haha', 'sure', 'thanks', 'thx', 'ty',
  'please', 'pls',
])

// A period after one of these is an abbreviation ("Dr. Bronner's", "2 lbs. chicken"), not the end of a sentence.
const ABBREVIATIONS = new Set([
  'dr', 'st', 'mr', 'mrs', 'ms', 'jr', 'sr', 'mt', 'ft', 'no', 'vs', 'approx', 'etc', 'inc', 'co', 'e.g', 'i.e',
  'a.m', 'p.m', 'oz', 'lb', 'lbs', 'pkg', 'pk', 'doz', 'ct', 'gal', 'qt', 'pt', 'tbsp', 'tsp', 'org', 'lg', 'sm', 'med',
])

const PROTECTED_AND = [
  'mac and cheese', 'mac & cheese', 'mac n cheese', 'macaroni and cheese', 'half and half', 'half & half',
  'sweet and sour', 'salt and vinegar', 'pork and beans', 'black and white', 'fish and chips',
  'ben and jerry', 'ben & jerry',
]

const DAY_OR_DATE =
  /^(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.?,?\s*)?(?:\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)?$/i
const TIME = /^(?:today|yesterday)?\s*\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?$/i
const BULLET = /^\s*(?:[-*•·▪◦‣⁃–—>+]+|\[[ xX✓✔]?\]|[☐☑✓✔✗✘□■◻◼○●]|\d{1,2}[.)](?=\s))\s*/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripLeadingFillers(text: string): string {
  let s = text
  for (let round = 0; round < 8; round++) {
    const lower = s.toLowerCase()
    const filler = LEADING_FILLERS.find((f) => lower === f || lower.startsWith(`${f} `))
    if (!filler) break
    s = s.slice(filler.length).trimStart()
  }
  return s
}

function stripTrailingFillers(text: string): string {
  let s = text
  for (let round = 0; round < 4; round++) {
    const next = s.replace(TRAILING_FILLER, '')
    if (next === s) break
    s = next
  }
  return s
}

function parseNumberToken(token: string): number | null {
  if (/^\d+(?:[.,]\d+)?$/.test(token)) return Number(token.replace(',', '.'))
  const fraction = /^(\d+)\/(\d+)$/.exec(token)
  if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2])
  return FRACTION_CHARS[token] ?? null
}

function unitOf(token: string | undefined): string | null {
  if (!token) return null
  return UNIT_ALIASES[token.toLowerCase().replace(/\.$/, '')] ?? null
}

interface Quantity {
  quantity: number | null
  unit: string | null
  words: string[]
}

function takeLeadingQuantity(words: string[]): Quantity {
  const none = { quantity: null, unit: null, words }
  const first = words[0]
  if (!first) return none
  const lower = first.toLowerCase()
  const second = words[1]?.toLowerCase()
  if (/^\d+(?:[.,]\d+)?%$/.test(first)) return none
  if (lower === 'half' && (second === 'and' || second === '&' || second === 'n')) return none
  let quantity: number | null = null
  let unit: string | null = null
  let i = 1

  const attached = /^(\d+(?:[.,]\d+)?)-?([a-z]+)\.?$/i.exec(first)
  const multiplier = /^(?:x|×)(\d+)$/i.exec(first) ?? /^(\d+)(?:x|×)$/i.exec(first)
  if (multiplier) {
    quantity = Number(multiplier[1])
  } else if (parseNumberToken(first) !== null) {
    quantity = parseNumberToken(first)
    const fraction = words[1] ? /^(\d+)\/(\d+)$/.exec(words[1]) : null
    if (fraction && Number.isInteger(quantity) && Number(fraction[2]) > 0) {
      quantity = quantity! + Number(fraction[1]) / Number(fraction[2])
      i = 2
    }
  } else if (attached && unitOf(attached[2])) {
    quantity = Number(attached[1]!.replace(',', '.'))
    unit = unitOf(attached[2])
  } else if ((lower === 'a' || lower === 'an') && second === 'couple') {
    quantity = 2
    i = words[2]?.toLowerCase() === 'of' ? 3 : 2
  } else if (lower === 'couple') {
    quantity = 2
    i = second === 'of' ? 2 : 1
  } else if (lower === 'half' && (second === 'a' || second === 'an')) {
    quantity = 0.5
    i = 2
  } else if (lower in NUMBER_WORDS) {
    quantity = NUMBER_WORDS[lower]!
  } else {
    return none
  }

  if (words[i] && /^(?:x|×)$/i.test(words[i]!)) i++
  if (!unit) {
    const next = unitOf(words[i])
    if (next) {
      unit = next
      i++
    }
  }
  if (words[i]?.toLowerCase() === 'of') i++
  // "12 rolls" names the thing itself; keep the unit word as the name.
  if (i >= words.length && unit) return { quantity, unit: null, words: [words[words.length - 1]!] }
  if (i >= words.length) return none
  return { quantity, unit, words: words.slice(i) }
}

function takeTrailingQuantity(words: string[]): Quantity {
  const n = words.length
  const none = { quantity: null, unit: null, words }
  if (n < 2) return none
  const last = words[n - 1]!
  const prev = words[n - 2]!
  const before = (words[n - 3] ?? '').toLowerCase()
  let m = /^(?:x|×)(\d+)$/i.exec(last) ?? /^(\d+)(?:x|×)$/i.exec(last)
  if (m) return { quantity: Number(m[1]), unit: null, words: words.slice(0, -1) }
  if (/^(?:x|×|-)$/i.test(prev) && /^\d+$/.test(last)) {
    return { quantity: Number(last), unit: null, words: words.slice(0, -2) }
  }
  m = /^(\d+(?:[.,]\d+)?)-?([a-z]+)\.?$/i.exec(last)
  if (m && unitOf(m[2])) {
    return { quantity: Number(m[1]!.replace(',', '.')), unit: unitOf(m[2]), words: words.slice(0, -1) }
  }
  const unit = unitOf(last)
  if (unit && n >= 3 && parseNumberToken(prev) !== null && !['size', 'no', 'number', '#'].includes(before)) {
    return { quantity: parseNumberToken(prev), unit, words: words.slice(0, -2) }
  }
  if (/^\d+$/.test(last) && !['size', 'no', 'number', '#'].includes(prev.toLowerCase())) {
    return { quantity: Number(last), unit: null, words: words.slice(0, -1) }
  }
  return none
}

function formatAmount(quantity: number, unit: string): string {
  const q = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100)
  return `${q} ${unit}${quantity > 1 && !unit.endsWith('s') ? 's' : ''}`
}

/** Parses one item phrase such as "2 lbs chicken thighs", "milk x2", or "a dozen eggs (large)". */
export function parseItemText(segment: string): Omit<ParsedItem, 'storeHint' | 'categoryHint'> | null {
  const raw = segment.trim()
  let text = raw.replace(BULLET, '').replace(/[’‘]/g, "'")
  const notes: string[] = []
  text = text.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim())
    return ' '
  })
  const dash = /\s+[-–—]\s+(.+)$/.exec(text)
  if (dash && !/^\d+$/.test(dash[1]!.trim())) {
    notes.push(dash[1]!.trim())
    text = text.slice(0, dash.index)
  }
  text = text.replace(/[.!?;:,]+$/g, '').trim()
  text = stripTrailingFillers(stripLeadingFillers(text))
  text = text.replace(/^[.!?;:,\s]+|[.!?;:,\s]+$/g, '')

  let words = text.split(/\s+/).filter(Boolean)
  let { quantity, unit, words: rest } = takeLeadingQuantity(words)
  if (quantity === null) ({ quantity, unit, words: rest } = takeTrailingQuantity(words))
  words = rest
  if (words[0]?.toLowerCase() === 'of') words = words.slice(1)

  let numericNote: number | null = null
  const remainingNotes = notes.filter((note) => {
    if (/^\d+$/.test(note) && numericNote === null) {
      numericNote = Number(note)
      return false
    }
    return true
  })
  if (quantity === null && numericNote !== null) quantity = numericNote

  if (unit && RECIPE_UNITS.has(unit) && quantity !== null) {
    remainingNotes.unshift(formatAmount(quantity, unit))
    quantity = null
    unit = null
  }

  const name = words.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%)]+$/gu, '')
  if (!/\p{L}/u.test(name) || name.length > 80 || words.length > 10) return null
  if (unitOf(name) && quantity === null) return null
  if (GENERIC_TITLES.has(foldText(name)) || tokenize(name).every((word) => CHAT_WORDS.has(word))) return null
  return {
    name: displayName(name),
    quantity: quantity !== null && quantity > 0 && quantity <= 1000 ? quantity : null,
    unit,
    note: remainingNotes.length ? remainingNotes.join('; ') : null,
    raw,
  }
}

/** "Get milk. Eggs too!" is two sentences; "Dr. Bronner's soap" is one. */
function splitSentences(line: string): string[] {
  const sentences: string[] = []
  let start = 0
  for (const m of line.matchAll(/([.!?]+)\s+/g)) {
    const before = line.slice(start, m.index)
    const word = (/(\S+)$/.exec(before)?.[1] ?? '').toLowerCase()
    if (m[1] === '.' && (/^\p{L}$/u.test(word) || ABBREVIATIONS.has(word))) continue
    sentences.push(before)
    start = m.index + m[0].length
  }
  sentences.push(line.slice(start))
  return sentences
}

function splitSegments(line: string): string[] {
  let s = line
  for (const phrase of PROTECTED_AND) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi'), (m) => m.replace(/\s+(?:and|&|n)\s+/i, ' \u0001 '))
  }
  return splitSentences(s)
    .flatMap((sentence) => sentence.split(/\s*;\s*|\s*,(?!\d)\s*|\s+(?:and|&|plus|also|then)\s+/i))
    .map((part) => part.replace(/\u0001/g, 'and').trim())
    .filter(Boolean)
}

function segmentByLexicon(segment: string, lexicon: Set<string>): string[] | null {
  const words = stripLeadingFillers(segment).split(/\s+/).filter(Boolean)
  if (words.length < 4) return null
  const norm = words.map((w) => singularize(tokenize(w).join('')))
  const out: string[] = []
  let pending: string[] = []
  let hits = 0
  let covered = 0
  for (let i = 0; i < words.length; ) {
    let matched = 0
    for (let n = Math.min(MAX_PHRASE_WORDS, words.length - i); n >= 1; n--) {
      if (lexicon.has(norm.slice(i, i + n).join(' '))) {
        matched = n
        break
      }
    }
    if (matched) {
      out.push([...pending, ...words.slice(i, i + matched)].join(' '))
      pending = []
      hits++
      covered += matched
      i += matched
    } else {
      pending.push(words[i]!)
      i++
    }
  }
  if (pending.length) out.push(pending.join(' '))
  if (hits < 2 || covered / words.length < 0.6) return null
  return out
}

type Heading =
  | { kind: 'store'; value: string; rest: string }
  | { kind: 'category'; value: Category; rest: string }
  | { kind: 'other'; value: string; rest: string }

/**
 * In strict mode the text must be just the store's name ("Costco" heads a section,
 * "Costco hot dogs" is an item). Otherwise any mention counts ("Costco run:").
 */
function matchStore(label: string, knownStores: string[], strict: boolean): string | null {
  const key = storeKey(label)
  if (!key) return null
  const known = knownStores.find((s) => storeKey(s) === key)
  if (known) return known
  const chain = matchKnownChain(label)
  if (!chain) return null
  if (strict && storeKey(chain) !== key) return null
  return knownStores.find((s) => matchKnownChain(s) === chain) ?? chain
}

function detectHeading(line: string, knownStores: string[], people: ReadonlySet<string>): Heading | null {
  const colon = /\d:\d/.test(line) ? null : /^([^:]{1,40}):\s*(.*)$/.exec(line)
  if (colon && colon[1]!.trim().split(/\s+/).length <= 4) {
    const label = colon[1]!.trim()
    const rest = colon[2]!.trim()
    const folded = foldText(label)
    const category = CATEGORIES.find((c) => foldText(c) === folded)
    if (category) return { kind: 'category', value: category, rest }
    if (GENERIC_TITLES.has(folded)) return { kind: 'other', value: '', rest }
    const store = matchStore(label, knownStores, false)
    if (store) return { kind: 'store', value: store, rest }
    // An unknown label is usually a store the household has not used yet ("Wegmans:"), unless it
    // names a sender ("Sam: can you grab milk?") or a purpose ("For tacos:").
    if (people.has(folded) || NOT_STORE_LABELS.has(folded) || folded.startsWith('for ') || CHAT_OPENER.test(rest)) {
      return { kind: 'other', value: '', rest }
    }
    return { kind: 'other', value: label, rest }
  }
  const store = matchStore(line, knownStores, true)
  if (store) return { kind: 'store', value: store, rest: '' }
  const category = CATEGORIES.find((c) => foldText(c) === foldText(line))
  if (category) return { kind: 'category', value: category, rest: '' }
  return null
}

function isNoiseLine(line: string): boolean {
  const folded = foldText(line).replace(/[.!?:]+$/, '').trim()
  if (!/\p{L}/u.test(folded)) return true
  if (/https?:\/\/|www\./.test(folded)) return true
  if (GENERIC_TITLES.has(folded)) return true
  if (DAY_OR_DATE.test(folded) || TIME.test(folded)) return true
  if (/^(?:read|delivered|sent)\b.*\d{1,2}:\d{2}/i.test(folded)) return true
  return false
}

function buildLexicon(knownProducts: string[] = []): Set<string> {
  const lexicon = groceryLexicon()
  for (const product of knownProducts) {
    const tokens = phraseTokens(product)
    if (tokens.length && tokens.length <= MAX_PHRASE_WORDS) lexicon.add(tokens.join(' '))
  }
  return lexicon
}

/**
 * Turns free text (a typed list, pasted notes, dictation, or OCR output) into items.
 * Handles bullets and checkboxes, commas and "and", quantities and units, filler words,
 * and headings: a line such as "Costco:" files the items below it under that store.
 */
export function parseListText(text: string, options: ParseOptions = {}): ParsedItem[] {
  const knownStores = options.knownStores ?? []
  const lexicon = buildLexicon(options.knownProducts)
  const people = new Set(
    (options.people ?? []).flatMap((person) => {
      const name = foldText(person.trim())
      return name ? [name, name.split(/\s+/)[0]!] : []
    }),
  )
  const items: ParsedItem[] = []
  const seen = new Set<string>()
  let storeHint: string | null = null
  let categoryHint: Category | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(BULLET, '').trim()
    if (!line) continue
    let lineStore: string | null = storeHint
    let lineCategory: Category | null = categoryHint
    const heading = isNoiseLine(line) ? null : detectHeading(line, knownStores, people)
    if (heading) {
      if (heading.kind === 'category') {
        lineCategory = heading.value
      } else if (heading.value) {
        lineStore = heading.value
        lineCategory = null
      }
      // A heading on a line of its own starts a section; "Costco: paper towels, olive oil" files only that line.
      if (!heading.rest) {
        storeHint = lineStore
        categoryHint = lineCategory
        continue
      }
      line = heading.rest
    } else if (isNoiseLine(line)) {
      continue
    }

    for (const segment of splitSegments(line)) {
      const parts = options.splitRuns ? (segmentByLexicon(segment, lexicon) ?? [segment]) : [segment]
      for (const part of parts) {
        const item = parseItemText(part)
        if (!item) continue
        const key = `${nameKey(item.name)}|${lineStore ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        items.push({ ...item, storeHint: lineStore, categoryHint: lineCategory })
        if (items.length >= 200) return items
      }
    }
  }
  return items
}
