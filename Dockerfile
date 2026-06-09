# ========================================================================
# pfd-saas — single-container Docker image for self-host preview
#
# Three stages:
#   1. deps    — install full node_modules (incl. dev) for the build
#   2. builder — compile Next.js to standalone (.next/standalone)
#   3. runner  — postgres:17-alpine base + Node 24 + the standalone app
#
# Runtime topology (single container):
#   tini (PID 1)
#   └─ docker-entrypoint.sh
#      ├─ initdb on first run (data in /data/pgdata)
#      ├─ pg_ctl start (postgres listens on 127.0.0.1:5432 only)
#      ├─ drizzle-kit migrate
#      └─ node server.js (listens on 0.0.0.0:3000, the exposed port)
#
# Persistence: a single named volume mounted at /data holds pgdata,
# uploads, and auto-generated secrets. Back up the volume = back up
# everything.
# ========================================================================

# ------------------------------------------------------------------------
# Stage 1: deps — install node_modules including dev (needed for build)
# ------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Skip the postinstall hooks of optional native deps we don't need for the
# server build (better-sqlite3 binaries, etc. are still rebuilt where
# required by npm). --ignore-scripts left off because drizzle-kit and
# better-sqlite3 need their normal install flow.
RUN npm ci

# ------------------------------------------------------------------------
# Stage 2: builder — compile the Next.js app to standalone
# ------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL is required by `next build` for type-checking; supply a
# placeholder that is never queried at build time. The real URL is
# constructed by the entrypoint at runtime.
ENV DATABASE_URL=postgres://dummy:dummy@dummy:5432/dummy
ENV AUTH_SECRET=build-only-secret-32-bytes-long-xxxxxx

RUN npm run build

# ------------------------------------------------------------------------
# Stage 3: runner — postgres-17 base with Node 24 and the Next.js app
# ------------------------------------------------------------------------
FROM postgres:17-alpine AS runner

# Install Node 24, tini (PID 1 zombie reaper), su-exec (drop to
# postgres uid without spawning a real shell), openssl (entrypoint
# uses it for random-password + AUTH_SECRET generation), and wget
# (HEALTHCHECK uses it to probe /api/health). postgres:17-alpine is
# distroless-ish so we have to add each tool explicitly.
RUN apk add --no-cache nodejs npm tini su-exec openssl wget

# App directory owned by the postgres user; postgres user already exists
# from the base image (uid 70 on Alpine).
RUN mkdir -p /app && chown postgres:postgres /app
WORKDIR /app

# Copy the standalone Next.js build. The standalone tree contains the
# bundled node_modules subset Next.js needs at runtime; we layer the
# additional bits below (drizzle-kit, postgres-js, schema, migrations).
COPY --from=builder --chown=postgres:postgres /app/.next/standalone ./
COPY --from=builder --chown=postgres:postgres /app/.next/static ./.next/static
COPY --from=builder --chown=postgres:postgres /app/public ./public

# Copy drizzle migrations (run on first start + future upgrades).
COPY --from=builder --chown=postgres:postgres /app/drizzle ./drizzle
COPY --from=builder --chown=postgres:postgres /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=postgres:postgres /app/src/db/schema.ts ./src/db/schema.ts

# Copy drizzle-kit + its dependencies into runtime so we can run
# migrations inside the container without re-installing dev deps.
# drizzle-kit is promoted to `dependencies` in package.json so its
# transitive tree lives in the standalone node_modules already; the
# explicit copies below are the kit binary and the few packages the
# standalone tree skipped.
COPY --from=builder --chown=postgres:postgres /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=builder --chown=postgres:postgres /app/node_modules/.bin/drizzle-kit ./node_modules/.bin/drizzle-kit
COPY --from=builder --chown=postgres:postgres /app/package.json ./package.json
COPY --from=builder --chown=postgres:postgres /app/tsconfig.json ./tsconfig.json
# postgres-js for the drizzle migration runner.
COPY --from=builder --chown=postgres:postgres /app/node_modules/postgres ./node_modules/postgres
# dotenv is read by drizzle.config.ts (it tries .env.local, .env). The
# entrypoint exports DATABASE_URL directly so the file lookups no-op
# gracefully, but the module still has to resolve.
COPY --from=builder --chown=postgres:postgres /app/node_modules/dotenv ./node_modules/dotenv

# drizzle-kit's dependency tree we need at runtime — it transpiles
# drizzle.config.ts on every invocation via esbuild + esbuild-register.
# The @esbuild/<platform> binary is matched to the build platform by
# `npm ci` in the deps stage.
COPY --from=builder --chown=postgres:postgres /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder --chown=postgres:postgres /app/node_modules/esbuild-register ./node_modules/esbuild-register
COPY --from=builder --chown=postgres:postgres /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=builder --chown=postgres:postgres /app/node_modules/@esbuild-kit ./node_modules/@esbuild-kit
COPY --from=builder --chown=postgres:postgres /app/node_modules/@drizzle-team ./node_modules/@drizzle-team
# drizzle-kit's reading-time check for drizzle-orm version. The
# standalone Next.js bundle already ships drizzle-orm inside its
# .next bundle, so the top-level node_modules tree is missing it.
COPY --from=builder --chown=postgres:postgres /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# pdfjs-dist legacy build — Next.js standalone only includes pdf.mjs
# (the entry it sees statically). pdf.worker.mjs is loaded dynamically
# even when getDocument() runs with disableWorker:true, so it must be
# physically present on disk or the require throws "Cannot find module
# pdf.worker.mjs". Statement parsers (Form 26AS, EPF passbook, NPS SOT,
# LIC, chit DSC) all import pdf-text.ts which depends on this.
COPY --from=builder --chown=postgres:postgres /app/node_modules/pdfjs-dist/legacy/build ./node_modules/pdfjs-dist/legacy/build

# Custom entrypoint orchestrates postgres + Next.js.
COPY --chown=postgres:postgres docker-entrypoint.sh /usr/local/bin/pfd-entrypoint.sh
RUN chmod +x /usr/local/bin/pfd-entrypoint.sh

# Persistent data volume — pgdata, uploads, secrets all live here.
VOLUME /data

# Healthcheck — Docker considers the container "healthy" once the
# /api/health endpoint responds 200 (added in Sprint 6.1d).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Internal port (host port mapped via -p flag at `docker run`).
EXPOSE 3000

# tini as PID 1 reaps zombies properly and forwards signals so docker
# stop / docker kill behave as expected.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/pfd-entrypoint.sh"]
