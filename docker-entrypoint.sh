#!/bin/sh
# ========================================================================
# pfd-saas Docker entrypoint
#
# Orchestrates a single-container postgres + Next.js stack:
#   1. Bootstrap /data layout (pgdata, uploads, secrets, socket dir)
#   2. First run: initdb + generate a random postgres password + lock
#      pg_hba.conf to localhost-only with scram-sha-256 auth
#   3. First run: generate AUTH_SECRET if not already present
#   4. Start postgres in the background, wait for it to accept connections
#   4b. Idempotently (re)set the role password from /data/.secrets and
#       enforce scram-sha-256 in pg_hba.conf (upgrades volumes created
#       when this file still wrote `trust`), then reload postgres
#   5. Ensure the application database exists
#   6. Run drizzle-kit migrate against the live database
#   7. Exec the Next.js standalone server in the foreground (PID becomes
#      the entrypoint child; tini handles signal forwarding)
#
# All persistent state lives under /data — back up that volume and you
# have everything: DB, uploads, secrets.
# ========================================================================
set -e

# ─── Paths & constants ───────────────────────────────────────────────
DATA_DIR=/data
PGDATA=$DATA_DIR/pgdata
UPLOADS=$DATA_DIR/uploads
SECRETS=$DATA_DIR/.secrets
PGSOCKET=$DATA_DIR/pgsocket

PG_USER=pfd_saas
PG_DB=pfd_saas

# ─── Bootstrap directories ───────────────────────────────────────────
mkdir -p "$PGDATA" "$UPLOADS" "$SECRETS" "$PGSOCKET"
chown -R postgres:postgres "$DATA_DIR"
chmod 700 "$PGDATA" "$SECRETS"

# ─── First-run: initdb + generate secrets ────────────────────────────
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[entrypoint] First run — initializing postgres data directory..."

  # Generate strong password for the internal postgres role. Never
  # exposed to the outside world. Stored at /data/.secrets/postgres_password
  # so subsequent container restarts can reconstruct DATABASE_URL.
  if [ ! -f "$SECRETS/postgres_password" ]; then
    su-exec postgres sh -c "openssl rand -base64 32 | tr -d /=+ | cut -c1-32" > "$SECRETS/postgres_password"
    chmod 600 "$SECRETS/postgres_password"
    chown postgres:postgres "$SECRETS/postgres_password"
  fi
  PG_PASS=$(cat "$SECRETS/postgres_password")

  # initdb writes the cluster files; --pwfile reads the postgres role
  # password from a file (not the process argv list).
  # Note: <(...) process substitution is not POSIX-sh; use a temp file
  # to stay compatible with /bin/sh (Alpine ships busybox sh).
  PWFILE=$(mktemp)
  echo "$PG_PASS" > "$PWFILE"
  chown postgres:postgres "$PWFILE"
  chmod 600 "$PWFILE"

  su-exec postgres initdb \
    --pgdata="$PGDATA" \
    --username="$PG_USER" \
    --pwfile="$PWFILE" \
    --encoding=UTF8 \
    --locale=C.UTF-8 \
    --no-instructions

  rm -f "$PWFILE"

  # Lock down: only allow connections from inside the container, and
  # require the scram-sha-256 password we just generated. The password
  # is already set at this point — initdb's --pwfile hashes it (PG 17's
  # password_encryption defaults to scram-sha-256), so no `trust`
  # bootstrap window is needed on first boot.
  cat > "$PGDATA/pg_hba.conf" <<EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
EOF
  chown postgres:postgres "$PGDATA/pg_hba.conf"
fi

# ─── Generate AUTH_SECRET on first run ───────────────────────────────
# Used by next-auth to sign sessions. Regenerating invalidates all
# existing sessions, which is why we persist it.
if [ ! -f "$SECRETS/auth_secret" ]; then
  openssl rand -base64 32 > "$SECRETS/auth_secret"
  chmod 600 "$SECRETS/auth_secret"
  chown postgres:postgres "$SECRETS/auth_secret"
fi
export AUTH_SECRET=$(cat "$SECRETS/auth_secret")

# ─── Generate CRON_SECRET on first run ───────────────────────────────
# The in-container scheduler (below) authenticates to /api/cron/tick with
# this bearer secret; the Next.js process validates against the same value.
# Persisted so restarts keep a stable secret.
if [ ! -f "$SECRETS/cron_secret" ]; then
  openssl rand -base64 32 | tr -d /=+ | cut -c1-40 > "$SECRETS/cron_secret"
  chmod 600 "$SECRETS/cron_secret"
  chown postgres:postgres "$SECRETS/cron_secret"
fi
export CRON_SECRET=$(cat "$SECRETS/cron_secret")

# ─── Telegram bot token (optional, persisted in the volume) ───────────
# If a -e TELEGRAM_BOT_TOKEN was passed, persist it so future redeploys
# don't need it again. Otherwise load a previously-persisted token. When
# neither exists, Telegram sends are simply skipped (no error).
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  printf '%s' "$TELEGRAM_BOT_TOKEN" > "$SECRETS/telegram_bot_token"
  chmod 600 "$SECRETS/telegram_bot_token"
  chown postgres:postgres "$SECRETS/telegram_bot_token"
elif [ -f "$SECRETS/telegram_bot_token" ]; then
  export TELEGRAM_BOT_TOKEN=$(cat "$SECRETS/telegram_bot_token")
fi

# ─── OpenAI API key (optional, persisted in the volume) ──────────────
# Powers the Transformation tracker's nutrition estimator. Pasted in
# Settings → written here → auto-loaded on boot. Absent → estimates skipped.
if [ -n "${OPENAI_API_KEY:-}" ]; then
  printf '%s' "$OPENAI_API_KEY" > "$SECRETS/openai_api_key"
  chmod 600 "$SECRETS/openai_api_key"
  chown postgres:postgres "$SECRETS/openai_api_key"
elif [ -f "$SECRETS/openai_api_key" ]; then
  export OPENAI_API_KEY=$(cat "$SECRETS/openai_api_key")
fi

# ─── Instance owner name (optional, persisted in the volume) ─────────
# Shows as "<Owner>’s Artha". Set via -e APP_OWNER (persisted) or in
# Settings → Personalize. Absent → plain "Artha".
if [ -n "${APP_OWNER:-}" ]; then
  printf '%s' "$APP_OWNER" > "$SECRETS/app_owner"
  chmod 600 "$SECRETS/app_owner"
  chown postgres:postgres "$SECRETS/app_owner"
elif [ -f "$SECRETS/app_owner" ]; then
  export APP_OWNER=$(cat "$SECRETS/app_owner")
fi

# ─── Start postgres in background ────────────────────────────────────
# `-l /dev/stdout` fails on Alpine because postgres can't open /dev/stdout
# with the permissions it wants. Use a regular log file under /data
# instead; entrypoint tails it to the container stdout after start so
# `docker logs` still surfaces postgres output.
PG_LOG=$DATA_DIR/postgres.log
touch "$PG_LOG"
chown postgres:postgres "$PG_LOG"

echo "[entrypoint] Starting postgres..."
su-exec postgres pg_ctl \
  -D "$PGDATA" \
  -l "$PG_LOG" \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=$PGSOCKET" \
  -w start

# Stream postgres logs to the container stdout in the background. tail
# -F handles log rotation; the process exits when the container does.
tail -F "$PG_LOG" &

# ─── Enforce scram-sha-256 auth (idempotent, every startup) ──────────
# Two volume generations exist:
#   • Fresh volumes — pg_hba.conf already says scram-sha-256 (written in
#     the first-run block above) and the role password was set by
#     initdb --pwfile. The connection below authenticates via PGPASSWORD.
#   • Pre-existing volumes — pg_hba.conf still says `trust` (written by
#     an older entrypoint), so the connection below succeeds without a
#     password. We then (re)set the role password from the secrets file
#     — idempotent, and guarantees a scram-sha-256 hash exists that
#     matches DATABASE_URL — before rewriting pg_hba.conf to
#     scram-sha-256 and reloading. Order matters: password first, then
#     flip auth, so we never lock ourselves out mid-startup.
PG_PASS=$(cat "$SECRETS/postgres_password")
export PGPASSWORD="$PG_PASS"

echo "[entrypoint] Ensuring role password + scram-sha-256 auth..."
# Password is fed via stdin (not argv) so it never shows up in `ps`.
# The generated password is strictly alphanumeric (openssl base64 with
# /=+ stripped), so single-quoting it in SQL is safe.
su-exec postgres psql -h 127.0.0.1 -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -q <<SQL
SET password_encryption = 'scram-sha-256';
ALTER ROLE $PG_USER WITH PASSWORD '$PG_PASS';
SQL

cat > "$PGDATA/pg_hba.conf" <<EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
EOF
chown postgres:postgres "$PGDATA/pg_hba.conf"
su-exec postgres pg_ctl -D "$PGDATA" reload >/dev/null

# ─── Ensure database exists ──────────────────────────────────────────

# psql -lqt | cut -d \| -f 1 | grep -qw $PG_DB
# Match the database name on the cleaned-up list. If absent, create it.
if ! su-exec postgres psql -h 127.0.0.1 -U "$PG_USER" -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$PG_DB"; then
  echo "[entrypoint] Creating database $PG_DB..."
  su-exec postgres psql -h 127.0.0.1 -U "$PG_USER" -d postgres -c "CREATE DATABASE $PG_DB;"
fi

# DATABASE_URL is consumed by drizzle.config.ts (build-time migration)
# and by the runtime app (next-auth adapter, query layer).
export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:5432/${PG_DB}"

# ─── Maintenance sentinel (Sprint 6.3c) ──────────────────────────────
# scripts/pfd-restore.sh creates /data/.maintenance to signal that
# Postgres should be up but the application (and migrations) must be
# held back so an external pg_restore can swap the database safely.
#
# Behavior when sentinel is present at this point in startup:
#   • Skip drizzle migrations (the restored dump already carries schema)
#   • Loop until the sentinel is removed (max 30 min — safety cap)
#   • Then fall through to migrations + Next.js launch
#
# The restore script's flow:
#   touch /data/.maintenance → docker restart → script runs pg_restore
#   via docker exec → script removes sentinel → docker restart (again).
# So in practice the wait loop is a belt-and-suspenders safety net for
# the case where someone forgets to remove the sentinel.
if [ -f "$DATA_DIR/.maintenance" ]; then
  echo "[entrypoint] /data/.maintenance present — Postgres up; Next.js held"
  # Max wait: 30 min (360 × 5s). Beyond that, log a warning and proceed
  # rather than hang silently.
  WAIT_SECS=0
  MAX_WAIT=1800
  while [ -f "$DATA_DIR/.maintenance" ] && [ "$WAIT_SECS" -lt "$MAX_WAIT" ]; do
    sleep 5
    WAIT_SECS=$((WAIT_SECS + 5))
  done
  if [ -f "$DATA_DIR/.maintenance" ]; then
    echo "[entrypoint] WARNING: /data/.maintenance still present after ${MAX_WAIT}s — proceeding anyway"
    rm -f "$DATA_DIR/.maintenance" || true
  else
    echo "[entrypoint] sentinel removed after ${WAIT_SECS}s — resuming normal startup"
  fi
fi

# ─── Run migrations ──────────────────────────────────────────────────
# drizzle-kit migrate is idempotent; the migrations journal in
# drizzle/meta/_journal.json tracks which hashes have been applied.
echo "[entrypoint] Running drizzle migrations..."
cd /app
npx drizzle-kit migrate 2>&1 || echo "[entrypoint] WARNING: migrations may have already been applied"

# ─── Configurable env (testers can override via -e flags) ────────────
export NODE_ENV=production
export PORT=3000
export HOSTNAME=0.0.0.0
export NEXT_TELEMETRY_DISABLED=1
# MAGIC_LINK_DISPLAY:
#   ui    — surface the link via /api/auth/pending-link (default)
#   email — send via SMTP (requires EMAIL_SERVER)
#   both  — surface in UI AND send via SMTP
export MAGIC_LINK_DISPLAY=${MAGIC_LINK_DISPLAY:-ui}
# Auth.js URL construction:
# - Next.js standalone server binds to HOSTNAME=0.0.0.0, so Auth.js's
#   "use the request URL" path produces URLs like `http://0.0.0.0:3000/…`
#   — unreachable from the user's browser.
# - The fix: set AUTH_URL to the host:port the user's browser will use.
#   deploy.sh passes `-e AUTH_URL=http://localhost:<host_port>` so the
#   port matches whatever the deployer mapped with `-p`. Manual
#   `docker run` users should pass it themselves.
# - Default falls back to localhost:3000, matching the most common
#   `-p 3000:3000` mapping. If the deployer maps differently and
#   doesn't pass AUTH_URL, post-login redirects break.
export AUTH_URL=${AUTH_URL:-http://localhost:3000}
# Sprint 6.1.6 — FEEDBACK_URL is consumed in (dashboard)/layout.tsx
# (server component) and passed as a prop to the Sidebar. No bridge
# needed; the entrypoint's environment is already inherited by the
# Next.js process.
# Sprint 6.1.9 — built-in Demo/Personal account switcher. Defaults to
# ON for the Docker self-host (click-to-sign-in, no email needed).
# Production SaaS deployments should pass `-e DEMO_PERSONAL_SWITCH=false`
# to restore the magic-link flow. Consumed by:
#   - src/app/login/page.tsx (chooses AccountChooser vs MagicLinkForm)
#   - src/app/api/auth/switch-account/route.ts (404s when disabled)
#   - src/app/(dashboard)/layout.tsx (bridges to Sidebar prop)
export DEMO_PERSONAL_SWITCH=${DEMO_PERSONAL_SWITCH:-true}

# ─── In-container scheduler (replaces V1's LaunchAgents/cron) ─────────
# A backgrounded ticker waits for the app to come up, then POSTs
# /api/cron/tick every CRON_INTERVAL_SECONDS (default 60). cron/tick runs
# any scheduled_jobs whose next_run_at <= NOW (daily_digest / alerts_check
# / sip_auto_execute) and advances them — so a 1-minute tick drives jobs of
# any cadence with no external scheduler. Set DISABLE_CRON=true to opt out
# (e.g. when an external scheduler hits /api/cron/tick instead).
if [ "${DISABLE_CRON:-false}" != "true" ]; then
  CRON_INTERVAL_SECONDS=${CRON_INTERVAL_SECONDS:-60}
  echo "[entrypoint] In-container scheduler ON (every ${CRON_INTERVAL_SECONDS}s)"
  (
    # Wait for the server to accept requests before the first tick.
    until wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health 2>/dev/null; do
      sleep 2
    done
    echo "[scheduler] app is up — ticking /api/cron/tick every ${CRON_INTERVAL_SECONDS}s"
    while true; do
      wget --quiet --tries=1 --timeout=120 -O /dev/null \
        --header="Authorization: Bearer ${CRON_SECRET}" \
        --post-data='' \
        http://127.0.0.1:3000/api/cron/tick 2>/dev/null || true
      sleep "${CRON_INTERVAL_SECONDS}"
    done
  ) &
else
  echo "[entrypoint] In-container scheduler OFF (DISABLE_CRON=true) — drive /api/cron/tick externally"
fi

# ─── Start Next.js in foreground ─────────────────────────────────────
echo "[entrypoint] Starting Next.js on http://0.0.0.0:3000..."
exec node server.js
