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

## Status

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
  `uploads/form-26as/<user>/<fy>-<ts>.pdf` with a best-effort regex
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

Deferred from Sprint 4.1:
- **Cost-inflation-index lookup** for indexed LTCG-other. Currently
  flat 20% on whatever `taxable_gain` the user enters; ideally the
  engine multiplies by the CII table to compute indexed cost basis
  itself.
- **Schedule FA (foreign assets) capture.** ITR-2/3 filers with any
  foreign asset must file FA — currently no UI or table for this.
- **44AE per-vehicle math.** Currently accepts manual declared
  profit; ideally we add a vehicle ledger (heavy ₹1k/tonne/month,
  light ₹7.5k/month) and derive declared profit.
- **e-filing XML/JSON schema-conformant export.** Phase C returns
  flat JSON suitable for human cross-checking; the e-filing portal's
  schema (one per form per FY) is a sprint of its own.

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
- MF CAS PDF parser. Awaiting a sample PDF.
- Migration of `timestamp` → `timestamptz` across all 50+ tables. Known
  tech debt — flagged when the per-tenant cron timezone bug surfaced in
  Sprint 2 Phase 5.
- Cross-asset rebalance projection. Currently each asset class grows
  at its own assumed return; a more honest model would track the
  three-bucket cascade (equity / debt / cash) across the whole
  portfolio. Sprint 5+ depending on demand.

Deferred from Sprint 4:
- **Surcharge brackets** (income >₹50L). Engine handles standard
  deduction + slabs + 87A + 4% cess but not the 10/15/25/37% surcharge
  layer on top.
- **Per-deduction regime eligibility**. NEW regime currently shows ₹0
  deductions (conservative); OLD shows everything. Refining requires a
  `regime: 'NEW' | 'OLD' | 'BOTH'` flag on `tax_deductions` rows so
  80CCD(2) employer NPS contributions count under NEW too.
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
