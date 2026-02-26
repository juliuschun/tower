#!/bin/bash
# Tower — Server management script
# Uses PM2 for process management — do not run node/tsx directly (port conflict risk)
cd "$(dirname "$0")"

case "${1:-start}" in
  start)
    echo "Building..."
    npx vite build && npx tsc -p tsconfig.backend.json || { echo "Build failed"; exit 1; }
    echo "Starting Tower via PM2..."
    pm2 start ecosystem.config.cjs
    echo ""
    echo "Access: http://localhost:32354"
    ;;
  stop)
    pm2 stop tower
    ;;
  restart)
    echo "Building..."
    npx vite build && npx tsc -p tsconfig.backend.json || { echo "Build failed"; exit 1; }
    pm2 restart tower
    ;;
  logs)
    pm2 logs tower --lines "${2:-50}"
    ;;
  status)
    pm2 show tower
    ;;
  *)
    echo "Usage: ./start.sh [start|stop|restart|logs|status]"
    ;;
esac
