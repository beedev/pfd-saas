#!/bin/bash
# Auto-execute overdue SIPs — intended to run via crontab
# Requires server at localhost:9999 (production) or localhost:3000 (dev)
#
# Crontab entry (runs daily at 9 AM):
#   0 9 * * * /Users/bharath/Desktop/personal-finance-dashboard/scripts/sip-auto-execute.sh

LOG_DIR="/Users/bharath/Desktop/personal-finance-dashboard/logs"
LOG_FILE="${LOG_DIR}/sip-auto-execute.log"

mkdir -p "$LOG_DIR"

echo "--- $(date '+%Y-%m-%d %H:%M:%S') ---" >> "$LOG_FILE"

curl -sf -X POST http://localhost:9999/api/investments/sips/auto-execute \
  -H "Content-Type: application/json" \
  >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"
