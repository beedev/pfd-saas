# pfd-saas — Security & Architecture Audit

**Date:** 2026-06-10
**Scope:** Full repo at commit `4834c42` (local main). Read-only — no code changed.
**Method:** 4 parallel specialist reviews (auth/access-control, injection/data-exposure, infra/dependencies, architecture conformance) + manual verification of every CRITICAL/HIGH claim against source. Coverage: 186 API route files / 323 handlers, 80 schema tables, 38 migrations, all upload/download paths, all raw SQL sites, Docker/install pipeline, `npm audit`.

**Estimate scale:** 1d = 8h focused dev time, including the saas smoke gates (`smoke-test-tax`, `smoke-portability`, `smoke-backup`) per commit.

---

## Executive summary

The multi-tenant core is genuinely strong: **all 323 handlers gate on `auth()` or an explicit secret, every tenant query is userId-scoped, zero IDOR found, no exploitable SQL injection, no committed secrets**. The real risk is concentrated in the **self-host convenience features that ship enabled-by-default in the production Docker image** — together they amount to unauthenticated account takeover for anyone who can reach the port. Three config-default flips (~6h) close all of it.

| Bucket | Critical | High | Medium | Low | Est. total |
|---|---|---|---|---|---|
| Security | 3 | 5 | 7 | 8 | ~50h |
| Architecture | — | 2 | 6 | 4 | ~28h |
| **Total** | **3** | **7** | **13** | **12** | **~78h (≈10 dev-days)** |

---

## SECURITY FINDINGS

> **Accepted risk (owner decision, 2026-06-10):** S1 (account switcher), S2 (magic-link UI mode), and S3 (magic-link log) are **intentional test-mode defaults** — kept for friction-free local usage. Accepted as-is while the deployment surface is localhost/trusted-LAN test usage only.
> **Re-open triggers** (any one of these flips S1–S3 back to must-fix before proceeding):
> 1. Binding/exposing the container beyond localhost (reverse proxy, cloud VM, port-forward).
> 2. Promoting the GHCR `:latest` image for anyone other than yourself — the published image carries these defaults, so any third-party self-hoster inherits them.
> 3. Onboarding a second real (non-demo) user.
>
> Cheapest future-proofing when the time comes (~1h, not now): make the entrypoint defaults conditional on a single `SELF_HOST_TEST_MODE=true` flag so production posture is one env var, not three.

### Critical

**S1 — Unauthenticated account takeover via account switcher (default ON in prod image)**
`src/app/api/auth/switch-account/route.ts` + `docker-entrypoint.sh:198`
The route is in `PUBLIC_PREFIXES` (`/api/auth/`), requires no credentials, and mints a valid `authjs.session-token` cookie for the hard-coded `personal` user (`src/lib/dev/account-switcher.ts:26`). The entrypoint defaults `DEMO_PERSONAL_SWITCH=${DEMO_PERSONAL_SWITCH:-true}` with `NODE_ENV=production`, and `install.sh` publishes the port on all interfaces. Anyone who can reach :3001 owns the owner's entire financial dataset with one POST.
**Fix:** default flag to `false`; additionally hard-gate the route on a `SELF_HOST_MODE` flag so a leaked env var can't re-enable it in SaaS builds; set `secure: true` + `__Secure-` cookie prefix on the hand-rolled cookie (currently missing).
**Est: 2.5h**

**S2 — Magic-link disclosure to unauthenticated callers (insecure default)**
`src/app/api/auth/pending-link/route.ts` + `src/auth.ts:161` + `docker-entrypoint.sh:174`
Default mode is `ui` (`MAGIC_LINK_DISPLAY ?? 'ui'` — fail-open). Every sign-in's live magic link is cached and served by public `GET /api/auth/pending-link?email=<addr>`. Attacker triggers a sign-in for a victim email (unauthenticated), then polls this endpoint → working login URL → full takeover of any account. Only defenses: 800ms per-IP throttle keyed on spoofable `X-Forwarded-For`, 5-min TTL. The route's own comment concedes "Not safe for multi-tenant SaaS."
**Fix:** default to `email` (fail-secure); only register the cache/route when an explicit self-host flag is set; don't trust `X-Forwarded-For` for throttling.
**Est: 3h**

**S3 — Magic-link tokens + user emails persisted plaintext to disk**
`src/auth.ts:195–208` → `tmp/magic-links.log`
`fs.appendFileSync(STUB_LOG, JSON.stringify({ ts, identifier, url, ... }))` runs in every non-`email` mode ("always, for debuggability"). The live file already contains real sign-in URLs for real emails. Any filesystem/container read access ⇒ replay unconsumed links + harvest the user list.
**Fix:** never persist the URL; dev-stdout only, gated on non-production; delete the existing log.
**Est: 0.5h**

### High

**S4 — Live secrets in `.env.local` on disk; rotate now**
`.env.local` (untracked — confirmed never committed; `.dockerignore` excludes it) holds live values: `AUTH_SECRET` (forgeable sessions = full takeover if leaked), Gmail SMTP app password, Telegram bot token, `CRON_SECRET`, OpenAI API key. These values were also read during this audit's tooling, so treat them as exposed.
**Fix:** rotate all five; keep runtime secrets in the existing `/data/.secrets` convention.
**Est: 2h**

**S5 — `next@16.1.1` known CVEs incl. middleware/proxy bypass (fix: 16.2.9)**
The app's auth perimeter *is* `proxy.ts` (Next middleware) — the middleware-bypass advisories (CVSS 8.1/7.5) directly undermine it; also SSRF-via-WebSocket (8.6), request smuggling, Server Actions CSRF.
**Fix:** bump to ≥16.2.9, rebuild, verify proxy gating + smoke suite.
**Est: 2h**

**S6 — `drizzle-orm@0.45.1` SQL injection via identifiers (GHSA-gpj5-g38j-94v9, fix: 0.45.2)**
Patch-level bump.
**Est: 0.5h**

**S7 — `xlsx@0.18.5` prototype pollution (CVE-2023-30533) + ReDoS, parsing untrusted uploads, no npm fix**
`src/lib/yeswanth-parser.ts:423` parses user-uploaded XLSX via `/api/imports/yeswanth-taxcalc`. npm version is frozen-vulnerable; fixes only on SheetJS CDN (≥0.20.2).
**Fix:** swap to `exceljs` or pin the SheetJS CDN tarball; keep the 5MB cap; parse with a timeout. Re-verify TaxCalc field mapping after swap.
**Est: 1d**

**S8 — Stored XSS via tax-document download (`inline` + attacker-controlled MIME)**
`src/app/api/tax/documents/[id]/download/route.ts:29-34` serves uploads with `Content-Type: doc.mimeType` (set verbatim from `file.type` at upload, no allowlist) and `Content-Disposition: inline; filename="${doc.fileName}"` (unsanitized → header injection). Upload an HTML/SVG declaring `text/html` → executes in app origin → session theft. No `nosniff` header anywhere.
**Fix:** force `attachment` + `application/octet-stream` (or allowlist), sanitize filename (strip quotes/CRLF), add `X-Content-Type-Options: nosniff` globally (see S13).
**Est: 2h**

### Medium

**S9 — Tax-document upload family: no size cap, no type allowlist** — `tax/documents`, `tax/form-16/upload`, `tax/form-26as/upload` buffer the whole file via `arrayBuffer()` with no `file.size` check (memory/disk DoS) and accept any type (feeds S8). Other uploaders cap at 5–25MB — mirror that. **Est: 2h**

**S10 — Path traversal via `financialYear`** — `tax/documents/route.ts:46,58`: `category` is sanitized but `financialYear` is joined into the write path raw (`../../../tmp` works). Form-16/26AS validate `^\d{4}-\d{2}$` — this handler is the outlier. **Est: 0.5h**

**S11 — Portability import inserts rows verbatim (no per-column validation)** — `import-validate.ts` checks envelope only; `import-commit.ts:145` spreads `{...rawRow, userId}`. `userId` IS force-overridden (no cross-tenant write) and `importId` is regex-gated, but arbitrary values/extra keys flow into `.values()` — self-scoped integrity corruption. **Fix:** per-table zod (drizzle-zod), strip unknown keys, range-check money. **Est: 1d**

**S12 — No request-body validation layer** — `src/lib/validations/` contains only `gstin.ts`; 138 mutation handlers hand-destructure `request.json()`. Positives verified: no handler takes `userId` from body, no blind `.values(body)` spreads. **Fix:** shared `parseBody(schema, req)` helper + back-fill top ~15 money routes first. **Est: 1d initial**

**S13 — No security headers** — no CSP, `X-Frame-Options`, HSTS, `nosniff`, `Referrer-Policy` anywhere (`next.config.ts` has no `headers()`). Finance app + session cookies ⇒ clickjacking + zero XSS defense-in-depth. **Est: 2h**

**S14 — `nodemailer@7.0.13` SMTP CRLF command injection (fix only in 8.0.4)** — exploitable when `EMAIL_SERVER` configured (the production path). Verify next-auth beta compat on upgrade. **Est: 2h**

**S15 — Postgres `trust` auth inside container** — entrypoint writes `local/host trust` to pg_hba despite generating a strong password. Loopback-only today, but one `listen_addresses` change away from passwordless DB. **Fix:** `scram-sha-256` with the generated password. **Est: 0.5h**

### Low (8 items, ~6.5h total)

| # | Finding | File | Est |
|---|---|---|---|
| S16 | Unencoded path param in AMFI fetch (`api.mfapi.in/mf/${code}`); host hardcoded so impact minimal | `src/lib/services/amfi.ts:186` | 0.5h |
| S17 | String-built DELETE with hand-rolled quote escaping (whitelisted table + session userId — safe today, fragile) | `api/dev/wipe-demo-data/route.ts:44` | 0.5h |
| S18 | Non-constant-time secret compares (cron tick, telegram webhook) + no rate limit on telegram pairing-token lookup | `api/cron/tick/route.ts:49`, `integrations/telegram/webhook/route.ts:52` | 1h |
| S19 | `/api/health` returns raw `err.message` on DB failure (unauthenticated info leak) | `api/health/route.ts` | 0.5h |
| S20 | `.dockerignore` excludes `.env*.local` but not bare `.env` | `.dockerignore` | 0.5h |
| S21 | Dev-chain transitive CVEs (esbuild/minimatch/etc. via drizzle-kit, eslint) | `package.json` | 2h |
| S22 | Build-stage placeholder `AUTH_SECRET` in Dockerfile (not in final image — hygiene only) | `Dockerfile` | 0.5h |
| S23 | Floating `^` ranges on security-critical deps (lockfile mitigates; pin next/next-auth/drizzle exactly) | `package.json` | 0.5h |

### Verified clean (the important negatives)

- **Auth-gate sweep:** 186 route files / 323 handlers — 179 call `auth()`; all 7 exceptions intentionally public with their own gates (health, NextAuth catch-all, cron `CRON_SECRET` bearer fail-closed, telegram webhook secret fail-closed, plus the S1/S2 routes flagged above).
- **Tenant scoping / IDOR:** all 62 `[id]` routes scope by userId; nested resources double-check parent ownership. Zero unscoped id queries.
- **SQL injection:** 16 raw-SQL sites — all parameterized or whitelisted-identifier; only S17 is string-built (escaped + whitelisted).
- **Mass assignment:** zero handlers accept `userId` from body; zero blind `.values(body)` spreads.
- **Path traversal via importId/filenames:** all importers use server-generated, regex-validated ids and session-derived user dirs (except S10's `financialYear`).
- **XSS sinks:** zero `dangerouslySetInnerHTML`, no raw HTML rendering (only vector is S8).
- **SSRF:** all 8 outbound fetches use hardcoded hosts.
- **Secrets in git:** none — `.env.local` untracked and absent from full history; `uploads/`, `tmp/`, `backups/` ignored.
- **Container:** non-root app process, runtime-generated secrets in `/data/.secrets` (600), Postgres loopback-only, `DEV_AUTH_BYPASS` hard-blocked in production builds.

---

## ARCHITECTURE FINDINGS

### High

**A1 — Drizzle meta snapshots missing for migrations 0028–0037**
`drizzle/meta/` stops at `0027_snapshot.json`; journal registers 38 entries and 38 `.sql` files exist (0028+ are hand-written with hand-edited journal). Next `drizzle-kit generate` will diff schema.ts against the 0027 snapshot and re-emit ~10 migrations of duplicate DDL (e.g. re-CREATE `forex_deposits`) — failing or partially applying. This is a loaded gun for the next schema change.
**Fix:** reconstruct the snapshot chain (generate against a temp DB at 0027 state, verify the diff matches the 10 hand-written files, commit snapshots).
**Est: 1d**

**A2 — Tax documents stored with no userId segment + content-addressed dedup + physical unlink**
`tax/documents/route.ts:58` writes to `uploads/finance/<fy>/<category>/<sha256><ext>` — no tenant segment (every other upload route has one). Two users (or two records) with the same file share ONE path; record delete does `fs.unlink` (`[id]/route.ts:39`) → deleting one record destroys the other's file (surviving download 410s). Tenant-isolation defect, not style.
**Fix:** move to `uploads/<userId>/finance/...` (or refcount before unlink) + one-time file migration walking `taxDocuments.filePath`.
**Est: 2h** (pairs with S9/S10 — same handler cluster)

### Medium

**A3 — `business_profile.gstin` globally UNIQUE without user_id** (`schema.ts:716`) — migration 0006 retro-fitted 20 tenant-unsafe uniques but missed this inline `.unique()`. Two tenants with the same GSTIN ⇒ 500 + cross-tenant existence leak. All 32 other uniqueIndexes verified conformant. **Est: 0.5h**

**A4 — `tds_credits` schema/migration drift** — partial unique idempotency index exists in migration 0036 but is only *described in a comment* in schema.ts (fresh-DB-from-schema paths lose re-derivation safety); `payment_date` is `date` in DB vs `text` in schema. **Est: 0.5h**

**A5 — FY-window logic reimplemented ~11×** — canonical `financialYearBounds()` exists in `tax-constants.ts:132`, yet 11 files re-parse FY strings inline (itr1-4 summaries, regime-compare, fy-close, gst invoices, loan-tax, tax-projection, itr-form-selection). With `financialYearStartMonth` now user-configurable, every hardcoded-April copy is a future correctness landmine. **Est: 2h**

**A6 — ITR-3 has no lib module** — `itr{1,2,4}-summary.ts` exist and are reused by itr-export; ITR-3 computes inline in a 251-line route, so filing-pack/export can never reuse it. **Fix:** extract `itr3-summary.ts`. **Est: 2h**

**A7 — Asset-aggregation route quadruplet copy-paste drift** — `goals/[id]/assets`, `savings-assets`, `retirement-assets`, `retirement-corpus-breakdown` (620/409/415/414 lines) each redeclare `MATURING_POLICY_TYPES`, near-twin lookup helpers, and private `compound()`/`yearsBetween()` despite `asset-projection.ts` exporting `projectFutureValue`. Also `regime-compare` carries the 24(b) vintage cutoff inline while `section-24b.ts` exists without it. **Fix:** extract `retirement-shared.ts` + move the 24(b) rule into its lib. **Est: 1d**

**A8 — Upload path ordering split** — form-16 uses `uploads/<userId>/<scope>/` (what migration 0037 documents); 6 other sites use `uploads/<scope>/<userId>/` (what CLAUDE.md documents). The repo disagrees with itself; per-tenant file enumeration needs two globs. **Fix:** standardize on userId-first + path-rewrite script for DB-stored relative paths. **Est: 2h**

### Low

| # | Finding | Est |
|---|---|---|
| A9 | No shared auth-guard helper — 317 inline copies; only 5 check `session.user.id` (rest non-null-assert after checking `session.user` only); message casing drift. Introduce `requireUserId()` | 2h |
| A10 | `providentFund = epfAccounts` back-compat alias is *growing* (new code imports the deprecated name); codemod + delete | 0.5h |
| A11 | Stale comments: table-manifest count prose (72 vs 73), retirement-corpus-breakdown "no retirement_treatment column" (column exists & is used in that file) | 0.5h |
| A12 | PF rate 8.25% triplicated across API, client page, and settings seed — sync enforced only by comment | 0.5h |

**Verified conformant:** user_id FK + CASCADE on all 80 domain tables (4 exceptions are documented global reference data) · all money columns `bigint mode:'number'` paisa (1 documented forex exception) · portability manifest complete: 73 user-scoped tables = 73 entries with load-time asserts · journal/sql files consistent (the snapshot gap A1 is the only break) · error envelope uniform across 1095 responses.

---

## Prioritized remediation plan

| Priority | Items | Effort | Outcome |
|---|---|---|---|
| **Accepted risk** | S1, S2, S3 (test-mode defaults — see note above; re-open on exposure/distribution/second user) | ~6h deferred | — |
| **P0 — this week** | S4 (rotate), S5, S6 | **~4.5h (≈0.5d)** | Secret rotation + the two one-line CVE bumps (middleware-bypass + SQLi) |
| **P1 — next** | S7, S8, S9, S10, A1, A2 | **~22.5h (≈3d)** | Untrusted-input hardening + the two structural landmines (snapshots, shared file paths) |
| **P2 — scheduled** | S11–S15, A3–A8 | **~35.5h (≈4.5d)** | Validation layer, headers, dep upgrades, dedup/layering debt |
| **P3 — opportunistic** | S16–S23, A9–A12 | **~9.5h (≈1d)** | Hygiene + hardening polish |
| **Total** | 35 findings (3 accepted) | **~72h ≈ 9 dev-days remaining** | |

Notes:
- P0 is almost entirely config-default flips + version bumps — disproportionate risk reduction per hour.
- A1 (snapshots) must land **before the next schema change**, or the migration tooling will fight you.
- S8/S9/S10/A2 are all in the same `tax/documents` handler cluster — fix as one ~6h unit.
- Estimates include running the saas smoke gates per commit; they exclude GHCR republish (push is user-gated).
