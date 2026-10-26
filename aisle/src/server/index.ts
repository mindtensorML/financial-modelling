import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createApp } from './app'
import { openDatabase } from './db'
import { loadConfig } from './env'
import { runMaintenance } from './maintenance'

if (existsSync('.env')) process.loadEnvFile('.env')

const config = loadConfig()
const db = openDatabase(join(config.dataDir, 'aisle.db'))
const app = createApp({ db, config })

// The service worker normally answers the share target; this only runs before it is installed.
app.post('/share-target', (c) => c.redirect('/#/capture?shared=0', 303))

const indexHtml = join(config.webDir, 'index.html')
if (existsSync(indexHtml)) {
  const html = readFileSync(indexHtml, 'utf8')
  app.use('/*', async (c, next) => {
    await next()
    const path = c.req.path
    c.header('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  })
  app.use('/*', serveStatic({ root: relative(process.cwd(), config.webDir) }))
  app.get('*', (c) => c.html(html))
}

runMaintenance(db)
const maintenance = setInterval(() => runMaintenance(db), 6 * 60 * 60_000)
maintenance.unref()

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Aisle listening on http://localhost:${info.port}`)
  if (!config.ai) console.log('No AI provider configured: captures use on-device OCR and rule-based parsing.')
})

function shutdown() {
  clearInterval(maintenance)
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
