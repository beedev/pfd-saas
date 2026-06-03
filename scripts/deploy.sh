#!/bin/bash
# pfd-saas one-shot deployment script
#
# Only prerequisite: Docker Desktop running.
#
# What it does:
#   1. Verifies Docker is reachable.
#   2. Checks the target port is free; bumps to the next one if not.
#   3. Builds (or pulls) the pfd-saas image.
#   4. Stops and removes any existing container with the same name.
#   5. Starts the container with a persistent named volume.
#   6. Waits for /api/health to return 200 (up to 120s — first run does
#      initdb + migrations and is the slow path).
#   7. Opens the browser (macOS only) and prints next-steps.
#
# Usage from inside the repo:
#   ./scripts/deploy.sh
# or
#   PORT=3001 ./scripts/deploy.sh

set -e

# ─── Constants ───────────────────────────────────────────────────────
CONTAINER_NAME="${CONTAINER_NAME:-pfd-saas}"
IMAGE_TAG="${IMAGE_TAG:-pfd-saas:latest}"
VOLUME_NAME="${VOLUME_NAME:-pfd_saas_data}"
PORT="${PORT:-3000}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-120}"

# ─── Color output (NO_COLOR=1 disables) ───────────────────────────────
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

step() { printf "${BLUE}[%s]${NC} %s\n" "$1" "$2"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

# ─── 1. Docker prereq ─────────────────────────────────────────────────
step "1/6" "Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker CLI not found. Install Docker Desktop from https://www.docker.com/products/docker-desktop"
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not reachable. Open Docker Desktop, wait for it to be ready, then re-run."
fi
success "Docker is ready"

# ─── 2. Port check ────────────────────────────────────────────────────
step "2/6" "Checking port $PORT..."
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  PORT_NEXT=$((PORT + 1))
  warn "Port $PORT is in use. Falling back to $PORT_NEXT."
  PORT=$PORT_NEXT
fi
success "Will bind on host port $PORT"

# ─── 3. Build or pull image ───────────────────────────────────────────
step "3/6" "Preparing image $IMAGE_TAG..."
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -f "$REPO_ROOT/Dockerfile" ]; then
  printf "  Building from %s/Dockerfile (this can take 5–10 minutes on first run)...\n" "$REPO_ROOT"
  ( cd "$REPO_ROOT" && docker build -t "$IMAGE_TAG" . )
else
  printf "  No local Dockerfile, pulling %s...\n" "$IMAGE_TAG"
  docker pull "$IMAGE_TAG"
fi
success "Image ready"

# ─── 4. Stop existing container if any ────────────────────────────────
step "4/6" "Cleaning up any existing $CONTAINER_NAME container..."
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  success "Removed previous container (data in volume $VOLUME_NAME is preserved)"
else
  success "No previous container to clean up"
fi

# ─── 5. Run container ─────────────────────────────────────────────────
step "5/6" "Starting $CONTAINER_NAME..."
CONTAINER_ID=$(docker run -d \
  -v "$VOLUME_NAME:/data" \
  -p "$PORT:3000" \
  -e "AUTH_URL=http://localhost:$PORT" \
  --name "$CONTAINER_NAME" \
  "$IMAGE_TAG")
success "Container started (id: ${CONTAINER_ID:0:12})"

# ─── 6. Wait for health ───────────────────────────────────────────────
step "6/6" "Waiting for the app to be ready (up to ${HEALTH_TIMEOUT_SEC}s)..."
printf "  "
for i in $(seq 1 "$HEALTH_TIMEOUT_SEC"); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    printf "\n"
    success "App is healthy"
    break
  fi
  printf "."
  if [ "$i" = "$HEALTH_TIMEOUT_SEC" ]; then
    printf "\n"
    fail "App never became healthy. Inspect with: docker logs $CONTAINER_NAME"
  fi
  sleep 1
done

# ─── Summary + browser open ───────────────────────────────────────────
URL="http://localhost:$PORT"
printf "\n"
printf "${BOLD}${GREEN}━━━ pfd-saas is running ━━━${NC}\n\n"
printf "  Open:     ${BOLD}%s${NC}\n" "$URL"
printf "  Logs:     docker logs -f %s\n" "$CONTAINER_NAME"
printf "  Stop:     docker stop %s\n" "$CONTAINER_NAME"
printf "  Restart:  docker start %s\n" "$CONTAINER_NAME"
printf "  Backup:   docker exec %s pg_dump -U pfd_saas pfd_saas > pfd-saas-\$(date +%%Y-%%m-%%d).sql\n" "$CONTAINER_NAME"
printf "  Wipe:     docker stop %s && docker rm %s && docker volume rm %s\n" "$CONTAINER_NAME" "$CONTAINER_NAME" "$VOLUME_NAME"
printf "\n"
printf "  First-time setup: pick ${YELLOW}Try the demo${NC} or ${YELLOW}Use my own data${NC}\n"
printf "  from the login screen. Switch between accounts anytime via the\n"
printf "  sidebar's ⇆ Switch button.\n"
printf "\n"

# macOS: auto-open the browser
if command -v open >/dev/null 2>&1 && [ "$(uname)" = "Darwin" ]; then
  open "$URL"
fi
