> ## ⛔ SCRAPPED — 2026-09-11
>
> **The Electron + PGlite desktop app (Artha `.dmg`) was abandoned.** It never
> worked reliably: the always-on scheduler went read-only → poisoned → zombie and
> ran no jobs, which is the failure this document was written to describe.
>
> **This file is kept only as a record of what was tried and why it failed** — so
> nobody re-attempts Electron + PGlite without knowing it already went this way.
> Nothing here describes a system that exists.
>
> **This also reverses the direction recorded in `docs/changes/CHANGES-2026-08-18.md`**,
> which said the desktop app would become the go-forward production and
> `vaspar-pfd` Docker would be shut down. That did not happen.
> **`vaspar-pfd` on `:9999` remains production.** See `docs/OPERATIONS-RUNBOOK.md`.
>
> The branches were archived as pushed tags before deletion:
> `archive/desktop-analyst` and `archive/desktop-app`.

---

# Artha Desktop (Electron + PGlite) — Handoff / Resume Doc

**Last updated:** 2026-08-20 · **Branch:** `feat/desktop-analyst` · **Status: BLOCKED on a decision (fix vs rollback the always-on scheduler).**

Read this first on resume. It captures the whole desktop-app effort, the blocking
problem, everything already shipped, and the exact next step.

---

## TL;DR

We packaged pfd-saas (with the Artha analyst) as an installable **macOS desktop app**
— Electron + **PGlite** (embedded WASM Postgres) replacing the Postgres server, so it
runs with **no Docker**. The app, install flow, timezone handling, and distribution
`.dmg` are all done and working. **BUT** the **always-on scheduler is unreliable**: over
~2 days unattended, PGlite's single connection went **read-only → poisoned → zombie**,
and **no scheduled jobs ran**. That's the open blocker.

**The pending decision (Bharath to steer):**
- **(A) Bounded fix** — make the DB layer auto-recover from a poisoned/read-only
  connection + add a health watchdog + **3–4 day untouched soak test**. If it survives,
  desktop wins; if it dies again, rollback with evidence.
- **(B) Rollback now** — keep the 24/7 scheduler on the proven **Docker/Postgres**
  (`vaspar-pfd`), treat the desktop app as a not-24/7 UI/import tool. Safe, but
  reintroduces the two-DB (no-sync) problem.

Claude's lean: **one bounded fix attempt (A)**, then decide on soak evidence. Docker is
the reliable fallback and is **still running** — no urgency, no risk in taking time.

---

## The blocking bug (why no jobs ran today)

**Symptom:** none of the scheduled tasks ran on 2026-08-20. App process was alive but DB
dead.

**Evidence (from `~/Library/Logs/Artha-{out,err}.log`):**
- ~14,000 `current transaction is aborted, commands ignored until end of transaction block`.
- Root error: **`cannot execute UPDATE in a read-only transaction`**.
- Disk NOT full (80 GB free) → not a disk issue.

**Root cause (architectural):**
1. PGlite is a **single in-process connection**. One aborted transaction poisons **all**
   subsequent queries — no connection pool to contain it (Postgres has one; PGlite doesn't).
2. PGlite flipped **read-only** (exact trigger not yet fully explained — it was NOT a
   crash-loop this time; investigate on the fix route). The first job-write then failed →
   transaction aborted → connection poisoned permanently.
3. A poisoned connection leaves the **process alive**, so the LaunchAgent `KeepAlive`
   (restart-on-crash) never fires. Silent zombie — the worst failure mode for always-on:
   cron ticker can't dispatch jobs, backups fail, `/api/health` returns nothing.

Contrast: the Docker/Postgres prod (`vaspar-pfd`) ran for **weeks** without this.

**Suspected read-only triggers to investigate (fix route):**
- Stale `pgdata/postmaster.pid` after an unclean shutdown (crash / KeepAlive restart /
  power loss) → PGlite mounts read-only on reopen. We ADDED a stale-pid clear on boot
  (see below), but it only helps if the PID's process is dead.
- The self-backup runs `pgDump` on the **same single connection** as the tickers; a
  `pgDump` read-only snapshot colliding with a cron-tick UPDATE can poison it.
- Possibly a WAL/recovery state mounting read-only.

---

## Current state of things (2026-08-20)

- **App:** installed at `/Applications/Artha.app`, running via LaunchAgent
  (`~/Library/LaunchAgents/com.bharath.artha.plist`), **but POISONED (db down, no jobs).**
  A **restart revives it** (clears the connection): `launchctl unload … && launchctl load …`
  the plist, or Cmd-Q + relaunch. Bharath was offered a revive; decide on resume.
- **Distributable `.dmg`:** `electron-dist/Artha-0.1.0-arm64.dmg` (316 MB, built 15:34
  Aug 18). arm64-only, ad-hoc signed, self-contained, no personal data. Ready to share.
- **Docker `vaspar-pfd`:** still running as the stable fallback prod. NOT shut down.
- **Data:** Artha's live DB is PGlite at `~/Library/Application Support/pfd-saas/pgdata`.
  Self-backups (gzipped, re-importable) in `~/Documents/Artha Backups/` (~12h cadence,
  last 14 kept). Prod→Artha import flow exists (see below); Bharath has NOT done the
  full prod import yet.
- **Git:** branch `feat/desktop-analyst`, **all changes uncommitted** (nothing pushed —
  standing no-push rule). Changed: `electron/main.js`, `electron/after-pack.js`,
  `package.json`, `src/db/index.ts`, `src/app/(dashboard)/layout.tsx`,
  `src/lib/services/statement-parsers/chit-dsc.ts`, `drizzle/0032_…sql`; new:
  `README-DESKTOP.md`, `build/Install Artha.command`, `build/icon.*`,
  `docs/changes/CHANGES-2026-08-{17,18}.md`, this doc.

---

## Everything shipped this session (don't redo)

Full detail in `docs/changes/CHANGES-2026-08-17.md` and `-2026-08-18.md`. Summary:

1. **Electron launcher** (`electron/main.js`): spawns Next standalone (PGlite driver);
   in-app cron/telegram/self-backup tickers; window-close keeps server alive +
   Dock-reopen; boot clears a **stale postmaster.pid** (if its PID is dead).
2. **Dock fix:** spawn the Next server via the dockless `Artha Helper` binary
   (`nodeRunner()`), so only ONE Dock icon (was a duplicate "next-server" icon).
3. **PGlite driver** (`src/db/index.ts`): globalThis singleton (avoids duplicate
   in-memory DBs); **`SET TIME ZONE 'UTC'`** at init.
4. **Timezone fix (RESOLVED):** DB session pinned to UTC (storage correct + jobs page
   correct); **`TZ=UTC` NOT set on the process** (that broke server-side JS date
   formatting → screens showed −5:30; removed). Net: DB=UTC, process=host IST.
   - Caveat: a one-time **re-baseline** over-shifted the fixed-schedule analyst jobs
     (self-tune/snapshot/EOD/pre-market/morning-picks/daily-run) by 5:30. **Self-corrects**:
     `cron/tick/route.ts` recomputes their next_run from IST-anchored SQL
     (`NEXT_*_IST`, lines ~64–110, applied ~257–268), so each fires once ~5:30 early
     then snaps back. (Moot once prod is imported.)
5. **`.dmg` packaging** (`electron/after-pack.js`, `package.json` build):
   - Copies `.next/standalone` (with node_modules) into the bundle.
   - **Re-points escaping symlinks** in `.next/node_modules/*` from absolute
     build-machine paths to RELATIVE in-bundle links (else they DANGLE on other Macs →
     server can't load pglite/pdfjs → app won't open). Remove symlinks with
     `unlinkSync`, NOT `fs.rmSync` (rmSync follows a symlink-to-dir and throws).
   - **Ad-hoc signs** the complete bundle (`codesign --force --deep --sign -`) + strict
     verify. `identity:null` otherwise ships NO seal → Gatekeeper rejects on other Macs.
   - `.dmg` window shows Artha.app, Applications, `Install Artha.command`, `README-DESKTOP.md`.
6. **Installer** (`build/Install Artha.command`): POSIX sh (zsh-safe — original bug was
   bash `read -p` under zsh); auto-finds Artha.app on `/Volumes`; **admin-privilege
   `ditto` copy** (Bharath's improvement — `ditto` NOT `cp -R`: cp -R breaks the
   signature seal → app won't launch); quarantine removal; **always-on opt-in**
   (installs the LaunchAgent, defaults No); offer-to-open.
7. **Always-on:** LaunchAgent `RunAtLoad` + `KeepAlive{SuccessfulExit:false}`
   (restart on crash, clean Cmd-Q stays quit). Opt-in via installer.
8. **Privacy scrub:** removed Bharath's real email/name from the bundle; feedback
   `mailto` default → `vaspar@gmail.com`. Verified 0 personal hits.
9. **In-app config:** OpenAI key + Telegram token managed via Settings (files under
   `<userData>`), NOT baked into the `.dmg`. Prod→Artha import at `/import-data`
   (`POST /api/desktop/import-db`). Self-backup at `POST /api/desktop/backup`.

---

## If we go the FIX route (Option A) — the bounded plan

1. **Resilient DB layer:** in `src/db/index.ts` (or a wrapper), detect
   `transaction is aborted` / `read-only transaction` errors and **recover the PGlite
   connection** (ROLLBACK, or close+reopen the globalThis singleton). Goal: a single bad
   transaction must NOT permanently poison the app.
2. **Isolate the self-backup:** don't let `pgDump` hold a read-only snapshot on the
   shared connection while ticks run (serialize, or dump defensively).
3. **Investigate the read-only trigger** (see suspects above) — ideally prevent it.
4. **Health watchdog:** if `/api/health` is `db:down` for N minutes, force-restart the
   app (external LaunchAgent watchdog, like the existing Docker-wedge watchdog pattern in
   memory `project_docker_wedge_watchdog`). Belt-and-suspenders against zombie state.
5. **Soak test:** run untouched 3–4 days at real cadence. Claude does NOT hammer it
   (forced ticks/backups + hard-kills are what polluted earlier signal). Check daily:
   `curl /api/health` + jobs page + log for `transaction is aborted`.
6. **Decide on evidence:** survives → desktop is the go-forward; dies again → rollback to
   Docker/Postgres as the 24/7 scheduler.

---

## Gotchas / lessons (so we don't repeat mistakes)

- **Install with `ditto`, never `cp -R`** — cp -R breaks the code-signature seal → app
  is killed at launch (crash-loop, no output). Verify: `codesign --verify --deep --strict
  /Applications/Artha.app` (check exit code — don't pipe to head, that masks it).
- **Don't hammer PGlite** (forced ticks + `pgDump` backups every few min) — it poisons
  the single connection. Real cadence only during soak.
- **Never run installer scripts against real paths in tests** — a stray
  `cp … /Applications/` overwrote the live Artha binary with a stub once.
- **arm64-only.** Intel Macs can't run it (would need an x64 target).
- **userData dir is `~/Library/Application Support/pfd-saas`** (Electron uses package
  `name`, not productName "Artha"). PGlite at `<userData>/pgdata`.
- Secrets under `<userData>`: `cron-secret`, `auth-secret`, `openai-api-key`,
  `telegram-bot-token`. Logs at `~/Library/Logs/Artha-{out,err}.log`.

---

## First actions on resume

1. Read this doc + the two changelogs.
2. `curl -s http://localhost:<port>/api/health` (port from
   `grep "Local:" ~/Library/Logs/Artha-out.log | tail -1`). If `db:down`/empty → the app
   is poisoned; **revive with a LaunchAgent unload/load** (a restart is not a code change).
3. Confirm Bharath's decision: **fix (A)** or **rollback (B)**.
4. If A → follow "the bounded plan" above. If B → plan the Docker-as-scheduler path
   (and how the desktop app fits as a viewer, incl. the two-DB reality).
