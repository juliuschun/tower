#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# Tower — Backup Script (PostgreSQL edition)
# ─────────────────────────────────────────────
# Layer 1 백업 (앱 레벨, 매일 새벽 3시 cron 권장).
# Layer 2 (Azure Recovery Services Vault VM 스냅샷)는 별도로 운영됨.
#
# Usage:
#   bash scripts/backup.sh [backup_dir]
#
# Cron:
#   0 3 * * * cd ~/tower && bash scripts/backup.sh >> ~/backups/backup.log 2>&1
#
# 환경변수 (선택):
#   DATABASE_URL       postgresql://user:pass@host:port/db   (.env에서 자동 로드)
#   WORKSPACE_ROOT     기본: $HOME/workspace
#   CLAUDE_DIR         기본: $HOME/.claude
#   KEEP_DAYS          기본: 7
#   BACKUP_WORKSPACE   기본: 1 (0이면 workspace tar 생략 — 본 서버처럼 큰 워크스페이스용)
#   BACKUP_CLAUDE      기본: 1 (0이면 ~/.claude tar 생략)
#   BACKUP_TO_BLOB     기본: 0 (1이면 PG/.claude를 Azure Blob에 추가 업로드)
#   BLOB_ACCOUNT       기본: towerworkspacebackup
#   BLOB_CONTAINER     기본: tower-data-backup
#   BLOB_KEEP_DAYS     기본: 30 (Blob 보관 기간, 로컬 KEEP_DAYS와 별개)
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_ROOT="${1:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
HOSTNAME_TAG=$(hostname -s)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[!!]${NC}  $1"; }
error() { echo -e "${RED}[ERR]${NC} $1"; }

echo "─────────────────────────────────────────────"
echo "Tower Backup — host=$HOSTNAME_TAG  ts=$TIMESTAMP"
echo "Target: $BACKUP_DIR"
echo "─────────────────────────────────────────────"

mkdir -p "$BACKUP_DIR"

# ── 0. .env 로드 (DATABASE_URL 등) ──
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

# ── 1. PostgreSQL pg_dump (custom format -Fc) ──
if [ -n "${DATABASE_URL:-}" ]; then
  if ! command -v pg_dump >/dev/null 2>&1; then
    error "pg_dump not found — install postgresql-client"
    exit 1
  fi
  PG_VERSION="$(pg_dump --version | awk '{print $3}')"
  DUMP_FILE="$BACKUP_DIR/postgres.dump"

  # custom format(-Fc): 압축 + 선택적 복구 가능
  if pg_dump -Fc -f "$DUMP_FILE" "$DATABASE_URL" 2>"$BACKUP_DIR/pg_dump.err"; then
    rm -f "$BACKUP_DIR/pg_dump.err"
    SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    info "PostgreSQL dump ok ($SIZE, pg_dump $PG_VERSION)"
  else
    error "pg_dump failed — see $BACKUP_DIR/pg_dump.err"
    cat "$BACKUP_DIR/pg_dump.err"
    exit 1
  fi
else
  warn "DATABASE_URL not set — skipping PostgreSQL backup"
fi

# ── 2. Workspace 디렉토리 (tar.gz) — BACKUP_WORKSPACE=0이면 생략 ──
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/workspace}"
BACKUP_WORKSPACE="${BACKUP_WORKSPACE:-1}"
if [ "$BACKUP_WORKSPACE" = "0" ]; then
  warn "Workspace tar skipped (BACKUP_WORKSPACE=0) — Vault 스냅샷에 위임"
elif [ -d "$WORKSPACE_ROOT" ]; then
  WS_SIZE_RAW=$(du -sb "$WORKSPACE_ROOT" 2>/dev/null | cut -f1)
  WS_SIZE_GB=$((WS_SIZE_RAW / 1024 / 1024 / 1024))
  if [ "$WS_SIZE_GB" -gt 5 ]; then
    warn "Workspace ${WS_SIZE_GB}GB — large. tar 시간 오래 걸림. 본 서버는 BACKUP_WORKSPACE=0 권장."
  fi
  WS_FILE="$BACKUP_DIR/workspace.tar.gz"
  tar --exclude='node_modules' \
      --exclude='.git' \
      --exclude='dist' \
      --exclude='backups' \
      --exclude='.cache' \
      -czf "$WS_FILE" \
      -C "$(dirname "$WORKSPACE_ROOT")" \
      "$(basename "$WORKSPACE_ROOT")" 2>/dev/null
  SIZE=$(du -h "$WS_FILE" | cut -f1)
  info "Workspace tar ok ($SIZE)"
else
  warn "Workspace not found: $WORKSPACE_ROOT"
fi

# ── 3. .env 파일 (민감 정보) ──
if [ -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env" "$BACKUP_DIR/env.backup"
  chmod 600 "$BACKUP_DIR/env.backup"
  info ".env backed up"
else
  warn ".env not found at $PROJECT_DIR/.env"
fi

# ── 4. ~/.claude 디렉토리 (세션 .jsonl, 설정, credentials) ──
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
BACKUP_CLAUDE="${BACKUP_CLAUDE:-1}"
if [ "$BACKUP_CLAUDE" = "0" ]; then
  warn "~/.claude tar skipped (BACKUP_CLAUDE=0)"
elif [ -d "$CLAUDE_DIR" ]; then
  CL_FILE="$BACKUP_DIR/claude.tar.gz"
  tar --exclude='*/node_modules' \
      --exclude='*/cache' \
      --exclude='*/projects/*/checkpoints' \
      -czf "$CL_FILE" \
      -C "$(dirname "$CLAUDE_DIR")" \
      "$(basename "$CLAUDE_DIR")" 2>/dev/null || true
  SIZE=$(du -h "$CL_FILE" | cut -f1)
  info "~/.claude tar ok ($SIZE)"
fi

# ── 5. 메타데이터 (복구 시 참고) ──
META="$BACKUP_DIR/MANIFEST.txt"
{
  echo "host: $HOSTNAME_TAG"
  echo "timestamp: $TIMESTAMP"
  echo "project_dir: $PROJECT_DIR"
  echo "workspace_root: $WORKSPACE_ROOT"
  echo "claude_dir: $CLAUDE_DIR"
  echo "pg_dump_version: ${PG_VERSION:-n/a}"
  echo "git_commit: $(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo n/a)"
  echo "git_branch: $(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo n/a)"
  echo ""
  echo "files:"
  ls -lh "$BACKUP_DIR" | awk 'NR>1 {print "  "$NF, $5}'
} > "$META"
info "Manifest written"

# ── 5.5. Azure Blob 업로드 (BACKUP_TO_BLOB=1일 때만) ──
BACKUP_TO_BLOB="${BACKUP_TO_BLOB:-0}"
if [ "$BACKUP_TO_BLOB" = "1" ]; then
  if ! command -v az >/dev/null 2>&1; then
    error "az CLI not found — Blob 업로드 불가"
  else
    BLOB_ACCOUNT="${BLOB_ACCOUNT:-towerworkspacebackup}"
    BLOB_CONTAINER="${BLOB_CONTAINER:-tower-data-backup}"
    BLOB_KEEP_DAYS="${BLOB_KEEP_DAYS:-30}"
    BLOB_PREFIX="${HOSTNAME_TAG}/${TIMESTAMP}"

    # Managed Identity 우선 시도
    az account show >/dev/null 2>&1 || az login --identity --output none 2>/dev/null || true

    info "Uploading to blob: $BLOB_ACCOUNT/$BLOB_CONTAINER/$BLOB_PREFIX/"

    upload_one() {
      local local_file="$1"
      local blob_name="$2"
      if [ -f "$local_file" ]; then
        if az storage blob upload \
            --account-name "$BLOB_ACCOUNT" \
            --container-name "$BLOB_CONTAINER" \
            --auth-mode login \
            --name "$blob_name" \
            --file "$local_file" \
            --overwrite \
            --no-progress >/dev/null 2>&1; then
          info "  blob ok: $blob_name ($(du -h "$local_file" | cut -f1))"
        else
          warn "  blob FAIL: $blob_name"
        fi
      fi
    }

    upload_one "$BACKUP_DIR/postgres.dump"     "$BLOB_PREFIX/postgres.dump"
    upload_one "$BACKUP_DIR/claude.tar.gz"     "$BLOB_PREFIX/claude.tar.gz"
    upload_one "$BACKUP_DIR/env.backup"        "$BLOB_PREFIX/env.backup"
    upload_one "$BACKUP_DIR/MANIFEST.txt"      "$BLOB_PREFIX/MANIFEST.txt"

    # 오래된 blob 정리 (BLOB_KEEP_DAYS 초과)
    CUTOFF=$(date -u -d "$BLOB_KEEP_DAYS days ago" +%Y%m%d)
    OLD_BLOBS=$(az storage blob list \
      --account-name "$BLOB_ACCOUNT" \
      --container-name "$BLOB_CONTAINER" \
      --auth-mode login \
      --prefix "$HOSTNAME_TAG/" \
      --query "[].name" -o tsv 2>/dev/null | \
      awk -v cutoff="$CUTOFF" -v host="$HOSTNAME_TAG" '
        {
          # 형식: hostname/YYYYMMDD_HHMMSS/filename
          n = split($0, a, "/")
          if (n >= 2) {
            ts = substr(a[2], 1, 8)
            if (ts < cutoff) print $0
          }
        }')

    if [ -n "$OLD_BLOBS" ]; then
      OLD_COUNT=$(echo "$OLD_BLOBS" | wc -l)
      echo "$OLD_BLOBS" | while read -r blob; do
        az storage blob delete \
          --account-name "$BLOB_ACCOUNT" \
          --container-name "$BLOB_CONTAINER" \
          --auth-mode login \
          --name "$blob" >/dev/null 2>&1 || true
      done
      info "Cleaned $OLD_COUNT old blob(s) (>${BLOB_KEEP_DAYS}d)"
    fi
  fi
fi

# ── 6. 오래된 백업 정리 (KEEP_DAYS 초과) ──
DELETED=0
if [ -d "$BACKUP_ROOT" ]; then
  while IFS= read -r old_dir; do
    rm -rf "$old_dir"
    DELETED=$((DELETED + 1))
  done < <(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime +"$KEEP_DAYS")
  if [ "$DELETED" -gt 0 ]; then
    info "Cleaned $DELETED old backup(s) (>${KEEP_DAYS}d)"
  fi
fi

TOTAL=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
info "Backup complete — $BACKUP_DIR ($TOTAL)"
echo ""
ls -lh "$BACKUP_DIR"
