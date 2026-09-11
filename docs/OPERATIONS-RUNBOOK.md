# Operations Runbook — vaspar-pfd (production)

> **Why this file exists.** On 2026-09-11 a session spent roughly half its effort
> rediscovering things that were already true and already written down somewhere
> else: how to deploy, how to run a query against the containerised Postgres,
> and where the backups live. None of that was hard — it was just *not in one
> place*. Everything below is the operational knowledge needed to work on the
> running production instance, written so a session starting cold can act
> without guessing. If you learn something operational the hard way, add it here.

---

## 0. The other context docs, and how much to trust them

This runbook covers **operations**. It deliberately does not restate intent or
history. The companions, in reading order:

| doc | covers | trust |
|---|---|---|
| `CLAUDE.md` | operating model, invariants, sprint history, prod branch | current |
| **this file** | how the running system is operated | current |
| `ORCHESTRATOR_CONTEXT.md` (repo root, **gitignored**, 617 lines) | the build roadmap: north star, explicit non-goals, stub policy, per-sprint phase plans | **intent yes, status NO** |
| `docs/changes/CHANGES-YYYY-MM-DD.md` | why a thing is the way it is | current, most reliable |
| `docs/ARCHITECTURE.md` | arc42 architecture view | current as of 2026-06-14 |

Two warnings:

- **`ORCHESTRATOR_CONTEXT.md`'s status table is badly stale** (last touched
  2026-05-31; it shows Sprint 1 "in flight" when Sprint 6.1 has shipped), and the
  plan diverged from what was actually built — planned Sprint 5 was Razorpay
  billing and SaaS infra, actual Sprint 5.x was tax fidelity, and Razorpay never
  happened. Read it for *why*, and for the useful non-goals it records (no broker
  integration, no native mobile app, India-only, free public APIs only). It has
  **zero** operational content, so it does not overlap this file.
- **`~/Desktop/personal-finance-dashboard/tasks/SESSION-RESUME.md` is obsolete and
  misleading.** Last updated 2026-06-09, it states v1 runs on `:9999` and pfd-saas
  on `:3001`. That is now inverted: v1 is sunset and `:9999` is `vaspar-pfd`
  production. Do not start from it.
- `context/context.md` is a ~400-byte auto-generated compaction artifact, not a
  context doc.

---

## 1. What is actually running, and where

Three distinct things. Do not conflate them.

| Thing | Where | Role |
|---|---|---|
| **V1** | `~/Desktop/personal-finance-dashboard` (SQLite) | **SUNSET.** Reference data only. No new work. LaunchAgents stopped. |
| **pfd-saas (dev)** | this repo, `npm run dev` → **host** Postgres on `:5432`, DB `pfd_saas` | Build and validate locally. **No scheduler, never auto-sends Telegram.** |
| **vaspar-pfd (prod)** | Docker container, `:9999`, volume `vaspar-pfd-data` | **Production. Runs forever.** Touch only when deliberately shipping. |

### What is inside the prod container

One container runs *four* things, which is why it can appear healthy while a
part of it is broken:

1. **Postgres 17**, bound to `127.0.0.1:5432` **inside** the container.
   `docker ps` shows `5432/tcp` but it is **not published** — you cannot reach it
   from the host. All DB access goes through `docker exec`.
2. **Next.js standalone server** on `0.0.0.0:3000`, published as host `:9999`.
3. **Cron ticker** — POSTs `/api/cron/tick` **every 60 s**.
4. **Telegram assistant ticker** — POSTs `/api/telegram/tick` **every 5 s**.

Both tickers log a line at startup; if you do not see these, a scheduler is dead:

```
[scheduler] app is up — ticking /api/cron/tick every 60s
[telegram] app is up — ticking /api/telegram/tick every 5s
```

### Secrets: you never pass them on the command line

`docker-entrypoint.sh` generates and persists them under `/data/.secrets`, then
re-exports them on every start. Redeploying needs **no** `-e` secrets.

| file | used for |
|---|---|
| `/data/.secrets/postgres_password` | the DB password — **read this to run psql** |
| `/data/.secrets/auth_secret` | Auth.js |
| `/data/.secrets/cron_secret` | bearer token for `/api/cron/tick` + `/api/telegram/tick` |
| `/data/.secrets/telegram_bot_token` | the bot |
| `/data/.secrets/openai_api_key` | analyst LLM calls |
| `/data/.secrets/app_owner` | owner display name |

---

## 2. Running queries against the prod database

This caused the most friction. The facts that matter:

- The DB is **inside** the container. Port 5432 is not published to the host.
- The role and database are both **`pfd_saas`** — set by `PG_USER` / `PG_DB` in
  `docker-entrypoint.sh`. **Not** `postgres`, **not** `pfd`. Guessing wrong gives
  `FATAL: password authentication failed` or `role does not exist`.
- The password must be read from the secrets file at call time.

### The canonical command

```bash
docker exec vaspar-pfd sh -lc \
  'PGPASSWORD=$(cat /data/.secrets/postgres_password) \
   psql -h 127.0.0.1 -U pfd_saas -d pfd_saas -c "SELECT 1;"'
```

### ALWAYS use a file for anything non-trivial

Nested shell quoting is the single biggest time sink here. A `docker exec sh -lc
'...'` wrapper plus SQL string literals means you are three quoting levels deep,
and it fails in ways that look like something else:

- `''failed''` inside single quotes **concatenates to bare `failed`**, so psql
  parses it as a column name: `ERROR: column "failed" does not exist`.
- Clever workarounds (writing `Q` and `sed`-ing it back to `'`) mangle unrelated
  text — `.s.PGSQL.5432` became `.s.PGS'L.5432`.
- A long one-liner **wraps when pasted into a terminal**, splitting `-U` from its
  argument: `psql: option requires an argument: U`.

Do this instead — it is immune to all three:

```bash
cat > /tmp/q.sql <<'SQL'
SELECT id, status FROM telegram_outbox WHERE status <> 'sent';
SQL
docker cp /tmp/q.sql vaspar-pfd:/tmp/q.sql
docker exec vaspar-pfd sh -lc \
  'PGPASSWORD=$(cat /data/.secrets/postgres_password) \
   psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U pfd_saas -d pfd_saas -f /tmp/q.sql'
```

Use `-At -F"|"` when you want machine-readable output to pipe into a script.
Use `-x` for wide rows. Always `-v ON_ERROR_STOP=1` for anything that writes.

### Writing to prod: wrap in a rolled-back transaction first

Write the script ending in `ROLLBACK;`, run it, read the `--- AFTER ---` block,
*then* flip to `COMMIT;`. Guard every `UPDATE` on the **old** value
(`WHERE id = 110 AND status = 'pending'`) so a re-run is a no-op and cannot
double-apply.

### Schema gotchas that produce confusing errors

- **`sips.next_execution_date` is `text`, not `date`.** `… < CURRENT_DATE` gives
  `operator does not exist: text < date`. Compare against
  `to_char(CURRENT_DATE,'YYYY-MM-DD')`. ISO strings sort correctly, which is why
  the app's own `lt()` comparison works.
- **Timestamps are `timestamp without time zone`**, written by Postgres `NOW()`.
  Comparing them against a JS `Date` (serialised as UTC) silently fails. Let the
  DB do the comparison — this is why `cron/tick` uses `sql\`NOW()\``. Migrating
  ~80 columns to `timestamptz` is known, deferred debt.
- **Column names drift from what you assume.** `telegram_outbox` has no
  `attempts` column; `telegram_inbox` uses `received_at`, not `created_at`. A
  `psql` statement that errors mid-script can leave you reading the *next*
  statement's empty output as "the table is empty" — which is exactly how the
  stuck outbox row was missed on the first pass. Run `\d <table>` first.

### Finding a value when you do not know where it lives

Do not guess tables. Sweep every column:

```sql
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_name = c.table_name AND t.table_schema = c.table_schema
           WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
             AND c.data_type IN ('text','character varying','bigint','numeric')
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %I WHERE %I::text LIKE %L',
                     r.table_name, r.column_name, '%NEEDLE%') INTO n;
      IF n > 0 THEN RAISE NOTICE 'HIT: %.% -> % row(s)', r.table_name, r.column_name, n; END IF;
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
END $$;
```

This found the stuck Telegram row in one shot after two hand-written queries had
produced misleading results.

---

## 3. Deploying to production

### Use the script. Never hand-roll docker commands.

```bash
scripts/deploy-prod.sh
```

That is the whole procedure. CLAUDE.md previously documented a manual
`docker build && docker rm -f && docker run` sequence, and following it is what
made the 2026-09-11 deploy painful. The script does **five** things the manual
sequence silently skips:

1. **Hard clean-tree gate.** Refuses if `git status --porcelain` is non-empty.
   This exists because of the **2026-06-21 incident**: an *untracked* migration
   (`0043_form_16a_uploads.sql`) sat in the working tree, `docker build` copied
   it in (`.dockerignore` does **not** exclude `drizzle/`), it was applied to the
   prod DB, and a later regenerate of the same migration collided on prod with
   `relation already exists`. Prod images come from committed code only.
2. Backs up the prod DB first (`scripts/backup-vaspar-pfd.mjs` → `~/pfd-backups/`).
3. Stamps the image `--label git.sha=… --label git.branch=…`.
4. Passes **`-e APP_OWNER=Bharath`** — trivially forgotten by hand.
5. Waits on `/api/health` and fails loudly if it never goes green.

`scripts/deploy.sh` is a **different** script: the generic self-host deploy
(container `pfd-saas`, port 3000, volume `pfd_saas_data`) for testers following
README-DOCKER.md. It will not touch vaspar-pfd.

### Which branch? `feat/analyst-agent` — and there are THREE lineages

| branch | in `main`? | role |
|---|---|---|
| `feat/telegram-assistant` | ✅ merged | two-way bot; reaches prod via `main` |
| `feat/tax-engine-refactor` | ✅ merged | folded in |
| `feat/analyst-agent` | ❌ never, by design | **the prod branch** |
| `feat/desktop-analyst` | ❌ no | Electron + PGlite `.dmg`. **Diverged** from the prod branch |
| `feat/desktop-app`, `feat/recurring-deposits` | ❌ no | unmerged |

The analyst (Artha) exists **only** on `feat/analyst-agent` — 127 files across
`lib/agent/**`, `api/agent/**`, `investments/analyst/**`, plus 8 `agent_*` cron
job types. `main` has **zero** of them, deliberately, because pushing `main`
builds the public GHCR image and the trading agent must not ship to self-hosters.

Consequences:

- A **core (non-analyst) fix must land on `main` AND be merged into
  `feat/analyst-agent`**, or the next prod rebuild silently drops it.
  Flow: commit to `main` → `git merge main` into `feat/analyst-agent` → deploy.
- **Never build prod from `feat/desktop-analyst`** (usually the checked-out
  branch). It is a separate lineage, not a superset, and does not receive core
  fixes automatically. Building prod from `main` would delete Artha and leave 16
  orphaned `agent_*` rows in `scheduled_jobs` throwing
  `Unknown job type` on every tick.

### Deploying from a git worktree (the usual case)

The clean-tree gate means you normally cannot deploy from `~/Desktop/pfd-saas`.
`deploy-prod.sh` resolves `REPO_ROOT` from its own location, so a worktree works:

```bash
git worktree add /tmp/wt-prod feat/analyst-agent
cd /tmp/wt-prod
# …commit the fix here…
scripts/deploy-prod.sh
```

### Verify a deploy actually shipped what you think

```bash
# which commit is running?
docker inspect vaspar-pfd --format '{{index .Config.Labels "git.branch"}} @ {{index .Config.Labels "git.sha"}}'

# is a specific fix compiled into the bundle?
docker exec vaspar-pfd sh -lc 'grep -rqo "portal.amfiindia.com" /app/.next/server/chunks/ && echo LIVE || echo MISSING'

# did migrations run cleanly?
docker logs vaspar-pfd 2>&1 | grep -iE 'migrat|error'
```

Grep for a **string literal you added**, not a minified identifier. And grep for a
string that actually survives minification as one piece — `"refusing AMFI"`
returned MISSING purely because the source concatenates it across two literals.

### Checking whether a fix is on a branch

Use `git grep`, not `git show | grep`:

```bash
git grep -c 'cols\[cols\.length - 2\]' feat/analyst-agent -- src/lib/services/amfi.ts
```

`git show <branch>:<path> | grep` inside a shell loop returned **false zero
counts** on 2026-09-11 and nearly triggered a false alarm that the fixes had been
lost from `main`.

---

## 4. Backups — three layers already exist. Do not create ad-hoc dumps.

| layer | when | where | retention |
|---|---|---|---|
| **Entrypoint pre-migration dump** | **every container start**, before migrations | `/data/backups/pre-migrate-YYYYMMDD-HHMMSS.dump` (in the volume) | last **7**, auto-pruned |
| **Deploy dump** | every `scripts/deploy-prod.sh` run | `~/pfd-backups/` via `scripts/backup-vaspar-pfd.mjs` (also tars `uploads`) | pruned by that script |
| **Monthly LaunchAgent** | 1st of the month, 03:00 | `~/pfd-backups/vaspar-pfd-db-backup-DDMMYYYY.dump` | manual |

LaunchAgent: `~/Library/LaunchAgents/com.bharath.vaspar-pfd-backup.plist`,
log at `~/Library/Logs/pfd/vaspar-pfd-backup.log`.

**Before a risky write, point at the most recent existing dump rather than making
another.** Any redeploy produces a fresh one automatically. Ad-hoc dumps also do
not match the `pre-migrate-*` prune glob, so the entrypoint never cleans them up,
and one created via `docker exec` is root-owned while the entrypoint's are
`postgres`-owned.

List them:

```bash
docker exec vaspar-pfd sh -lc 'ls -lt /data/backups/*.dump | head'
ls -lt ~/pfd-backups/*.dump | head
```

Restore: `scripts/pfd-restore.sh` (or `pg_restore` the `.dump`). Full procedure in
`docs/backup-restore.md`. Separately, `docs/portability.md` covers the in-app
Settings JSON export/import across all 72 user-scoped tables.

---

## 5. Reading logs without being misled

`docker logs` on vaspar-pfd is **cumulative across restarts** (the container is
restarted, not recreated, e.g. when the watchdog bounces Docker Desktop —
`RestartCount` stays 0). The app logs **only on error**, so a healthy instance
writes nothing for weeks.

Both facts together produce a specific trap: the tail of `docker logs` is whatever
last went wrong, however long ago, and it **reads as current**. On 2026-09-11 the
final log entry was `2026-08-20T04:03:37` — 22 days stale — and the blocked-bot
spam at the tail looked like a live incident.

Always bound the window and show timestamps:

```bash
docker logs --timestamps vaspar-pfd 2>&1 | tail -3   # when did logging actually stop?
docker logs --since 2m vaspar-pfd 2>&1 | wc -l        # is anything happening NOW?
docker logs --since 30s vaspar-pfd 2>&1 | grep -c 'bot was blocked'
```

**Silence is not health.** Twenty-two days of zero output coincided with the SIP
job skipping every fund on every run. That is precisely why `cron/tick` now writes
`NOTHING EXECUTED — …` into both the log and `scheduled_jobs.last_run_error`.

---

## 6. The cron system

`scheduled_jobs` is one row per **(user, job_type)**. Two users (demo + personal)
× 11 job types = 22 rows, so **seeing two of each `agent_*` job is correct, not a
duplicate bug.** `ensureDefaultJobsForAllUsers()` self-heals missing rows on every
tick, which is how seeded accounts that skipped onboarding still get jobs.

Inspect:

```sql
SELECT NOW() AS db_now, job_type, next_run_at, (next_run_at <= NOW()) AS is_due,
       run_count, last_run_status, last_run_error
FROM scheduled_jobs ORDER BY job_type;
```

**A restart does not make a 24 h job run.** `sip_auto_execute` advances
`next_run_at` by 24 h, so after a deploy it waits until its normal slot. This is
not a failure — check `is_due` before concluding anything. Cross-check with a
5-minute job like `alerts_check` to confirm the ticker itself is alive.

Several jobs are **anchored to an IST wall-clock time** rather than `NOW()+24h`
(premarket brief 07:30, morning picks 07:35, daily run 09:20, self-tune 16:00,
snapshot 16:10, EOD review 16:30) — see the `NEXT_*_IST` SQL in
`src/app/api/cron/tick/route.ts`.

### Triggering work without waiting

Best: use the **UI**. `/investments/sips` shows an **"Auto-execute all"** button
whenever SIPs are overdue; it calls the same `runSipAutoExecute` as the cron, for
the logged-in user.

Otherwise hit the tick endpoint inside the container (dispatches only jobs that
are genuinely due):

```bash
docker exec vaspar-pfd sh -lc \
  'wget -qO- --header="Authorization: Bearer $(cat /data/.secrets/cron_secret)" \
   --post-data="" http://127.0.0.1:3000/api/telegram/tick'
```

Last resort: set `next_run_at = NOW()` for the specific job. Safe and reversible
— the job rewrites its own `next_run_at` after running.

---

## 7. Known operational hazards

- **Container DNS dies roughly biweekly.** Docker Desktop's VM wedges and every
  outbound `fetch` fails with `ENOTFOUND` / `EAI_AGAIN`. The watchdog
  (`~/pfd-watchdog/watchdog.sh`, LaunchAgent `com.bharath.vaspar-pfd-watchdog`,
  log `~/pfd-watchdog/watchdog.log`) detects it and restarts Docker Desktop —
  bouncing the `kgi` stack too. It was installed 2026-08-15 and has fired
  repeatedly since (four times on 2026-09-08 alone). **This is not cosmetic**: the
  August DNS outage is what caused stale NAVs to be written as real SIP purchase
  prices, because the AMFI cache kept serving frozen data with no age attached.
- **Telegram: a permanent send failure used to retry forever.** `drainOutbox`
  leaves a failed row `pending`, which is right for a crash but wrong for
  `403 bot was blocked by the user`. One such row (id 110, a "this chat isn't
  linked" notice to an unpaired stranger who blocked the bot on 2026-08-01)
  produced ~46,785 failed API calls over six days and resumed on every container
  start. Cleared by hand on 2026-09-11 (`status='failed'`). **The code fix —
  classifying permanent vs transient errors — is still open.** `drainOutbox`
  takes the 20 lowest-id pending rows per tick, so ~20 accumulated permanent
  failures would starve the queue and silence real alerts.
  Diagnose with: `SELECT id, chat_id, status, error FROM telegram_outbox WHERE status <> 'sent';`
- **Anyone can message the bot.** A bot token is open by nature; a stranger
  `/start`ed it on 2026-08-01. The assistant correctly refuses unpaired chats.
- **Migration journal is deliberately out of step.** Several migrations (0026–0032)
  were applied via `psql -v ON_ERROR_STOP=1 -f` with a manual
  `INSERT INTO drizzle.__drizzle_migrations`. **Do not try to repair the migrator
  state** — a previous attempt made it worse. Keep using the documented pattern.
  `relation "__drizzle_migrations" already exists, skipping` on boot is normal.
- **`mutual_funds.units` is NOT derivable from `investment_transactions`.** Funds
  carried over from the v1 import hold large opening balances with no transaction
  rows (id 4 = 2766.79 units, id 8 = 433.77). Any holdings correction must apply
  a **delta**; `SUM(quantity)` would destroy most of the position. `expected_xirr`
  is computed from transaction flows only and is blank/unreliable for the same
  reason.

---

## 8. What the agent can and cannot do here

Recorded so a future session stops burning turns rediscovering it.

**Allowed:** `docker build`, `docker cp`, `docker logs`, `docker exec … psql`
(including `SELECT`), reading files, git operations in a worktree.

**Refused by the permission layer:** `docker rm -f` / `docker stop` on the prod
container, `docker run`, and `scripts/deploy-prod.sh` itself — i.e. **anything
that tears down or recreates production.**

**Prod DB writes** (`UPDATE`/`DELETE`) are refused by default but **do go through
after the user explicitly approves in conversation.** Container teardown stays
blocked regardless.

So the working pattern is: build the image, verify the fix is in it, prepare and
**dry-run** any SQL, then hand over the exact command prefixed with `!`. Keep
handed-over commands **short** — long ones wrap when pasted and break in
confusing ways (`psql: option requires an argument: U`). Stage a `.sql` file with
`docker cp` and hand over a one-liner that runs `psql -f`.
