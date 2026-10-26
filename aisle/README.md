# Aisle

A shared shopping list that files every item under the store you usually buy it from, learns your household's habits as you shop, and takes items from whatever you have: a typed or pasted message, a voice note, a screenshot, a photo of a handwritten list, or a receipt.

- **Capture anything.** Paste a text from your partner, dictate, record a voice note, photograph a list or a receipt, or share a screenshot straight from the Android share sheet. What it reads comes back for a quick review before anything changes.
- **Grouped by store.** Each item is filed under the store you usually buy it at, with the reason ("Bought here 5 of 6 times"). Move an item once and it remembers.
- **Learns as you shop.** Checking items off and capturing receipts teach it where you buy things, how often ("Running low?"), what they cost at each store, and the order you walk each store in, which it uses to sort that store's section.
- **Shared and offline.** Everyone in the household sees changes within a second. The list keeps working with no signal in the store and catches up when it reconnects. It installs to the home screen like an app.

How it works, and why it is built this way, is in [docs/DESIGN.md](docs/DESIGN.md). To put it online for your household without installing anything, see [Fly.io, from the browser](#flyio-from-the-browser), which should cost nothing, or [Render, from the browser](#render-from-the-browser), at $7.25 a month.

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
| `TRUST_PROXY` | `false` | Where rate limits find the visitor's address behind a proxy: `true` reads the first `X-Forwarded-For` entry, or name the header your host sets (`fly-client-ip` on Fly.io, `cf-connecting-ip` on Render). Only use a header that the proxy overwrites |
| `SIGNUP_MODE` | `open` | `invite` only allows new accounts that join an existing household with its invite code |
| `AI_API_KEY` | empty | Turns on AI extraction (`OPENAI_API_KEY` also works) |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible API |
| `AI_MODEL` | `gpt-4.1-mini` | Reads photos, screenshots, receipts, and text. Must accept images and JSON-schema output |
| `AI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | Transcribes voice notes. Set it empty if your provider has no transcription endpoint |
| `OCR_ENABLED` | `true` | OCR when there is no AI provider. Downloads a 5 MB English model on first use |
| `WEB_DIR` | `./dist/web` | The built web app that the server serves |

## Deploy

Aisle is one Node process with a SQLite database on disk, so it needs a single small server with a persistent volume. Serve it over HTTPS: installing to the home screen, offline use, the share target, and voice recording all need a secure origin.

Choose one of the ways below. Each server keeps its own database, so running two would give you two separate lists. Fly.io and Render are both set up in the browser, and Fly.io costs less; Docker takes a few commands on a server of your own. None of them needs a Docker Hub account: each one builds the image from this folder's Dockerfile.

### Fly.io, from the browser

[fly.toml](fly.toml) runs one machine with a 1 GB volume at `/data`, and [a GitHub Actions workflow](../.github/workflows/aisle-fly.yml) builds Aisle and deploys it to [Fly.io](https://fly.io) whenever its code changes on this branch. Running all month, the 512 MB machine costs $3.69 and the volume $0.15. The machine stops when nobody has the app open, so it usually costs less, and Fly currently waives bills under $5 for the organization it creates at sign-up. That waiver is not a published promise, and it does not cover organizations you add later. Once the trial ends (2 hours of machine time or 7 days), Fly needs a card on file.

1. Sign up at [fly.io](https://fly.io/app/sign-up) and add a card on the dashboard's [Billing](https://fly.io/dashboard/personal/billing) page.
2. Create a token at [fly.io/dashboard/personal/tokens](https://fly.io/dashboard/personal/tokens) and copy all of it, including `FlyV1` at the start.
3. In this repository on GitHub, open **Settings > Secrets and variables > Actions**, choose **New repository secret**, name it `FLY_API_TOKEN`, and paste the token.
4. Open the **Actions** tab, open the latest **Deploy Aisle to Fly.io** run, and choose **Re-run all jobs**. The first deploy creates the app and its volume and takes a few minutes. The run's summary shows the address, `https://aisle-mindtensorml.fly.dev`; to use another name, change `app` in `fly.toml` before this step.
5. Open the address and create your account. That account starts your household. On your phone, open the same address and add it to the home screen: **Share > Add to Home Screen** in Safari on iPhone, or **⋮ > Install app** (or **Add to Home screen**) in Chrome on Android.
6. Invite the rest of the household from **Settings** with **Copy link** or **Share**. Once they have accounts, add a repository variable on the **Variables** tab of the same GitHub page, named `SIGNUP_MODE` with the value `invite`, and re-run the latest deploy, so nobody else who finds the address can sign up.

To read photos, receipts, and voice notes with AI, add an `AI_API_KEY` repository secret and re-run the latest deploy. Each push that changes `aisle/` deploys by itself, and the app is unreachable for a few seconds while the machine restarts. After a quiet spell, the first visit waits a few seconds for the machine to start; the installed app shows the list straight away and catches up. Fly snapshots the volume every day and keeps each snapshot for 5 days. To stop paying, delete the app from its **Settings** page in the Fly dashboard and delete the `FLY_API_TOKEN` secret; otherwise the next change would create the app again, with an empty list.

### Render, from the browser

[render.yaml](../render.yaml), at the root of this repository, tells [Render](https://render.com) everything it needs: build this folder's Dockerfile, attach a 1 GB disk at `/data` for the database, and set `COOKIE_SECURE` and `TRUST_PROXY` the way Render needs them. It costs $7 a month for the server and $0.25 a month for the disk, charged by the second. The free plan cannot have a disk, so it would lose the list every time it restarted.

1. Sign up at [dashboard.render.com](https://dashboard.render.com/register) with your GitHub account.
2. Choose **New > Blueprint**. Connect GitHub when asked and let Render see this repository.
3. Pick the repository and the branch that has the `aisle/` folder (not `main`, unless Aisle has been merged there). Give the Blueprint any name, leave the path as `render.yaml`, and choose **Deploy Blueprint**. Render asks for a card before it creates a paid service.
4. The first build takes a few minutes. When the deploy shows **Live**, open the `onrender.com` address at the top of the service's page and create your account. That account starts your household.
5. On your phone, open the same address and add it to the home screen: **Share > Add to Home Screen** in Safari on iPhone, or **⋮ > Install app** (or **Add to Home screen**) in Chrome on Android.
6. Invite the rest of the household from **Settings** with **Copy link** or **Share**. Once they have accounts, open the service's **Environment** page on Render, add `SIGNUP_MODE` with the value `invite`, and save, so nobody else who finds the address can sign up.

To read photos, receipts, and voice notes with AI, add `AI_API_KEY` on the same page (see [Reading captures](#reading-captures)). Each push to the branch deploys the new version by itself; with a disk attached, the app is unreachable for a few seconds while it switches over. Render snapshots the disk every day and keeps each snapshot for a week; restore one from the service's **Disk** page. The **Shell** page runs commands on the server, such as the demo seed below.

### Docker

```bash
docker build -t aisle .
docker run -d --name aisle -p 8080:8080 -v aisle-data:/data aisle
```

Put it behind a reverse proxy that terminates HTTPS, and add `-e COOKIE_SECURE=true -e TRUST_PROXY=true` when you do. Pass `-e AI_API_KEY=...` to read captures with AI. The container drops root and runs the server as the `node` user. The image has a health check on `/api/health`.

### Fly.io, from a terminal

[fly.toml](fly.toml) runs one machine with a volume mounted at `/data`. From this folder, with an app name of your own:

```bash
fly launch --no-deploy --copy-config --name your-aisle --region ewr
fly secrets set AI_API_KEY=sk-...    # optional
fly deploy --ha=false                # the first deploy also creates the volume
```

The app is then at `https://your-aisle.fly.dev`. Keep it to a single machine (`fly scale count 1`): the database lives on that machine's volume. The machine stops when nobody has the app open and starts again on the next request. Captures that were being read when it stopped pick up where they left off.

Once everyone in your household has an account, run `fly secrets set SIGNUP_MODE=invite` so strangers cannot sign up.

### Demo data and backups on a server

The demo seed is bundled into the image. Run it next to the server:

```bash
docker exec -u node -e TZ=America/New_York aisle node dist/server/seed.js --password 'choose-a-password'
fly ssh console --user node -C "env DATA_DIR=/data TZ=America/New_York node /app/dist/server/seed.js"
TZ=America/New_York node /app/dist/server/seed.js   # on Render, in the service's Shell page
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

Or copy the folder somewhere else and run `git init` there. Nothing in it depends on files outside the folder. Two files at the repository root belong with it:

- `render.yaml`: if you use Render, move it to the new repository's root and delete its `rootDir` line.
- `.github/workflows/aisle-fly.yml`: if you deploy to Fly.io from GitHub, move it to the same path in the new repository. Change its branch to `main`, drop the `aisle/` prefix from its paths, and delete its `defaults` section. Add the `FLY_API_TOKEN` secret, and any others, to the new repository.
