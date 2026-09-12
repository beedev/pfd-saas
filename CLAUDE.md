# CLAUDE.md — pfd-saas

Guidance for Claude Code when working in this repo.

## What this is

`pfd-saas` is the SaaS edition of the personal finance planner originally
built at [beedev/pfd](https://github.com/beedev/pfd). Multi-tenant: every
domain table carries `user_id NOT NULL` and every API route scopes its
queries by the authenticated session's `user.id`. Postgres only — there's
no dual-DB code path. Self-hosters get docker-compose in Sprint 2.

Target market: India-only for v1. INR everywhere. All Indian tax modules
(NPS / EPF / PPF / 80C / GST / ITR) stay; structure leaves room for other
countries later.

## Operating model — dev vs production (READ FIRST)

Decided 2026-06-11. Three distinct things — don't conflate them:

| Thing | Where | Role | Cron + Telegram |
|-------|-------|------|-----------------|
| **V1** | `~/Desktop/personal-finance-dashboard` (SQLite) | **SUNSET** — reference / original data source only, **no new work** | retired (LaunchAgents stopped) |
| **pfd-saas** | this repo · `npm run dev` → host Postgres `:5432` (`pfd_saas` DB; holds `demo` + `personal` accounts) | **Dev** — build + validate features locally | none (on-demand only: `POST /api/cron/tick`) |
| **vaspar-pfd** | Docker container · `:9999` · volume `vaspar-pfd-data:/data` | **Production — runs forever** | **auto** (60 s in-container ticker + real Telegram) |

**vaspar-pfd is production and is left alone.** Single always-on container
(embedded Postgres + Next standalone + in-container scheduler). Touch it **only**
when Bharath decides a prod bug needs fixing or a specific change is wanted —
otherwise never redeploy it. Data lives in the `vaspar-pfd-data` volume; secrets
(postgres password, `AUTH_SECRET`, `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`) are
persisted under `/data/.secrets` and **auto-loaded by `docker-entrypoint.sh`** —
no `-e` secrets needed on redeploy. Monthly DB backup →
`~/pfd-backups/vaspar-pfd-db-backup-DDMMYYYY.dump` via the
`com.bharath.vaspar-pfd-backup` LaunchAgent.

Redeploy vaspar-pfd (**only when intentionally shipping a prod change**) — use
the script, never hand-rolled docker commands:
```bash
scripts/deploy-prod.sh        # run from a CLEAN checkout of the prod branch
```
`scripts/deploy-prod.sh` is the only sanctioned prod deploy. It does five
things a manual `docker build && docker rm -f && docker run` silently skips:

1. **Hard clean-tree gate** — refuses to build if `git status --porcelain` is
   non-empty. This exists because of the **2026-06-21 incident**: an *untracked*
   migration (`0043_form_16a_uploads.sql`) sat in the working tree, `docker
   build` copied it in (`.dockerignore` does not exclude `drizzle/`), it was
   applied to the prod DB, and a later regenerate of that same migration
   collided on prod with "relation already exists". Prod images come from
   committed code only.
2. Backs up the prod DB first via `scripts/backup-vaspar-pfd.mjs`.
3. Stamps the image with `--label git.sha=… --label git.branch=…`, so you can
   always ask a running container which commit it is.
4. Passes **`-e APP_OWNER=Bharath`** — easy to forget by hand.
5. Waits on `/api/health` (up to 180s) and fails loudly if it never goes green.

Don't confuse it with **`scripts/deploy.sh`**, which is the *generic self-host*
deploy (container `pfd-saas`, port 3000, volume `pfd_saas_data`) used by testers
following README-DOCKER.md. It is NOT the prod path and will not touch
vaspar-pfd.

**Deploying is the human's job.** Tearing down the prod container is refused by
the permission layer for the agent — `docker rm -f vaspar-pfd`,
`docker run … vaspar-pfd`, and `scripts/deploy-prod.sh` itself are all blocked,
as are writes to the prod DB (`psql … -c "UPDATE …"`). Don't burn turns
retrying or looking for a way around it: build and verify the image, then hand
Bharath the exact command to paste with a leading `!`. Reading prod
(`docker exec … psql … SELECT`), building an image, and `docker cp` are allowed.

**Deploying from a git worktree.** The clean-tree gate means you usually cannot
deploy from `~/Desktop/pfd-saas` (it normally carries in-flight edits). Add a
worktree on the prod branch, commit there, and run the script from inside it —
`deploy-prod.sh` resolves `REPO_ROOT` from its own location, so it builds that
worktree:
```bash
git worktree add /tmp/wt-prod feat/analyst-agent && cd /tmp/wt-prod
# …commit the fix here… then
scripts/deploy-prod.sh
```

**Backups already run on a schedule — do not create ad-hoc dumps.** Three
layers already exist: `docker-entrypoint.sh` takes a `pre-migrate-*.dump` in
`/data/backups` on *every* container start (keeps the last 7),
`deploy-prod.sh` calls `backup-vaspar-pfd.mjs` → `~/pfd-backups/`, and the
`com.bharath.vaspar-pfd-backup` LaunchAgent runs monthly on the 1st at 03:00.
Before a risky write, point at the most recent of those rather than adding
another dump. (Ad-hoc dumps also don't match the `pre-migrate-*` glob, so the
entrypoint never prunes them.)

**⚠️ Which branch is prod built from? `feat/analyst-agent`, NOT `main`.**
This is the deploy gotcha to remember:

| Target | Built from | Has the analyst (Artha)? |
|--------|-----------|--------------------------|
| **Everyone / self-host** (GHCR image, built on `git push` of `main`) | `main` | ❌ no — analyst is never merged to main |
| **vaspar-pfd (Bharath's prod)** | local `docker build` on the `feat/analyst-agent` working tree | ✅ yes |

The analyst code lives ONLY on `feat/analyst-agent` (isolated to `api/agent/**`,
`lib/agent/**`, `investments/analyst/**`) and stays out of `main` on purpose, so
the public image never ships it. Consequence: **a core (non-analyst) fix must be
committed on `feat/analyst-agent` too — not just `main` — or the next prod
rebuild silently drops it**, because prod is built from that branch. Standard
flow for a core fix: commit to `main` → `git merge main` into
`feat/analyst-agent` → rebuild vaspar-pfd. (Example: budget cross-year fix
`9ec488d`, 2026-08-05 — landed on main, merged into analyst, then prod rebuilt.
Same again for the AMFI/SIP fixes, 2026-09-09/11.)

**There are THREE live lineages, not two — check which one you're on.** As of
2026-09-11:

| branch | merged into `main`? | role |
|---|---|---|
| `feat/telegram-assistant` | ✅ yes | two-way bot; now part of `main`, so prod gets it via the merge |
| `feat/tax-engine-refactor` | ✅ yes | folded in |
| `feat/analyst-agent` | ❌ never (by design) | **the prod branch.** Build vaspar-pfd from here |
| `feat/desktop-analyst` | ❌ no | Electron + PGlite desktop app (`.dmg`). **Diverged** from `feat/analyst-agent` — 19 ahead, 5 behind |
| `feat/desktop-app` | ❌ no | earlier desktop attempt |
| `feat/recurring-deposits` | ❌ no | unmerged feature |

`feat/desktop-analyst` is usually the checked-out branch in
`~/Desktop/pfd-saas`, and it is **not** a superset of the prod branch — it is a
separate lineage that does not receive core fixes automatically. Never build
vaspar-pfd from it. Verify before deploying:
```bash
git grep -c '<a string from the fix>' feat/analyst-agent -- <path>
```
Use `git grep <pattern> <branch> -- <path>`, not `git show <branch>:<path> | grep`
inside a shell loop — the latter silently produced wrong zero-counts on
2026-09-11 and nearly triggered a false alarm that the fixes had been lost.

**Telegram + cron run automatically ONLY in vaspar-pfd.** Dev never auto-sends:
`npm run dev` has no scheduler, and any throwaway Docker test container must run
with `-e DISABLE_CRON=true`.

**Do NOT push to remote casually — every push triggers a GHCR image build**, which
Bharath does not want happening on routine commits. Push only when he explicitly
says "push"/"publish" (matches the standing no-push rule). Day-to-day = local
commits on the working branch only; `main` is the rollback baseline.

On-demand Docker image test (validate a build without disturbing prod):
```bash
docker run -d --name pfd-test -p 3001:3000 -e DISABLE_CRON=true \
  -e AUTH_URL=http://localhost:3001 vaspar-pfd:latest
# ...test at :3001, then...
docker rm -f pfd-test
```

## Status

**Sprint 6.1 complete — single-container Docker self-host shipped.**
Prod (`vaspar-pfd`, `:9999`) runs it, plus the analyst agent (Artha).

The **full sprint-by-sprint, phase-by-phase record lives in
`docs/SPRINT-HISTORY.md`** — moved out of this file on 2026-09-12 because it was
852 of 1360 lines and this file loads into every session's context. Day-by-day
detail is in `docs/changes/CHANGES-YYYY-MM-DD.md`. Nothing was deleted.

### What shipped, at headline level

| sprint | theme |
|---|---|
| 1 · 1.5 | Postgres + multi-tenancy + Auth.js magic-link; v1 data import + smoke walk |
| 2 | Productize: onboarding, mobile, PWA, per-tenant cron, synthetic demo seed |
| 3 | India modules: Health Insurance, Income, Vehicles, Subscriptions, Small Savings (EPF split) |
| 3.5 | Goals/Retirement architecture — `cashflow_events` substrate, disbursement models, IA regroup |
| 4 · 4.1 | Tax hardening: regime compare, slabs, Form 26AS recon, advance tax, ITR selector; then ITR-1/2/4 depth parity + presumptive income |
| 5.1–5.4 | Tax-calc fidelity to the Yeswanth reference (HRA, 24(b), 80EEA, surcharge + marginal relief, 80D/80G, CII, post-Jul-24 CG); IT UI refresh; rental history; ITR eligibility disclosure |
| 5.5–5.11 | Contribution-aware retirement projections, EPF/NPS statement importers, MF sub-classification, retirement tax brackets, loan 80C/24(b) flags, forex deposits, corpus breakdown |
| 6.1 | Single-container Docker self-host: standalone build, multi-stage Dockerfile, entrypoint, `/api/health`, magic-link-in-UI, demo data, Demo/Personal switcher |
| — | **Analyst agent (Artha)** — paper trading, news signals, L3 self-tuning. Never merged to `main`; lives on `feat/analyst-agent` only |
| — | **Telegram assistant** — two-way bot, merged to `main` |

Design tenet that drove Sprint 4 and after: **filing follows planning.** The
dashboard already projected what you *will earn*; the tax work makes it project
what you *will keep*.

### Still open (decision-relevant — keep this list current)

**Tax / ITR**
- **Schedule FA (foreign assets) capture.** ITR-2/3 filers with any foreign asset
  must file FA. No table, no UI; the eligibility flag is a stub that always
  returns false.
- **Director-of-company / unlisted-shares flag** and **agricultural income
  capture** — same: typed stubs wired correctly, always false until schema lands.
- **44AE per-vehicle math.** Accepts a manual declared profit; should derive it
  from a vehicle ledger (heavy ₹1k/tonne/month, light ₹7.5k/month).
- **e-filing schema-conformant JSON/XML export.** Current exports are flat JSON
  for human cross-checking. One schema per form per FY — a sprint of its own.
- **Grandfathering for pre-1-Feb-2018 equity LTCG** (sec 112A FMV option) — user
  adjusts `taxableGain` by hand.
- **Pre-Jul-2024 CG election toggle persistence.** The `/tax/ltcg-stcg` checkbox
  is **in-memory only**; needs a `capital_gains.elect_pre_reform_method` column.
- **LTCG/STCG not folded into total liability** — surfaced as a separate
  "taxed separately" chip.
- **234B/234C exact penalty math** — the planner shows the warning band only.
- **Per-year slab-derived marginal rate** — projections use a flat effective-rate
  proxy.
- **ITR-2 per-property 24(b) allocation** — the whole deduction lands on the first
  property; wrong if loans exist on several.

**Platform**
- **`timestamp` → `timestamptz` across ~80 columns.** Known debt; the source of a
  whole class of timezone bugs (see the `NOW()` comparison note in `cron/tick`).
- **Telegram `drainOutbox` retries permanent failures forever.** A 403
  (blocked / chat-not-found) leaves the row `pending`. One such row produced
  ~46,785 failed calls over six days. `drainOutbox` takes the 20 lowest-id pending
  rows per tick, so ~20 of these would starve the queue and silence real alerts.
- **No scheduled MF NAV refresh.** `refresh-navs` is an on-demand route only, so
  stored NAVs go stale between SIP executions.
- **`expected_xirr` is unreliable** where a fund has a v1-import opening balance —
  XIRR is computed from transaction flows only.
- **MF CAS PDF parser** — awaiting a sample. (EPF passbook + NPS SoT importers
  shipped in 5.6.)
- **Cross-asset rebalance projection.** Each asset class grows at its own assumed
  return; a three-bucket equity/debt/cash cascade across the whole portfolio would
  be more honest.

**Abandoned**
- **Electron + PGlite desktop app** (Artha `.dmg`) — scrapped 2026-09-11, never
  worked reliably. Archived at tags `archive/desktop-analyst` /
  `archive/desktop-app`; post-mortem in `docs/DESKTOP-ARTHA-HANDOFF.md`. This
  reversed the 2026-08-18 direction that it would replace Docker — **`vaspar-pfd`
  remains production.**
- **Razorpay billing, tiers, subscriptions, public launch** — planned for the
  original Sprints 5 and 6, never built, not currently planned. Runs as a personal
  instance, not a SaaS.

### Migration journal caveat (still in force)

`drizzle.__drizzle_migrations` is deliberately behind the file count. Migrations
0026–0032 were applied with `psql -v ON_ERROR_STOP=1 -f <sql>` followed by a
manual `INSERT INTO drizzle.__drizzle_migrations(hash, created_at)` with the
SHA-256 of the SQL file. **Do not try to repair the migrator state** — a previous
attempt made it worse. Keep using that pattern for new migrations.
`relation "__drizzle_migrations" already exists, skipping` on boot is normal.

## Key invariants (don't break these)

- **All money in paisa** (integer for small values, `bigint` for anything
  that can hold a sum — see schema.ts; the bigint sweep landed in
  migration 0003). Display layer divides by 100. Never store
  rupees-as-decimal.
- **Every domain table has `user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE`.**
  Enforced by migration 0004. The DB rejects un-stamped inserts.
- **Every query is scoped by `session.user.id`.** SELECT/UPDATE/DELETE
  combine via `and(...)`; INSERT stamps `userId` as the first field of
  `.values({...})`. The pattern reference is `src/app/api/investments/nps/`.
- **Edge middleware does cookie presence only.** Full session validation
  happens in route handlers via `auth()` from `src/auth.ts`. Don't try to
  wire Auth.js into middleware — `MissingAdapter` will silently break it.
- **No personal data in committed files.** Seeds, fixtures, demos must be
  synthetic. Local DB dumps live in `backups/` (gitignored).
- **Stubs are tracked.** Every external integration not yet wired is in
  `STUBS.md`. When you replace one with the real thing, move its entry
  to "Replaced" with the date and commit hash.
- **API integrations stay free:** Yahoo Finance v8 (stocks), AMFI
  NAVAll.txt + mfapi.in (MFs), Yahoo GC=F × USDINR=X (gold). No API
  keys, no rate limits at single-user scale.
- **Upload paths are userId-first:** `uploads/<userId>/<scope>/...`
  (e.g. `uploads/<userId>/form-16/`, `uploads/<userId>/form-26as/`,
  `uploads/<userId>/statement-imports/`). Never scope-first
  (`uploads/<scope>/<userId>/`) — userId-first lets account deletion
  `rm -rf uploads/<userId>` in one shot. Reads always resolve the
  DB-stored path (`path.resolve(process.cwd(), stored)`), so legacy
  scope-first files on disk keep working.
- **Never let market data of unknown age become a transaction price.** Learned
  the hard way in Sept 2026 (see `docs/changes/CHANGES-2026-09-09.md`). Two
  rules fall out of it:
    - **Parse third-party feeds end-anchored, not front-indexed.** AMFI silently
      changed `NAVAll.txt` from 6 columns to 8 by splitting the scheme name into
      `Scheme Name / Plan / Option`. `parseNavAll()` read the NAV from `cols[4]`,
      which became the string `"Direct Plan"`; `parseFloat` returned `NaN` and
      **every line in a 1.5 MB file was dropped** for three weeks. NAV and date
      are now taken as `cols[len-2]` / `cols[len-1]`, which is correct for both
      layouts and survives further columns being inserted in the middle.
      `scripts/check-amfi-nav-feed.mjs` is the canary — it asserts the feed still
      matches that assumption rather than re-implementing the parser.
    - **A cache that can serve stale data must expose its age, and price paths
      must check it.** `AmfiFund` always carried `navDate`; nothing read it.
      `getAllNavs()` returns a stale in-memory copy when the fetch throws, so
      during a container-DNS outage `getBySchemeCode().nav` kept handing back a
      frozen NAV and `sip-auto-execute` wrote it as a real purchase price.
      The AMFI fallback now only prices `nextDue` when `navDate >= nextDue`,
      mirroring the on-or-after rule `getHistoricalNavOn` already used; otherwise
      it **skips and retries**. A missed installment that prices correctly
      tomorrow beats a wrong one written permanently. Historical NAV comes from
      mfapi.in's *dated* history and is the preferred source precisely because
      each point carries its own date.
    - Weekend/holiday due dates correctly take the **next published NAV** (the
      on-or-after search), matching how an AMC processes a non-business-day SIP.
      That behaviour is intentional — don't "fix" it.
- **A cron job that did nothing must not report success.** `cron/tick` only
  marked a job failed if it *threw*, while `runSipAutoExecute` pushes unpriceable
  funds onto a `skipped[]` list and returns normally. Result: 90 consecutive
  `last_run_status = success` rows, an empty `last_run_error`, and 22 days of
  zero log output while every SIP silently skipped. `summariseOutcome()` in
  `src/app/api/cron/tick/route.ts` now folds a job's own `skipped`/`errors`
  payload into `last_run_error` even on success, prefixed `NOTHING EXECUTED —`
  when nothing ran. Any new job returning `{executed, skipped, errors}` gets this
  for free; preserve the shape.
- **`mutual_funds.units` is NOT derivable from `investment_transactions`.** Funds
  carried over from the v1 import have large opening balances with no transaction
  rows behind them (e.g. id 4 = 2766.79 units, id 8 = 433.77). Any correction to
  holdings must apply a **delta**, never `SUM(quantity)` — a "recompute from
  transactions" would destroy most of the position. The same caveat applies to
  XIRR, which is computed from transaction flows only.

## Docs worth reading before you touch anything

- `docs/SPRINT-HISTORY.md` — the full sprint-by-sprint, phase-by-phase build
  record, moved out of this file 2026-09-12. Go here when you need to know *how*
  a feature was built or why a phase did what it did.
- `docs/ARCHITECTURE.md` — arc42 architecture doc (context, building blocks,
  runtime + deployment views, ADRs, risks). Start here for the big picture.
- `docs/changes/CHANGES-YYYY-MM-DD.md` — the daily change log. The most reliable
  record of *why* something is the way it is; grep it before assuming a quirk is
  an accident.
- `docs/backup-restore.md` — `scripts/pfd-backup.sh` / `pfd-restore.sh`, portable
  across hosts and same-major Postgres versions.
- `docs/portability.md` — the Settings export/import over all 72 user-scoped
  tables.
- `docs/DESKTOP-ARTHA-HANDOFF.md` — Electron + PGlite desktop build state.
- `docs/PLAN-telegram-assistant.md` — the two-way bot design.
  Operational note: the bot is reachable by anyone who finds it. A stranger
  `/start`ed it on 2026-08-01, blocked it, and the bot then logged ~46,785
  `Forbidden: bot was blocked by the user` retries over six days. A permanent
  Telegram 403/400 should terminate a send, not retry forever.
- `README-DOCKER.md` (self-host),
  `docs/agent-strategy-plain-english.md` (analyst agent in plain English — on
  `feat/analyst-agent` only, per the analyst-isolation rule; absent on `main`).

## Stack

- Next.js 16, App Router, Turbopack dev
- Postgres 17 via postgres-js + Drizzle ORM
- Auth.js v5 (next-auth@5.0.0-beta) with EmailProvider + DrizzleAdapter,
  database session strategy
- Tailwind 4 + @dxp/ui design system (symlinked from sibling dxp repo)
- Recharts, sonner, pdfjs-dist

## Dev commands

```bash
npm install
npm run dev -- --port 3000     # dev server (port 3000 — see App Registry below)
npm run build                  # production build
npm run lint

npm run db:generate            # generate a Drizzle migration from schema.ts
npm run db:migrate             # apply pending migrations  (see the journal caveat)
npm run db:verify              # sanity-check the DB connection + schema hash
npm run db:studio              # Drizzle Studio, browse the dev DB

npm run smoke:tax              # 20-endpoint tax API smoke test (see Testing below)
```

Two lifecycle hooks fire automatically, which explains otherwise-confusing
output:

- **`predev` → `scripts/db-verify.mjs`.** `npm run dev` verifies the DB first. If
  it complains, your `DATABASE_URL` or schema is out of step — fix that before
  reading anything else as a bug.
- **`prebuild` → `scripts/compute-schema-hash.mjs`.** `npm run build` stamps a
  schema hash; a mismatch at runtime means the build and the DB disagree.

**Dev needs the host Postgres**, not the container: `postgresql://…@localhost:5432/pfd_saas`.
Dev has **no scheduler and never auto-sends Telegram** — trigger jobs by hand with
`POST /api/cron/tick`.

## Testing and smoke tests

There is no unit-test suite. There *are* three real smoke tests — prefer them over
clicking around:

| command / script | covers | notes |
|---|---|---|
| `npm run smoke:tax` | 20 tax + finance API endpoints, asserts 200 (or a documented non-200) | needs the dev server running with `DEV_AUTH_BYPASS=true`; sends `x-dev-as-user: <USER_ID>` per request. Refuses to run when `NODE_ENV=production`. |
| `node scripts/smoke-portability.mjs` | export → wipe → import round-trip over all 72 user-scoped tables | destructive to the target user's data — use a throwaway user |
| `./scripts/smoke-backup.sh` | `pfd-backup.sh` → `pfd-restore.sh` round-trip | container-level |

Run the tax smoke in two terminals:

```bash
# terminal 1
DEV_AUTH_BYPASS=true npm run dev
# terminal 2
npm run smoke:tax
```

`scripts/check-amfi-nav-feed.mjs` is a **canary**, not a test: it asserts the live
AMFI feed still matches what `parseNavAll()` assumes (NAV second-to-last column,
date last). Run it whenever MF numbers look wrong — it is the fastest way to rule
in or out a third-party format change.

## Diagnosing a reported failure

The 2026-09 AMFI incident is the worked example: SIPs silently stopped for three
weeks while cron reported `success` on every run. Work outward from the data, and
**do not trust that a green status means the job did anything.** Full command
reference in `docs/OPERATIONS-RUNBOOK.md`.

1. **Is the thing even running?** `docker ps`, then
   `docker inspect vaspar-pfd --format '{{index .Config.Labels "git.sha"}}'` to see
   *which commit* is live. A fix you merged is not a fix you deployed.
2. **What does the job ledger say?** Query `scheduled_jobs` for `last_run_at`,
   `last_run_status`, `last_run_error` and `(next_run_at <= NOW())`. Remember a
   24 h job is not due just because you restarted, and that `success` historically
   meant only "did not throw" — the `NOTHING EXECUTED —` prefix now marks a run
   that skipped everything.
3. **Did the expected rows appear?** Go to the domain table
   (`investment_transactions`, `cashflow_events`, `alert_history`, …) and check
   dates, not just counts. A wrong *value* is worse than a missing row and will not
   show up as an error anywhere.
4. **Bound the log window.** `docker logs --since 2m` and `--timestamps`. The log is
   cumulative across restarts and the app only logs on error, so the tail is
   whatever last broke — possibly weeks ago. **Silence is not health.**
5. **Suspect the external feed.** Most "the app broke" reports are really AMFI,
   mfapi.in, Yahoo or IBJA changing shape or a DNS wedge. Run
   `node scripts/check-amfi-nav-feed.mjs`, and test DNS from *inside* the container
   (`docker exec vaspar-pfd sh -lc 'nslookup api.mfapi.in'`) — container DNS dies
   roughly biweekly here.
6. **Compare against the source of truth**, never against what the DB already says.
   For NAVs that means mfapi.in's dated history; for tax it means the Yeswanth
   reference sheet.
7. **Check `docs/changes/`** before concluding a quirk is a bug. Several are
   deliberate and documented.

## Key modules — where things live

`src/lib` is the compute layer; keep it pure and pass `userId` in rather than
reaching for the session.

| path | files | what it is |
|---|---|---|
| `src/lib/finance/` | 54 | **All the money math**, pure and testable. Biggest: `cashflow-derivation.ts` (859), `goal-corpus.ts`, `tax-compute.ts`, `deduction-engine.ts`, `form-26as-recon.ts`, `goal-projection.ts`, `chit-calculator.ts`, `capital-gains-tax.ts`. Tax libs each cite the Yeswanth template row they mirror. |
| `src/lib/services/` | 17 | **External API clients** — `amfi.ts` (NAV + mfapi.in history), `yahoo-finance.ts` (stocks, FX, gold), `ibja.ts` (gold), `telegram.ts`, plus `statement-parsers/` for PDF/xlsx import. |
| `src/lib/cron/` | 8 | One module per scheduled job, dispatched from `api/cron/tick`. |
| `src/lib/agent/` | 74 | **Analyst (Artha)** — only on `feat/analyst-agent`, never on `main`. |
| `src/lib/reports/` | 24 | GST / ITR / filing-pack generation. |
| `src/lib/telegram-assistant/` | 10 | Two-way bot: `poll` → `telegram_inbox` → `worker` → `telegram_outbox` → `send`. |
| `src/lib/portability/` | 6 | Settings export/import across all 72 user-scoped tables. |
| `src/lib/api/` | 2 | `auth-guard.ts` (`getSessionUserId`) + `parseBody` — the convention every route uses. |
| `src/db/schema.ts` | — | Single Drizzle schema for every table. |

Route pattern reference: `src/app/api/investments/nps/` — copy its userId scoping.

## Installation paths (three of them)

| audience | how | what they get |
|---|---|---|
| **Self-hosters** | `curl -fsSL https://raw.githubusercontent.com/beedev/pfd-saas/main/install.sh \| bash` — pulls the prebuilt GHCR image | built from **`main`** on push, so **no analyst**. `install.sh` at the repo root. |
| **Self-host from source** | `./scripts/deploy.sh` (container `pfd-saas`, port 3000, volume `pfd_saas_data`) | see `README-DOCKER.md` |
| **Bharath's prod** | `scripts/deploy-prod.sh` (container `vaspar-pfd`, port 9999, volume `vaspar-pfd-data`) | built from **`feat/analyst-agent`**, **with** the analyst |

First run in any container: `initdb` → generate secrets into `/data/.secrets` →
`drizzle-kit migrate` → start Next. No `-e` secrets needed on later runs.

## External APIs integrated

All free, no API keys, no rate limits at single-user scale — except OpenAI, which
is the one paid dependency and analyst-only.

| service | used for | client | notes |
|---|---|---|---|
| **AMFI** `portal.amfiindia.com/spages/NAVAll.txt` | latest MF NAV + ISIN→scheme-code index | `src/lib/services/amfi.ts` | **Format has changed before** (6→8 columns, Sept 2026) and killed every MF feature silently. Parse end-anchored; canary at `scripts/check-amfi-nav-feed.mjs`. Carries only the *latest* NAV — never price a dated transaction from it without checking `navDate`. |
| **mfapi.in** `api.mfapi.in/mf/<code>` | **dated** NAV history | `src/lib/services/amfi.ts` | preferred for anything date-sensitive, because each point carries its own date |
| **Yahoo Finance v8** | stocks, `<CCY>INR=X` FX, `GC=F` gold | `src/lib/services/yahoo-finance.ts` | 5-min quote cache |
| **IBJA** | India gold rates | `src/lib/services/ibja.ts` | |
| **NSE bhavcopy / RSS** | analyst prices + news | `agent/providers/`, `agent/news/` | analyst branch only |
| **Telegram Bot API** | alerts, digests, two-way assistant | `src/lib/services/telegram.ts` | token in `/data/.secrets/telegram_bot_token`. A **permanent** 403 (blocked/chat-not-found) must terminate a send — `drainOutbox` currently retries it forever. |
| **OpenAI** | analyst LLM calls | `agent/**` | key in `/data/.secrets/openai_api_key`; **the only paid dependency** |

Every unwired integration is tracked in `STUBS.md`. When you replace a stub, move
its entry to "Replaced" with the date and commit hash.

## Environment variables

- `DATABASE_URL` — `postgresql://user@host:port/dbname`
- `AUTH_SECRET` — random 32+ bytes (`openssl rand -base64 32`)
- `AUTH_URL` — the host:port the **browser** will use. Auth.js v5 name; the old
  `NEXTAUTH_URL` is not read anywhere. `http://localhost:3000` in dev;
  `deploy-prod.sh` passes `http://localhost:9999`. Without it, post-login
  redirects point at the container's internal bind address and break.
- `EMAIL_FROM` — sender address on outgoing magic-link emails. Defaults to
  `noreply@pfd-saas.local`.
- `EMAIL_SERVER` — SMTP connection string. **Real and working** (Nodemailer;
  Gmail / Resend / Postmark all fine). Required for `MAGIC_LINK_DISPLAY=email`;
  without it that mode silently degrades to `ui`.
- `MAGIC_LINK_DISPLAY` — `ui` (default) | `email` | `both`. Read at boot. See
  "Sign-in flow" above.
- `CRON_SECRET` — bearer token gating `/api/cron/tick`
- `TELEGRAM_BOT_TOKEN` — single bot token. One bot serves every user;
  chat IDs are per-user (stored on `user_preferences.telegram_chat_id`).
  Optional — when unset, sends become console + `tmp/telegram-out.log`
  stubs but pretend-succeed so cron jobs don't infinite-retry.
- `TELEGRAM_BOT_USERNAME` — the bot's `@username` (without the `@`).
  Used to build the pairing deep link
  `https://t.me/<bot-username>?start=<token>`. Required for the UI's
  Connect Telegram flow.
- `TELEGRAM_WEBHOOK_SECRET` — random secret (e.g. `openssl rand -hex 32`)
  that Telegram echoes back on every webhook update via the
  `X-Telegram-Bot-Api-Secret-Token` header. We refuse any inbound update
  whose header doesn't match. Required if you register the webhook.
- `TELEGRAM_CHAT_ID` — **no longer read.** Per-user routing supersedes
  it; safe to remove from `.env.local`.

## Telegram webhook registration (one-time)

After deploying, point Telegram at your webhook:

```bash
./scripts/telegram-set-webhook.sh https://<your-host>/api/integrations/telegram/webhook
```

The script reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` from
env / `.env.local`. Telegram persists the registration — re-run only if
you change hosts or rotate the secret.

## Sign-in flow — three modes, and prod uses none of them

**Email is NOT stubbed** (it was in Sprint 1; real SMTP landed in Sprint 2). The
behaviour is selected by `MAGIC_LINK_DISPLAY`, read at **boot** — restart after
changing it. See `buildEmailProvider()` in `src/auth.ts`.

| `MAGIC_LINK_DISPLAY` | behaviour |
|---|---|
| `ui` (**default**) | no email sent. The link is surfaced in the browser via `/api/auth/pending-link`, and also written to stdout and `tmp/magic-links.log`. In-memory cache, 5-min TTL, single-use. Default for the Docker self-host image. |
| `email` | real SMTP via Nodemailer — needs `EMAIL_SERVER`. The production SaaS path. |
| `both` | surfaces in the UI *and* sends. For demos. |

**`email` silently degrades to `ui` when `EMAIL_SERVER` is unset** — there is
nothing to send to. If you think SMTP is configured and it is not, you get the UI
flow with no error.

**On `vaspar-pfd` (prod), magic-link is not the login path at all.**
`DEMO_PERSONAL_SWITCH=true` replaces `/login` with a two-card Demo/Personal chooser
that mints a session directly (`POST /api/auth/switch-account`). Set it to `false`
to restore magic-link. That switcher is **localhost-single-machine only** — never
expose it beyond that; see the security caveat in `README-DOCKER.md`.

Magic-link flow when it *is* active:

1. `/` → middleware redirects to `/login`.
2. Enter email, submit → `/login/check-email`.
3. In `ui` mode the page polls `/api/auth/pending-link` every 800 ms for up to 10 s
   and shows a "Sign in as you@example.com →" button. In dev you can also take the
   link from the `npm run dev` terminal (`🔑 MAGIC LINK …`) or
   `tmp/magic-links.log` (newline-delimited JSON).
4. Auth.js validates the token, writes a `session` row, redirects to `/`.

`STUBS.md` tracks what genuinely *is* still stubbed — check it there rather than
trusting a heading.

## Importing personal-v1 data into a fresh pfd-saas

Two-step script flow (only relevant for the original owner — synthetic
demo data for everyone else lands in Sprint 2 Phase 6):

```bash
node scripts/import/01-export-v1.mjs                          # SQLite → JSON
node scripts/import/02-import.mjs --owner-email=<your-email>  # JSON → Postgres
```

`01-export-v1.mjs` is read-only against the personal v1 DB. `02-import.mjs`
requires you to have signed in once (so a `user` row exists with that
email); it stamps `user_id` on every imported row.

## What's preserved from the personal v1

- All the math: XIRR, EMI/amortization, prepay simulator, retirement
  bucket SWP, PV of growing annuity, ladder PV, chit-fund cash flows.
- All asset modules: Stocks, MFs, SIPs, Gold, NPS, PF (EPF), Real Estate,
  Insurance, Liabilities, Chit Funds, Fixed Deposits.
- All UI primitives, charts, snapshot machinery, alert framework.
- GST module (Customers, Vendors, Invoices, Purchase Invoices, GSTR-1,
  GSTR-3B).

## What's removed or changed in pfd-saas

- The `transformation_*` weight-loss tables/routes are gone — not a
  finance product.
- Money columns are `bigint` where they hold sums (real estate value,
  chit value, total balance, etc.). Per-unit prices, IDs, counters,
  ages stay `integer`.
- ~~Cron-driven endpoints return 503 with `TODO(sprint-2)`~~ — **no longer true.**
  Per-tenant cron shipped in Sprint 2 Phase 5. `/api/alerts/check`,
  `/api/daily-digest` and `/api/investments/sips/auto-execute` all work and are
  dispatched from `/api/cron/tick`; the SIP one is also reachable from the
  "Auto-execute all" button on `/investments/sips`.

## Don't

- Don't hardcode any user-specific data anywhere.
- Don't bypass auth/userId scoping in any new query.
- Don't add `db.<verb>` calls to library code without threading `userId`
  through (see `src/lib/finance/budget-sync.ts` for the pattern).
- Don't commit `.env*`, `personal-finance.db*`, `pfd_saas.dump`,
  `tmp/`, `backups/`, `uploads/`, or `.claude/`.
- Don't hand-edit the auto-managed App Registry section at the bottom.

## App Registry (auto-managed — do not edit manually)

- **Frontend port**: 3000
- **Start backend**: `./start.sh`
- **Start frontend**: `npm run dev -- --port {port}`

### Rules for Claude Code
- Frontend dev server MUST use port **3000**
- Do NOT pick arbitrary port numbers — use the ports listed above

<!-- end-app-registry -->
