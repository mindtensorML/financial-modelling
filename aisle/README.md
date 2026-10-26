# Aisle

A shared shopping list that files every item under the store you usually buy it from, learns your household's habits as you shop, and takes items from whatever you have: a typed or pasted message, a voice note, a screenshot, a photo of a handwritten list, or a receipt.

- **Capture anything.** Paste a text from your partner, dictate, record a voice note, photograph a list or a receipt, or share a screenshot straight from the Android share sheet. What it reads comes back for a quick review before anything changes.
- **Grouped by store.** Each item is filed under the store you usually buy it at, with the reason ("Bought here 5 of 6 times"). Move an item once and it remembers.
- **Learns as you shop.** Checking items off and capturing receipts teach it where you buy things, how often ("Running low?"), what they cost at each store, and the order you walk each store in, which it uses to sort that store's section.
- **Shared and offline.** Everyone in the household sees changes within a second. The list keeps working with no signal in the store and catches up when it reconnects. It installs to the home screen like an app.

How it works, and why it is built this way, is in [docs/DESIGN.md](docs/DESIGN.md).

## Run it locally

You need Node 22 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and create an account. The API runs on port 8787 and the Vite dev server proxies to it. Data goes to `./data`.

To look around with history already in place, seed the demo household:

```bash
TZ=America/New_York npm run seed:demo -- --password demo-pass-123
```

Then sign in as `alex@example.com` (or `sam@example.com`, the other member) with that password. "The Riveras" have ten weeks of shopping at Trader Joe's, Costco, Target, and Whole Foods. Their list is ready for the next trip, a text message is waiting to be reviewed, and every Insights card has something on it. Set `TZ` to your own time zone so the trips appear at sensible hours. Use `--reset` to replace an earlier demo household.

## Reading captures

With an AI provider configured, photos, screenshots, receipts, handwriting, and voice notes are read by a vision model. Any OpenAI-compatible API works: OpenAI, OpenRouter, or a local [Ollama](https://ollama.com) model if you want images to stay on your own machine.

```bash
# .env (copy .env.example)
AI_API_KEY=sk-...
AI_MODEL=gpt-4.1-mini
```

Without a provider, Aisle uses OCR and rule-based parsers. That works well on screenshots, pasted text, and printed receipts, and poorly on handwriting. Uploaded voice notes cannot be transcribed, but live dictation still works because the browser does the speech recognition.

## Configuration

Settings come from environment variables, or from a `.env` file in the working directory. [.env.example](.env.example) has the same list with more detail.

| Variable | Default | What it does |
| --- | --- | --- |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the SQLite database, uploaded originals, and the OCR model cache live |
| `PORT` | `8787` (`8080` in Docker) | HTTP port |
| `COOKIE_SECURE` | `false` | Marks session cookies Secure. Set to `true` when serving over HTTPS |
| `TRUST_PROXY` | `false` | Reads the client address from `X-Forwarded-For` or `Fly-Client-IP` for rate limits. Only safe behind a proxy that sets them |
| `SIGNUP_MODE` | `open` | `invite` only allows new accounts that join an existing household with its invite code |
| `AI_API_KEY` | empty | Turns on AI extraction (`OPENAI_API_KEY` also works) |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible API |
| `AI_MODEL` | `gpt-4.1-mini` | Reads photos, screenshots, receipts, and text. Must accept images and JSON-schema output |
| `AI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | Transcribes voice notes. Set it empty if your provider has no transcription endpoint |
| `OCR_ENABLED` | `true` | OCR when there is no AI provider. Downloads a 5 MB English model on first use |
| `WEB_DIR` | `./dist/web` | The built web app that the server serves |

## Deploy

Aisle is one Node process with a SQLite database on disk, so it needs a single small server with a persistent volume. Serve it over HTTPS: installing to the home screen, offline use, the share target, and voice recording all need a secure origin.

### Docker

```bash
docker build -t aisle .
docker run -d --name aisle -p 8080:8080 -v aisle-data:/data aisle
```

Put it behind a reverse proxy that terminates HTTPS, and add `-e COOKIE_SECURE=true -e TRUST_PROXY=true` when you do. Pass `-e AI_API_KEY=...` to read captures with AI. The container drops root and runs the server as the `node` user. The image has a health check on `/api/health`.

### Fly.io

[fly.toml](fly.toml) runs one machine with a volume mounted at `/data`. From this folder:

```bash
fly launch --no-deploy --copy-config --name your-aisle --region ewr
fly volumes create aisle_data --size 1 --region ewr
fly secrets set AI_API_KEY=sk-...    # optional
fly deploy
```

The app is then at `https://your-aisle.fly.dev`. Keep it to a single machine (`fly scale count 1`): the database lives on that machine's volume. The machine stops when nobody has the app open and starts again on the next request. Captures that were being read when it stopped pick up where they left off.

Once everyone in your household has an account, run `fly secrets set SIGNUP_MODE=invite` (or set it in `fly.toml`) so strangers cannot sign up.

### Demo data and backups on a server

The demo seed is bundled into the image. Run it as the `node` user so the files it touches stay writable by the server:

```bash
docker exec -u node -e TZ=America/New_York aisle node dist/server/seed.js --password 'choose-a-password'
fly ssh console --user node -C "env DATA_DIR=/data TZ=America/New_York node /app/dist/server/seed.js"
```

Without `--password`, the seed makes one up and prints it, so a public server never ends up with a guessable demo account.

Everything worth keeping is in the data directory: `aisle.db` and `uploads/`. Copying the database file while the server is running can catch it mid-write, so take a snapshot through SQLite instead:

```bash
docker exec -u node aisle node -e "require('better-sqlite3')('/data/aisle.db').backup('/data/backup.db')"
docker cp aisle:/data/backup.db ./aisle-backup.db
```

On Fly.io, run the same `node -e` command with `fly ssh console --user node -C`, then download the copy with `fly ssh sftp get /data/backup.db`. For continuous backups to S3-compatible storage, look at [Litestream](https://litestream.io).

## Development

```bash
npm test             # unit and API tests (Vitest)
npm run typecheck
npm run build        # web app to dist/web, server to dist/server
npm start            # serve the build
npm run e2e -- http://localhost:8790   # browser walkthrough against a running server (see scripts/e2e.mjs)
```

The end-to-end walkthrough drives headless Chrome through sign-up, adding and moving items, shopping, capturing a pasted list and a receipt photo, insights, offline edits, and a second person joining. It saves screenshots to `e2e-output/`. Set `CHROME_PATH` if Chrome is not at `/usr/local/bin/google-chrome`.

```
src/shared   Parsers, name matching, categories, and the sync operation schema, used by both sides
src/server   Hono API, SQLite, sync and realtime, the capture pipeline, and the learning engine
src/web      React app (PWA): list, quick add, capture, review, insights, settings
test         Vitest suites for all three
docs         Design document and build plan
```

## Moving Aisle into its own repository

Aisle lives in the `aisle/` folder of this repository. To give it a repository of its own with its history, run this from the repository root:

```bash
git subtree split --prefix=aisle -b aisle-only
git push git@github.com:you/aisle.git aisle-only:main
```

Or copy the folder somewhere else and run `git init` there. Nothing in it depends on files outside the folder.
