// Renders public/icon.svg into the PNG sizes the PWA manifest and iOS need.
// Usage: CHROME_PATH=/path/to/chrome node scripts/generate-icons.mjs
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const svg = readFileSync('public/icon.svg', 'utf8')
const fullBleed = svg.replace('rx="116"', 'rx="0"')

const targets = [
  { file: 'public/pwa-192.png', size: 192, source: svg },
  { file: 'public/pwa-512.png', size: 512, source: svg },
  { file: 'public/pwa-maskable-512.png', size: 512, source: fullBleed },
  { file: 'public/apple-touch-icon.png', size: 180, source: fullBleed },
]

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome' })
const page = await browser.newPage()
for (const { file, size, source } of targets) {
  await page.setViewportSize({ width: size, height: size })
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`,
  )
  await page.screenshot({ path: file, omitBackground: true })
  console.log('wrote', file)
}
await browser.close()
