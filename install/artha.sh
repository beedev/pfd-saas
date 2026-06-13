#!/usr/bin/env bash
#
# Artha — self-host control script.
#
#   ./artha.sh install     pull the image + start Artha (first time)
#   ./artha.sh start        start a stopped Artha
#   ./artha.sh stop         stop Artha (data is kept)
#   ./artha.sh restart      restart Artha
#   ./artha.sh status       show whether Artha is running
#   ./artha.sh logs         tail the logs (Ctrl-C to quit)
#   ./artha.sh update       pull the latest image + recreate (data kept)
#   ./artha.sh backup       save a database backup to ~/artha-backups
#   ./artha.sh uninstall    remove the container (data volume KEPT)
#
# Override defaults with env vars, e.g.:
#   ARTHA_PORT=8080 ARTHA_OWNER=Bharath ./artha.sh install
#
set -euo pipefail

IMAGE="${ARTHA_IMAGE:-ghcr.io/beedev/pfd-saas:latest}"
NAME="${ARTHA_NAME:-artha}"
PORT="${ARTHA_PORT:-9999}"
VOLUME="${ARTHA_VOLUME:-artha-data}"
OWNER="${ARTHA_OWNER:-}"
BACKUP_DIR="${ARTHA_BACKUP_DIR:-$HOME/artha-backups}"

need_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "✗ Docker is not installed. See README.md → Step 1 (Install Docker)."; exit 1; }
  docker info >/dev/null 2>&1 || {
    echo "✗ Docker is installed but not running."
    echo "  Start Docker Desktop (macOS/Windows) or 'sudo systemctl start docker' (Linux), then retry."
    exit 1; }
}

run_container() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  docker run -d --name "$NAME" --restart unless-stopped \
    -p "${PORT}:3000" \
    -v "${VOLUME}:/data" \
    -e AUTH_URL="http://localhost:${PORT}" \
    -e DEMO_PERSONAL_SWITCH=true \
    ${OWNER:+-e APP_OWNER="$OWNER"} \
    "$IMAGE" >/dev/null
}

wait_healthy() {
  printf "Waiting for Artha to start"
  for _ in $(seq 1 45); do
    if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then echo " ✓"; return 0; fi
    printf "."; sleep 2
  done
  echo; echo "⚠ Not healthy yet — check './artha.sh logs'."; return 1
}

case "${1:-}" in
  install)
    need_docker
    if [ -z "$OWNER" ]; then
      read -rp "Your name (shows as \"<name>'s Artha\"; blank for plain Artha): " OWNER || true
    fi
    echo "Pulling $IMAGE (first run is a one-time ~600 MB download)…"
    docker pull "$IMAGE"
    run_container
    wait_healthy || true
    echo
    echo "✅ Artha is running → http://localhost:${PORT}"
    echo "   Next: open it, choose 'Personal', then Settings → Personalize / Telegram."
    echo "   See README.md → Step 3 onwards."
    ;;
  start)   need_docker; docker start "$NAME" >/dev/null && echo "Started → http://localhost:${PORT}" ;;
  stop)    docker stop "$NAME" >/dev/null && echo "Stopped (data kept)." ;;
  restart) need_docker; docker restart "$NAME" >/dev/null && echo "Restarted → http://localhost:${PORT}" ;;
  status)  docker ps -a --filter "name=^/${NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' ;;
  logs)    docker logs -f "$NAME" ;;
  update)
    need_docker
    echo "Pulling the latest image…"
    docker pull "$IMAGE"
    run_container
    wait_healthy || true
    echo "✅ Updated. Your data (volume '$VOLUME') is preserved."
    ;;
  backup)
    need_docker
    mkdir -p "$BACKUP_DIR"
    TS="$(date +%Y%m%d-%H%M%S)"
    OUT="$BACKUP_DIR/artha-db-$TS.dump"
    docker exec "$NAME" sh -c \
      'PGPASSWORD=$(cat /data/.secrets/postgres_password) su-exec postgres pg_dump -Fc -h 127.0.0.1 -U pfd_saas -d pfd_saas -f /tmp/artha-backup.dump'
    docker cp "$NAME:/tmp/artha-backup.dump" "$OUT"
    docker exec "$NAME" rm -f /tmp/artha-backup.dump
    echo "✅ Backup saved → $OUT"
    echo "   (Tip: also keep an in-app export — Settings → Data portability → Download JSON.)"
    ;;
  uninstall)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "Container removed. Your data volume '$VOLUME' is KEPT."
    echo "To delete your data too (irreversible): docker volume rm $VOLUME"
    ;;
  *)
    echo "Artha — usage: $0 {install|start|stop|restart|status|logs|update|backup|uninstall}"
    exit 1
    ;;
esac
