# Roster — Creator/Influencer Database

A real full-stack app: Node.js + Express backend, SQLite database, REST API,
and a web frontend. Every save is a network request to the server and lands
in the database file — nothing lives only in your browser.

## What's inside

- `server.js` — Express API + SQLite database (creators table, CSV import/export, stats)
- `public/index.html` — the frontend (talks to the API over `fetch`)
- `data/roster.db` — created automatically on first run (not committed to git)

## Run it locally

```
npm install
npm start
```

Then open http://localhost:3000

## Put it online (free, ~5 minutes, no coding)

You need somewhere to run `npm start` and keep `data/roster.db` persisted
between restarts. Two easy options:

### Option A — Railway (recommended, has a persistent volume)

1. Push this folder to a new GitHub repo (or use Railway's CLI to deploy
   the folder directly — `railway up` after `railway login`, no GitHub needed).
2. Go to railway.app → **New Project** → **Deploy from GitHub repo** (or
   run `railway up` from this folder).
3. Once deployed, open the service → **Settings** → **Volumes** → add a
   volume mounted at `/app/data`. This keeps your database across restarts
   and deploys.
4. Under **Variables**, add `DB_PATH` = `/app/data/roster.db`.
5. Railway gives you a public URL automatically (Settings → Networking →
   Generate Domain). That URL is your live app.

### Option B — Render

1. Push this folder to a GitHub repo.
2. Go to render.com → **New** → **Web Service** → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add a **Disk** (Render's persistent storage) mounted at `/opt/render/project/data`,
   and set the environment variable `DB_PATH` to
   `/opt/render/project/data/roster.db`.
5. Deploy — Render gives you a public `.onrender.com` URL.

Either way, once it's live, share the URL with your team and everyone hits
the same database.

## Swapping in live platform data later

Every stat (`followers`, `engagementRate`, `avgViews`, etc.) lives in the
`platforms` array of each creator record, stored the same way whether you
type it in, import it via CSV, or a script writes it. To move to a live data
provider (Modash, HypeAuditor, Phyllo, Upfluence, etc.) later:

1. Get API access from the provider of your choice.
2. Add a script/cron job that calls their API and `PUT`s the results to
   `/api/creators/:id` in this same shape.
3. Nothing in the frontend or database schema needs to change.

## CSV columns

Use **Download CSV template** in the app for the exact header row and an
example row. Fields for a second platform (`platform2`, `handle2`, etc.) are
optional.
