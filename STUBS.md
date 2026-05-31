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
- **Where:** `src/auth.ts` — `buildEmailProvider()`.
- **Stub behaviour:** When `EMAIL_SERVER` is empty, logs the magic-link URL to `console.log` with a banner AND appends `{ts, identifier, url}` to `tmp/magic-links.log`. Does NOT send any email. **Auto-disables** when `EMAIL_SERVER` is set — Auth.js delivers via Nodemailer using whatever SMTP connection string is provided (Gmail App Password, Resend, Postmark, etc.).
- **What the real thing needs:** Sprint 5 Phase 1 — a production-grade transactional email provider (Resend or Postmark). For dev/self-host today, Gmail SMTP works fine for low volume; see README for App Password setup.
- **Why stub:** Avoid SMTP credentials before product is validated. Lets the owner sign in offline by copy-pasting the URL from the log.
- **Added:** Sprint 1 Phase 3
- **Updated:** Sprint 2 Phase 7 — added env-var-driven fallthrough to real SMTP.

### 2. Telegram notifications (alerts + digest)
- **Where:** `src/lib/services/telegram.ts` — `sendTelegramMessage()`.
- **Stub behaviour:** When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are NOT both set, logs the payload to `console.log` with a banner AND appends `{ts, text}` to `tmp/telegram-out.log`. Returns `true` so callers think delivery succeeded (otherwise alerts re-fire on every tick). If both env vars ARE set, falls through to the real Telegram API — the single-tenant personal-v1 path.
- **What the real thing needs:** A per-user bot routing model. The bot API is free, but a multi-tenant SaaS can't share one bot/chat across tenants. Sprint 5 or later.
- **Why stub:** Tenant-specific Telegram routing is unsolved.
- **Added:** Sprint 1 Phase 4 (planned), updated Sprint 2 Phase 5.

### 3. Billing / subscriptions
- **Where:** No code yet; placeholder slot at `src/lib/services/billing.ts`.
- **Stub behaviour:** Every account treated as the only tier (full access).
- **What the real thing needs:** Sprint 5 Phase 2 — Razorpay subscriptions integration.
- **Why stub:** No product to bill for until Sprint 3 modules ship.
- **Added:** Future

## Replaced

### Cron endpoints (per-tenant) — Sprint 2 Phase 5
- **Was:** `src/app/api/{alerts/check,daily-digest,investments/sips/auto-execute}/route.ts` returned 503 with a `TODO(sprint-2)` comment.
- **Now:** Each endpoint un-stubbed to call the matching lib module (`src/lib/cron/{alerts-check,daily-digest,sip-auto-execute}.ts`) for the authenticated user. A new `/api/cron/tick` dispatcher (bearer-auth via `CRON_SECRET`) iterates due rows in the `scheduled_jobs` table and runs jobs per-user. Schedule is baked in code for MVP; Sprint 7+ adds per-user override.
- **Migration:** `0007_petite_sauron.sql` creates `scheduled_jobs` + backfills 3 rows per existing user.

## What is NOT stubbed (live, no auth, free)

- Yahoo Finance v8 chart endpoint — stock/gold spot prices
- AMFI NAVAll.txt — mutual fund NAVs
- mfapi.in — historical mutual fund NAVs
- IBJA gold rate (with Yahoo fallback via GC=F × USDINR=X)

These are public GET endpoints with no auth, no rate limit you'd hit at
single-user scale, and no cost. They stay wired throughout the SaaS
build.
