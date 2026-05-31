# STUBS — external integrations not yet wired

Until pfd-saas runs end-to-end against the owner's real data, anything
that needs a paid third-party API, a real SMTP relay, or a webhook
target is stubbed. This file is the canonical list. When a stub is
replaced with the real thing, move it to **Replaced** at the bottom
with the date and commit.

Rule of thumb: every stub MUST fail loud in a way the operator notices.
Silent no-op = bug factory. Either log prominently, write to disk, or
return a 503.

## Active stubs

### 1. Magic-link email send
- **Where:** `src/auth.ts` — `sendVerificationRequest` callback on the EmailProvider.
- **Stub behaviour:** Logs the magic-link URL to `console.log` with a banner AND appends `{ts, identifier, url}` to `tmp/magic-links.log`. Does NOT send any email.
- **What the real thing needs:** Sprint 5 Phase 1 — a transactional email provider (Resend or Postmark). `EMAIL_SERVER` and `EMAIL_FROM` env vars filled.
- **Why stub:** Avoid SMTP credentials before product is validated. Lets the owner sign in offline by copy-pasting the URL from the log.
- **Added:** Sprint 1 Phase 3

### 2. Cron endpoints (per-tenant)
- **Where:** `src/app/api/alerts/check/route.ts`, `src/app/api/investments/sips/auto-execute/route.ts`, `src/app/api/daily-digest/route.ts`.
- **Stub behaviour:** Return `503 Service Unavailable` with a `TODO(sprint-2)` comment in the source.
- **What the real thing needs:** Sprint 2 Phase 5 — a per-tenant job ledger and a `/api/cron/tick` dispatcher.
- **Why stub:** Personal v1's cron logic assumed a single user. Multi-tenant scheduling is its own design problem.
- **Added:** Sprint 1 Phase 4 (planned)

### 3. Telegram notifications (alerts + digest)
- **Where:** `src/lib/services/telegram.ts` — `sendTelegramMessage()`.
- **Stub behaviour:** Logs the would-be Telegram payload to `console.log` and appends to `tmp/telegram-out.log`. Returns `true` so callers think delivery succeeded.
- **What the real thing needs:** A real bot token + chat ID in env. The provider is already free (Telegram Bot API), but tying a single bot to a multi-tenant SaaS needs per-user bot tokens or a routing model.
- **Why stub:** Tenant-specific Telegram routing is unsolved. Sprint 5 or later.
- **Added:** Sprint 1 Phase 4 (planned)

### 4. Billing / subscriptions
- **Where:** No code yet; placeholder slot at `src/lib/services/billing.ts`.
- **Stub behaviour:** Every account treated as the only tier (full access).
- **What the real thing needs:** Sprint 5 Phase 2 — Razorpay subscriptions integration.
- **Why stub:** No product to bill for until Sprint 3 modules ship.
- **Added:** Future

## Replaced

*(empty — nothing has been replaced yet)*

## What is NOT stubbed (live, no auth, free)

- Yahoo Finance v8 chart endpoint — stock/gold spot prices
- AMFI NAVAll.txt — mutual fund NAVs
- mfapi.in — historical mutual fund NAVs
- IBJA gold rate (with Yahoo fallback via GC=F × USDINR=X)

These are public GET endpoints with no auth, no rate limit you'd hit at
single-user scale, and no cost. They stay wired throughout the SaaS
build.
