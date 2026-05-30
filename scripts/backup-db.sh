#!/bin/bash
# Rolling 3-file SQLite backup. Runs daily at 8 AM via LaunchAgent.
#
# Always exactly 3 files in backups/:
#   personal-finance.daily.db     — overwritten every day
#   personal-finance.weekly.db    — overwritten every Sunday
#   personal-finance.monthly.db   — overwritten on the 1st of each month
#
# Restore: copy the chosen .db file over personal-finance.db at the repo root
# (with the service stopped), then restart.

# Resolve script dir so we don't depend on a hardcoded user path.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_FILE="${PROJECT_DIR}/personal-finance.db"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/backup.log"

# Read BACKUP_DIR from .env.local if set (lets each machine point at its
# own OneDrive / iCloud / Dropbox folder). Falls back to ./backups.
ENV_FILE="${PROJECT_DIR}/.env.local"
BACKUP_DIR=""
if [ -f "$ENV_FILE" ]; then
  BACKUP_DIR="$(grep -E '^BACKUP_DIR=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
[ -z "$BACKUP_DIR" ] && BACKUP_DIR="${PROJECT_DIR}/backups"

mkdir -p "$LOG_DIR" "$BACKUP_DIR"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

log "--- Backup started ---"

if [ ! -f "$DB_FILE" ]; then
  log "ERROR: Database not found at ${DB_FILE}"
  exit 1
fi

# Use SQLite's online backup API via the `.backup` dot-command. Safer than
# `cp` for an active DB — it produces a consistent snapshot even with WAL
# writes in flight.
do_backup() {
  local DEST="$1"
  local LABEL="$2"
  if sqlite3 "$DB_FILE" ".backup '${DEST}'" 2>>"$LOG_FILE"; then
    local SIZE
    SIZE=$(du -h "$DEST" | cut -f1)
    log "Wrote ${LABEL} backup → ${DEST} (${SIZE})"
  else
    log "ERROR: ${LABEL} backup failed for ${DEST}"
    return 1
  fi
}

DAILY="${BACKUP_DIR}/personal-finance.daily.db"
WEEKLY="${BACKUP_DIR}/personal-finance.weekly.db"
MONTHLY="${BACKUP_DIR}/personal-finance.monthly.db"

do_backup "$DAILY" "daily"

# Sunday → refresh weekly. `date +%u` returns 1-7 (Mon-Sun).
if [ "$(date +%u)" = "7" ]; then
  do_backup "$WEEKLY" "weekly"
fi

# 1st of month → refresh monthly.
if [ "$(date +%d)" = "01" ]; then
  do_backup "$MONTHLY" "monthly"
fi

# Bootstrap weekly + monthly if missing (first run or fresh clone).
[ ! -f "$WEEKLY" ] && do_backup "$WEEKLY" "weekly (bootstrap)"
[ ! -f "$MONTHLY" ] && do_backup "$MONTHLY" "monthly (bootstrap)"

# Clean up legacy `backups/YYYY-MM-DD/` directories from the prior strategy.
DELETED=0
for old in "$BACKUP_DIR"/20*; do
  if [ -d "$old" ]; then
    rm -rf "$old"
    DELETED=$((DELETED + 1))
  fi
done
[ "$DELETED" -gt 0 ] && log "Pruned ${DELETED} legacy daily folders"

log "--- Backup finished ---"
