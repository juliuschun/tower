#!/bin/bash
# Tower — Server management script
# Uses PM2 for process management — do not run node/tsx directly (port conflict risk)
cd "$(dirname "$0")"

build() {
  echo "Building..."
  npx vite build && npx tsc -p tsconfig.backend.json || { echo "Build failed"; exit 1; }
}

case "${1:-start}" in
  start)
    build
    echo "Starting Tower (dev PM2) on :32354..."
    pm2 start ecosystem.config.cjs --only tower
    ;;
  stop)
    pm2 stop tower
    ;;
  restart)
    build
    pm2 restart tower
    ;;
  logs)
    pm2 logs tower --lines "${2:-50}"
    ;;
  status)
    pm2 show tower
    ;;

  # ── Production (tower-prod on :32364) ──
  prod-start)
    build
    echo "Starting Tower Production on :32364..."
    pm2 start ecosystem.config.cjs --only tower-prod
    ;;
  prod-stop)
    pm2 stop tower-prod
    ;;
  prod-restart)
    build
    pm2 restart tower-prod
    ;;
  prod-logs)
    pm2 logs tower-prod --lines "${2:-50}"
    ;;
  prod-status)
    pm2 show tower-prod
    ;;

  *)
    echo "Usage: ./start.sh [command]"
    echo ""
    echo "  Dev (desk.moatai.app :32354):"
    echo "    start | stop | restart | logs | status"
    echo ""
    echo "  Prod (tower.moatai.app :32364):"
    echo "    prod-start | prod-stop | prod-restart | prod-logs | prod-status"
    ;;
esac
