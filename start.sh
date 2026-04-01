#!/bin/bash
# Tower — Server management script
# Uses PM2 for process management — do not run node/tsx directly (port conflict risk)
cd "$(dirname "$0")"

LOCKFILE="/tmp/tower-deploy.lock"
COOLDOWN=120  # seconds

# ── Cooldown guard ──────────────────────────────────────────────
# Prevents repeated restarts within 2 minutes (e.g. AI session resume → auto-retry)
check_cooldown() {
  local target="$1"
  if [[ -f "$LOCKFILE-$target" ]]; then
    local last now elapsed remaining
    last=$(cat "$LOCKFILE-$target")
    now=$(date +%s)
    elapsed=$(( now - last ))
    if (( elapsed < COOLDOWN )); then
      remaining=$(( COOLDOWN - elapsed ))
      echo ""
      echo "⚠️  $target was restarted ${elapsed}s ago (cooldown: ${COOLDOWN}s)"
      echo "   Next restart available in ${remaining}s."
      echo "   To force: add --force flag"
      echo ""
      return 1
    fi
  fi
  return 0
}

stamp_cooldown() {
  date +%s > "$LOCKFILE-$1"
}

# ── Build ───────────────────────────────────────────────────────
# Builds into dist-new/, then atomically swaps with dist/
# This prevents the running server from reading half-written files.
build() {
  echo "Building..."
  rm -rf dist-new

  # vite: root=packages/frontend, outDir is relative to root
  # tsc:  outDir is relative to project root
  npx vite build --outDir ../../dist-new/frontend \
    && npx tsc -p tsconfig.backend.json --outDir dist-new/backend \
    || { echo "❌ Build failed"; rm -rf dist-new; exit 1; }

  echo "✅ Build succeeded → dist-new/"
}

# ── Safe deploy: stop → swap dist → start ──────────────────────
# Stops the server FIRST, then swaps dist/ atomically, then starts.
# This eliminates the race condition where tsc overwrites files
# while the running server reads them (→ ERR_MODULE_NOT_FOUND crash).
safe_deploy() {
  local target="$1"
  echo "Deploying $target..."

  # 1. Stop the running server
  pm2 stop "$target" 2>/dev/null

  # 2. Atomic swap: old dist → dist-old (backup), new → dist
  rm -rf dist-old
  [[ -d dist ]] && mv dist dist-old
  mv dist-new dist

  # 3. Start with clean dist
  pm2 restart "$target"
  stamp_cooldown "$target"

  # 4. Clean up old build
  rm -rf dist-old
  echo "✅ $target deployed"
}

# ── Force flag check ────────────────────────────────────────────
FORCE=false
for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=true
done

case "${1:-start}" in
  start)
    if [[ "$FORCE" != true ]]; then
      check_cooldown "tower" || exit 0
    fi
    build
    rm -rf dist; mv dist-new dist
    echo "Starting Tower (dev PM2) on :32354..."
    pm2 start ecosystem.config.cjs --only tower
    stamp_cooldown "tower"
    ;;
  stop)
    pm2 stop tower
    ;;
  restart)
    if [[ "$FORCE" != true ]]; then
      check_cooldown "tower" || exit 0
    fi
    build
    safe_deploy "tower"
    ;;
  logs)
    pm2 logs tower --lines "${2:-50}"
    ;;
  status)
    pm2 show tower
    ;;

  # ── Production (tower-prod on :32364) ──
  prod-start)
    if [[ "$FORCE" != true ]]; then
      check_cooldown "tower-prod" || exit 0
    fi
    build
    rm -rf dist; mv dist-new dist
    echo "Starting Tower Production on :32364..."
    pm2 start ecosystem.config.cjs --only tower-prod
    stamp_cooldown "tower-prod"
    ;;
  prod-stop)
    pm2 stop tower-prod
    ;;
  prod-restart)
    # Build first (while server is still running), then detach the deploy
    # step via setsid+nohup so it works even when called from the web app
    # (the calling process dies when pm2 stops the server).
    if [[ "$FORCE" != true ]]; then
      check_cooldown "tower-prod" || exit 0
    fi
    build
    LOGFILE="/tmp/tower-deploy.log"
    echo "🔄 Deploying tower-prod (detached)..."
    setsid nohup bash -c '
      cd "$(dirname "$0")"
      sleep 1
      echo "[$(date)] Deploying tower-prod..." >> '"$LOGFILE"'
      pm2 stop tower-prod >> '"$LOGFILE"' 2>&1
      rm -rf dist-old
      [[ -d dist ]] && mv dist dist-old
      mv dist-new dist
      pm2 restart tower-prod >> '"$LOGFILE"' 2>&1
      date +%s > /tmp/tower-deploy.lock-tower-prod
      rm -rf dist-old
      echo "[$(date)] ✅ tower-prod deployed" >> '"$LOGFILE"'
    ' "$0" </dev/null >/dev/null 2>&1 &
    echo "✅ Build done. Deploy completes in ~2s (log: $LOGFILE)"
    ;;
  prod-logs)
    pm2 logs tower-prod --lines "${2:-50}"
    ;;
  prod-status)
    pm2 show tower-prod
    ;;

  *)
    echo "Usage: ./start.sh [command] [--force]"
    echo ""
    echo "  Dev (desk-dev.moatai.app :32354):"
    echo "    start | stop | restart | logs | status"
    echo ""
    echo "  Prod (tower.moatai.app :32364):"
    echo "    prod-start | prod-stop | prod-restart | prod-logs | prod-status"
    echo ""
    echo "  --force    Skip 2-minute cooldown guard"
    ;;
esac
