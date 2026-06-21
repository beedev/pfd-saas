#!/bin/bash
# Production deploy for the vaspar-pfd instance (:9999).
#
# HARD GATE: refuses to build unless the git working tree is clean. The prod
# image MUST come from committed code only.
#
# Why this gate exists — the 2026-06-21 incident: an *untracked* migration
# (0043_form_16a_uploads.sql) sat in the working tree, `docker build` copied it
# into the image (.dockerignore doesn't exclude drizzle/), and it got applied to
# the prod DB. A later regenerate of that same migration then collided on prod
# with "relation already exists". Committed-only builds make dev and prod
# converge on the exact same, reviewed migration set.
#
# Usage:  scripts/deploy-prod.sh
set -euo pipefail

CONTAINER=vaspar-pfd
IMAGE=vaspar-pfd:latest
VOLUME=vaspar-pfd-data
PORT=9999

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. Commit-clean gate ────────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree is dirty — commit (or stash) everything before deploying to prod."
  echo "  Uncommitted/untracked files are baked into the image and applied to the prod DB."
  echo
  git status --short
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"
BRANCH="$(git branch --show-current)"
echo "▶ Deploying ${BRANCH} @ ${SHA} → ${CONTAINER} (:${PORT})"

# ── 2. Back up the prod DB first ────────────────────────────────────────
if [ -f scripts/backup-vaspar-pfd.mjs ]; then
  echo "▶ Backing up prod DB..."
  node scripts/backup-vaspar-pfd.mjs
fi

# ── 3. Build from committed code, stamped with the commit ───────────────
echo "▶ Building ${IMAGE} (this takes a few minutes)..."
docker build --label "git.sha=${SHA}" --label "git.branch=${BRANCH}" -t "${IMAGE}" .

# ── 4. Recreate the container (named volume preserves /data → the DB) ────
echo "▶ Recreating ${CONTAINER}..."
docker stop "${CONTAINER}" >/dev/null 2>&1 || true
docker rm "${CONTAINER}" >/dev/null 2>&1 || true
docker run -d \
  -v "${VOLUME}:/data" \
  -p "${PORT}:3000" \
  -e "AUTH_URL=http://localhost:${PORT}" \
  -e "APP_OWNER=Bharath" \
  -e "DEMO_PERSONAL_SWITCH=true" \
  --restart unless-stopped \
  --name "${CONTAINER}" \
  "${IMAGE}" >/dev/null

# ── 5. Wait for health ──────────────────────────────────────────────────
printf "▶ Waiting for health "
for i in $(seq 1 90); do
  if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo " ✓ healthy"
    break
  fi
  printf "."
  sleep 2
  if [ "$i" = 90 ]; then echo " ✗ never healthy — inspect: docker logs ${CONTAINER}"; exit 1; fi
done

echo "✓ Deployed ${SHA}."
echo "  Verify migrations:  docker logs ${CONTAINER} 2>&1 | grep -iE 'migrat|error'"
