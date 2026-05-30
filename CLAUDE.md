# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start — Read This First

This is **Bharath's personal finance dashboard** — a single-user INR investment/tax portal. NOT a demo app. It has REAL financial data (23 LIC policies, 9 SIPs, 4 chit funds, gold, NPS, PF, real estate, etc.).

**Key rules:**
- All money is stored in **paisa** (integer) in SQLite. Display divides by 100.
- UI components come from **@dxp/ui** (symlinked at `src/lib/dxp-ui/`). Import as `import { Button, Card, DataTable, ... } from '@dxp/ui'`. Never install third-party UI libraries.
- Every investment detail page has **inline edit** (Edit/Save/Cancel pattern with `isEditing` state).
- Use `lucide-react` for icons. Use `sonner` for toasts.
- **Read a file before editing it.** Always.
- **No test suite exists.** Don't attempt `npm test`.
- The DB file `personal-finance.db` is the single source of truth. Back it up before schema changes.
- `npm run db:push` may fail on existing indexes — use `sqlite3 personal-finance.db "ALTER TABLE ..."` directly for new columns.
- Yahoo Finance **v7 is dead** — always use v8 chart endpoint.
- **StatsDisplay** component: `value` must be `number` (not string), `columns` must be 2|3|4.

**Production service:** http://localhost:9999 (password in `.env.local`). Dev: http://localhost:3000.

**Pending task from last session:** Auto-add SIP/chit monthly payments to budget_entries for spend tracking.

---

# Personal Finance Dashboard

## What is this?

Bharath's personal financial planning portal. Single-user INR dashboard covering investments, tax planning, GST business filings, and net worth tracking. Built and iterated across 30+ commits.

**Path:** `/Users/bharath/Desktop/personal-finance-dashboard`
**Live URL:** http://localhost:9999 (production, auto-starts on reboot)
**Dev URL:** http://localhost:3000 (only when actively developing)
**Password:** Set in `.env.local` → `FINANCE_PASSWORD` (default: `bharath2026`)

## Stack

- **Framework:** Next.js 16.1.1 (App Router, Turbopack for dev)
- **Database:** SQLite via better-sqlite3 + Drizzle ORM (WAL mode)
- **DB file:** `personal-finance.db` (committed as baseline backup)
- **UI:** @dxp/ui component library (symlinked from `~/Desktop/dxp/packages/ui/src`)
- **Styling:** Tailwind 4 + CSS variables (`--dxp-*` injected in globals.css)
- **Forms:** react-hook-form + zod (registration pages), raw useState (inline edit)
- **Charts:** Recharts
- **Icons:** lucide-react
- **Toasts:** sonner
- **XIRR:** `xirr` npm package (Newton-Raphson solver)
- **PDF parsing:** pdfjs-dist 5.x (legacy build, server-side, marked as serverExternalPackage)

## Architecture

```
src/
├── app/
│   ├── (dashboard)/          # All authenticated pages (sidebar layout)
│   │   ├── page.tsx          # Home — Net Worth dashboard with 9 asset tiles
│   │   └── investments/
│   │       ├── stocks/       # Yahoo Finance v8 live prices
│   │       ├── mutual-funds/ # AMFI NAVAll.txt live NAV
│   │       ├── sips/         # SIP tracking with auto-execute + XIRR
│   │       ├── gold/         # SGB/ETF/Physical/Digital, Yahoo GC=F × USDINR
│   │       ├── nps/          # NPS Tier-I/II accounts
│   │       ├── pf/           # EPF/PPF/VPF
│   │       ├── real-estate/  # 5 property types + rental + mortgage
│   │       ├── insurance/    # LIC + health policies, premium calendar
│   │       ├── liabilities/  # Loans + credit cards, EMI calculator
│   │       ├── chit-funds/   # Chit subscriptions with dividends + XIRR
│   │       └── import/       # Generic PDF statement importer
│   │   ├── networth/         # Historical net-worth snapshots + breakdown charts
│   │   ├── analytics/        # Monthly cashflow trends + category pies
│   │   ├── projections/      # Goal tracking, monthly contribution required
│   │   ├── retirement/       # Corpus calculator + spending power
│   │   ├── goals/            # Redirect → /projections
│   │   ├── alerts/           # Reactive market/payment/portfolio alert rules
│   │   ├── daily-digest/     # Morning snapshot dashboard (Telegram source)
│   │   ├── settings/fy-close/# End-of-FY checklist + category locks
│   │   ├── tax/              # Section 80, capital gains, tax paid, 80G, LTCG/STCG, filing pack
│   │   └── budget/           # Budget allocation + carry-forward
│   ├── login/                # Password login page (outside dashboard group)
│   ├── api/
│   │   ├── auth/             # login + logout endpoints
│   │   ├── investments/      # REST CRUD for each asset type
│   │   ├── alerts/           # rules + check + history (Telegram-aware)
│   │   ├── daily-digest/     # market+portfolio JSON for Telegram digest
│   │   ├── tax/              # capital-gains, tax-paid, summary, 80g, ltcg-stcg
│   │   ├── settings/         # fy-close workflow + business profile
│   │   └── finance/budget/   # budget entries + carry-forward
│   └── layout.tsx            # Root layout (fonts, metadata)
├── components/layout/
│   └── sidebar.tsx           # Sectioned nav: Overview / Investments / Planning / GST
├── db/
│   ├── index.ts              # Drizzle + better-sqlite3 connection
│   └── schema.ts             # 31 tables, all money in paisa
├── lib/
│   ├── services/
│   │   ├── yahoo-finance.ts  # v8 chart endpoint (NOT v7 — needs crumb token)
│   │   ├── amfi.ts           # NAVAll.txt + mfapi.in historical NAV
│   │   ├── ibja.ts           # Gold rate: Yahoo GC=F × USDINR=X
│   │   ├── telegram.ts       # Bot API helper (Markdown sends, bot token + chat ID)
│   │   └── statement-parsers/# Generic PDF importer framework
│   │       ├── lic.ts        # LIC Premium Paid Statement parser
│   │       ├── chit-dsc.ts   # Chit Fund Form XIV parser
│   │       ├── mf-sip.ts     # MF CAS parser (stub — awaiting sample)
│   │       └── index.ts      # Registry + auto-detect + dispatch
│   └── finance/
│       ├── xirr.ts           # XIRR wrapper (returns %)
│       ├── chit-xirr.ts      # Chit cash flow builders (per-installment + summary-based)
│       ├── chit-presets.ts    # 8 foreman presets (DNC, Dhanalakshmi, etc.)
│       └── emi.ts            # EMI calculator + amortization schedule
├── middleware.ts              # Auth check (finance-session cookie)
└── lib/dxp-ui/               # Symlink → ~/Desktop/dxp/packages/ui/src
```

## Database — ~38 tables

All money stored in **paisa** (integer). Displayed as rupees via `Intl.NumberFormat('en-IN')`.

Newer tables beyond the original 31: `alert_rules`, `alert_history`, `capital_gains`, `income_tax_paid`, `budget_carry_forward`, `fy_close_status`, `credit_card_expenses`, `loan_amortization`.

Key tables and current record counts (as of 2026-04-09):
- `insurance_policies` (23) — LIC bulk-imported from PDF
- `mutual_funds` (11) + `sips` (9) — with auto-execute on due date
- `chit_funds` (4) + `chit_fund_installments` — 2 imported from PDF, 2 manually registered
- `gold_holdings` (1) — live rate from Yahoo
- `holdings` (1) — stocks
- `nps_accounts` (1), `provident_fund` (1), `real_estate` (3), `liabilities` (1)
- `investment_transactions` — SIP execution history
- `tax_deductions`, `tax_documents` — Section 80 dashboard
- `price_snapshots` — net worth time series
- GST tables: `customers`, `invoices`, `invoice_items`, `vendors`, `purchase_invoices`

Schema changes use `npm run db:push` (Drizzle push mode, no migrations folder).

## Key Features & How They Work

### PDF Statement Importer (`/investments/import`)
- Upload any PDF → auto-detects type (LIC / Chit / MF)
- LIC: extracts policies from Premium Paid Statement, UPSERT by policyNumber
- Chit: extracts metadata from Form XIV ledger (Dhanalakshmi format)
- MF SIP: stub awaiting a CAS sample PDF
- Entry points: "Import from PDF" button on Insurance and Chit Funds pages

### SIP Auto-Execute
- Cron runs daily at 9 AM → `POST /api/investments/sips/auto-execute`
- Finds ACTIVE SIPs where nextExecutionDate <= today
- Fetches **historical NAV for the actual due date** (not today) via mfapi.in
- Handles multi-month overdue (executes each month separately with correct NAV)
- Page-load overdue banner catches anything cron misses
- SIP due dates: 1 SIP on 1st (HDFC Mid Cap), 8 SIPs on 10th of each month
- Crontab: `0 9 * * * /Users/bharath/Desktop/personal-finance-dashboard/scripts/sip-auto-execute.sh`

### Inline Edit (All Asset Types)
Every investment detail page has Edit/Save/Cancel toggle:
- Stocks, MFs, SIPs, Gold, NPS, PF, Real Estate, Insurance, Liabilities, Chit Funds
- PATCH handlers accept partial updates (only fields in body are set)
- Money fields: body sends rupees, API converts to paisa

### Gold Rate — Single Source of Truth
- Gold list + detail pages fetch live rate from `/api/investments/gold/current-rate`
- All displayed values (current value, P&L, "Now rate") computed on-the-fly from live rate × grams × purity
- Stored DB values are fallback-only
- Buy price includes GST + wastage (actual cost basis, not spot)

### Chit Fund XIRR
- `calculateChitXirrFromSummary()` builds synthetic cash flows from summary state
- Past months: avg net outgo spread across paid installments
- Future months: full nominal monthly (no dividend assumed — conservative)
- Terminal: chit value at last month (worst-case win timing)
- Recompute endpoint: `POST /api/investments/chit-funds/recompute-xirr`

### Chit Installment Recording
- Quick-pay modal on list page + record modal on detail page
- Auto-calculates dividend: `dividend = monthly installment − amount paid`
- Month numbering: month 1 = start date (0-indexed addMonths)
- "Paid this month" section shows current month only

### Insurance
- Collapsible sections: Coverage adequacy, Premium calendar, Policies list
- Annuity fields for Whole Life policies
- All fields editable via detail page inline edit
- Quick action: `POST /api/investments/insurance/[id]/mark-paid` advances `nextPremiumDueDate` by `premiumFrequency`

### Alerts + Daily Digest (Telegram pipeline)
- **Alerts** (`/alerts`): user-defined rules across Market / Payment / Portfolio categories. Each rule has cooldown hours + enable flag. `POST /api/alerts/check` runs all enabled rules, fetches live market data, dedupes by cooldown, fires Telegram messages.
- **Daily Digest** (`/daily-digest`): morning snapshot — portfolio Δ vs prior snapshot, MF gainers/losers, indices/commodities/USD-INR, due action items, news. `GET /api/daily-digest` returns the JSON; `scripts/send-digest.mjs` formats + dispatches to Telegram.
- Both share `src/lib/services/telegram.ts` (Markdown bot helper).

### FY Close (`/settings/fy-close`)
- End-of-financial-year workflow with checklist (tax docs, capital gains, insurance audit, etc.)
- Per-category lock toggles, progress bar, "Close FY" advances business profile to next FY
- Endpoints: `GET/POST/PATCH /api/settings/fy-close`

### Tax Module Expansion
- `POST /api/tax/capital-gains` — log asset sales with LTCG/STCG classification, exemptions, computed tax
- `POST /api/tax/tax-paid` — income tax payment ledger per FY (for ITR cross-reference)

### Budget Carry-Forward
- `POST /api/finance/budget/carry-forward` — rolls unspent monthly allocations to next period via `budget_carry_forward` table

## Services & Cron

### Production Service (port 9999)
```bash
./scripts/service.sh start    # load LaunchAgent
./scripts/service.sh stop     # unload
./scripts/service.sh restart  # after rebuilds
./scripts/service.sh status   # check
./scripts/service.sh build    # npm run build shortcut
./scripts/service.sh logs     # tail service log
```
LaunchAgent: `~/Library/LaunchAgents/com.bharath.finance-dashboard.plist`
RunAtLoad + KeepAlive. Requires `npm run build` before first start.

### Daily Backup (8 AM)
- `scripts/backup-db.sh` → copies DB to `backups/YYYY-MM-DD/`
- Retains 30 days, prunes older
- LaunchAgent: `~/Library/LaunchAgents/com.bharath.finance-backup.plist`

### SIP Auto-Execute (9 AM daily)
- `scripts/sip-auto-execute.sh` → curls port 9999
- Crontab: `0 9 * * * /path/scripts/sip-auto-execute.sh`

### Daily Digest (8:30 AM)
- `scripts/send-digest.mjs` (or `daily-digest-telegram.sh` wrapper) → `GET /api/daily-digest` → format → Telegram
- LaunchAgent: `~/Library/LaunchAgents/com.bharath.daily-digest.plist`
- Logs: `logs/daily-digest.log`

### Alert Checker (5x daily — market hours)
- `scripts/check-alerts.mjs` → `POST /api/alerts/check`
- LaunchAgent: `~/Library/LaunchAgents/com.bharath.alert-checker.plist` — fires at 9:15, 11:15, 13:15, 15:15, 18:00 IST
- 3-attempt retry, logs to `logs/check-alerts.log`

## Critical Gotchas — READ BEFORE EDITING

1. **Yahoo Finance v7 is dead** — always use v8 chart endpoint. See `src/lib/services/yahoo-finance.ts`.
2. **SQLite WAL files** — if moving `personal-finance.db`, also move `.db-shm` and `.db-wal` together.
3. **Don't run dev (3000) and prod (9999) simultaneously for writes** — SQLite write lock will conflict.
4. **@dxp/ui is a symlink** — `src/lib/dxp-ui` → `~/Desktop/dxp/packages/ui/src`. Turbopack `root` is set to `~/Desktop` in `next.config.ts`. If the symlink breaks, the app won't compile.
5. **pdfjs-dist** must stay in `serverExternalPackages` in `next.config.ts` — Turbopack can't bundle its worker shim.
6. **StatsDisplay.value is `number` only** — never pass strings or dates. Use a manual Card for text values.
7. **StatsDisplay.columns accepts 2|3|4 only** — not 5.
8. **middleware.ts is deprecated in Next.js 16** — shows a warning but still works. Future: migrate to `proxy.ts`.
9. **All money in paisa** — API bodies send rupees, handlers multiply by 100. Display divides by 100.
10. **AMFI historical NAV** — uses `mfapi.in` (free, no auth). Cache per scheme code for 30 min.
11. **Chit installment months are 1-indexed** — month 1 = start date. `addMonths(startDate, monthNumber - 1)`.
12. **Chit dividend = installment − amount paid** — the "amount paid" IS the net. Don't double-subtract.
13. **Gold page values** — always derive from live rate, never display stale `currentValue`/`currentRatePerGram`.
14. **GST pages still use shadcn/ui** — don't touch them. Only investment pages use @dxp/ui.

## Deferred / Future Work

| Item | Notes |
|------|-------|
| Auto-add SIP/chit payments to budget | Track monthly investment outflows in budget_entries |
| MF CAS PDF import | Parser stubbed in statement-parsers/mf-sip.ts, awaiting sample |
| Mobile app (TestFlight) | Full plan in `docs/ROADMAP-MOBILE-CHITFUNDS.md` phases M1-M5 |
| Turso migration | Phase M1 — SQLite → cloud for multi-device |
| Vercel deployment | Phase M2 — production hosting |
| Mobile-responsive | Phase M3 — bottom tab bar, safe area insets |
| Capacitor iOS | Phase M4-M5 — native shell + TestFlight |
| middleware.ts → proxy.ts | Next.js 16 deprecation |
| DigiLocker / Gmail parser | Explicitly deferred |

## Dev Commands

```bash
npm run dev              # dev server on :3000 (Turbopack)
npm run build            # production build
npm run start:prod       # production server on :9999
npm run lint             # ESLint
npm run db:push          # push schema changes to SQLite (may fail on existing indexes — use sqlite3 ALTER TABLE directly)
npm run db:studio        # Drizzle Studio GUI for browsing DB
npm run db:seed-finance  # seed sample finance data
```

**No test suite exists** — there are no unit/integration tests configured. Don't attempt `npm test`.

## After Making Changes

```bash
npm run build
./scripts/service.sh restart
```

Dev server on :3000 reflects changes instantly via Turbopack hot reload.

## App Registry (auto-managed — do not edit manually)

- **Frontend port**: 3010
- **Start backend**: `./start.sh`
- **Start frontend**: `npm run dev -- --port {port}`

### Rules for Claude Code
- Frontend dev server MUST use port **3010**
- Do NOT pick arbitrary port numbers — use the ports listed above

<!-- end-app-registry -->
