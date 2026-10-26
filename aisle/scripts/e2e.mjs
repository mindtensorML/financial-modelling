// End-to-end walk through the web app in headless Chrome, against a running server.
//
//   npm run build && DATA_DIR=/tmp/aisle-e2e PORT=8790 npm start
//   npm run e2e -- http://localhost:8790
//
// Screenshots go to e2e-output/. Set CHROME_PATH if Chrome is not at /usr/local/bin/google-chrome.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:8790'
const OUT = 'e2e-output'
const ZONE = 'America/New_York'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: ZONE,
}
const problems = []
let shot = 0
let offline = false

function watch(page, label) {
  page.on('console', (msg) => {
    // Failed requests are judged below, where the URL and status are known.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) problems.push(`[${label}] console: ${msg.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`[${label}] page error: ${error.message}`))
  page.on('response', (res) => {
    const path = new URL(res.url()).pathname
    // Before signing in, the app asks who is signed in and is told nobody.
    if (res.status() === 401 && path === '/api/me') return
    if (res.status() >= 400) problems.push(`[${label}] ${res.status()} ${res.request().method()} ${path}`)
  })
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? ''
    if (failure.includes('ERR_ABORTED') || (offline && failure.includes('ERR_INTERNET_DISCONNECTED'))) return
    problems.push(`[${label}] request failed: ${req.method()} ${req.url()} ${failure}`)
  })
}

async function snap(page, name, options = {}) {
  const file = `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`
  await page.waitForTimeout(350)
  await page.screenshot({ path: file, ...options })
  console.log(`  screenshot ${file}`)
}

function step(title) {
  console.log(`\n${title}`)
}

function check(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`)
}

const expectVisible = (locator, timeout = 10_000) => locator.first().waitFor({ state: 'visible', timeout })

/** A printed receipt from a few minutes ago, the usual case: snapped on the way home. */
async function receiptPng() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(Date.now() - 10 * 60_000))
      .map((p) => [p.type, p.value]),
  )
  const printed = `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}`
  const line = (name, price) =>
    `<div style="display:flex;justify-content:space-between"><span>${name}</span><span>${price}</span></div>`
  const page = await browser.newPage({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 2 })
  await page.setContent(`
    <body style="margin:0;background:#ddd">
      <div id="receipt" style="width:360px;margin:20px;padding:28px;background:#fff;font:20px/1.5 'DejaVu Sans Mono',monospace;color:#111">
        <div style="text-align:center;font-weight:bold">TRADER JOE'S #552</div>
        <div style="text-align:center">${printed}</div>
        <br>
        ${line('BANANAS ORGANIC', '1.99')}
        ${line('OAT MILK', '3.49')}
        ${line('EGGS DOZEN', '4.29')}
        ${line('GREEK YOGURT', '5.99')}
        <br>
        ${line('SUBTOTAL', '15.76')}
        ${line('TOTAL', '15.76')}
        <br>
        <div style="text-align:center">THANK YOU</div>
      </div>
    </body>`)
  const png = await page.locator('#receipt').screenshot({ path: `${OUT}/receipt-input.png` })
  await page.close()
  return png
}

const stamp = Date.now()
const alice = { name: 'Alice', email: `alice+${stamp}@example.com`, password: 'correct horse battery' }
const bob = { name: 'Bob', email: `bob+${stamp}@example.com`, password: 'another long password' }

const context = await browser.newContext(phone)
const page = await context.newPage()
watch(page, 'alice')

step('Sign up')
await page.goto(BASE)
await expectVisible(page.getByRole('heading', { name: 'Aisle' }))
await snap(page, 'sign-in')
await page.getByRole('radio', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill(alice.name)
await page.getByLabel('Email').fill(alice.email)
await page.getByLabel('Password').fill(alice.password)
await page.getByRole('button', { name: 'Create account' }).click()
await expectVisible(page.getByText('Where do you shop?'))
await snap(page, 'pick-stores')

step('Pick stores')
for (const name of ['Costco', "Trader Joe's", 'Target']) await page.getByRole('button', { name, exact: true }).click()
await page.getByRole('button', { name: 'Done' }).click()

step('Quick add')
const box = page.getByRole('combobox', { name: 'Add items' })
await box.fill('2 avocados, oat milk, bananas @trader joes')
await box.press('Enter')
await expectVisible(page.getByText("Added 3 items to Trader Joe's"))
await box.fill('paper towels, olive oil, dish soap')
await box.press('Enter')
await expectVisible(page.getByText('Added 3 items to Unsorted. Tap one to pick its store.'))
await snap(page, 'list-after-adding')

step('Move an item to a store, which teaches Aisle')
await page.getByRole('button', { name: 'Paper towels' }).click()
await expectVisible(page.getByRole('dialog', { name: 'Paper towels' }))
await page.getByRole('dialog').getByRole('radio', { name: 'Costco' }).click()
await snap(page, 'item-sheet')
await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
await expectVisible(page.getByText('Paper towels goes to Costco from now on'))

step('Autocomplete from known products')
await box.fill('pap')
await expectVisible(page.getByRole('option', { name: /Paper towels/ }))
await snap(page, 'autocomplete')
await box.fill('')
await box.blur()

step('Check items off and clear them')
await page.getByRole('checkbox', { name: 'Mark Bananas as bought' }).click()
await page.getByRole('checkbox', { name: 'Mark Oat milk as bought' }).click()
await expectVisible(page.getByText('2 in the cart'))
await page.getByText('2 in the cart').click()
await snap(page, 'checked-off')

step('Shop at one store')
await page.getByRole('navigation', { name: 'Stores' }).getByRole('button', { name: /Trader Joe's/ }).click()
await expectVisible(page.getByRole('button', { name: /Done shopping/ }))
await snap(page, 'shopping-at-one-store')
await page.getByRole('button', { name: /Done shopping/ }).click()
await page.getByRole('button', { name: 'All stores' }).first().click()

step('Capture a pasted text list')
await page.getByRole('link', { name: 'Capture' }).click()
await expectVisible(page.getByRole('heading', { name: 'Capture' }))
await snap(page, 'capture')
await page.getByRole('button', { name: /Type or paste/ }).click()
await page.getByLabel('Text to read').fill("Costco: paper towels, olive oil\nTrader Joe's: bananas, eggs, 2 greek yogurt\nbirthday candles")
await page.getByRole('button', { name: 'Read it' }).click()
await expectVisible(page.getByRole('button', { name: 'Review' }), 20_000)
await page.getByRole('button', { name: 'Review' }).click()
await expectVisible(page.getByRole('button', { name: 'Add 6 items' }))
check((await page.getByLabel('Store for Birthday candles').inputValue()) !== (await page.getByLabel('Store for Eggs').inputValue()),
  'birthday candles, on a line of its own, should not inherit the Trader Joe\'s line above it')
await snap(page, 'review-list')
await snap(page, 'review-list-full', { fullPage: true })
await page.getByRole('button', { name: 'Add 6 items' }).click()
await expectVisible(page.getByText(/Added 6 items to your list \(2 already on it\)/))
await snap(page, 'list-after-capture', { fullPage: true })

step('Capture a receipt image (read with OCR)')
const png = await receiptPng()
await page.getByRole('link', { name: 'Capture' }).click()
await page.getByRole('radio', { name: 'Receipt' }).click()
await page.evaluate(async (bytes) => {
  const file = new File([new Uint8Array(bytes)], 'receipt.png', { type: 'image/png' })
  const data = new DataTransfer()
  data.items.add(file)
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
}, [...png])
await expectVisible(page.getByRole('button', { name: 'Review' }), 60_000)
await page.getByRole('button', { name: 'Review' }).click()
await expectVisible(page.getByRole('button', { name: 'Record 4 purchases' }))
await expectVisible(page.getByRole('radio', { name: "Trader Joe's", checked: true }))
// Eggs and yogurt were on the list before the trip; bananas were already checked off in the store.
check((await page.getByText('Checks it off your list').count()) === 2, 'two receipt lines should promise to check off list items')
await page.locator('img[alt="Trader Joe\'s receipt"]').evaluate((img) => img.decode())
await snap(page, 'review-receipt')
await snap(page, 'review-receipt-full', { fullPage: true })
await page.getByRole('button', { name: 'Record 4 purchases' }).click()
await expectVisible(page.getByText("Recorded 4 purchases at Trader Joe's, checked off 2"))
await snap(page, 'list-after-receipt', { fullPage: true })

step('Insights')
await page.getByRole('link', { name: 'Insights' }).click()
await expectVisible(page.getByRole('heading', { name: 'Insights' }))
await expectVisible(page.getByText('$15.76'))
await snap(page, 'insights', { fullPage: true })

step('Settings')
await page.getByRole('link', { name: 'Settings' }).click()
await expectVisible(page.getByRole('heading', { name: 'Settings' }))
const inviteCode = (await page.locator('p.font-mono').first().textContent())?.trim()
check(inviteCode && /^[A-Z0-9]{6,}$/.test(inviteCode), `invite code looks wrong: ${inviteCode}`)
await snap(page, 'settings', { fullPage: true })

step('Offline edits wait in the outbox')
await page.getByRole('link', { name: 'List' }).click()
offline = true
await context.setOffline(true)
await page.evaluate(() => window.dispatchEvent(new Event('offline')))
await box.fill('coffee beans')
await box.press('Enter')
await expectVisible(page.getByText(/Offline/), 15_000)
await snap(page, 'offline')
await context.setOffline(false)
await page.evaluate(() => window.dispatchEvent(new Event('online')))
await page.getByText(/Offline/).first().waitFor({ state: 'detached', timeout: 15_000 })
offline = false

step('A second person joins and sees changes live')
const context2 = await browser.newContext(phone)
const page2 = await context2.newPage()
watch(page2, 'bob')
await page2.goto(`${BASE}/#/join/${inviteCode}`)
await page2.getByLabel('Your name').fill(bob.name)
await page2.getByLabel('Email').fill(bob.email)
await page2.getByLabel('Password').fill(bob.password)
await page2.getByRole('button', { name: 'Create account and join' }).click()
await expectVisible(page2.getByText(/You’re in/))
await expectVisible(page2.getByRole('button', { name: 'Coffee beans' }))
check((await page2.getByText('Where do you shop?').count()) === 0, 'a member joining a household with stores should not be asked to pick stores')
await box.fill('maple syrup')
await box.press('Enter')
const started = Date.now()
await expectVisible(page2.getByRole('button', { name: 'Maple syrup' }), 10_000)
console.log(`  appeared on the second device after ${Date.now() - started} ms`)
await snap(page2, 'second-device')

step('The same list on a laptop')
const desktop = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 1280, height: 860 }, timezoneId: ZONE })
const page3 = await desktop.newPage()
watch(page3, 'alice-desktop')
await page3.goto(BASE)
await expectVisible(page3.getByRole('button', { name: 'Maple syrup' }))
await snap(page3, 'desktop-list')

await browser.close()
console.log(problems.length ? `\nProblems:\n${problems.join('\n')}` : '\nNo console errors, failed requests, or error responses.')
process.exit(problems.length ? 1 : 0)
