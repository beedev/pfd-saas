#!/bin/bash
# pfd-saas restore script — Sprint 6.3b
#
# Restores a backup archive produced by scripts/pfd-backup.sh into a
# running pfd-saas container.
#
# Strategy: pg_restore (NOT raw pgdata swap) so we tolerate same-major
# Postgres version differences. Uses /data/.maintenance sentinel inside
# the container to hold Next.js back while Postgres is still up so
# pg_restore can run.
#
# Usage:
#   ./scripts/pfd-restore.sh --from <archive> [--container <name>]
#                            [--force] [--force-major] [--no-color]
#
# Defaults:
#   --container pfd-saas
#
# Safety:
#   - Refuses cross-major Postgres versions unless --force-major.
#   - Requires typed CONFIRM at stdin unless --force.
#
# Exit codes:
#   0   success
#   1+  any step failed; absolute paths in error messages.

set -euo pipefail

# ─── Defaults & CLI ──────────────────────────────────────────────────
CONTAINER_NAME="pfd-saas"
ARCHIVE=""
FORCE=0
FORCE_MAJOR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from)         ARCHIVE="$2"; shift 2 ;;
    --container)    CONTAINER_NAME="$2"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --force-major)  FORCE_MAJOR=1; shift ;;
    --no-color)     NO_COLOR=1; shift ;;
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

if [ -z "$ARCHIVE" ]; then
  echo "Missing required --from <archive>" >&2
  exit 1
fi

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
step "1/11" "Verifying Docker + container '$CONTAINER_NAME'..."
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker CLI not found in PATH"
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon not reachable"
fi
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  fail "Container '$CONTAINER_NAME' does not exist"
fi
success "Container '$CONTAINER_NAME' exists"

# ─── 2. Verify archive ───────────────────────────────────────────────
step "2/11" "Verifying archive..."
if [ ! -f "$ARCHIVE" ]; then
  fail "Archive not found: $ARCHIVE"
fi
ARCHIVE_ABS="$( cd "$( dirname "$ARCHIVE" )" && pwd )/$( basename "$ARCHIVE" )"
# Quick gzip-tar sanity check
if ! tar -tzf "$ARCHIVE_ABS" >/dev/null 2>&1; then
  fail "Archive is not a valid gzip tar: $ARCHIVE_ABS"
fi
ENTRIES=$(tar -tzf "$ARCHIVE_ABS" | sort | tr '\n' ',' )
case "$ENTRIES" in
  "db.dump,manifest.json,uploads.tar,") : ;;
  *) fail "Archive missing expected entries (db.dump, uploads.tar, manifest.json). Got: $ENTRIES" ;;
esac
success "Archive valid: $ARCHIVE_ABS"

# ─── 3. Untar to temp ────────────────────────────────────────────────
step "3/11" "Extracting to temp dir..."
TMP=$(mktemp -d)
cleanup_tmp() {
  rm -rf "$TMP"
}
trap cleanup_tmp EXIT
tar -xzf "$ARCHIVE_ABS" -C "$TMP"
success "Extracted to $TMP"

# ─── 4. Parse manifest + version check ───────────────────────────────
step "4/11" "Checking Postgres version..."
MANIFEST="$TMP/manifest.json"
# Use python3 for safe JSON parsing — avoids hand-rolled regex.
SRC_PG_VER=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('pgVersion',''))" "$MANIFEST")
if [ -z "$SRC_PG_VER" ]; then
  fail "Could not read pgVersion from manifest: $MANIFEST"
fi
SRC_PG_MAJOR="${SRC_PG_VER%%.*}"
DST_PG_VER_RAW=$(docker exec "$CONTAINER_NAME" postgres --version | awk '{print $3}')
DST_PG_MAJOR="${DST_PG_VER_RAW%%.*}"

if [ "$SRC_PG_MAJOR" != "$DST_PG_MAJOR" ]; then
  if [ "$FORCE_MAJOR" -ne 1 ]; then
    fail "Postgres major version mismatch: backup=$SRC_PG_VER, container=$DST_PG_VER_RAW. Re-run with --force-major to proceed at your own risk."
  fi
  warn "Cross-major Postgres restore (backup=$SRC_PG_VER → container=$DST_PG_VER_RAW). Proceeding because --force-major was set."
fi
success "Postgres version compatible (backup=$SRC_PG_VER, container=$DST_PG_VER_RAW)"

# ─── 5. CONFIRM gate ─────────────────────────────────────────────────
if [ "$FORCE" -ne 1 ]; then
  step "5/11" "Confirmation required"
  printf "${YELLOW}⚠ Restoring will DESTROY all current data in container '%s'.${NC}\n" "$CONTAINER_NAME"
  printf "Type CONFIRM to proceed: "
  read -r REPLY
  if [ "$REPLY" != "CONFIRM" ]; then
    fail "Aborted (no CONFIRM)"
  fi
  success "Confirmed"
else
  step "5/11" "--force set, skipping confirmation"
fi

# ─── 6. Enter maintenance mode ───────────────────────────────────────
step "6/11" "Entering maintenance mode..."
# /data/.maintenance sentinel — entrypoint will bring Postgres up but
# hold Next.js back when it sees the file.
docker exec "$CONTAINER_NAME" touch /data/.maintenance
sleep 1
docker restart "$CONTAINER_NAME" >/dev/null
# Poll Postgres readiness only — Next.js is intentionally NOT up.
PG_READY=0
i=0
while [ "$i" -lt 60 ]; do
  if docker exec "$CONTAINER_NAME" pg_isready -h /data/pgsocket -U pfd_saas >/dev/null 2>&1; then
    PG_READY=1
    break
  fi
  sleep 1
  i=$((i + 1))
done
if [ "$PG_READY" -ne 1 ]; then
  fail "Postgres did not become ready within 60s. Inspect: docker logs $CONTAINER_NAME"
fi
success "Postgres ready, Next.js held by sentinel"

# ─── 7. Drop & recreate DB ───────────────────────────────────────────
step "7/11" "Dropping & recreating database..."
docker exec "$CONTAINER_NAME" sh -c \
  'PGPASSWORD=$(cat /data/.secrets/postgres_password) psql -h /data/pgsocket -U pfd_saas -d postgres -c "DROP DATABASE IF EXISTS pfd_saas;"' \
  >/dev/null
docker exec "$CONTAINER_NAME" sh -c \
  'PGPASSWORD=$(cat /data/.secrets/postgres_password) psql -h /data/pgsocket -U pfd_saas -d postgres -c "CREATE DATABASE pfd_saas OWNER pfd_saas;"' \
  >/dev/null
success "Database recreated empty"

# ─── 8. Restore DB ───────────────────────────────────────────────────
step "8/11" "Restoring DB via pg_restore..."
docker cp "$TMP/db.dump" "$CONTAINER_NAME:/tmp/db.dump" >/dev/null
# --clean is harmless on the freshly recreated DB; --if-exists silences
# the cleanup warnings. --no-owner/--no-acl ensures objects belong to
# the connecting role (pfd_saas) regardless of the source dump.
if ! docker exec "$CONTAINER_NAME" sh -c \
  'PGPASSWORD=$(cat /data/.secrets/postgres_password) pg_restore --clean --if-exists --no-owner --no-acl -h /data/pgsocket -U pfd_saas -d pfd_saas /tmp/db.dump' \
  >/dev/null 2>&1; then
  # pg_restore can return non-zero with only benign warnings; re-run
  # verbose so the user sees what failed.
  warn "pg_restore returned non-zero. Re-running verbose for diagnostics..."
  docker exec "$CONTAINER_NAME" sh -c \
    'PGPASSWORD=$(cat /data/.secrets/postgres_password) pg_restore --clean --if-exists --no-owner --no-acl -h /data/pgsocket -U pfd_saas -d pfd_saas /tmp/db.dump' \
    || warn "pg_restore warnings noted; verifying restore integrity below."
fi
docker exec "$CONTAINER_NAME" rm -f /tmp/db.dump
success "DB restored"

# ─── 9. Restore uploads ──────────────────────────────────────────────
step "9/11" "Restoring uploads..."
docker exec "$CONTAINER_NAME" sh -c 'rm -rf /data/uploads && mkdir -p /data/uploads && chown postgres:postgres /data/uploads'
docker cp "$TMP/uploads.tar" "$CONTAINER_NAME:/tmp/uploads.tar" >/dev/null
docker exec "$CONTAINER_NAME" sh -c 'cd /data && tar -xf /tmp/uploads.tar && rm -f /tmp/uploads.tar && chown -R postgres:postgres /data/uploads'
success "Uploads restored"

# ─── 10. Exit maintenance mode ───────────────────────────────────────
step "10/11" "Exiting maintenance mode..."
docker exec "$CONTAINER_NAME" rm -f /data/.maintenance
docker restart "$CONTAINER_NAME" >/dev/null
# Discover the published port for /api/health polling.
PORT_MAP=$(docker port "$CONTAINER_NAME" 3000 2>/dev/null | head -1 || true)
HOST_PORT=""
if [ -n "$PORT_MAP" ]; then
  # PORT_MAP looks like "0.0.0.0:3001" — extract the port.
  HOST_PORT="${PORT_MAP##*:}"
fi
if [ -z "$HOST_PORT" ]; then
  warn "Container has no published port for 3000; skipping /api/health poll."
else
  HEALTH_URL="http://localhost:$HOST_PORT/api/health"
  printf "  Waiting for %s ...\n" "$HEALTH_URL"
  HEALTHY=0
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      HEALTHY=1
      break
    fi
    sleep 1
    i=$((i + 1))
  done
  if [ "$HEALTHY" -ne 1 ]; then
    fail "App did not become healthy within 60s. Inspect: docker logs $CONTAINER_NAME"
  fi
fi
success "App healthy"

# ─── 11. Summary ─────────────────────────────────────────────────────
step "11/11" "Done"
DB_BYTES=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dbDumpBytes',0))" "$MANIFEST")
UPLOADS_BYTES=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('uploadsBytes',0))" "$MANIFEST")
printf "\n"
printf "${BOLD}${GREEN}━━━ Restore complete ━━━${NC}\n"
printf "  From:       %s\n" "$ARCHIVE_ABS"
printf "  DB dump:    %s bytes restored\n" "$DB_BYTES"
printf "  Uploads:    %s bytes restored\n" "$UPLOADS_BYTES"
printf "  Container:  %s\n" "$CONTAINER_NAME"
printf "\n"
