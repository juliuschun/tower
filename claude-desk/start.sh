#!/bin/bash
# Claude Desk 서버 관리 스크립트
# PM2로 통일 관리 — 직접 node/tsx 실행 금지 (포트 충돌 위험)
cd "$(dirname "$0")"

case "${1:-start}" in
  start)
    echo "Building..."
    npx vite build && npx tsc -p tsconfig.backend.json || { echo "Build failed"; exit 1; }
    echo "Starting claude-desk via PM2..."
    pm2 start ecosystem.config.cjs
    echo ""
    echo "접속: http://localhost:32354"
    echo "SSH 터널: ssh -L 32354:localhost:32354 azureuser@4.230.33.35"
    ;;
  stop)
    pm2 stop claude-desk
    ;;
  restart)
    echo "Building..."
    npx vite build && npx tsc -p tsconfig.backend.json || { echo "Build failed"; exit 1; }
    pm2 restart claude-desk
    ;;
  logs)
    pm2 logs claude-desk --lines "${2:-50}"
    ;;
  status)
    pm2 show claude-desk
    ;;
  *)
    echo "Usage: ./start.sh [start|stop|restart|logs|status]"
    ;;
esac
