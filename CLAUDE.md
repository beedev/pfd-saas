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

Redeploy vaspar-pfd (**only when intentionally shipping a prod change**):
```bash
docker build -t vaspar-pfd:latest .          # in ~/Desktop/pfd-saas
docker rm -f vaspar-pfd
docker run -d --name vaspar-pfd --restart unless-stopped -p 9999:3000 \
  -v vaspar-pfd-data:/data -e AUTH_URL=http://localhost:9999 -e DEMO_PERSONAL_SWITCH=true \
  vaspar-pfd:latest
```

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

**Sprint 6.1 complete — Docker self-host preview shipped.**

### Sprint 6.1 — Single-container Docker self-host (seven phases)

Goal: produce a single \`docker run\` command that gives a tester a
working pfd-saas instance with zero email/SMTP config. Distribution to
Docker Hub is a manual \`docker push\` step Bharath does after this
sprint lands.

- **Phase 6.1a — Standalone build.** \`output:'standalone'\` in
  next.config.ts emits \`.next/standalone/server.js\`. Added \`.dockerignore\`.
- **Phase 6.1b — Multi-stage Dockerfile.** deps → builder → runner.
  Runner stage is postgres:17-alpine + Node 24 + tini + su-exec +
  openssl + wget. Promoted \`drizzle-kit\` and \`dotenv\` from
  devDependencies to dependencies so migrations can run inside the
  container. Image size: 746MB.
- **Phase 6.1c — docker-entrypoint.sh.** POSIX-sh entrypoint. First
  run: initdb + openssl-generate postgres password + AUTH_SECRET,
  stash under /data/.secrets. Always: start postgres bound to
  127.0.0.1 (no TCP exposure), ensure DB exists, drizzle-kit migrate,
  exec node server.js. Postgres logs redirected to /data/postgres.log
  and \`tail -F\`'d in the background to keep \`docker logs\` complete.
- **Phase 6.1d — /api/health.** Returns 200 + {ok,db,uptimeMs} when
  \`SELECT 1\` succeeds, 503 on failure. No auth. Used by Docker
  HEALTHCHECK directive (30s interval, 30s start-period).
  Path added to \`PUBLIC_PATHS\` in proxy.ts.
- **Phase 6.1.5 — Magic-link-in-UI.** \`MAGIC_LINK_DISPLAY\` env
  selects \`ui\` (default — surface via /api/auth/pending-link),
  \`email\` (real SMTP, identical to pre-6.1.5 production), or
  \`both\`. In-memory \`pendingLinks\` cache with 5-min TTL,
  single-use. New /login/check-email page polls
  /api/auth/pending-link every 800 ms for up to 10 s; shows a
  "Sign in as you@example.com →" button when the link is found.
- **Phase 6.1.6 — Demo data + feedback.** \`POST /api/dev/load-demo-data\`
  (MINIMAL version — salary, 4 deductions, 2 stocks, 1 MF, 1 term
  policy, 1 home loan, all marked \`notes LIKE 'DEMO-SEED:%'\`).
  \`POST /api/dev/wipe-demo-data\` mirrors for cleanup. Empty-state
  CTA on the Net Worth home page; "Wipe demo data" card on Settings.
  Sidebar "Send feedback" link above Sign out, defaults to mailto,
  overridable via \`FEEDBACK_URL\` env (consumed server-side in
  \`(dashboard)/layout.tsx\`, passed as prop to Sidebar).
- **Phase 6.1f — README-DOCKER.md.** Tester-facing install + run
  + backup + restore + upgrade + troubleshoot guide.
- **Phase 6.1g — End-to-end smoke.** Built image, ran with named
  volume, confirmed first-run path (initdb → migrations →
  Next.js Ready), confirmed second-run path (skip initdb, fast
  start), confirmed /api/health 200 and /login 200. Verified
  \`docker stop && docker start\` preserves data.
- **Phase 6.1.9 — Built-in Demo/Personal account switcher.** Docker
  self-host now ships with a two-account model instead of the
  magic-link round-trip. Gated by \`DEMO_PERSONAL_SWITCH=true\`
  (default for the self-host image; production SaaS sets it to
  \`false\` to restore the magic-link path).
    - **9a — Stable IDs + provisioning helper.** Hard-coded UUIDs in
      \`src/lib/dev/account-switcher.ts\` (\`DEMO_USER_ID\`,
      \`PERSONAL_USER_ID\`). \`ensureAccountExists(target)\` lazily
      inserts the user + user_preferences row and, for demo, runs
      the BXDEva seed when the portfolio is empty. The BXDEva seed
      body was extracted to \`src/lib/dev/seed-demo-data.ts\`
      (\`seedDemoDataForUser(userId, name)\`) so the route and the
      switcher share it.
    - **9b — Switch endpoint.** \`POST /api/auth/switch-account?to=…\`
      mints a fresh Auth.js session row + sets the same
      \`authjs.session-token\` cookie NextAuth would. Returns 303 →
      \`/\` for HTML form posts, JSON for fetch callers. AUTH_URL
      is honored so the redirect points back at the public host:port,
      not the internal 0.0.0.0.
    - **9c — Login page.** \`/login\` became a server component that
      dispatches between \`<AccountChooser/>\` (two-card chooser) and
      \`<MagicLinkForm/>\` (extracted verbatim from the old client
      page) based on the env flag. \`export const dynamic =
      'force-dynamic'\` keeps the env read at request time — without
      it Next.js prerenders the page at build, before the entrypoint
      has set the flag.
    - **9d — Sidebar.** Server layout bridges
      \`DEMO_PERSONAL_SWITCH\` + \`session.user.email\` into the
      Sidebar (client) as props. When enabled, a new account row
      above the nav shows \`👤 Demo · Switch to Personal\` (or the
      mirror) and POSTs to /api/auth/switch-account on click.
    - **9e — Entrypoint default.** \`docker-entrypoint.sh\` exports
      \`DEMO_PERSONAL_SWITCH=${DEMO_PERSONAL_SWITCH:-true}\`.
    - **9f — Docs.** README-DOCKER.md rewrote the first-run narrative
      and added a "Security caveat for self-host" section. The
      switcher is single-machine localhost only; multi-user
      deployments must set \`-e DEMO_PERSONAL_SWITCH=false\`.

**Distribution note**: \`docker push pfd-saas:latest\` to Docker Hub
is a manual step. Image tag at smoke time was \`pfd-saas:smoke\`.

### Sprint 5.9 — Loan accounting + 80C principal flag (six phases)

### Sprint 5.9 — Loan accounting + 80C principal flag (six phases)

- **Phase 5.9a — Schema (mig 0031).** `liabilities` gains
  `principal_qualifies_80c boolean DEFAULT false NOT NULL` and
  `interest_qualifies_24b boolean DEFAULT false NOT NULL`. Migration's
  trailing UPDATE auto-flips both to true for every existing
  `HOME_LOAN` row so legacy data behaves correctly. Migration journal
  id 30 via the documented psql + manual INSERT pattern.
- **Phase 5.9b — Loan-tax compute lib + API.**
  `src/lib/finance/loan-tax.ts` walks each loan's amortization schedule
  (forward via `amortizationSchedule()` from `emi.ts`, backward via a
  reverse-walk of the EMI math) to extract the FY-window principal +
  interest splits. New `GET /api/finance/loan-tax-deductions?fy=…`
  returns per-liability rows + aggregate totals.
- **Phase 5.9c — Wired into tax modules.** Regime-compare, ITR-1/2/3/4
  summaries all pull loan deductions in:
  - Loan principal flows into 80C with the ₹1.5L cap enforced at the
    aggregator (sum manual + loan-derived 80C, clamp at cap).
  - Loan interest flows into Section 24(b). For the first
    self-occupied property, the max(user-entered, loan-derived) is
    used through the existing `computeSection24bDeduction` lib so the
    ₹2L cap still applies. For let-out / no-property cases it stacks
    uncapped.
  - Response payloads gain `eightyC: {manual, fromLoans, applied, cap,
    overCap}` and `loanDeductions: {totalInterest, totalPrincipal,
    perLiability}` for UI transparency.
- **Phase 5.9d — Net-worth transparency.** Home dashboard's hero tile
  gains an "₹X assets · ₹Y liabilities" clickable subtitle that
  expands into a top-5-assets + all-liabilities breakdown. Confirms
  net worth math = assets − liabilities (already correct on
  /networth's `netWorthPaisa`).
- **Phase 5.9e — Detail-page toggles.** Loan detail page Loan
  Information card gains two checkboxes for 80C + 24(b) qualification
  plus an inline FY-counted note ("FY 2025-26: ₹X principal · ₹Y
  interest already counted in your tax deductions"). PATCH route
  extended to accept the flags.
- **Phase 5.9f — Verify.** BXDEva's HOME_LOAN (id 38) auto-flipped
  both flags. FY 2025-26: ₹2.33L principal · ₹4.63L interest across
  12 months. 80C: ₹3.02L manual + ₹2.33L loan = ₹5.35L raw, capped
  at ₹1.5L (₹3.85L over). Sec 24(b): ₹4.4L total (self-occupied ₹2L
  + let-out plot ₹2.4L).

### Sprint 5.8 — Retirement tax-aware planning (five phases)

- **Phase 5.8a — Schema (mig 0032).** `user_preferences` gains
  `retirement_tax_brackets jsonb` with a default of `[{0,0%},
  {₹10L,15%}, {₹30L,25%}]`. Stored as JSONB array sorted ascending by
  threshold; threshold is in RUPEES (not paisa — matches user mental
  model of "₹10L slab"). Migration journal id 31.
- **Phase 5.8b — Pure compute lib.**
  `src/lib/finance/retirement-tax.ts` exposes
  `applyRetirementTaxBrackets(grossPaisa, brackets)` returning
  `{taxPaisa, netPaisa, perBracketTax[], effectiveRatePct, warnings}`.
  Validates + normalises malformed brackets (sort, prepend zero
  threshold, drop NaN), returns per-band attribution so the UI tooltip
  can show "₹10L at 0% = 0, ₹20L at 15% = ₹3L, ₹5L at 25% = ₹1.25L".
- **Phase 5.8c — Projection wiring.** Retirement page replaces the
  Sprint 4 Phase 5 flat marginal-rate proxy. Each year's TAXABLE
  income (rental + annuity + NPS pension) now runs through
  bracket-aware tax. Ladder income (LIC endowment) stays TAX_FREE
  under Section 10(10D). `/api/user-preferences` GET + PATCH extended
  to return + write the brackets, with server-side validation
  (length 1-8, strictly ascending, first threshold=0, rates 0-100).
- **Phase 5.8d — Settings editor.** New
  `RetirementTaxBracketsForm` card on `/settings` — table view with
  add/delete row, threshold + rate inputs, "Reset to defaults"
  button, live preview ("0% up to ₹10L, 15% ₹10L-30L, 25% above ₹30L").
- **Phase 5.8e — UI surface.** Retirement page year-by-year table's
  Tax column now bracket-aware. Net income column already existed.
  Footnote spells out the slabs + links to Settings.

### Sprint 5.11 — Retirement corpus breakdown card (three phases)

- **Phase 5.11a — Breakdown API.** New
  `GET /api/finance/retirement-corpus-breakdown` returns
  `{totalCorpusAtRetirementPaisa, retirementYear, byAssetClass: [{
   assetClass, todayPaisa, atRetirementPaisa, growthMultiple,
   components: [{itemName, todayPaisa, atRetirementPaisa, growthRatePct,
   balanceComponentPaisa, contributionComponentPaisa,
   monthlyContributionPaisa}]}]}`. Projects every asset row (holdings,
  MFs, NPS, EPF, small savings, real estate, forex, gold, insurance,
  FDs) using `projectFutureValue()` with rates from
  `getGrowthRates()` — same helper retirement-assets uses, so the
  numbers reconcile.
- **Phase 5.11b — Breakdown card UI.** New
  `RetirementCorpusBreakdownCard` component — collapsed shows
  total + "show breakdown" toggle; expanded shows the asset-class
  table with row-click drill-down into per-component projection.
  Two-leg attribution (balance leg + contribution leg) surfaced via
  badges for contribution-bearing components (NPS, EPF, PPF, SSY).
- **Phase 5.11c — Retirement page integration.** Card lives alongside
  the existing 4-tile summary (Corpus needed / Selected→Grows /
  Gap / Monthly SIP needed) — all four tiles preserved. The
  breakdown card itself shows the user's FULL asset base; the 4-tile
  "Selected→Grows" uses only assets ticked into the retirement
  picker, so the two numbers can legitimately differ when assets
  are earmarked for other goals. A footnote in the card explains
  this.

### BXDEva verified numbers (FY 2025-26)

- Home loan splits: ₹2.33L principal · ₹4.63L interest (12 months active).
- Retirement Year 30 (2056): total corpus projected ₹26.1Cr. Top 3
  contributors: Real Estate ₹11.4Cr (4.3×), Small Savings ₹3.97Cr
  (44.8× — PPF + SSY hugely contribution-heavy), EPF ₹3.19Cr (42×).
- Tax brackets default: 0% up to ₹10L, 15% ₹10L-30L, 25% above ₹30L.
  Configurable per user via /settings.

### Migration tracking pattern (still in force)

`drizzle.__drizzle_migrations` is now a row behind the file count for
multiple migrations (0028+0029+0030+0031+0032 all applied via `psql
-v ON_ERROR_STOP=1 -f <sql>` followed by `setval` + manual `INSERT INTO
drizzle.__drizzle_migrations(hash, created_at)`). Do NOT try to repair
the migrator state. Keep using the documented pattern.

### Default retirement tax brackets

The seed `[{threshold:0, ratePct:0}, {threshold:1000000, ratePct:15},
{threshold:3000000, ratePct:25}]` is Bharath's planning starting point.
0% to ₹10L recognises basic-exemption + std-ded + 87A rebate covering
roughly that band under either regime in the retirement-income mix.
The 15% / 25% bands are deliberately conservative (real slabs go
20%/30% in working life, but retirement-income mix usually has more
capital-gains and rental components which carry their own lower rates).
Treat as a planning proxy, not a real tax engine.

---

**Sprint 5.7 complete — mutual-fund sub-classification.** Four phases.

- **Phase 5.7a — Schema + rates split.** Migration 0029 adds
  `mutual_funds.category text DEFAULT 'UNKNOWN' NOT NULL` with a CHECK
  constraint over (EQUITY|DEBT|HYBRID|UNKNOWN). Distinct from
  `fund_type` (AMFI scheme classification); category is the rate-bucket
  key. `DEFAULT_GROWTH_RATES` gains three new keys: MF_EQUITY=11,
  MF_DEBT=7, MF_HYBRID=9. Existing `MUTUAL_FUNDS` umbrella rate stays
  as the UNKNOWN fallback. Settings UI surfaces the three subclass
  rows with a footnote spelling out "subclass rates only fire when the
  per-fund category is set". Migration journal updated via the psql +
  manual INSERT pattern (id 28, hash captured).
- **Phase 5.7b — Projection wiring.** New helper
  `getMfRate(category, rates)` resolves per-fund rates with a single
  precedence chain. `goal-corpus.ts` CorpusContext now carries a per-MF
  array with resolved category + rate; `weightedReturnForGoal` special-
  cases MUTUAL_FUNDS aggregate inclusion to sum
  `value × category_rate` per fund, so a goal with mostly equity MFs
  sees ~11% vs ~7% if mostly debt. Cashflow `deriveSips` surfaces the
  category in the event label/notes (math unchanged — SIPs stay flat
  outflows). Retirement-assets API gets a new MUTUAL_FUNDS class row
  with `mfBreakdown` aggregate (per-category value + rate + fund
  count) for at-a-glance UI display.
- **Phase 5.7c — UI inline edit + bulk modal.** MF detail page gets a
  Category dropdown with a live hint showing the resolved rate
  ("Using Equity growth rate of 11% per year"). MF list page shows an
  amber banner when any fund is UNKNOWN — clicking "Categorise now"
  opens a modal with one row per uncategorised fund + per-row dropdown,
  committing via the new POST
  `/api/investments/mutual-funds/bulk-categorise` endpoint. List page
  table also gains a Category column for at-a-glance visibility.
- **Phase 5.7d — Seed + verify.** BXDEva's 8 MFs now carry explicit
  categories — 5 EQUITY (₹9.93L), 2 DEBT (₹5.38L, including the Liquid
  fund), 1 HYBRID (₹0.85L). 30-year projection delta vs the
  before-state (uniform 11%):
    BEFORE total ₹3.70Cr → AFTER total ₹2.80Cr (24% lower, more
    honest — debt MFs no longer over-projected at equity rates).

**Sprint 5.10 complete — forex deposits asset class.** Six phases.

- **Phase 5.10a — Schema (mig 0030).** New `forex_deposits` table
  with `amount_in_currency numeric(18,4)` (foreign currency, not paisa
  — paisa rule is INR-only), `currency_code` (ISO 4217), interest
  rate, opening/maturity dates, status (ACTIVE/MATURED/CLOSED), notes.
  Indexed on user_id and (user_id, status) for the dashboard tile.
  Migration journal: id 29.
- **Phase 5.10b — Live FX rate service.** New `getFxRatesToInr()` in
  `src/lib/services/yahoo-finance.ts` resolves `<CCY>INR=X` symbols
  through the existing 5-min getQuote cache. INR short-circuited to
  1.0; failed lookups omitted from the result. New auth-gated GET
  `/api/investments/forex-deposits/live-rates` exposes rates for the
  union of the user's currencies.
- **Phase 5.10c — CRUD API.** GET/POST /api/investments/forex-deposits
  + GET/PATCH/DELETE /api/investments/forex-deposits/[id]. Each row
  is enriched with `fxRate` + `inrValuePaisa` at read time. Validation:
  currency `/^[A-Z]{3}$/`, amount > 0, allowed status. numeric() round-
  trip preserved by parseFloat at the boundary.
- **Phase 5.10d — UI pages + sidebar + net-worth tile.**
  `/investments/forex-deposits` list, `/new` create form (with live
  INR preview as the user types), `/[id]` detail with inline edit
  matching NPS/EPF. Sidebar entry between Real Estate and Chit Funds.
  New "Forex Deposits" stat in the home net-worth StatsDisplay
  aggregated from ACTIVE deposits with non-null inrValuePaisa.
- **Phase 5.10e — Cashflow derivation + asset-growth-rates.** New
  `FOREX` key in DEFAULT_GROWTH_RATES (5% — INR depreciation drift ≈
  deposit interest). New `FOREX_MATURITY` CashflowSourceKind (TAXABLE
  default, documented rationale). `deriveForexDeposits` emits ONE_TIME
  events at the deposit's maturity_date using the live FX rate
  captured at derivation time (flat-rate, no FX projection — honest
  stance). `/api/cashflow-events/derive` route preloads forex rows +
  rates, threads them through DerivationInput; response now reports
  forexDeposits + fxRatesResolved in the `considered` summary.
- **Phase 5.10f — Seed + verify.** BXDEva gets 3 deposits: USD 5,000
  (HDFC NRE), EUR 2,000 maturing 2028 (ICICI NRE Bank), AED 10,000
  (ENBD). Live FX resolved at runtime: USD ₹95.265, EUR ₹110.9168,
  AED ₹25.886. Total INR equivalent ₹9.57L. Cashflow derive emits a
  single FOREX_MATURITY event for the EUR FD (₹221,834 at 2028-06-01);
  ongoing savings correctly skipped.

**Sprint 5.6 complete — EPF + NPS PDF statement importer.** Six phases.

- **Phase 5.6a — Parser framework.** `DocType` union extended with
  `'epf-passbook'` and `'nps-sot'`; `ParsedStatement` now includes
  `EpfPassbookParsed` + `NpsSotParsed` (each with a HIGH/MEDIUM/LOW
  confidence band). `pdfjs-dist` already in `serverExternalPackages`
  per the v1 lesson.
- **Phase 5.6b — EPF passbook parser.** `src/lib/services/statement-
  parsers/epf-passbook.ts`: regex-anchored extractor for EPFO member
  passbook PDFs. Captures UAN, Member ID, employer name, as-of date,
  employee/employer/pension closing balances, recent transactions, and
  derives monthly contribution from the avg of the last 3–6 credit
  rows. Reference layout: EPFO Member_Passbook_Sample.pdf.
- **Phase 5.6c — NPS Statement of Transactions parser.** `src/lib/
  services/statement-parsers/nps-sot.ts`: similar regex strategy.
  Captures PRAN, subscriber, Tier I/II, asset-class breakdown (E /
  C+G / A), totals, recent contributions, derived monthly contribution
  with quarterly-deposit date-span normalisation. Reference layout:
  NSDL Sample SOT.pdf.
- **Phase 5.6d — Import API.** `POST /api/imports/statement` (multi-
  part file, 5 MB max) → persists raw PDF under
  `uploads/<user_id>/statement-imports/<importId>.pdf` (userId-first
  upload convention — see below), returns
  `{ importId, kind, confidence, preview, currentValues, diff,
  warnings }`. `POST /api/imports/statement/confirm` re-reads the
  persisted file (idempotent — same input → same writes), applies
  the toggled fields to the matched EPF / NPS account. Match
  priority: explicit `accountId` > UAN/PRAN > sole account.
- **Phase 5.6e — Import UI.** Standalone
  `/investments/import-statement` page (separate from the older
  `/investments/import` LIC/chit/MF-CAS flow). Upload, preview with
  confidence badge + warnings, diff table, balance/contribution
  toggles, confirm. Sidebar gains "Import from statement" under
  Investments.
- **Phase 5.6f — Verification.** Real-sample testing is on the user
  — the parsers were written against the public EPFO + NSDL sample
  PDFs documented in each parser file. Verified the UNKNOWN path
  with a minimal-valid PDF returns
  `{ kind: 'UNKNOWN', confidence: 'LOW', warnings: [...] }`
  cleanly. Smoke test stays 20/20.

**Sprint 5.5 complete — contribution-aware retirement projections.** Six
phases.

- **Phase 5.5a — Schema + pure projection lib.** Migration 0028 adds
  `nps_accounts.monthly_contribution_paisa`,
  `epf_accounts.monthly_contribution_paisa`,
  `small_savings_accounts.{periodic_contribution_paisa,
  contribution_frequency}`. Applied via `psql -f` (migrator drift
  unresolved — see note below); journal row inserted manually with
  the SHA-256 of the SQL file. New pure lib
  `src/lib/finance/asset-projection.ts` with `projectFutureValue(...)`
  — combines PV compound interest + future-value-of-annuity into one
  call, returns balance & contribution components separately so UI
  can show attribution.
- **Phase 5.5b — `deriveNps` projects forward + new `deriveEpf`.**
  NPS corpus + monthly contributions projected to retirement at the
  NPS asset-class rate (default 9%) BEFORE the 60/40 lumpsum/annuity
  split. New `deriveEpf` emits one `EPF_MATURITY` event per EPF
  account at retirement (tax-free per sec 10(12) on 5+ yrs service).
  `EPF_MATURITY` added to `CashflowSourceKind` enum.
- **Phase 5.5c — `deriveSmallSavings` per-scheme rate + contribution.**
  Each row projects on its locked instrument rate (PPF 7.1, SSY 8.2,
  NSC 7.7 etc) with `periodic_contribution_paisa` +
  `contribution_frequency`. SSY contribution capped at 14 years
  (approximation — exact rule depends on child DOB); NSC/KVP forced
  to lumpsum even if a recurring value is recorded.
- **Phase 5.5d — Central growth-rates helper.**
  `src/lib/finance/asset-growth-rates.ts` reads `asset_class_returns`
  per user with `DEFAULT_GROWTH_RATES` fallback. Constants split into
  `asset-growth-rates-constants.ts` so client components can import
  `DEFAULT_GROWTH_RATES` without pulling postgres into the browser
  bundle. `cashflow-derivation` receives `growthRates` as an
  input — the lib stays pure.
- **Phase 5.5e — Contribution UI on detail pages.** NPS, EPF (PF),
  and Small Savings detail pages got the new field with live
  `projectFutureValue` preview showing balance side + contribution
  side. EPF page loads `/api/finance/retirement-assumptions` to
  compute years-to-retirement (EPF has no per-account maturity date
  the way small-savings does).
- **Phase 5.5f — Seed extension + verify.** BXDEva now has NPS
  ₹11,233/mo, EPF ₹15,840/mo, PPF ₹8,333/mo, SSY ₹15,000/mo,
  NSC 0/mo. After re-derive:
  - NPS_LUMPSUM at 2056: ₹5.10L → ₹1.56Cr
  - NPS_ANNUITY at 2056: ₹1,700/mo → ₹52,080/mo
  - NEW EPF_MATURITY at 2056: ₹3.19Cr
  - PPF_MATURITY at 2032: ₹6.5L → ₹17.07L
  - SSY_MATURITY at 2038: ₹1.8L → ₹4.25L

**Migration journal note.** `drizzle.__drizzle_migrations` is one row
behind the file count (0026 + 0027 + 0028 were applied via
`psql -v ON_ERROR_STOP=1 -f` due to a stuck orphan row tripping
`drizzle-kit migrate`). When you add migration 0029, do the same and
manually `INSERT INTO drizzle.__drizzle_migrations` with the SHA-256
of the SQL file. Do NOT try to repair the migrator state — last
attempt corrupted things further.

**Sprint 4 complete.** Tax hardening — six focused phases bringing the
filing-side of the dashboard to par with the planning side:

- **Regime comparison engine** (Phase 1): `tax_slabs` + `tax_regime_config`
  govt-data tables (NOT user-scoped — slabs are global), seeded for FY
  2025-26 and 2026-27 across both NEW (default since FY 2024-25) and OLD
  regimes. `src/lib/finance/tax-slabs.ts` is the pure compute lib:
  standard deduction → slab tax → 87A rebate → 4% cess → total.
  `/api/tax/regime-compare` aggregates salary + GST invoices + non-exempt
  other-sources + rental into a slab-eligible gross, runs both regimes,
  returns the recommendation with savings delta. `RegimeComparisonCard`
  on `/tax` shows side-by-side with "Set as default" buttons that flip
  `user_preferences.tax_regime_default`. Migration 0020.
- **Form 26AS reconciliation** (Phase 2): new `form_26as_uploads` table
  + `tds_credits.is_reconciled` flag. PDF upload to
  `uploads/<user>/form-26as/<fy>-<ts>.pdf` with a best-effort regex
  sweep over pdfjs-extracted text (govt template drift makes precise
  parsing fragile — manual reconciliation flow always works as
  fallback). Two-column `/tax/form-26as` view: books on the left,
  26AS uploads on the right, ±₹1k tolerance banner. Migration 0021.
- **Advance tax planner** (Phase 3): new `advance_tax_installments`
  table auto-seeded with the 4 quarterly slots (15%/45%/75%/100% on
  15 Jun/Sep/Dec/Mar). `projectAnnualTax()` shared helper mirrors
  regime-compare math. `AdvanceTaxCard` shows a 4-up grid on `/tax`
  with inline "Mark paid" buttons and a 234B/234C amber warning when
  shortfall >10%. Exact penalty math deferred (slab-based, gnarly).
  Migration 0022.
- **ITR form selector + export** (Phase 4): new `itr_form_selection`
  table (unique per user/fy). `src/lib/finance/itr-selector.ts` is the
  pure rule engine — ITR-1 (Sahaj) for salary + 1 house + interest with
  total ≤₹50L, ITR-2 for multiple houses or capital gains, ITR-3 for
  any business/GST income, ITR-4 (Sugam) for presumptive ≤₹50L.
  `/tax/itr-wizard` is a single-page questionnaire prefilled from a
  `/detect` endpoint that reads salary_income, real_estate,
  capital_gains, and gst invoices. ITR-1 has a bespoke Sahaj summary
  export; ITR-2/3/4 delegate to the existing filing-pack ZIP.
  Migration 0023.
- **Tax-aware inflow simulation** (Phase 5): closes the Sprint 3.5
  deferred. `cashflow_events.tax_treatment` (TAX_FREE / TAXABLE / TDS)
  now flows through `goal-projection.ts` — `earmarkedInflowsForYear`
  honours the treatment per event. Goal API auto-supplies the marginal
  rate from regime-compare (flat effective-rate proxy for v1; per-year
  slab-derived rate deferred). Retirement page year-by-year table
  gains Gross/Tax/Net columns where Rental + Annuity + NPS are
  TAXABLE and the SWP ladder stays TAX_FREE. Backward-compatible —
  default 0% = unchanged behaviour.

Design tenet that drove Sprint 4: **filing follows planning**. The
dashboard already projected what the user *will earn*; Sprint 4 makes
it project what the user *will keep*. The chain — regime choice →
advance-tax cadence → ITR form → net-of-tax inflows — mirrors the
real-world filing year so every screen has an obvious next step.

**Sprint 4.1 (post-Sprint-4 follow-on).** Filled out the ITR-form
filing experience for ITR-1, ITR-2, and ITR-4 to match the depth
already at ITR-3. Six commits, six phases:

- **Phase A — Pure libs.** `src/lib/finance/capital-gains-tax.ts`
  handles the four-way bucket split (STCG sec 111A 15%, STCG-other
  adds-to-slab, LTCG sec 112A 10% over ₹1L, LTCG-other flat 20%) +
  4% cess separately so callers don't double-count vs slab cess.
  `itr1-summary.ts` / `itr2-summary.ts` / `itr4-summary.ts` are pure
  compute libs that wrap `computeTax()` from tax-slabs.ts. ITR-2
  layers in capital-gains via the new CG lib and folds STCG-other
  into slab gross. ITR-4 evaluates each presumptive line against
  its deemed-profit minimum (6%/8% for 44AD by receipt mode, 50%
  for 44ADA, 44AE manual). Each summary returns `exceedsCap` for
  the UI's "switch to the right form" banner.
- **Phase B — Presumptive schema + CRUD (migration 0024).** New
  `presumptive_income` table with user-scoped + (user, fy) indices.
  POST `/api/tax/itr4/presumptive` + `[id]` PATCH/DELETE re-validate
  the 44AB(e) audit-trigger rule server-side (declared profit ≥
  section minimum); rejects with 422 otherwise.
- **Phase C — Summary APIs.** New `GET /api/tax/itr1/summary`,
  `/itr2/summary`, `/itr4/summary` that pull the right tables for
  each form and call the corresponding lib. `/api/tax/itr-export/
  [form]` rewired: ITR-3 stays delegated to `/tax/itr3`, ITR-1/2/4
  now call the new libs directly (no more "delegate to filing-pack").
- **Phase D — Walkthrough pages.** `/tax/itr1`, `/tax/itr2`,
  `/tax/itr4` — read-only summary pages with sections per ITR
  schedule, exceeds-cap amber banner where applicable, headline
  StatsDisplay. `/tax/itr4` has an inline presumptive-income table
  with compliance badge (above min / at min / below min); add + edit
  routes at `/tax/itr4/presumptive/new` and `/tax/itr4/presumptive/
  [id]`. Live minimum-profit preview in the form.
- **Phase E — Wizard + sidebar wiring.** ITR wizard's recommendation
  card and saved-selection card both get a "Continue to ITR-X
  walkthrough →" button that routes by form. Sidebar Income Tax
  section gains explicit ITR-1 / ITR-2 / ITR-3 / ITR-4 entries; the
  old generic "ITR Filing → /tax/itr3" label retired.
- **Phase F — Docs.** This entry + README roadmap update + deferred
  list refresh.

Deferred from Sprint 4.1 (now closed by Sprint 5.1):
- ~~Cost-inflation-index lookup~~ — closed by Sprint 5.1c (CII table +
  `cii-indexed-cost.ts`).

Still deferred from Sprint 4.1:
- **Schedule FA (foreign assets) capture.** ITR-2/3 filers with any
  foreign asset must file FA — currently no UI or table for this.
- **44AE per-vehicle math.** Currently accepts manual declared
  profit; ideally we add a vehicle ledger (heavy ₹1k/tonne/month,
  light ₹7.5k/month) and derive declared profit.
- **e-filing XML/JSON schema-conformant export.** Phase C returns
  flat JSON suitable for human cross-checking; the e-filing portal's
  schema (one per form per FY) is a sprint of its own.
- **Grandfathering for pre-1-Feb-2018 equity LTCG.** Sec 112A allows
  using the higher of (actual cost) or (FMV on 31-Jan-2018) for
  equities held before that cut-off. User adjusts `taxableGain`
  manually for now.
- **Pre-Jul-2024 CG election toggle (persistence).** Capital-gains rows
  on `/tax/ltcg-stcg` now show an inline "elect pre-reform indexed
  treatment" checkbox on eligible LTCG rows (Sprint 5.2 commit 3, item
  U6), but the election is **in-memory only**. Persistence needs
  migration 0027 adding `capital_gains.elect_pre_reform_method` boolean
  + downstream tax recompute. Deferred to a follow-up so the schema
  drift guard stays clean for Sprint 5.2 close.

**Sprint 5.1 (post-Sprint-4.1 follow-on).** Tax-calc fidelity to the
canonical Yeswanth TaxCalc FY 2026-27 reference. Four focused phases
closing the OLD-regime exemption gaps:

- **Phase 5.1a — Salary components + HRA + sec 24(b) + 80CCD(2) NEW
  eligibility + tax setup params** (migration 0025). `salary_income`
  gains 9 component columns (basic/da/hra/lta/conveyance/children_ed/
  medical/other_allowances/rent_paid_monthly). `real_estate` gains 6
  housing-loan columns (is_self_occupied, interest paid, disbursed
  date, is_first_home, stamp_value, carpet_area). `tax_deductions`
  gains `eligible_under_new` (backfilled true for 80CCD(2)).
  `user_preferences` gains 8 tax-setup booleans + disability severity.
  Pure libs: `hra-exemption.ts`, `section-24b.ts`, `section-80eea.ts`.
  Regime-compare API rewired: salary now sums components (fallback to
  gross for legacy rows), OLD regime subtracts HRA + applies house-
  property head with sec 24(b) cap + 80EEA + ₹2L cross-head offset
  cap. NEW regime applies 30% std maint on let-out only. New
  `RegimeColumn` rows for HRA / 24(b) / 80EEA per regime.
- **Phase 5.1b — Surcharge + marginal relief.** `surcharge.ts`
  encodes FY 2024-25+ brackets (≤₹50L=0%, ₹50L–₹1Cr=10%, ₹1Cr–₹2Cr=
  15%, ₹2Cr–₹5Cr=25%, >₹5Cr OLD=37% / NEW=25%). Marginal relief
  caps surcharge at (tax_at_threshold + income_above_threshold).
  Wired into `computeTax()` with optional regime+fy params; backward-
  compat callers (omitting params) get 0 surcharge. Cess now applied
  on (tax_after_rebate + effective_surcharge). UI shows surcharge
  rows only when income > ₹50L.
- **Phase 5.1c — 80D sr-citizen + 80G four-category + post-Jul-24 CG
  + CII table** (migration 0026). New `cost_inflation_index` table
  (FY PK, seeded with CBDT values FY 2001-02 through 2025-26).
  `tax_deductions` gains `eighty_g_category` (50_NO_LIMIT /
  100_NO_LIMIT / 50_WITH_LIMIT / 100_WITH_LIMIT — CHECK constrained)
  and `eighty_d_bucket` (SELF_FAMILY / PARENTS). Pure libs:
  `section-80d.ts` (sr-citizen-aware caps ₹25k/₹50k), `section-80g.ts`
  (four-category with shared 10%-adjusted-gross cap proportionally
  split between WITH_LIMIT rows), `cii-indexed-cost.ts` (purchase ×
  saleCii / purchaseCii formula). `capital-gains-tax.ts` refined to
  branch on saleDate vs 23-Jul-2024 cutoff: pre = 15% STCG / 10%
  LTCG over ₹1L / 20% indexed; post = 20% STCG / 12.5% LTCG over
  ₹1.25L / 12.5% flat no-indexation. `basicExemptionAbsorption()` for
  per-bucket exemption windows (₹2.5L OLD / ₹4L NEW). Regime-compare
  uses 80D/80G libs when rows have bucket/category set; legacy face-
  value preserved.
- **Phase 5.1d — Yeswanth xlsx importer.** Pure parser
  `src/lib/yeswanth-parser.ts` uses SheetJS to extract salary
  components / setup params / housing loan / deductions / TDS /
  capital gains. POST `/api/imports/yeswanth-taxcalc` uploads xlsx
  → preview JSON (no writes), stores at `uploads/<userId>/
  yeswanth-imports/<importId>.xlsx` (gitignored). POST `/api/imports/
  yeswanth-taxcalc/confirm` re-parses by importId, applies writes
  per-section based on mapping flags. `/tax/import` UI: two-step
  upload → review-with-checkboxes → confirm. Capital-gains mapping
  OFF by default (re-import duplication risk).

Design tenet: **the Yeswanth template is the canonical reference;
pfd-saas should match its math, not approximate it.** Every Sprint 5.1
lib references the corresponding template row in its module docstring.

**Sprint 5.4 (in progress) — ITR eligibility audit + unified disclosure.**
Closes the gap that all four ITR pages were silently dropping income
that didn't fit the form, with no warning to the user. Audit table in
`docs/ITR-AUDIT-2026-06.md`. No schema changes (migration head still
0027).

Symptoms before:
- ITR-1 page silently picked `real_estate ORDER BY id LIMIT 1` and
  hid every other property — a user with 3 properties saw none of the
  extras even though ₹3L of rental income was being computed elsewhere.
- ITR-1 + ITR-4 ignored ₹7.85L of capital gains for FY 2025-26 with no
  disclosure. Only the ₹50L cap was surfaced.
- ITR-2 silently treated GST invoices as not-business — would have let
  a user file ITR-2 when they actually needed ITR-3.
- The wizard's recommendation (persisted in `itr_form_selection`) was
  never re-checked on the form pages. A user deep-linking to /tax/itr1
  with capital gains would see "correct-looking" numbers that dropped
  ₹10L of income.
- ITR-1/4 surfaced only `exceedsCap`. Capital gains / multi-HP / business
  / foreign / director / agricultural-over-5k were all in prose footers.

Sprint 5.4 fix shape (4 commits):
- **Phase A — Audit.** `docs/ITR-AUDIT-2026-06.md` — table of current vs
  correct behaviour for each form, plus the cross-cutting findings.
- **Phase B — `ItrEligibilityBanner` component** at
  `src/components/forms/itr-eligibility-banner.tsx`. One reusable banner
  for all four pages. Props: `formCode`, `fy`, `wizardSelectedForm?`,
  `excludedIncomeBlocks`, `eligibilityFlags`. Each form evaluates only
  the flags relevant to it (ITR-1: cap + CG + multi-HP + business +
  foreign + director + agri; ITR-2: business only; ITR-3: nothing —
  catch-all; ITR-4: cap + CG + multi-HP + foreign + director + agri).
  Wizard mismatch → amber callout with "Go to {recommended}" CTA. No
  ineligibility + no mismatch → compact green "Eligible for {form}" row.
- **Phase C — Summary endpoints return eligibility + excluded blocks.**
  `/api/tax/itr{1,2,3,4}/summary` extended with `eligibility.flags`,
  `excludedIncomeBlocks`, `wizardSelectedForm`. ITR-1 additionally
  returns `housePropertyRows` listing every property even though only
  the first is in scope. Three flags are typed stubs that always resolve
  to `false` until schema captures them: `hasForeignIncome` (Schedule
  FA), `isDirectorOrUnlisted` (user profile flag), `agriculturalOver5k`
  (agri income line). Stubs are wired correctly so the UI picks up the
  signal when capture lands. No math changed in any compute lib.
- **Phase D — Pages wire the banner + ITR-1 multi-property disclosure.**
  Banner mounted at the top of all four pages above the existing
  `ItrResultBanner`. ITR-1 + ITR-4 relabel "Total income" →
  "{form} eligible income" and render a one-liner "Actual income across
  all forms: ₹X" below the stat when excludedIncomeBlocks is non-empty.
  ITR-1 House Property section now renders every property — first row
  with badge "In ITR-1", extra rows in a separate table marked
  "Additional properties (excluded from ITR-1)" with Self-occupied /
  Let-out / Vacant badges. Section header amber callout when >1
  property: "ITR-1 allows only one house property. Your additional ₹X
  of rental income won't fit — file ITR-2 to include all of these."

Verification (BXDEva FY 2025-26):
- ITR-1: `wizardSelectedForm: 'ITR-2'`, `isEligible: false`,
  flags fired = `hasCapitalGains` (₹7.85L, 4 rows) +
  `multipleHouseProperties` (3 properties, ₹3L extra rent). Excluded
  blocks = capital gains ₹7.85L + additional rental ₹3L. All 3
  properties in `housePropertyRows`.
- ITR-2: `isEligible: true`. No `hasBusiness` flag (no invoices).
- ITR-3: `isEligible: true` (always).
- ITR-4: same as ITR-1 — `hasCapitalGains` + `multipleHouseProperties`.

Deferred to a future sprint:
- **Schedule FA capture.** Foreign assets/income disclosure. Stub
  resolves to false today.
- **Director-of-company / unlisted-shares flag.** User-profile boolean
  pair. Stub resolves to false today.
- **Agricultural income capture.** Currently has no schema home; would
  need a row type on `other_sources_income` or its own table. Stub
  resolves to false today.
- **ITR-2 per-property 24(b) allocation.** Currently the entire 24B
  deduction lands on the first property — fine for a single-loan home
  but wrong if loans exist on multiple. Not blocking; flagged in
  Sprint 4.1 docs.

**Sprint 5.3 (in progress) — historical rental track.** Closes the
Sprint 5.2 footnote "rental income excluded from YoY — no history yet".
Adds a per-property × FY rental ledger that drives `/income` instead
of the brittle `monthly_rent × 12` proxy.

- **Phase 1 — Schema (migration 0027).** New `rental_history` table:
  `(user_id, real_estate_id, fy)` unique, `months_let` CHECK 1..12,
  `rent_received_paisa` bigint, FK CASCADE on both parents. Indexes on
  user_id, (user_id, fy), and real_estate_id.
- **Phase 2 — CRUD API.** `/api/finance/rental-history` GET (with
  optional `?fy` + `?propertyId` filters, JOINs real_estate to surface
  property_name inline), POST (rupees → paisa, validates fy regex +
  monthsLet range + property ownership; 23505 → 409), PATCH (field-diff,
  realEstateId/fy are immutable → 400), DELETE (scoped by userId).
  Smoke test extended to 20 endpoints (`/api/finance/rental-history?fy=
  <FY>`).
- **Phase 3 — /api/income/summary integration.** Stream rental now
  carries `.source: 'history' | 'current_rate'`. Trend rows include
  `rentalPaisa: number | null` (null = no history row, render as "—").
  Current FY uses history if present, else falls back to monthly_rent
  × 12 — both paths exercised by the demo seed.
- **Phase 4 — UI.** `/income` YoY table gains a Rental column between
  Other-sources and Capital-gains (formatINRNullable distinguishes null
  from ₹0). The footnote is rewritten to explain the history vs
  current-rate fallback. Real-estate detail page gets a Rental-history
  Card with inline Add-FY + Edit/Save/Cancel rows; self-occupied
  properties hide the section entirely (NIL annual value).
- **Phase 5 — Seed.** BXDEva gets 3 prior FYs on the Whitefield flat
  (FY 2022-23 ₹2.40L, 2023-24 ₹2.52L, 2024-25 ₹2.76L). Current FY
  2025-26 has no row → exercises the current_rate fallback path so the
  demo data covers both branches.

**Sprint 5.2 complete.** Income Tax UI refresh — three sequenced
commits that recompose the `/tax` hub and adjacent screens so the
recommendation is always visible above its justification. No new
schema (migration head still 0026).

- **Commit 1 — IT hub page restructure.** New `TaxKpiStrip` (total tax
  / TDS / advance paid / balance|refund), `TaxProfileInline` chips
  (metro / sr citizen self+parents / family pensioner with PATCH
  user-preferences and parent refresh hook), `Section80RegimeAwareStats`
  (OLD vs NEW eligible deductions side-by-side + tax delta),
  `ItrResultBanner` on each ITR form page with Switch-form CTA, and
  `TaxOnboardingChecklist` for empty-state. Regime banner promoted
  above the side-by-side columns. 5-tile sub-nav grid replaced by a
  3-button Quick Actions row.
- **Commit 2 — Section 80 entry UX overhaul.** New 4-step
  `DeductionWizardForm` (section → sub-type → amount+dates →
  extras+proof) with per-section sub-type lists, live cap-usage bar
  fetched from existing rows for that section/FY, inline 80G PAN
  validation above ₹2k, 80EEA eligibility checkboxes, 80CCD(2)
  auto-eligible-under-new pill, "Eligible under NEW?" checkbox for
  others, optional receipt+cert upload. `/tax/new` honours
  `?section=` query param; `/tax/80g/new` redirects there. New
  `/tax/[id]/edit` for in-place editing. U8 carry-forward banner +
  modal calls new `POST /api/tax/deductions/carry-forward`. The
  deductions POST endpoint now also accepts `multipart/form-data`
  with `payload` JSON + `receipt`/`certificate` files (rolls back
  the deduction row on upload failure).
- **Commit 3 — Capital gains + 80G + Form 26AS polish.** `/tax/80g`
  rewritten as four CBDT-category buckets (100/no-limit,
  50/no-limit, 100/with-limit, 50/with-limit) with per-bucket
  subtotal and post-cap effective deduction read from
  regime-compare. `/tax/ltcg-stcg` adds a 23-Jul-2024 cutoff
  explanation banner and groups rows into Post-reform vs Pre-reform
  sections with applicable rate shown inline. U6 "elect pre-reform
  indexed" toggle on eligible LTCG rows (debt MF / real estate /
  gold sold on/after cutoff) — election is **in-memory only in
  this iteration**; persistence will need migration 0027.
  `/tax/form-26as` reco banner promoted to a full-width prominent
  card with tri-state styling (no-uploads / match / discrepancy).

UX tenets that drove the sprint:
1. Recommendation first, then justification.
2. Data entry should teach the user the law, not assume they know it.
3. Every screen surfaces an answer above its explanation.

**Sprint 3.5 complete.** Goals/Retirement architecture + IA regroup.
Four focused phases on top of Sprint 3:

- **Sidebar IA regroup** (Phase 1): top-level sections match the user's
  mental model — Investments are *what you own*, Insurance is *what
  protects you*, Liabilities are *what you owe*. URLs stay stable at
  `/investments/*`; only sidebar groupings change. New `/insurance`
  overview page. Retirement moves under Planning.
- **`cashflow_events` substrate** (Phase 2): first-class inflow
  timeline that both retirement and per-goal funding projections
  consume. Migration 0013. Auto-derivation from insurance maturities,
  NPS lumpsum/annuity, PPF/VPF/NSC/KVP/SSY maturities, SCSS quarterly
  payouts, real-estate rental, salary till retirement. `/planning/
  cashflows` timeline UI. Idempotent re-derive preserves manual rows.
- **Goals upgrade** (Phase 3): disbursement model on `financial_goals`
  — LUMPSUM (one-shot), FIXED_PERIOD_SWP (flat per-year), INFLATION_SWP
  (per-year × growth^N). Migration 0014. Year-by-year projection engine
  (`lib/finance/goal-projection.ts`) with binary-search monthly-
  contribution solver. Per-goal asset mapping via existing
  `savings_asset_inclusion` keyed by `goal_id`. New `/goals/[id]` detail
  page with 4 stacked sections including a Recharts funding chart.
- **Retirement reads cashflow_events** (Phase 4): additive enhancement.
  `/api/finance/retirement-assets` gains SMALL_SAVINGS as a 6th asset
  class (closes Sprint 3 Phase 5 deferred). `/retirement` page gains
  an "Income arrivals during retirement" section that surfaces the
  events firing during retirement years — pre-existing three-bucket
  SWP cascade math, corpus depletion chart, and selection table
  untouched.

Design principle that drove the sprint: **Stage ≠ Milestone**.
Retirement is a *life phase* (singular, dedicated dashboard, never
"closed"). Goals are *milestones* (plural, lifecycle: open → funded →
closed). Both share the substrate (cashflow events, asset mapping)
but stay psychologically distinct at the surface.

**Sprint 3 complete.** Five India-specific modules shipped on top of
Sprint 2's productized core:

- **Health Insurance** (Phase 1): separate table from life insurance,
  family-floater data model, member cards with policy numbers, claims
  log, portability history. Auto-migrated HEALTH rows out of
  `insurance_policies` during the split.
- **Income** (Phase 2): unified `/income` summary aggregating
  salary_income + other_sources_income (with `is_tax_exempt` +
  `tax_section` flags) + capital_gains + real_estate.monthly_rent. GST
  invoice income joins via `invoices.taxable_amount`. YoY trend
  separates Salary / Freelance / Other / Capital gains.
- **Vehicles** (Phase 3): vehicles + insurance policies + PUC + service
  log (4 tables). Alert types `VEHICLE_INSURANCE_DUE` and
  `PUC_EXPIRY_DUE` wired into cron.
- **Subscriptions** (Phase 4): 10 categories
  (STREAMING/SOFTWARE/CLOUD/FITNESS/NEWS/GAMING/AI/EDUCATION/
  PRODUCTIVITY/OTHER) with monthly-drag normalization across
  MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL/LIFETIME billing cycles.
- **Small Savings + EPF split** (Phase 5): `provident_fund` renamed to
  `epf_accounts` (EPF-only); new `small_savings_accounts` table covers
  PPF/VPF/NSC/KVP/SSY/SCSS with per-scheme interest projection
  (`src/lib/finance/small-savings.ts` — yearly compound with SCSS
  quarterly-payout flag). Wired into networth snapshot, savings-asset
  selection, and tax/summary 80C source list.

Sprint 2 deliverables (still in force):
- Onboarding wizard with GST/no-GST branching
- Mobile-responsive (sidebar drawer + DataTable card layout on `<md`)
- PWA shell — installable, offline fallback page, manifest, service worker
- Per-tenant cron: `/api/cron/tick` dispatches `daily_digest`,
  `alerts_check`, `sip_auto_execute` per user from a `scheduled_jobs`
  ledger
- Synthetic demo seed (`scripts/seed-demo.mjs`) populates 25 sections
  for a fresh user
- Real magic-link email via SMTP (Gmail / Resend / Postmark — auto-falls
  back to console-log stub when `EMAIL_SERVER` is unset)
- Per-user Telegram alerts + daily digest. One bot
  (`TELEGRAM_BOT_TOKEN`); each user pairs their own chat_id via
  Settings → Telegram (deep-link + webhook). When the bot token is
  unset, sends are logged to `tmp/telegram-out.log` per user.
- Tenant-scoped unique indices everywhere (the multi-tenancy invariant
  reaches every constraint, not just every query)

Two-user data isolation verified end-to-end. See `ORCHESTRATOR_CONTEXT.md`
(gitignored) for the multi-sprint roadmap. Sprint 5 (deployment +
docker-compose self-host scaffold) is next; Sprint 6 scoped when we get
there.

Deferred from Sprint 2:
- Docker / docker-compose self-host scaffold (real SMTP via Gmail
  obsoleted the Mailpit dev-SMTP need; full Docker comes in Sprint 5
  with deployment infrastructure).

Deferred from Sprint 3 / 3.5:
- MF CAS PDF parser. Awaiting a sample PDF. (EPF passbook + NPS SoT
  importers closed by Sprint 5.6.)
- ~~MF subclass projection~~ — closed by Sprint 5.7 (per-fund
  category drives MF_EQUITY/DEBT/HYBRID rates in goal-corpus, retire-
  ment-assets, and the inline-edit UI).
- ~~Forex deposits asset class~~ — closed by Sprint 5.10 (new
  forex_deposits table + live INR conversion + cashflow integration).
- Migration of `timestamp` → `timestamptz` across all 50+ tables. Known
  tech debt — flagged when the per-tenant cron timezone bug surfaced in
  Sprint 2 Phase 5.
- Cross-asset rebalance projection. Currently each asset class grows
  at its own assumed return; a more honest model would track the
  three-bucket cascade (equity / debt / cash) across the whole
  portfolio. Sprint 5+ depending on demand.

Deferred from Sprint 4 (now closed by Sprint 5.1):
- ~~Surcharge brackets (>₹50L)~~ — closed by Sprint 5.1b.
- ~~Per-deduction regime eligibility~~ — closed by Sprint 5.1a
  (`eligible_under_new` flag with 80CCD(2) backfilled).

Still deferred from Sprint 4:
- **LTCG/STCG separately taxed**. Capital gains are surfaced as a
  separate "taxed separately" chip on the regime card but not yet
  layered into the total liability. Phase 4.5+ work.
- **234B/234C exact penalty math**. Advance tax planner shows the
  warning band; the slab-based interest calc is gnarly enough to be its
  own ticket.
- **Per-year slab-derived marginal rate**. Phase 5 uses a flat
  effective-rate proxy for tax-aware projections; ideally the rate is
  recomputed each projection year from the projected income for that
  year.
- **ITR form full e-filing JSON export**. Phase 4 picks the form and
  exports the existing filing-pack ZIP; the schema-conformant
  e-filing JSON each form requires is a sprint of its own.

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
npm run db:generate            # generate Drizzle migration from schema.ts
npm run db:migrate             # apply pending migrations
npm run dev -- --port 3000     # dev server (port assigned by ~/.appregistry)
npm run build                  # production build
npm run lint
```

No test suite yet; the smoke-test convention is to load the owner's
imported data (Sprint 1.5) and walk every page.

## Environment variables

- `DATABASE_URL` — `postgresql://user@host:port/dbname`
- `AUTH_SECRET` — random 32+ bytes (`openssl rand -base64 32`)
- `NEXTAUTH_URL` — `http://localhost:3000` for dev; canonical https URL
  in prod
- `EMAIL_FROM` — sender address on outgoing magic-link emails (used by
  Auth.js display; the actual send is stubbed in Sprint 1)
- `EMAIL_SERVER` — SMTP connection string, real Sprint 5+, ignored while
  stubbed
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

## Sign-in flow (Sprint 1 — email send is STUBBED)

1. Visit `/` → middleware redirects to `/login`.
2. Enter email, submit.
3. Land on `/login/check-email`. In dev, the page itself tells you the
   stub is active.
4. Grab the magic-link URL from either:
   - the `npm run dev` terminal (banner: `🔑 MAGIC LINK ...`)
   - `tmp/magic-links.log` (newline-delimited JSON)
5. Paste the URL in the same browser, Auth.js validates the token,
   creates a row in `session`, redirects to `/`.

See `STUBS.md` for the full list of stubbed integrations.

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
- Cron-driven endpoints (`/api/alerts/check`, `/api/daily-digest`,
  `/api/investments/sips/auto-execute`) return 503 with `TODO(sprint-2)`.
  Per-tenant cron scheduling lands in Sprint 2 Phase 5.

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
