#!/bin/bash
# Daily Digest → Telegram
# Fetches digest from localhost:9999, formats, and sends via Telegram Bot API.
#
# Crontab entry (daily at 8:30 AM):
#   30 8 * * * /Users/bharath/Desktop/personal-finance-dashboard/scripts/daily-digest-telegram.sh
#
# Requires: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.telegram

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/daily-digest-telegram.log"

mkdir -p "$LOG_DIR"

echo "--- $(date '+%Y-%m-%d %H:%M:%S') ---" >> "$LOG_FILE"

# Refresh live prices first so the digest reflects today's values.
# Failures are logged but do not block the digest — better to send a slightly
# stale digest than nothing at all.
BASE="http://localhost:9999"
for endpoint in \
  "/api/investments/gold/refresh-rates" \
  "/api/investments/mutual-funds/refresh-navs" \
  "/api/investments/stocks/refresh-prices"; do
  resp=$(curl -s -m 60 -X POST "${BASE}${endpoint}" -H "Content-Type: application/json" 2>&1)
  echo "refresh ${endpoint}: ${resp}" >> "$LOG_FILE"
done

# Run the Node.js formatter script
node "${SCRIPT_DIR}/send-digest.mjs" >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"
