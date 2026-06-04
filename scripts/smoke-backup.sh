#!/bin/bash
# smoke-backup.sh — Sprint 6.3e
#
# Round-trips a backup against the currently-running pfd-saas container:
#
#   1. backup → tar.gz exists
#   2. archive manifest schemaHash matches local
#      src/lib/portability/schema-hash.generated.ts
#   3. capture baseline holdings count
#   4. insert tagged junk row
#   5. restore --force
#   6. poll /api/health until 200
#   7. assert junk row gone, baseline count restored
#   8. run smoke-test-tax.mjs to confirm app integrity (20/20)
#
# Exit 0 only when every assertion passes.
#
# Usage:
#   ./scripts/smoke-backup.sh

set -euo pipefail

CONTAINER_NAME="pfd-saas"
USER_ID="dcc2a010-bf3e-44e5-8b6b-9fcd3bc521d3"
FY="2025-26"
OUT_DIR="/tmp/smoke-bk"
HEALTH_URL="http://localhost:3001/api/health"

if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

step()    { printf "${BLUE}[%s]${NC} %s\n" "$1" "$2"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()    { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fail()    { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# ─── Helper: psql against container ──────────────────────────────────
psql_q() {
  docker exec "$CONTAINER_NAME" sh -c \
    "PGPASSWORD=\$(cat /data/.secrets/postgres_password) psql -h /data/pgsocket -U pfd_saas -d pfd_saas -tAc \"$1\""
}

# ─── 0. Preconditions ────────────────────────────────────────────────
step "0/8" "Preconditions"
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  fail "Container '$CONTAINER_NAME' is not running"
fi
if ! curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  fail "App is not healthy at $HEALTH_URL — start it first"
fi
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
success "Container running, app healthy"

# ─── 1. Take backup ──────────────────────────────────────────────────
step "1/8" "Taking backup"
"$REPO_ROOT/scripts/pfd-backup.sh" --out "$OUT_DIR" --keep 3 --no-color >/dev/null
ARCHIVES=()
while IFS= read -r line; do
  ARCHIVES+=("$line")
done < <(ls -1t "$OUT_DIR"/pfd-backup-*.tar.gz 2>/dev/null || true)
if [ "${#ARCHIVES[@]}" -ne 1 ]; then
  fail "Expected exactly 1 archive in $OUT_DIR, found ${#ARCHIVES[@]}"
fi
ARCHIVE="${ARCHIVES[0]}"
success "Created $ARCHIVE"

# ─── 2. Manifest schemaHash check ────────────────────────────────────
step "2/8" "Verifying manifest schemaHash"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; rm -rf "$OUT_DIR"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"
MANIFEST_HASH=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['schemaHash'])" "$TMP/manifest.json")
LOCAL_HASH=$(grep -oE "sha256:[0-9a-f]+" "$REPO_ROOT/src/lib/portability/schema-hash.generated.ts" | head -1)
if [ "$MANIFEST_HASH" != "$LOCAL_HASH" ]; then
  fail "schemaHash mismatch: manifest=$MANIFEST_HASH local=$LOCAL_HASH"
fi
success "schemaHash matches: $MANIFEST_HASH"

# ─── 3. Baseline count ───────────────────────────────────────────────
step "3/8" "Capturing baseline holdings count"
BASELINE=$(psql_q "SELECT count(*) FROM holdings;")
BASELINE=$(echo "$BASELINE" | tr -d '[:space:]')
if [ -z "$BASELINE" ]; then
  fail "Could not read baseline holdings count"
fi
success "Baseline holdings: $BASELINE"

# ─── 4. Insert junk row ──────────────────────────────────────────────
step "4/8" "Inserting smoke-test junk row"
JUNK_TS=$(date -u +'%Y%m%d%H%M%S')
JUNK_SYMBOL="SMOKE-JUNK-$JUNK_TS"
psql_q "INSERT INTO holdings (symbol, quantity, average_price, current_price, purchase_date, total_investment, current_value, gain_loss, gain_loss_percent, user_id) VALUES ('$JUNK_SYMBOL', 1, 100, 100, '2026-01-01', 100, 100, 0, 0, '00000000-0000-0000-0000-00000000d3a0');" >/dev/null
COUNT_WITH_JUNK=$(psql_q "SELECT count(*) FROM holdings;" | tr -d '[:space:]')
if [ "$COUNT_WITH_JUNK" != "$((BASELINE + 1))" ]; then
  fail "After insert: expected $((BASELINE + 1)), got $COUNT_WITH_JUNK"
fi
success "Junk row inserted (count $BASELINE → $COUNT_WITH_JUNK)"

# ─── 5. Restore ──────────────────────────────────────────────────────
step "5/8" "Restoring from archive"
"$REPO_ROOT/scripts/pfd-restore.sh" --from "$ARCHIVE" --force --no-color >/dev/null
success "Restore script returned 0"

# ─── 6. Health poll ──────────────────────────────────────────────────
step "6/8" "Polling /api/health"
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
  fail "/api/health did not return 200 within 60s"
fi
success "App healthy after restore"

# ─── 7. Junk gone, baseline restored ─────────────────────────────────
step "7/8" "Asserting baseline restored"
COUNT_AFTER=$(psql_q "SELECT count(*) FROM holdings;" | tr -d '[:space:]')
if [ "$COUNT_AFTER" != "$BASELINE" ]; then
  fail "After restore: expected $BASELINE holdings, got $COUNT_AFTER"
fi
JUNK_AFTER=$(psql_q "SELECT count(*) FROM holdings WHERE symbol='$JUNK_SYMBOL';" | tr -d '[:space:]')
if [ "$JUNK_AFTER" != "0" ]; then
  fail "Junk row still present after restore (count=$JUNK_AFTER)"
fi
success "Junk gone, holdings=$COUNT_AFTER matches baseline"

# ─── 8. App integrity (smoke-test-tax) ───────────────────────────────
step "8/8" "Running smoke-test-tax.mjs"
if ! node "$REPO_ROOT/scripts/smoke-test-tax.mjs" "$USER_ID" "$FY" >/dev/null 2>&1; then
  # Re-run verbose for the user to see failures.
  node "$REPO_ROOT/scripts/smoke-test-tax.mjs" "$USER_ID" "$FY" || true
  fail "smoke-test-tax.mjs failed post-restore"
fi
success "smoke-test-tax.mjs: 20/20 OK"

# ─── Summary ─────────────────────────────────────────────────────────
printf "\n"
printf "${BOLD}${GREEN}━━━ smoke-backup OK ━━━${NC}\n"
printf "  Archive:        %s\n" "$ARCHIVE"
printf "  Baseline rows:  %s\n" "$BASELINE"
printf "  Junk symbol:    %s\n" "$JUNK_SYMBOL"
printf "  Post-restore:   %s holdings (junk count=0)\n" "$COUNT_AFTER"
printf "\n"
