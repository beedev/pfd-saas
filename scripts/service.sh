#!/bin/bash
# Manage the finance dashboard production service (port 9999)
PLIST=~/Library/LaunchAgents/com.bharath.finance-dashboard.plist
PROJECT_DIR="/Users/bharath/Desktop/personal-finance-dashboard"

case "$1" in
  start)
    launchctl load "$PLIST" && echo "Started on port 9999"
    ;;
  stop)
    launchctl unload "$PLIST" && echo "Stopped"
    ;;
  restart)
    launchctl unload "$PLIST" 2>/dev/null
    launchctl load "$PLIST" && echo "Restarted on port 9999"
    ;;
  status)
    launchctl list | grep finance-dashboard
    ;;
  build)
    cd "$PROJECT_DIR" && npm run build
    ;;
  logs)
    tail -f "$PROJECT_DIR/logs/service.log"
    ;;
  errors)
    tail -f "$PROJECT_DIR/logs/service-error.log"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|build|logs|errors}"
    ;;
esac
