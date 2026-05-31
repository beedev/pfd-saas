# CLAUDE.md — pfd-saas

Guidance for Claude Code when working in this repo.

## What this is

`pfd-saas` is the generic SaaS edition of the personal finance planner originally
built at [beedev/pfd](https://github.com/beedev/pfd). It is multi-tenant
(per-user data isolation), supports both **SQLite** (self-hosted) and
**Postgres** (cloud SaaS) via the `DATABASE_URL` env var, and runs as a
**PWA** so users can install it to their phone home screens.

Target market: India-only for v1. INR everywhere. All Indian tax modules
(NPS / EPF / PPF / 80C / GST / ITR) stay; structure leaves room for other
countries later.

## Key invariants (don't break these)

- **All money in paisa** (integer). Display layer divides by 100. Never store
  rupees-as-decimal.
- **Every domain table has `userId`** (FK to `users`). Every query must scope
  by current session's user. Middleware double-checks.
- **DB backend is env-driven** (`DATABASE_URL=sqlite://...` or
  `postgres://...`). Drizzle schema written portably; avoid SQLite-only
  functions (`unixepoch()`, etc).
- **No personal data in committed files** — seed scripts, fixtures, and
  examples must be synthetic.
- **API integrations**: Yahoo Finance v8 (stocks), AMFI NAVAll.txt + mfapi.in
  (MFs), Yahoo GC=F × USDINR=X (gold). All free, no API keys.

## Stack

- Next.js 16, App Router, Turbopack dev
- Drizzle ORM (better-sqlite3 + postgres-js adapters)
- Auth.js (NextAuth) with email magic-link
- Tailwind 4 + @dxp/ui design system (symlinked from sibling dxp repo)
- Recharts for graphs
- sonner for toasts
- pdfjs-dist for PDF imports (row-aware extraction)

## Dev commands

```bash
npm install
npm run db:generate            # generate Drizzle migrations
npm run db:migrate             # apply migrations
npm run dev                    # dev server on :3000 (Turbopack)
npm run build                  # production build
npm start                      # production server
npm run lint
```

## Environment variables

- `DATABASE_URL` — `sqlite://./local.db` or `postgres://...`
- `AUTH_SECRET` — random 32+ bytes (`openssl rand -base64 32`)
- `EMAIL_SERVER` / `EMAIL_FROM` — for Auth.js magic-link emails
- `NEXT_PUBLIC_APP_URL` — canonical URL for callbacks

## What stays from the original repo

All the math: XIRR, EMI/amortization, prepay simulator, retirement bucket
SWP, PV-of-growing-annuity, ladder PV, chit fund math.

All the asset modules: Stocks, MFs, SIPs, Gold, NPS, PF, Real Estate,
Insurance, Liabilities, Chit Funds, Fixed Deposits.

All UI primitives, charts, snapshot machinery, alert framework.

## What's new for SaaS

- Auth (Auth.js magic-link)
- Multi-tenant userId everywhere
- Postgres adapter alongside SQLite
- PWA shell + mobile-responsive layout
- Onboarding wizard + empty states
- Health insurance, income tracker, vehicle insurance, small savings, etc.
- Pricing tiers + billing (Razorpay)

## Don't

- Don't hardcode any user-specific data anywhere.
- Don't add SQLite-only schema features without a Postgres equivalent.
- Don't bypass auth/userId scoping in any new query.
- Don't commit `.env*`, `*.db`, `uploads/`, or `.claude/`.

## App Registry (auto-managed — do not edit manually)

- **Frontend port**: 3000
- **Start backend**: `./start.sh`
- **Start frontend**: `npm run dev -- --port {port}`

### Rules for Claude Code
- Frontend dev server MUST use port **3000**
- Do NOT pick arbitrary port numbers — use the ports listed above

<!-- end-app-registry -->
