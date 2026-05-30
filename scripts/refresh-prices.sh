#!/usr/bin/env bash
# Daily price refresh — hits the stocks + MF refresh endpoints on the local
# dashboard service. Runs as a LaunchAgent (or cron) on the host machine.
#
# Both endpoints are in middleware PUBLIC_PATHS so no auth needed.

set -u

LOG_DIR="/Users/bharath/Desktop/personal-finance-dashboard/logs"
LOG_FILE="${LOG_DIR}/refresh-prices.log"
BASE="http://localhost:9999"

mkdir -p "${LOG_DIR}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "${LOG_FILE}"
}

call() {
  local endpoint="$1"
  local label="$2"
  local body
  body=$(curl -s -m 60 -X POST "${BASE}${endpoint}" -H "Content-Type: application/json" 2>&1)
  log "${label}: ${body}"
}

log "=== refresh-prices start ==="
call "/api/investments/stocks/refresh-prices" "stocks"
call "/api/investments/mutual-funds/refresh-navs" "mfs"
log "=== refresh-prices done ==="
