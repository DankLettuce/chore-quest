# AGENTS.md: setting up Chore Quest for a family

These instructions are for an AI assistant (Grok Bot, Claude, Cursor, ChatGPT, Codex, etc.) helping a
**non-technical parent** put Chore Quest online. Follow the steps in order. Talk to the parent in plain
language, do the technical work yourself, and only hand them the steps that need a human (signing up,
clicking "Allow" in a browser, opening a link on the family tablet).

What they end up with: a private web app at `https://<project>.pages.dev` that the kids use on a shared
tablet/phone, plus a 4-digit parent PIN for grown-up mode. It runs on Cloudflare's free plan.

## Ground rules (read first)

- **Never commit or share secrets.** `.secrets.env` (family key + PIN), `.dev.vars` and any API token are
  gitignored; keep them that way. Don't paste them into issues, logs, or public places.
- **Don't make the parent paste secrets into chat.** Generate them yourself (`scripts/seed.mjs` does the
  family key + PIN; `openssl rand -hex 32` for anything else) and set them with wrangler directly. The one
  thing you must hand the parent is their PIN and the family link; tell them to keep both private.
- **`INIT_DB=1` is for a brand-new install only.** If the database already has data (see "Is this a fresh
  install?" below), never run it, never run `schema.sql`, and never re-run `scripts/seed.mjs --remote` to
  "fix" a PIN. Use grown-up mode or the PIN-change screen instead.
- **Back up before any change to a live database:** `npx wrangler d1 export chore-quest --remote --output backups/<date>.sql`
  (`backups/` is gitignored). Do this before migrations, SQL edits, or updates.
- Don't set `ALLOW_TEST_CLOCK` in production (it lets anyone fake the date).
- Ask before anything that costs money (Cloudflare paid plans, buying a domain).

## 1. Prerequisites

Check on the machine you're working on:

```bash
node -v      # must be v22 or newer (wrangler 4 declares "node": ">=22.0.0")
git --version
```

- No Node 22+? Install the current LTS from https://nodejs.org (or `nvm install 22 && nvm use 22`).
- No git? Install it (macOS: `xcode-select --install`; Windows: https://git-scm.com).

Then:

```bash
git clone https://github.com/DankLettuce/chore-quest.git && cd chore-quest
npm install
```

## 2. Cloudflare account

Ask the parent: *"Do you already have a Cloudflare account?"*

### If they don't have one

Explain plainly: Cloudflare hosts websites. Its free plan is enough for a family chore app, and signing
up asks for an email and password only, with no credit card. Then walk them through it:

1. Go to **https://dash.cloudflare.com/sign-up**, enter an email and password, and create the account.
2. Open the verification email from Cloudflare and click the link.
3. They don't need to add a domain or pick a plan. Skip any "add a site" prompts; the free plan is the default.

Free-plan limits that matter here (checked against Cloudflare docs, Oct 2026; a family uses a tiny
fraction of them):

| What | Free allowance |
|---|---|
| Pages Functions (the app's `/api/*` calls) | 100,000 requests/day, shared with Workers, resets 00:00 UTC |
| Static files (the app itself, icons, sounds) | free and unlimited |
| D1 database | 10 databases, 500 MB each, 5 GB total; 5M rows read and 100k rows written per day |
| D1 Time Travel (point-in-time restore) | 7 days |

If a limit is ever hit, the app just errors until the next UTC day; nothing gets billed on the free plan.

### Log wrangler in (both cases)

```bash
npx wrangler login
```

This opens a browser page; the **parent** logs in (if needed) and clicks **Allow**. If you're running on
a remote/headless machine where the browser can't open, either give them the printed URL to open on a
machine on the same network, or have them create an API token (dashboard → My Profile → API Tokens →
"Edit Cloudflare Workers" template, plus D1 edit) and set it as `CLOUDFLARE_API_TOKEN` in your environment
yourself. Don't ask them to paste it into chat if you can avoid it.

### If they already have one

```bash
npx wrangler whoami
```

Confirm the email and account name with the parent. If several accounts are listed, set
`CLOUDFLARE_ACCOUNT_ID` to the one they want.

### Is this a fresh install?

```bash
npx wrangler d1 list
npx wrangler pages project list
```

If a `chore-quest` database or project already exists, **stop and ask** whether they're reinstalling or
already using it. An existing database means: no `INIT_DB`, back up first, and see "Updates" below.

## 3. Create the database

```bash
npx wrangler d1 create chore-quest
```

Copy the printed `database_id` into `wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`
(keep `binding = "DB"` and `database_name = "chore-quest"`; the scripts use that name). `scripts/deploy.sh`
refuses to run while the placeholder is still there.

The database name `chore-quest` is hardcoded in `scripts/deploy.sh`, `scripts/seed.mjs` and
`package.json`. Keep it unless you change all of them.

**Schema and migrations.** `schema.sql` is the full, current schema (it already includes everything in
`migrations/0002_*` and `0003_*`) plus sample kids Alex and Sam and starter chores. On a fresh install you
apply only `schema.sql`; the migrations are for databases created by older versions.

## 4. First deploy

```bash
INIT_DB=1 npm run deploy
```

`npm run deploy` runs `scripts/deploy.sh`, which:

1. creates the Pages project (`PROJECT`, default `chore-quest`) with production branch `main` if it doesn't exist,
2. with `INIT_DB=1`: runs `schema.sql` on the remote DB and `node scripts/seed.mjs --remote`, which generates a
   **family key** and a **4-digit parent PIN** into `.secrets.env` (mode 600) and stores only their hashes in D1,
3. builds `dist/` and deploys it.

The URL is printed at the end (`https://chore-quest.pages.dev`, or `https://chore-quest-xyz.pages.dev` if
the name was taken; to pick a name, use `PROJECT=<name> INIT_DB=1 npm run deploy` and keep using that
`PROJECT` for later deploys).

**Back up `.secrets.env`.** Suggest the parent saves the PIN and family link in their password manager.
If the family key is lost, a parent can re-share it from grown-up mode (it's stored sealed with the PIN).

### Secrets and environment variables

The code reads exactly these from the environment (`functions/api/[[path]].js`):

| Name | Needed? | What to do |
|---|---|---|
| `DB` | yes | D1 binding from `wrangler.toml`. Nothing to set. |
| `DASHBOARD_READ_KEY` | optional | Only if they want a read-only `GET /api/summary` for a wall dashboard. Generate it yourself: `openssl rand -hex 32 \| npx wrangler pages secret put DASHBOARD_READ_KEY --project-name chore-quest` |
| `DASHBOARD_ORIGINS` | optional | Comma-separated browser origins allowed to call `/api/summary`. `npx wrangler pages secret put DASHBOARD_ORIGINS --project-name chore-quest` |
| `ALLOW_TEST_CLOCK` | never in prod | Test-only. |

The family key and parent PIN are **not** env vars; they live (hashed) in D1. After setting any secret,
run `npm run deploy` again (no `INIT_DB`) so it takes effect.

### Time zone

"Today" is computed in **America/New_York** (`functions/_lib/time.js`, `export const TZ`). If the family
lives elsewhere, change that one string to their IANA zone (e.g. `America/Los_Angeles`, `Europe/London`)
and redeploy, otherwise chores will roll over at the wrong time. Money is shown with `$`.

## 5. Interview the parent and enter their family

Ask in small batches, in plain words. Suggested questions:

1. **Kids:** names, and pick an avatar for each (bundled: astronaut, astronaut-blond, captain, captain-brown,
   pilot, robot, rover, alien; or any emoji) and a colour.
2. **Chores** for each kid or shared: how often? Daily, certain weekdays (e.g. Mon + Thu), or once a week.
   Any done more than once a day (e.g. *Brush teeth* AM/PM, up to 6 times)? Should one chore take turns
   between kids (daily or weekly rotation)?
3. **Rewards:** screen-time minutes and/or money per chore. For multi-step chores, reward **each** check
   or only when **all** are done? Daily all-done bonus and weekly "every day" bonus (defaults: 10 min daily;
   30 min + $2.00 weekly).
4. **Goals / challenges:** bigger one-off things a kid claims ("I did it!") and a parent approves, with a
   reward (e.g. "Ride your bike to the park").
5. **PIN:** the app generated one. Do they want to change it? (They do that themselves in grown-up mode,
   so you never need to see their new PIN.)

**How to enter it:** use **grown-up mode** in the app. It supports adding/editing/removing kids, chores
(schedules, repeats, labels, reward each/all, rotations), goals, bonus settings, payouts and the PIN.
Either guide the parent through it, or, if you can drive a browser, do it yourself with the PIN they gave
you. Remove or edit the sample kids Alex and Sam and the starter chores there too.

Avoid hand-written SQL for this: the API keeps derived fields (rotation plans, rewards on repeat checks)
consistent, and raw inserts can get them wrong. If you have no way to use the UI, an alternative for a
**fresh** install is editing the starter-data `INSERT`s at the bottom of `schema.sql` **before** the first
`INIT_DB=1` deploy (those rows insert only once, guarded by the `seeded` setting).

## 6. Verify with the parent

1. Open `https://<project>.pages.dev/?k=<FAMILY_KEY>` (from `.secrets.env`). The kids' avatars should show.
2. Tap a kid, **check off** a chore. You should see it tick and the progress rocket move.
3. Tap it again to **uncheck**, confirm it reverts.
4. Open grown-up mode, enter the PIN, and confirm the parent sees today's overview.
5. Optional quick check: `curl "https://<project>.pages.dev/api/ping?k=<FAMILY_KEY>"` should return `{"ok":true,...}` (401 = wrong key, 503 = database not seeded).

**Install on the family devices** (open the full `?k=` link on each one first):

- **iPad / iPhone (Safari):** Share button → **Add to Home Screen** → Add.
- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.

The key is remembered by the installed app; the parent shouldn't post that link anywhere public.

## 7. Optional extras

**Custom domain** (e.g. `chores.example.com`, needs a domain already on Cloudflare): Cloudflare dashboard →
Workers & Pages → the project → Custom domains → Set up a custom domain. Then use the new URL with the same `?k=`.

**Backups:**

```bash
mkdir -p backups && npx wrangler d1 export chore-quest --remote --output backups/chore-quest-$(date +%F).sql
```

D1 Time Travel also allows restoring to any point in the last 7 days (free plan):
`npx wrangler d1 time-travel info chore-quest` / `npx wrangler d1 time-travel restore chore-quest --timestamp=<ISO time>`.
Restoring undoes everything after that time, so confirm with the parent first.

**Updates:**

```bash
npx wrangler d1 export chore-quest --remote --output backups/before-update-$(date +%F).sql
git pull
npm install
# only if a new file appeared in migrations/ since their last update:
npx wrangler d1 execute chore-quest --remote --file migrations/<new-file>.sql --yes
npm run deploy          # no INIT_DB
```

Migrations are additive; an `ALTER` that was already applied fails with "duplicate column" and is harmless.
If they changed `TZ` or `wrangler.toml`, re-apply those edits after `git pull` (or keep them on a local branch).

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `Set database_id in wrangler.toml first` | Step 3: paste the id from `wrangler d1 create`. |
| wrangler errors about Node version | `node -v` must be 22+. |
| `Not logged in` / auth errors | `npx wrangler login` again, or check `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`. |
| Several Cloudflare accounts, wrong one used | `npx wrangler whoami`, then set `CLOUDFLARE_ACCOUNT_ID`. |
| App says the link/key is invalid | Use the full `?k=` link from `.secrets.env`; key is case-sensitive. A parent can re-share it from grown-up mode. |
| Forgot the PIN | It's in `.secrets.env` unless it was changed in the app. If changed and forgotten: back up, then ask before resetting (a reset means writing a new `pin_hash` into `settings`; see `scripts/seed.mjs` for the format). |
| PIN locked out | Too many wrong tries locks it for a while; wait and retry. |
| Chores roll over at the wrong hour | Set `TZ` in `functions/_lib/time.js` and redeploy. |
| `/api/summary` returns 404/401 | `DASHBOARD_READ_KEY` not set, or wrong bearer key; redeploy after setting secrets. |
| Free-plan "limit exceeded" errors | Resets at 00:00 UTC; a normal family won't get near it. |

Local trial without Cloudflare: `npm run db:local && npm run dev`, then open
`http://127.0.0.1:8788/?k=<FAMILY_KEY>` (writes a local `.secrets.env`; delete it before the real deploy if
you want fresh credentials).
