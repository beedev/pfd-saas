# Data portability

A single button on the Settings page exports everything you entered as a
JSON file, and a second button replaces all your data from a previously
saved file. Both actions stay entirely inside your container — nothing
is uploaded anywhere external.

## What's exported

Every row owned by your account across the 72 user-scoped tables that
make up your financial graph:

- Onboarding preferences, business profile, GST setup
- All investment positions: stocks, mutual funds, SIPs, gold, NPS, EPF,
  FDs, forex deposits, small-savings accounts, real estate, chit funds,
  insurance policies
- Liabilities: loans, credit cards, amortisation schedules
- Tax records: deductions, capital gains, salary income, Form 26AS
  uploads (the parsed rows, not the PDF itself), TDS credits, advance
  tax, ITR form selection
- Personal finance: budgets, recurring expenses, financial goals,
  cashflow events, projections, retirement assumptions, asset class
  returns
- Vehicles, health insurance, subscriptions
- Customers, vendors, invoices for GST-registered businesses
- Alerts, price snapshots, transaction history

## What's NOT exported

Intentionally excluded from the export:

- **Auth tables** (`users`, `sessions`, `accounts`, `verificationTokens`):
  managed by NextAuth. The destination container injects its own
  authenticated user id when you import.
- **Government reference data** (`taxSlabs`, `taxRegimeConfig`,
  `costInflationIndex`, `sacCodes`): every container ships with these
  seeded; copying them across would be redundant and risk drift.
- **Cron state** (`scheduledJobs`): machine-specific; never portable.
- **Uploaded files** (Form 26AS PDF, tax document scans): stay on disk.
  Use the Layer B container volume backup to capture these. See the
  forthcoming `docs/backup-restore.md` (Sprint 6.3).

## Version gating

Every export file embeds a `schemaHash` — a SHA-256 of the live
`src/db/schema.ts` source at the time of export. The import endpoint
refuses any file whose schema hash doesn't match the destination
container's current build, with an explicit error.

This is intentional: pfd-saas does not perform cross-version data
migration in v1. If your saved export is from an older build, you must
either reload the matching container image or wait for a future sprint
that adds migration scripts. The hash mismatch is your guarantee that
imports never produce silently broken data.

## How to use

### Export

1. Sign in.
2. Settings → scroll to **Data portability**.
3. Click **Download JSON**.

You'll get a file like `pfd-export-<userid>-<timestamp>.json`. Treat it
as sensitive: it contains every financial detail you entered.

### Import (Replace mode)

> Replace mode is **destructive**. Every row you own is deleted before
> the file is reinserted, all in a single Postgres transaction. If
> anything fails midway, the transaction rolls back and your existing
> data is untouched.

1. Settings → **Data portability** → **Replace from JSON…**
2. Select the previously-saved JSON file. You'll see a diff summary:
   how many rows of each type will be wiped, and how many will be
   inserted from the file.
3. To proceed: type **REPLACE** (case-sensitive) in the confirmation
   field, then click **Replace my data**.
4. On success, the page reloads and your dashboards show the imported
   state.

### Limits

- Upload cap: 25 MB. This covers a typical user's complete graph
  including text-heavy fields like Form 26AS raw HTML. If you hit the
  cap, clear stale Form 26AS uploads in `/tax/form-26as` before
  re-exporting.
- Cross-user import (importing your export into a container that
  already has another user's data with overlapping ids) will fail with
  a primary-key constraint error. The supported workflow is to import
  into a **fresh** container or **after wiping** other users.

## Round-trip guarantee

Export → Import → Re-export produces byte-identical JSON (everything
except the `exportedAt` timestamp). This is verified by the
`scripts/smoke-portability.mjs` smoke test in CI.

The internal row ids are preserved on round-trip so cross-table foreign
keys keep working without remapping. Drizzle sequences are advanced to
`MAX(id)` after the bulk insert so the next normal `INSERT` from the
app doesn't collide with imported ids.
