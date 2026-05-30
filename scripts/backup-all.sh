#!/usr/bin/env bash
# backup-all.sh — bundle everything you need to restore on a fresh machine
# into a single tarball. Includes the DB + secrets, not the code (which
# lives in git).
#
# Output: finance-bundle-YYYY-MM-DD-HHMMSS.tar.gz in the current directory.
# Move this to iCloud/USB/Drive — that's your portable backup.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STAMP="$(date +%Y-%m-%d-%H%M%S)"

cd "$PROJECT_DIR"

# Read BACKUP_DIR from .env.local so the tarball goes wherever the rolling
# backups already live (typically OneDrive). Falls back to repo root.
ENV_FILE="${PROJECT_DIR}/.env.local"
BACKUP_DIR=""
if [ -f "$ENV_FILE" ]; then
  BACKUP_DIR="$(grep -E '^BACKUP_DIR=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
[ -z "$BACKUP_DIR" ] && BACKUP_DIR="${PROJECT_DIR}"
mkdir -p "$BACKUP_DIR"

OUT="${BACKUP_DIR}/finance-bundle-${STAMP}.tar.gz"

# Stage everything in a temp dir, then tar the dir. Simpler and more reliable
# than chained -C flags. SQLite .backup gives a consistent snapshot of the
# live DB even if the service has it open.
STAGE="$(mktemp -d)"
trap "rm -rf '$STAGE'" EXIT

sqlite3 personal-finance.db ".backup '$STAGE/personal-finance.db'"
echo "→ snapshot DB"

for f in .env .env.local; do
  [ -f "$f" ] && cp "$f" "$STAGE/" && echo "→ include $f"
done

mkdir -p "$STAGE/backups"
for name in personal-finance.daily.db personal-finance.weekly.db personal-finance.monthly.db; do
  src="${BACKUP_DIR}/${name}"
  if [ -f "$src" ]; then
    cp "$src" "$STAGE/backups/$name"
    echo "→ include $src"
  fi
done

tar -czf "$OUT" -C "$STAGE" .

SIZE="$(du -h "$OUT" | cut -f1)"
echo ""
echo "✓ Wrote $OUT ($SIZE)"
if [[ "$BACKUP_DIR" == "$PROJECT_DIR" ]]; then
  echo "  Tip: set BACKUP_DIR in .env.local to write directly into your cloud-sync folder."
fi
echo "  Restore on the new machine with: ./scripts/restore-all.sh <path-to-this-tarball>"
