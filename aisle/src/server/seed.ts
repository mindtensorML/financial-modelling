import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { hashPassword } from './auth'
import { openDatabase } from './db'
import { DEMO_MEMBERS, DemoExistsError, seedDemo } from './demo'
import { loadConfig } from './env'
import { BlobStore } from './ingest/blobs'

const emails = DEMO_MEMBERS.map((m) => m.email)
const usage = `Usage: npm run seed:demo -- [--password <password>] [--reset]

Adds a demo household, "The Riveras", with ten weeks of shopping at four stores to the
database in DATA_DIR. Both members (${emails.join(' and ')}) sign in with the same password.

  --password <password>  At least 8 characters; without it, one is made up and printed
  --reset                Replace the demo household if it is already there

Trips happen at local times in this machine's time zone. To see them at sensible hours
in your browser, seed with your zone: TZ=America/New_York npm run seed:demo`

function fail(message: string): never {
  console.error(`${message}\n\n${usage}`)
  process.exit(1)
}

function readArgs() {
  try {
    return parseArgs({
      options: {
        password: { type: 'string' },
        reset: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }).values
  } catch (error) {
    fail((error as Error).message)
  }
}

const args = readArgs()
if (args.help) {
  console.log(usage)
  process.exit(0)
}
const password = args.password ?? randomBytes(9).toString('base64url')
if (password.length < 8) fail('Use at least 8 characters for the password.')

if (existsSync('.env')) process.loadEnvFile('.env')
const config = loadConfig()
const db = openDatabase(join(config.dataDir, 'aisle.db'))
try {
  const summary = await seedDemo(db, {
    passwordHash: await hashPassword(password),
    blobs: new BlobStore(join(config.dataDir, 'uploads')),
    reset: args.reset,
  })
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  console.log(`Added "The Riveras" to ${config.dataDir}, with times in ${zone}:`)
  console.log(`  ${summary.stores} stores, ${summary.products} products, ${summary.purchases} purchases, ${summary.receipts} receipts`)
  console.log(`  ${summary.openItems} items on the list and ${summary.toReview} capture to review`)
  console.log(`\nSign in as ${emails.join(' or ')}\nPassword: ${password}`)
  if (summary.warnings.length) {
    console.warn(`\nSome of the history did not go as scripted:\n${summary.warnings.map((w) => `  - ${w}`).join('\n')}`)
  }
} catch (error) {
  if (!(error instanceof DemoExistsError)) throw error
  console.error(`${error.message}. Run with --reset to replace the demo household.`)
  process.exitCode = 1
} finally {
  db.close()
}
