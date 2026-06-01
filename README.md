# pfd-saas

A generic personal finance planner for India. SaaS edition of
[beedev/pfd](https://github.com/beedev/pfd) — multi-tenant, Postgres-backed,
magic-link auth.

**Status:** Sprint 5.1 complete (Sprint 4 + 4.1 + 5.1) — tax hardening
+ tax-calc fidelity on top of the multi-tenant skeleton. The dashboard
now covers the full Indian filing chain: NEW vs OLD regime comparison
with HRA / sec 24(b) / 80EEA / 80D sr-citizen / 80G four-category caps
+ surcharge brackets + marginal relief, post-Jul-2024 CG cutoff, CII
table, Form 26AS reconciliation, quarterly advance-tax planner with
234B/234C warnings, ITR form wizard (1/2/3/4) with auto-detect from
income sources, Yeswanth TaxCalc xlsx importer, and tax-aware net-of-tax
inflow projections on goals + retirement. Demo seed script lets anyone
clone and bring up a fully-populated dashboard in minutes. Pre-launch;
no public deploy yet.

---

## What it does

Tracks the full INR portfolio of an Indian retail investor:

- **Investments:** Stocks, Mutual Funds, SIPs, Gold (SGB/ETF/Physical/Digital),
  NPS Tier-I/II, EPF, **Small Savings (PPF/VPF/NSC/KVP/SSY/SCSS)** with
  per-scheme interest projection, Real Estate, Chit Funds, Fixed Deposits,
  Life Insurance, **Health Insurance** (family-floater with member cards +
  claims + portability), **Vehicles** (with insurance/PUC/service log).
- **Subscriptions:** 10-category subscription tracker (streaming /
  software / cloud / AI / fitness / news / gaming / education /
  productivity / other) with monthly-drag normalization.
- **Income:** Unified summary across salary / freelance (GST invoices) /
  other income / capital gains / rental, with tax-exempt flagging.
- **Liabilities:** Loans (home/personal/vehicle) with EMI amortization +
  prepay simulator, credit cards with statement tracking.
- **Tax (Indian):** Section 80 deductions, capital gains (LTCG/STCG),
  income tax paid ledger, 80G donations, ITR filing-pack generator.
- **GST (Indian small business):** Customers, Vendors, Invoices,
  Purchase Invoices, GSTR-1 and GSTR-3B summaries.
- **Planning:** Net worth time series, monthly cashflow analytics,
  retirement corpus calculator with three-bucket SWP cascade, budget
  with carry-forward, financial-goal projections.

All currency is INR, stored in paisa (integer). All time-series values
adapt to the Indian financial year (Apr–Mar).

## Stack

- **Next.js 16** App Router with Turbopack
- **Postgres 17** via `postgres-js` + **Drizzle ORM**
- **Auth.js v5** (NextAuth) — passwordless email magic-link, database
  session strategy, `@auth/drizzle-adapter`
- **Tailwind 4** + the `@dxp/ui` design system (sibling repo, symlinked
  via `src/lib/dxp-ui`)
- **Recharts** for graphs, **sonner** for toasts, **pdfjs-dist** for
  PDF statement imports
- Free, no-auth market data: Yahoo Finance v8 (stocks, gold), AMFI
  NAVAll.txt + mfapi.in (mutual funds)

## Setup (local dev)

### 1. Prerequisites

- Node ≥ 22
- Postgres 17 running locally on port 5432
- `psql` CLI in `$PATH`

### 2. Install

```bash
git clone <this repo> pfd-saas
cd pfd-saas
npm install
```

### 3. Create the database

```bash
createdb pfd_saas
```

### 4. Environment

Copy `.env.example` (if present) or create `.env.local`:

```env
DATABASE_URL=postgresql://<your-pg-user>@localhost:5432/pfd_saas
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000

# Sprint 1: email send is stubbed — these are placeholders only
EMAIL_FROM=noreply@pfd-saas.local
EMAIL_SERVER=
```

### 5. Apply schema

```bash
npm run db:migrate
```

This applies migrations `0000` → `0004`:
- `0000` — full schema (52 tables: 47 domain + 4 Auth.js + 1 reference)
- `0001` — drop legacy weight-loss tracker tables
- `0002` — add nullable `user_id` FK + index on every domain table
- `0003` — widen money columns from `integer` to `bigint`
- `0004` — tighten `user_id` to `NOT NULL`

### 6. Run

```bash
npm run dev -- --port 3000
```

Open <http://localhost:3000>. Middleware redirects you to `/login`.
Enter your email, then…

### 7. Sign in

`pfd-saas` uses passwordless email magic links. Two modes:

**a) Stub mode (default).** Leave `EMAIL_SERVER` empty in `.env.local`.
The Auth.js EmailProvider does NOT send a real email — instead, the
magic-link URL is printed to:

- the `npm run dev` terminal with a banner (`🔑 MAGIC LINK …`)
- `tmp/magic-links.log` (newline-delimited JSON)

Paste the URL in the same browser. Useful for offline dev / when you
don't want to set up SMTP.

**b) Real SMTP mode.** Set `EMAIL_SERVER` to a real SMTP connection
string and restart. Tested with **Gmail** (free, fine for low volume):

1. Enable 2-Step Verification on your Google account.
2. Google Account → Security → 2-Step Verification → **App passwords**.
3. Generate a new app password for "Mail" — Google gives you a 16-char
   token (no spaces).
4. In `.env.local`:
   ```env
   EMAIL_SERVER=smtp://your-email%40gmail.com:abcdwxyzabcdwxyz@smtp.gmail.com:587
   EMAIL_FROM=your-email@gmail.com
   ```
   (URL-encode the `@` in the username as `%40`.)
5. `npm run build && npm run start -- --port 3000`. Sign-in attempts
   now arrive in your Gmail inbox.

Gmail's limit is 500/day for personal accounts. For scale, swap to
Resend / Postmark — same `EMAIL_SERVER` shape.

## Architecture

### Multi-tenancy

Every domain table carries `user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE`.
Every API route does:

```ts
const session = await auth();
if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
// ... db.select/update/delete .where(and(<existing>, eq(t.userId, session.user.id)))
// ... db.insert(...).values({ userId: session.user.id, ...rest })
```

The edge middleware (`src/middleware.ts`) does a cheap session-cookie
presence check; full validation happens in the route handler via
`auth()` from `src/auth.ts`. Database session strategy means Auth.js
can't run in Edge runtime — the split-config pattern (`src/auth.config.ts`
vs `src/auth.ts`) keeps Node-only deps out of the middleware bundle.

### Money handling

Stored as integers in paisa, displayed as INR via `Intl.NumberFormat`.
Sum-bearing columns (totals, balances, property values) are `bigint`;
per-unit prices, counters, ages, periods stay `integer`. Drizzle's
`bigint('col', { mode: 'number' })` keeps JS Number semantics safely
through 2^53 paisa (≈ ₹9e13).

### Layout

```
src/
├── app/
│   ├── api/              # route handlers (all user-scoped)
│   ├── (dashboard)/      # authenticated UI
│   ├── login/            # public auth pages
│   └── layout.tsx
├── auth.config.ts        # Edge-safe Auth.js config
├── auth.ts               # Node Auth.js config (DrizzleAdapter, providers)
├── middleware.ts         # cookie presence redirect
├── db/
│   ├── index.ts          # postgres-js client + Drizzle
│   └── schema.ts         # 52 tables, source of truth
├── lib/
│   ├── finance/          # math: XIRR, EMI, retirement SWP, chit cash flows
│   ├── services/         # external APIs (Yahoo, AMFI, mfapi)
│   └── dxp-ui/           # symlink to ../dxp/packages/ui/src
└── types/
    └── next-auth.d.ts    # narrows session.user.id to required string
drizzle/                  # migration SQL + journal
scripts/                  # one-shot maintenance scripts
backups/                  # local pg_dump output (gitignored)
tmp/                      # stub-mode artifacts (gitignored)
STUBS.md                  # ledger of external integrations not yet wired
```

## Stubs

External integrations are stubbed until the product is validated.
Each stub fails loudly so we don't get silent no-ops in production.
See `STUBS.md` for the full ledger. As of Sprint 1, stubbed:

1. **Magic-link email send** — logs URL to console + `tmp/magic-links.log`.
2. **Cron endpoints** — alerts/check, daily-digest, sips/auto-execute
   all return 503. Per-tenant cron scheduling lands in Sprint 2.
3. **Telegram notifications** — slot exists, no payloads delivered.
4. **Billing** — no Razorpay wiring; every account is treated as full-tier.

## Importing data from personal v1

If you're migrating from [beedev/pfd](https://github.com/beedev/pfd):

```bash
node scripts/import/01-export-v1.mjs                          # SQLite → JSON
node scripts/import/02-import.mjs --owner-email=you@example.com
```

You must sign in once first so a `user` row exists with that email. The
import is idempotent on row IDs (preserves them; bumps sequences) and
read-only on the source v1 SQLite DB. See commit `27b99d1` for details.

## Roadmap

Tracked in `ORCHESTRATOR_CONTEXT.md` (gitignored — local workflow doc).
Sprint sequence:

- **Sprint 1** ✅ Foundation — Postgres + multi-tenancy + Auth
- **Sprint 1.5** ✅ Data import + smoke test (one-time, for the owner)
- **Sprint 2** ✅ Productize — onboarding, mobile-responsive, PWA, per-tenant cron, demo data, real SMTP. Docker self-host scaffold deferred to Sprint 5.
- **Sprint 3** ✅ India modules — Health Insurance (cards/claims/portability), Income tracker, Vehicles (insurance/PUC/service log), Subscriptions, Small Savings (PPF/VPF/NSC/KVP/SSY/SCSS with interest projection)
- **Sprint 3.5** ✅ Goals/Retirement architecture + IA regroup — sidebar regrouped (Investments / Insurance / Liabilities), `cashflow_events` substrate (auto-derived inflow timeline from insurance / NPS / PPF / SSY / rental / salary), goals get disbursement model + asset mapping + year-by-year projection, retirement page reads cashflow events for income arrivals
- **Sprint 4** ✅ Tax hardening — NEW vs OLD regime comparison + slab engine (FY 2025-26 / 2026-27 seeded for both regimes), Form 26AS reconciliation (PDF upload + book-vs-26AS view), quarterly advance-tax planner with 234B/234C warnings, ITR form wizard (1/2/3/4) auto-detecting from income sources, tax-aware net-of-tax inflow simulation flowing through goal + retirement projections via `cashflow_events.tax_treatment` + ITR-1/2/4 full walkthroughs (Sprint 4.1) + tax-calc fidelity (Sprint 5.1) with Yeswanth xlsx importer
- **Sprint 5** ⏳ SaaS infra — Razorpay billing, pricing tiers, Docker self-host, marketing + docs sites
- **Sprint 6** ⏳ Launch — deploy, domain, legal, observability, backups, beta, public

## License

TBD pre-launch. Not for public use until tagged `v1.0.0`.
