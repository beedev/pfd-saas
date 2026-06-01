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

### 3. Billing / subscriptions
- **Where:** No code yet; placeholder slot at `src/lib/services/billing.ts`.
- **Stub behaviour:** Every account treated as the only tier (full access).
- **What the real thing needs:** Sprint 5 Phase 2 — Razorpay subscriptions integration.
- **Why stub:** No product to bill for until Sprint 3 modules ship.
- **Added:** Future

## Replaced

### Telegram notifications (per-user) — Sprint 3.5+ follow-up
- **Was:** `sendTelegramMessage(text)` read `TELEGRAM_CHAT_ID` from the env. One bot, one global chat — single-tenant only.
- **Now:** Per-user routing. `sendTelegramToUser(userId, text)` looks up the user's `user_preferences.telegram_chat_id`. Users pair their own Telegram via `POST /api/integrations/telegram/start` (generates a UUID token, deep-links to `https://t.me/<bot>?start=<token>`), confirm with `/start` in Telegram (bot posts to `/api/integrations/telegram/webhook`, secured with `X-Telegram-Bot-Api-Secret-Token`). One bot serves every user; chat_id is per-user.
- **Env:** `TELEGRAM_BOT_TOKEN` (one bot, all users), `TELEGRAM_BOT_USERNAME` (for the deep link), `TELEGRAM_WEBHOOK_SECRET` (for inbound webhook auth). `TELEGRAM_CHAT_ID` is no longer read by the app — safe to remove.
- **Migration:** `0017_bitter_maddog.sql` added `telegram_chat_id`, `telegram_username`, `telegram_connect_token`, `telegram_connect_token_expires_at` to `user_preferences`. A one-shot SQL backfilled the original owner's existing chat_id so they don't have to re-pair.
- **Webhook registration:** `scripts/telegram-set-webhook.sh <https-webhook-url>` — one-time per deployment.

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
