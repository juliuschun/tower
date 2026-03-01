#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# Tower — Backup Script
# ─────────────────────────────────────────────
# Usage:  bash scripts/backup.sh [backup_dir]
# Cron:   0 3 * * * cd ~/claude-desk && bash scripts/backup.sh
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_ROOT="${1:-$PROJECT_DIR/backups}"
KEEP_DAYS=7

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!!]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC} $1"; }

echo "Tower Backup — $TIMESTAMP"
echo ""

mkdir -p "$BACKUP_DIR"

# ── 1. Database (WAL-safe online backup) ──
DB_PATH="${DB_PATH:-$PROJECT_DIR/data/tower.db}"
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/tower.db'"
  info "Database backed up ($(du -h "$BACKUP_DIR/tower.db" | cut -f1))"
else
  warn "Database not found at $DB_PATH"
fi

# ── 2. Workspace (tar) ──
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/workspace}"
if [ -d "$WORKSPACE_ROOT" ]; then
  tar -czf "$BACKUP_DIR/workspace.tar.gz" -C "$(dirname "$WORKSPACE_ROOT")" "$(basename "$WORKSPACE_ROOT")" 2>/dev/null
  info "Workspace backed up ($(du -h "$BACKUP_DIR/workspace.tar.gz" | cut -f1))"
else
  warn "Workspace not found at $WORKSPACE_ROOT"
fi

# ── 3. Environment file ──
if [ -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env" "$BACKUP_DIR/.env"
  info ".env backed up"
else
  warn ".env not found"
fi

# ── 4. Cleanup old backups ──
DELETED=0
if [ -d "$BACKUP_ROOT" ]; then
  find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime +$KEEP_DAYS | while read -r old_dir; do
    rm -rf "$old_dir"
    DELETED=$((DELETED + 1))
  done
  if [ "$DELETED" -gt 0 ]; then
    info "Cleaned up $DELETED old backup(s) (older than $KEEP_DAYS days)"
  fi
fi

echo ""
info "Backup complete: $BACKUP_DIR"
ls -lh "$BACKUP_DIR"
