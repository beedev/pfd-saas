#!/bin/bash
# Back up the vaspar-pfd production database to a single SQL file you can import
# into the Artha desktop app (Import from backup → upload this file).
#
#   ./scripts/backup-prod.sh                 # → ~/artha-backups/artha-prod-<date>.sql
#   ./scripts/backup-prod.sh /path/out.sql   # explicit output path
#
# Full dump (schema + data) with --inserts so it restores cleanly into PGlite.
set -euo pipefail

CONTAINER=vaspar-pfd
OUT=${1:-"$HOME/artha-backups/artha-prod-$(date +%d%m%Y-%H%M).sql"}
mkdir -p "$(dirname "$OUT")"

# Pull DATABASE_URL out of the running Next server process inside the container.
DBURL=$(docker exec "$CONTAINER" sh -c '
  for d in /proc/[0-9]*; do
    if grep -qa "server.js" "$d/cmdline" 2>/dev/null; then
      tr "\0" "\n" < "$d/environ" 2>/dev/null | sed -n "s/^DATABASE_URL=//p"
      break
    fi
  done')

if [ -z "$DBURL" ]; then
  echo "Could not read DATABASE_URL from $CONTAINER — is it running?" >&2
  exit 1
fi

echo "Dumping $CONTAINER → $OUT ..."
docker exec "$CONTAINER" pg_dump "$DBURL" --no-owner --no-privileges --inserts > "$OUT"
echo "Done: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Now open Artha → Import from backup → choose this file."
