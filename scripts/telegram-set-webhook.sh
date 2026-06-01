#!/usr/bin/env bash
# Register the pfd-saas Telegram webhook with Telegram's Bot API.
#
# Usage:
#   ./scripts/telegram-set-webhook.sh <PUBLIC_WEBHOOK_URL>
#
#   <PUBLIC_WEBHOOK_URL> must be an HTTPS URL Telegram can reach,
#   ending in /api/integrations/telegram/webhook
#   (e.g. https://pfd.example.com/api/integrations/telegram/webhook)
#
# Reads from environment / .env.local:
#   TELEGRAM_BOT_TOKEN        — bot API token (required)
#   TELEGRAM_WEBHOOK_SECRET   — shared secret passed as
#                               X-Telegram-Bot-Api-Secret-Token on each
#                               update (required; must match
#                               what's set in pfd-saas .env.local)
#
# Run once after deploy. Telegram persists the webhook until you change
# or delete it — re-running is idempotent but harmless.

set -euo pipefail

WEBHOOK_URL="${1:-}"
if [ -z "$WEBHOOK_URL" ]; then
  echo "ERROR: pass the webhook URL as the first argument."
  echo "       e.g. ./scripts/telegram-set-webhook.sh https://pfd.example.com/api/integrations/telegram/webhook"
  exit 1
fi

# Source .env.local if it's present and the env vars aren't already set.
if [ -f .env.local ]; then
  # shellcheck disable=SC2046
  set -a
  # shellcheck source=/dev/null
  . ./.env.local
  set +a
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN not set (env or .env.local)."
  exit 1
fi
if [ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]; then
  echo "ERROR: TELEGRAM_WEBHOOK_SECRET not set (env or .env.local)."
  echo "       Generate one with:  openssl rand -hex 32"
  exit 1
fi

echo "Registering webhook with Telegram..."
echo "  URL    : $WEBHOOK_URL"
echo "  Secret : (length ${#TELEGRAM_WEBHOOK_SECRET})"

RESP=$(curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<JSON
{
  "url": "${WEBHOOK_URL}",
  "secret_token": "${TELEGRAM_WEBHOOK_SECRET}",
  "allowed_updates": ["message"]
}
JSON
)")

echo "Response: $RESP"

# Telegram returns {"ok":true,"result":true,"description":"..."} on success.
if echo "$RESP" | grep -q '"ok":true'; then
  echo "✓ webhook registered."
  exit 0
fi

echo "✗ webhook registration failed. See response above."
exit 1
