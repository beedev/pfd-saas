#!/bin/bash
# pfd-saas backup script — Sprint 6.3a
#
# Produces a single tar.gz containing:
#   - db.dump        Postgres custom-format dump (pg_dump -Fc, already
#                    gzip-compressed by Postgres internally)
#   - uploads.tar    Tar of /data/uploads (per-user files: 26AS PDFs, etc.)
#   - manifest.json  Metadata: image id/repo, pg version, sizes, schema hash
#
# Usage:
#   ./scripts/pfd-backup.sh [--container <name>] [--out <dir>] [--keep <n>] [--no-color]
#
# Defaults:
#   --container pfd-saas
#   --out       ./backups
#   --keep      7        (older archives pruned)
#
# Exit codes:
#   0   success
#   1+  any step failed; absolute paths are included in error messages so
#       a tester can find the broken artifact without re-running.

set -euo pipefail

# ─── Defaults & CLI ──────────────────────────────────────────────────
CONTAINER_NAME="pfd-saas"
OUT_DIR="./backups"
KEEP=7

while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER_NAME="$2"; shift 2 ;;
    --out)       OUT_DIR="$2"; shift 2 ;;
    --keep)      KEEP="$2"; shift 2 ;;
    --no-color)  NO_COLOR=1; shift ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ─── Color output (NO_COLOR=1 disables) ───────────────────────────────
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

step()    { printf "${BLUE}[%s]${NC} %s\n" "$1" "$2"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()    { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fail()    { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

# ─── 1. Verify Docker + container ────────────────────────────────────
step "1/8" "Verifying Docker + container '$CONTAINER_NAME'..."
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker CLI not found in PATH"
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon not reachable (open Docker Desktop and retry)"
fi
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  fail "Container '$CONTAINER_NAME' does not exist"
fi
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  fail "Container '$CONTAINER_NAME' is not running. Start it first: docker start $CONTAINER_NAME"
fi
success "Container '$CONTAINER_NAME' is running"

# ─── 2. Resolve OUT_DIR to absolute path ─────────────────────────────
mkdir -p "$OUT_DIR"
OUT_DIR_ABS="$( cd "$OUT_DIR" && pwd )"
TS="$(date -u +'%Y%m%d-%H%M%S')"
WORK_DIR="$OUT_DIR_ABS/work-$TS"
ARCHIVE="$OUT_DIR_ABS/pfd-backup-$TS.tar.gz"
mkdir -p "$WORK_DIR"

cleanup_work() {
  rm -rf "$WORK_DIR"
}
trap cleanup_work EXIT

step "2/8" "Output directory: $OUT_DIR_ABS"
success "Workspace: $WORK_DIR"

# ─── 3. Dump database ────────────────────────────────────────────────
step "3/8" "Dumping Postgres (pg_dump -Fc)..."
# pg_dump -Fc writes the custom format (already gzip-compressed). We
# stream it from inside the container to the host file.
if ! docker exec "$CONTAINER_NAME" sh -c \
  'PGPASSWORD=$(cat /data/.secrets/postgres_password) pg_dump -h /data/pgsocket -U pfd_saas -d pfd_saas -F c' \
  > "$WORK_DIR/db.dump"; then
  fail "pg_dump failed. See $WORK_DIR/db.dump (partial) for context."
fi
DB_BYTES=$(wc -c < "$WORK_DIR/db.dump" | tr -d ' ')
if [ "$DB_BYTES" -lt 1024 ]; then
  fail "db.dump is suspiciously small (${DB_BYTES} bytes). Check container logs."
fi
success "db.dump: ${DB_BYTES} bytes"

# ─── 4. Archive uploads ──────────────────────────────────────────────
step "4/8" "Archiving uploads..."
# uploads dir may be empty or missing entirely. tar -C /data uploads/
# handles the empty case fine; we guard the missing case explicitly so
# the error message is actionable.
if ! docker exec "$CONTAINER_NAME" test -d /data/uploads; then
  warn "/data/uploads does not exist inside container; creating empty tar."
  tar -cf "$WORK_DIR/uploads.tar" -T /dev/null
else
  if ! docker exec "$CONTAINER_NAME" tar -C /data -cf - uploads/ > "$WORK_DIR/uploads.tar"; then
    fail "tar of /data/uploads failed inside container."
  fi
fi
UPLOADS_BYTES=$(wc -c < "$WORK_DIR/uploads.tar" | tr -d ' ')
success "uploads.tar: ${UPLOADS_BYTES} bytes"

# ─── 5. Gather metadata ──────────────────────────────────────────────
step "5/8" "Gathering metadata..."
IMAGE_ID=$(docker inspect -f '{{.Image}}' "$CONTAINER_NAME")
IMAGE_REPO=$(docker inspect -f '{{index .Config.Image}}' "$CONTAINER_NAME")
PG_VERSION_RAW=$(docker exec "$CONTAINER_NAME" postgres --version | awk '{print $3}')
PG_VERSION="$PG_VERSION_RAW"
CREATED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

# Schema hash: read from local repo (the running image was built from
# this checkout). Regex-extract the sha256 token to avoid TS quoting
# subtleties. If absent, record "unknown" rather than failing — the
# backup is still valid; only cross-build portability would warn.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SCHEMA_HASH_FILE="$REPO_ROOT/src/lib/portability/schema-hash.generated.ts"
SCHEMA_HASH="unknown"
if [ -r "$SCHEMA_HASH_FILE" ]; then
  EXTRACTED=$(grep -oE "sha256:[0-9a-f]+" "$SCHEMA_HASH_FILE" | head -1 || true)
  if [ -n "$EXTRACTED" ]; then
    SCHEMA_HASH="$EXTRACTED"
  fi
fi

cat > "$WORK_DIR/manifest.json" <<EOF
{
  "backupVersion": "pfd-saas/0.6.3",
  "createdAt": "$CREATED_AT",
  "containerName": "$CONTAINER_NAME",
  "imageId": "$IMAGE_ID",
  "imageRepo": "$IMAGE_REPO",
  "pgVersion": "$PG_VERSION",
  "dbDumpBytes": $DB_BYTES,
  "uploadsBytes": $UPLOADS_BYTES,
  "schemaHash": "$SCHEMA_HASH"
}
EOF
success "manifest.json written"

# ─── 6. Pack archive ─────────────────────────────────────────────────
step "6/8" "Packing $ARCHIVE..."
tar -czf "$ARCHIVE" -C "$WORK_DIR" db.dump uploads.tar manifest.json
ARCHIVE_BYTES=$(wc -c < "$ARCHIVE" | tr -d ' ')
success "Archive: ${ARCHIVE_BYTES} bytes"

# ─── 7. Clean workspace (trap also handles) ──────────────────────────
step "7/8" "Cleaning workspace..."
cleanup_work
trap - EXIT
success "Workspace removed"

# ─── 8. Retention ────────────────────────────────────────────────────
step "8/8" "Applying retention (keep $KEEP)..."
# List archives sorted by mtime descending; delete past index $KEEP.
# Bash 3.2 (macOS default) lacks mapfile, so we read into an array via
# a while-loop. Filenames never contain newlines (they're timestamped),
# so newline-as-delimiter is safe.
ARCHIVES=()
while IFS= read -r line; do
  ARCHIVES+=("$line")
done < <(ls -1t "$OUT_DIR_ABS"/pfd-backup-*.tar.gz 2>/dev/null || true)
TOTAL=${#ARCHIVES[@]}
PRUNED=0
if [ "$TOTAL" -gt "$KEEP" ]; then
  i=$KEEP
  while [ "$i" -lt "$TOTAL" ]; do
    rm -f "${ARCHIVES[$i]}"
    printf "  pruned: %s\n" "${ARCHIVES[$i]}"
    PRUNED=$((PRUNED + 1))
    i=$((i + 1))
  done
fi
KEPT=$((TOTAL - PRUNED))
success "Kept $KEPT, pruned $PRUNED"

# ─── Summary ─────────────────────────────────────────────────────────
printf "\n"
printf "${BOLD}${GREEN}━━━ Backup complete ━━━${NC}\n"
printf "  Archive:    %s\n" "$ARCHIVE"
printf "  Size:       %s bytes\n" "$ARCHIVE_BYTES"
printf "  DB dump:    %s bytes\n" "$DB_BYTES"
printf "  Uploads:    %s bytes\n" "$UPLOADS_BYTES"
printf "  Retention:  keep last %s (%s pruned this run)\n" "$KEEP" "$PRUNED"
printf "\n"
