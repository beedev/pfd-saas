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
  → preview JSON (no writes), stores at `uploads/yeswanth-imports/
  <userId>/<importId>.xlsx` (gitignored). POST `/api/imports/
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
- MF CAS PDF parser. Awaiting a sample PDF.
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
