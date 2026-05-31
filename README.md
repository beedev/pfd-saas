# pfd-saas

A generic personal finance planner for India. SaaS edition of
[beedev/pfd](https://github.com/beedev/pfd) — multi-tenant, Postgres-backed,
magic-link auth.

**Status:** Sprint 1 complete — multi-tenant skeleton with the owner's
real data imported and two-user isolation verified end-to-end. Pre-launch;
no public deploy yet.

---

## What it does

Tracks the full INR portfolio of an Indian retail investor:

- **Investments:** Stocks, Mutual Funds, SIPs, Gold (SGB/ETF/Physical/Digital),
  NPS Tier-I/II, EPF/PPF/VPF, Real Estate, Chit Funds, Fixed Deposits, Term
  & Life Insurance.
- **Liabilities:** Loans (home/personal/vehicle) with EMI amortization +
  prepay simulator, credit cards with statement tracking.
- **Tax (Indian):** Section 80 deductions, capital gains (LTCG/STCG),
  income tax paid ledger, 80G donations, ITR-3 filing-pack generator.
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

### 7. Sign in (Sprint 1 — magic-link send is **stubbed**)

The Auth.js EmailProvider stub does NOT send a real email. Instead, the
magic-link URL is printed to:

- the `npm run dev` terminal with a banner (`🔑 MAGIC LINK …`)
- `tmp/magic-links.log` (newline-delimited JSON)

Paste the URL in the same browser. Auth.js validates the token, creates
a session row, and lands you on `/`. Real SMTP wires in Sprint 5; see
`STUBS.md` entry #1.

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
- **Sprint 2** ⏳ Productize — onboarding, mobile-responsive, PWA, per-tenant cron, demo data, docker-compose
- **Sprint 3** ⏳ India modules — Health Insurance, Income tracker, Vehicle Insurance, Subscriptions, Small Savings Schemes
- **Sprint 4** ⏳ Tax hardening — regime toggle, slab abstraction, Form 26AS, ITR-1/2 export
- **Sprint 5** ⏳ SaaS infra — real SMTP, Razorpay billing, pricing tiers, marketing + docs sites
- **Sprint 6** ⏳ Launch — deploy, domain, legal, observability, backups, beta, public

## License

TBD pre-launch. Not for public use until tagged `v1.0.0`.
