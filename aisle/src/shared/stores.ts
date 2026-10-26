import { foldText, titleCase } from './normalize'

interface Chain {
  name: string
  pattern: RegExp
}

// Receipts and OCR mangle chain names ("WHOLEFDS MKT", "TRADER JOE'S #552"); these patterns
// map the common spellings to one canonical name.
export const KNOWN_CHAINS: Chain[] = [
  { name: "Trader Joe's", pattern: /\btrader\s*joe'?s?\b/i },
  { name: 'Whole Foods', pattern: /\bwhole\s*foods?\b|\bwholefds\b/i },
  { name: 'Costco', pattern: /\bcostco\b|\bcstco\b/i },
  { name: 'Walmart', pattern: /\bwal[\s-]?mart\b/i },
  { name: 'Target', pattern: /\btarget\b/i },
  { name: 'Kroger', pattern: /\bkroger\b/i },
  { name: 'Safeway', pattern: /\bsafeway\b/i },
  { name: 'Albertsons', pattern: /\balbertsons?\b/i },
  { name: 'Publix', pattern: /\bpublix\b/i },
  { name: 'Aldi', pattern: /\baldi\b/i },
  { name: 'Lidl', pattern: /\blidl\b/i },
  { name: 'H-E-B', pattern: /\bh[\s-]?e[\s-]?b\b/i },
  { name: 'Wegmans', pattern: /\bwegmans\b/i },
  { name: 'CVS', pattern: /\bcvs\b/i },
  { name: 'Walgreens', pattern: /\bwalgreens\b/i },
  { name: 'Rite Aid', pattern: /\brite\s*aid\b/i },
  { name: 'Sprouts', pattern: /\bsprouts\b/i },
  { name: 'Ralphs', pattern: /\bralphs\b/i },
  { name: 'Vons', pattern: /\bvons\b/i },
  { name: 'Food Lion', pattern: /\bfood\s*lion\b/i },
  { name: 'Giant', pattern: /\bgiant\s+(?:food|eagle)\b|^\s*giant\s*$/i },
  { name: 'Stop & Shop', pattern: /\bstop\s*(?:&|and|n)?\s*shop\b/i },
  { name: 'Meijer', pattern: /\bmeijer\b/i },
  { name: "Sam's Club", pattern: /\bsam'?s\s*club\b/i },
  { name: "BJ's", pattern: /\bbj'?s\s*(?:wholesale)?\b/i },
  { name: 'Fred Meyer', pattern: /\bfred\s*meyer\b/i },
  { name: 'Harris Teeter', pattern: /\bharris\s*teeter\b/i },
  { name: 'Hy-Vee', pattern: /\bhy[\s-]?vee\b/i },
  { name: 'ShopRite', pattern: /\bshop\s*rite\b/i },
  { name: 'Smart & Final', pattern: /\bsmart\s*(?:&|and)\s*final\b/i },
  { name: 'Dollar Tree', pattern: /\bdollar\s*tree\b/i },
  { name: 'Dollar General', pattern: /\bdollar\s*general\b/i },
  { name: 'Amazon Fresh', pattern: /\bamazon\s*fresh\b/i },
  { name: 'Tesco', pattern: /\btesco\b/i },
  { name: "Sainsbury's", pattern: /\bsainsbury'?s?\b/i },
  { name: 'Asda', pattern: /\basda\b/i },
  { name: 'Morrisons', pattern: /\bmorrisons\b/i },
  { name: 'Waitrose', pattern: /\bwaitrose\b/i },
  { name: 'Marks & Spencer', pattern: /\bmarks\s*(?:&|and)\s*spencer\b/i },
  { name: 'Loblaws', pattern: /\bloblaws?\b/i },
  { name: 'No Frills', pattern: /\bno\s*frills\b/i },
  { name: 'Woolworths', pattern: /\bwoolworths\b/i },
  { name: 'Coles', pattern: /\bcoles\b/i },
]

export function matchKnownChain(text: string): string | null {
  for (const chain of KNOWN_CHAINS) if (chain.pattern.test(text)) return chain.name
  return null
}

/** Compact comparison key: "Trader Joe's" and "TRADER JOES" both become "traderjoes". */
export function storeKey(name: string): string {
  return foldText(name)
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Turns a raw receipt header or user-typed store into a display name. */
export function canonicalStoreName(raw: string): string {
  const chain = matchKnownChain(raw)
  if (chain) return chain
  const cleaned = raw
    .replace(/^\s*(?:welcome\s+to|thank\s+you\s+for\s+shopping\s+at)\s+/i, '')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b(?:store|str|location|loc)\s*(?:no\.?|number)?\s*\d+\b/gi, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^\p{L}\p{N}'&.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return titleCase(cleaned || raw.trim())
}

export const STORE_COLORS = [
  '#059669',
  '#0284c7',
  '#d97706',
  '#e11d48',
  '#7c3aed',
  '#ea580c',
  '#0d9488',
  '#65a30d',
  '#c026d3',
  '#4f46e5',
  '#db2777',
  '#57534e',
]

export function nextStoreColor(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  return STORE_COLORS.find((c) => !taken.has(c)) ?? STORE_COLORS[used.length % STORE_COLORS.length]!
}

export const POPULAR_STORES = [
  'Costco',
  "Trader Joe's",
  'Whole Foods',
  'Target',
  'Walmart',
  'Kroger',
  'Safeway',
  'Aldi',
  'Publix',
  'CVS',
]
