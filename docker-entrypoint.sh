#!/bin/sh
# ========================================================================
# pfd-saas Docker entrypoint
#
# Orchestrates a single-container postgres + Next.js stack:
#   1. Bootstrap /data layout (pgdata, uploads, secrets, socket dir)
#   2. First run: initdb + generate a random postgres password + lock
#      pg_hba.conf to localhost-only
#   3. First run: generate AUTH_SECRET if not already present
#   4. Start postgres in the background, wait for it to accept connections
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

  # Lock down: only allow connections from inside the container.
  # `trust` is acceptable here because the only path to the socket
  # is from PID 1 namespace inside the container.
  cat > "$PGDATA/pg_hba.conf" <<EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
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

# ─── Ensure database exists ──────────────────────────────────────────
PG_PASS=$(cat "$SECRETS/postgres_password")
export PGPASSWORD="$PG_PASS"

# psql -lqt | cut -d \| -f 1 | grep -qw $PG_DB
# Match the database name on the cleaned-up list. If absent, create it.
if ! su-exec postgres psql -h 127.0.0.1 -U "$PG_USER" -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$PG_DB"; then
  echo "[entrypoint] Creating database $PG_DB..."
  su-exec postgres psql -h 127.0.0.1 -U "$PG_USER" -d postgres -c "CREATE DATABASE $PG_DB;"
fi

# DATABASE_URL is consumed by drizzle.config.ts (build-time migration)
# and by the runtime app (next-auth adapter, query layer).
export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:5432/${PG_DB}"

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

# ─── Start Next.js in foreground ─────────────────────────────────────
echo "[entrypoint] Starting Next.js on http://0.0.0.0:3000..."
exec node server.js
