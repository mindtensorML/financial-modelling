import { displayName } from './normalize'
import { canonicalStoreName, matchKnownChain, storeKey } from './stores'

export interface ReceiptLine {
  rawText: string
  name: string
  quantity: number | null
  unit: string | null
  price: number | null
}

export interface ReceiptParse {
  store: string | null
  storeRaw: string | null
  purchasedAt: string | null
  total: number | null
  items: ReceiptLine[]
}

const PRICE_AT_END = /(-)?\$?\s?(\d{1,4}[.,]\d{2})(-)?\s*(?:[A-Z]{1,2}|\*)?\s*$/
const WEIGHT_LINE = /^(\d+(?:\.\d+)?)\s*(lb|lbs|kg|oz)\b[^@]*@\s*\$?\s*(\d+[.,]\d{2})/i
const QTY_LINE = /^(\d+)\s*(?:@|x|×)\s*\$?\s*(\d+[.,]\d{2})/i
const DISCOUNT = /\b(?:coupon|savings|discount|promo|markdown|price\s*cut)\b/i
const TOTAL = /\b(?:total|balance\s*due|amount\s*due)\b/i
const NOT_TOTAL = /sub\s*-?\s*total|total\s*(?:savings|discount|items?|tax|number)/i
const SKIP =
  /\b(?:sub\s*-?\s*total|total|tax|vat|balance|change|cash|tender|payment|paid|visa|master\s*card|amex|american\s*express|discover|debit|credit|ebt|card\s*(?:#|no\.?|number|type|ending)|approv\w*|auth\w*|ref\s*#|trans\w*|terminal|chip\s*read|contactless|entry\s*method|signature|member(?:ship)?|you\s*saved|loyalty|points|rewards|items?\s*sold|item\s*count|thank|receipt|phone|tel|www|http|cashier|register|lane|survey|return|customer|merchant|account|acct|seq|batch|invoice|order\s*#|net\s*sales|bag\s*fee|deposit|crv)\b|\b(?:store|st|tr|op|te)\s*#|[x*]{4,}\d{4}|\baid\s*:/i
const ADDRESS = /^\d+\s+\w+|\b(?:st|ave|rd|blvd|dr|hwy|suite|ste|street|avenue|road)\b\.?|\b[A-Z]{2}\s+\d{5}\b|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/i

const ABBREVIATIONS: Record<string, string> = {
  ORG: 'organic', ORGN: 'organic', ORGNC: 'organic', BNLS: 'boneless', SKNLS: 'skinless', SKLS: 'skinless',
  CHKN: 'chicken', CHCKN: 'chicken', CHIC: 'chicken', CKN: 'chicken', BRST: 'breast', THGH: 'thigh',
  THGHS: 'thighs', GRND: 'ground', GRD: 'ground', BF: 'beef', WHL: 'whole', MLK: 'milk', YGRT: 'yogurt',
  YOGRT: 'yogurt', YOG: 'yogurt', YGT: 'yogurt', GRK: 'greek', CHS: 'cheese', CHSE: 'cheese',
  SHRD: 'shredded', CHDR: 'cheddar', CHED: 'cheddar', MOZZ: 'mozzarella', PARM: 'parmesan', BRD: 'bread',
  SRDGH: 'sourdough', SDGH: 'sourdough', HLF: 'half', FF: 'fat free', LF: 'low fat', RF: 'reduced fat',
  NF: 'nonfat', UNSWT: 'unsweetened', UNSWTND: 'unsweetened', SWT: 'sweet', VAN: 'vanilla', VNL: 'vanilla',
  CHOC: 'chocolate', STRWB: 'strawberries', STRAWB: 'strawberries', STRWBRY: 'strawberries',
  BLUEB: 'blueberries', BLBRY: 'blueberries', RASP: 'raspberries', AVOC: 'avocado', AVO: 'avocado',
  TOM: 'tomato', TOMS: 'tomatoes', TMTO: 'tomato', POT: 'potato', POTS: 'potatoes', ONN: 'onion',
  GRN: 'green', RD: 'red', YLW: 'yellow', YEL: 'yellow', PEPR: 'pepper', PEPP: 'pepper', LETT: 'lettuce',
  ROM: 'romaine', ROMN: 'romaine', SPIN: 'spinach', SPNCH: 'spinach', BROC: 'broccoli', CARR: 'carrots',
  CRRT: 'carrots', CUC: 'cucumber', CUKE: 'cucumber', MUSH: 'mushrooms', MSHRM: 'mushrooms', GRLC: 'garlic',
  APPL: 'apples', APL: 'apples', ORNG: 'orange', LMN: 'lemon', JCE: 'juice', JC: 'juice', JUC: 'juice',
  SPRKLNG: 'sparkling', SPKL: 'sparkling', WTR: 'water', PPR: 'paper', TWL: 'towels', TWLS: 'towels',
  TP: 'toilet paper', TISS: 'tissue', DET: 'detergent', DTRG: 'detergent', LNDRY: 'laundry', DSH: 'dish',
  PB: 'peanut butter', OLV: 'olive', EVOO: 'extra virgin olive oil', VEG: 'vegetable', FRZ: 'frozen',
  FRZN: 'frozen', CRM: 'cream', SR: 'sour', BTR: 'butter', BUTR: 'butter', UNSLT: 'unsalted',
  UNSLTD: 'unsalted', SLTD: 'salted', CRKR: 'crackers', CRKRS: 'crackers', CHP: 'chips', CHPS: 'chips',
  TORT: 'tortillas', TRTLA: 'tortillas', PSTA: 'pasta', SPAG: 'spaghetti', SCE: 'sauce', SAU: 'sauce',
  MRNRA: 'marinara', BNNA: 'bananas', BNNS: 'bananas', BAN: 'bananas', GRP: 'grapes', GRPS: 'grapes',
  STK: 'steak', SLMN: 'salmon', SHRMP: 'shrimp', TKY: 'turkey', TRKY: 'turkey', BCN: 'bacon',
  SAUS: 'sausage', SSG: 'sausage', CRMR: 'creamer', COFF: 'coffee', BRWN: 'brown', WW: 'whole wheat',
  GF: 'gluten free', RTSRE: 'rotisserie', ROTIS: 'rotisserie', HMMS: 'hummus', CRL: 'cereal', RCE: 'rice',
  FLR: 'flour', SGR: 'sugar', HNY: 'honey', SYRP: 'syrup', MPL: 'maple', MSTRD: 'mustard', DRSG: 'dressing',
  RNCH: 'ranch', BNS: 'beans', BLK: 'black', BRTH: 'broth', STCK: 'stock', EGG: 'eggs',
}

// House-brand prefixes carry no information about what the item is.
const BRAND_TOKENS = new Set(['KS', 'KIRKLAND', 'GV', 'TJ', 'TJS', '365', 'WFM', 'MM', 'KRO', 'SIG', 'HEB'])
const SIZE_TOKEN = /^(?:\d+(?:[.,]\d+)?|\d*(?:[.,]\d+)?(?:oz|lb|lbs|ct|pk|gal|qt|pt|ml|l|kg|g|dz|doz|fl)|oz|lb|lbs|ct|pk|gal|qt|pt|fl|dz|doz|ea|each|lg|lrg|xl|sm|med)$/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function parseAmount(digits: string): number {
  return Number(digits.replace(',', '.'))
}

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function cleanReceiptName(namePart: string): string {
  const stripped = namePart
    .replace(/^[A-Z]?\s*\d{4,}\s+/, '')
    .replace(/\s+\d{5,}\s*$/, '')
    .replace(/^\d+\s*(?:@|x)\s*/i, '')
    .replace(/[^\p{L}\p{N}%&'\s/.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const shouting = letterCount(stripped) > 0 && stripped === stripped.toUpperCase()
  const tokens = stripped.split(' ').filter(Boolean)
  while (tokens.length > 1 && /^\p{L}$/u.test(tokens[tokens.length - 1]!)) tokens.pop()
  const kept = tokens.filter((t, i) => !(BRAND_TOKENS.has(t.toUpperCase()) && tokens.length > 1 && i === 0))
  const words = kept
    .filter((t) => !(SIZE_TOKEN.test(t) && kept.length > 1))
    .map((t) => ABBREVIATIONS[t.toUpperCase()] ?? (shouting ? t.toLowerCase() : t))
  const name = words.join(' ').trim()
  return letterCount(name) >= 2 ? displayName(name) : ''
}

function detectStore(lines: string[], knownStores: string[]): { store: string | null; storeRaw: string | null } {
  const head = lines.slice(0, 8)
  for (const line of head) {
    const chain = matchKnownChain(line)
    if (chain) {
      const known = knownStores.find((s) => matchKnownChain(s) === chain || storeKey(s) === storeKey(chain))
      return { store: known ?? chain, storeRaw: line }
    }
    const key = storeKey(line)
    const known = knownStores.find((s) => storeKey(s).length >= 4 && key.includes(storeKey(s)))
    if (known) return { store: known, storeRaw: line }
  }
  for (const line of head) {
    if (letterCount(line) < 4 || line.length > 40) continue
    if (ADDRESS.test(line) || PRICE_AT_END.test(line) || SKIP.test(line) || /\d{1,2}[/.-]\d{1,2}/.test(line)) continue
    return { store: canonicalStoreName(line), storeRaw: line }
  }
  return { store: null, storeRaw: null }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function validDate(year: number, month: number, day: number): boolean {
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

export function detectDate(text: string): string | null {
  const time = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i.exec(text)
  let timePart = ''
  if (time) {
    let hour = Number(time[1])
    const pm = time[3]?.toLowerCase().startsWith('p')
    if (pm && hour < 12) hour += 12
    if (time[3]?.toLowerCase().startsWith('a') && hour === 12) hour = 0
    if (hour < 24 && Number(time[2]) < 60) timePart = `T${pad(hour)}:${time[2]}`
  }
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text)
  if (iso && validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return `${iso[1]}-${iso[2]}-${iso[3]}${timePart}`
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(text)
  if (numeric) {
    let a = Number(numeric[1])
    let b = Number(numeric[2])
    const year = numeric[3]!.length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])
    if (a > 12 && b <= 12) [a, b] = [b, a]
    if (validDate(year, a, b)) return `${year}-${pad(a)}-${pad(b)}${timePart}`
  }
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(text)
  if (named) {
    const month = MONTHS.indexOf(named[1]!.toLowerCase()) + 1
    if (validDate(Number(named[3]), month, Number(named[2]))) {
      return `${named[3]}-${pad(month)}-${pad(Number(named[2]))}${timePart}`
    }
  }
  return null
}

export function looksLikeReceipt(text: string): boolean {
  const lines = text.split(/\r?\n/)
  const priced = lines.filter((l) => PRICE_AT_END.test(l) && letterCount(l) >= 2).length
  const hasTotal = lines.some((l) => TOTAL.test(l) && PRICE_AT_END.test(l))
  return (hasTotal && priced >= 2) || priced >= 5
}

/**
 * Reads printed receipt text (from OCR or a pasted e-receipt): store, date, total, and one
 * line per purchased item. Handles weighed items whose price sits on the next line
 * ("BANANAS" then "2.13 lb @ 0.69 /lb 1.47") and discounts printed under an item.
 */
export function parseReceiptText(text: string, options: { knownStores?: string[] } = {}): ReceiptParse {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const { store, storeRaw } = detectStore(lines, options.knownStores ?? [])
  const items: ReceiptLine[] = []
  let total: number | null = null
  let pendingName: string | null = null
  let pendingQuantity: { quantity: number; unit: string | null; lineTotal: number } | null = null
  let lastWasItem = false

  const pushItem = (item: ReceiptLine) => {
    if (pendingQuantity && item.quantity === null && Math.abs((item.price ?? 0) - pendingQuantity.lineTotal) < 0.02) {
      item.quantity = pendingQuantity.quantity
      item.unit = pendingQuantity.unit
    }
    pendingQuantity = null
    items.push(item)
    lastWasItem = true
  }

  for (const line of lines) {
    if (line === storeRaw) continue
    const price = PRICE_AT_END.exec(line)
    const amount = price ? parseAmount(price[2]!) * (price[1] || price[3] ? -1 : 1) : null

    if (price && TOTAL.test(line) && !NOT_TOTAL.test(line)) {
      total = Math.abs(amount!)
      pendingName = null
      lastWasItem = false
      continue
    }
    if (price && !TOTAL.test(line) && (amount! < 0 || DISCOUNT.test(line))) {
      const last = items[items.length - 1]
      if (lastWasItem && last?.price != null) last.price = round2(Math.max(0, last.price - Math.abs(amount!)))
      continue
    }
    if (SKIP.test(line)) {
      pendingName = null
      lastWasItem = false
      continue
    }

    const weight = WEIGHT_LINE.exec(line)
    const qty = weight ? null : QTY_LINE.exec(line)
    if (weight || qty) {
      const quantity = Number(weight ? weight[1] : qty![1])
      const unitPrice = parseAmount(weight ? weight[3]! : qty![2]!)
      const matchedLength = (weight ?? qty)![0].length
      const lineTotal = price && price.index >= matchedLength ? amount! : round2(quantity * unitPrice)
      const unit = weight ? (weight[2]!.toLowerCase().startsWith('lb') ? 'lb' : weight[2]!.toLowerCase()) : null
      const last = items[items.length - 1]
      if (pendingName) {
        const name = cleanReceiptName(pendingName)
        if (name) pushItem({ rawText: pendingName, name, quantity, unit, price: lineTotal })
        pendingName = null
      } else if (lastWasItem && last && last.quantity === null && Math.abs((last.price ?? 0) - lineTotal) < 0.02) {
        last.quantity = quantity
        last.unit = unit
      } else {
        // Some receipts print "2 @ 1.99" above the item it belongs to.
        pendingQuantity = { quantity, unit, lineTotal }
        lastWasItem = false
      }
      continue
    }

    if (price) {
      const namePart = line.slice(0, price.index).trim()
      const name = cleanReceiptName(namePart)
      if (name) {
        pushItem({ rawText: namePart, name, quantity: null, unit: null, price: amount })
      } else if (pendingName) {
        const pending = cleanReceiptName(pendingName)
        if (pending) pushItem({ rawText: pendingName, name: pending, quantity: null, unit: null, price: amount })
      }
      pendingName = null
      continue
    }

    // A line starting with a number under a name is a size or weight detail, not a new name.
    if (pendingName && /^\d/.test(line)) continue
    pendingName = letterCount(line) >= 3 && line.length <= 40 && !ADDRESS.test(line) ? line : null
    lastWasItem = false
  }

  return { store, storeRaw, purchasedAt: detectDate(text), total, items }
}
