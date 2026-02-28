#!/usr/bin/env bash
# =============================================================================
# auto-selfheal.sh — claude-desk 자동 수복 스크립트 v3
#
# 설계 원칙:
#   - 감지: "포트 32355가 LISTEN 상태인가?" 하나만 본다
#     OS는 동일 포트에 하나만 허용 → 포트가 살아있으면 서버 정상
#   - 좀비 처리: 재시작 전 kill 단계에서 일괄 정리 (별도 감지 불필요)
#   - pgrep/concurrently 카운트 방식 금지:
#     sh wrapper + node + zsh(pgrep 자체) 모두 패턴에 매칭 → 항상 오판
#
# 버그 수정 이력:
#   v1: /api/health → 401, curl -sf false-positive → 3분마다 무한 재시작
#   v2: concurrently 카운트도 pgrep 자신이 매칭 → 오판
#   v3: 포트 LISTEN 체크만 사용, pgrep 카운트 완전 제거
#
# 로그  : ~/logs/tower-selfheal.log (500줄 초과 시 자동 로테이션)
# 락    : /tmp/tower-selfheal.lock (PID 기반 — 중복 실행 방지)
# =============================================================================

set -uo pipefail

APP_DIR="/home/enterpriseai/claude-desk"
BACKEND_PORT=32355
FRONTEND_PORT=32354
LOCK="/tmp/tower-selfheal.lock"
LOG="$HOME/logs/tower-selfheal.log"
DEV_LOG="/tmp/tower-dev.log"
MAX_LOG_LINES=500

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

rotate_log() {
  if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt "$MAX_LOG_LINES" ]; then
    tail -n 250 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
    log "[INFO] 로그 로테이션"
  fi
}

# 포트 LISTEN 여부만 확인 — auth 독립적, pgrep 없음
port_listening() {
  ss -tlnp 2>/dev/null | grep -q ":${BACKEND_PORT} "
}

# 5분 내 재시작 시도 이력 → 루프 방지
recently_restarted() {
  [ -f "$LOG" ] || return 1
  local cutoff
  cutoff="$(date -d '5 minutes ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" || return 1
  awk -v c="$cutoff" '$1" "$2 > c && /\[START\]/{found=1} END{exit !found}' "$LOG"
}

# ── 락 파일 ───────────────────────────────────────────────────────────────────
if [ -f "$LOCK" ]; then
  LOCK_PID=$(cat "$LOCK" 2>/dev/null || echo "0")
  if [ "$LOCK_PID" -gt 0 ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0  # 이전 실행 중 — 조용히 종료
  else
    log "[WARN] 스테일 락 (PID ${LOCK_PID}) — 제거 후 진행"
    rm -f "$LOCK"
  fi
fi

echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

rotate_log

# ── 고아 claude 프로세스 정리 (매 실행마다) ────────────────────────────────────
# SDK/CLI 모두: 백엔드 재시작 또는 zellij 탭 닫기로 ppid=1이 된 프로세스.
# SIGTERM 무시하므로 SIGKILL.
ORPHANS=$(ps -eo pid,ppid,tty,args | awk '$2==1 && $3=="?" && /claude.*--dangerously-skip-permissions/ {print $1}')
if [ -n "$ORPHANS" ]; then
  ORPHAN_COUNT=$(echo "$ORPHANS" | wc -w)
  log "[FIX] 고아 claude ${ORPHAN_COUNT}개 정리: ${ORPHANS}"
  echo "$ORPHANS" | xargs kill -9 2>/dev/null || true
fi

# ── 고CPU idle claude 정리 (CPU 전체 >80% 일 때만) ─────────────────────────────
# 터미널에 붙어있지만 TUI 렌더링 루프로 CPU를 태우는 세션.
# 시스템 CPU idle이 20% 미만일 때만 작동 — 정상 상황에서는 건드리지 않음.
CPU_IDLE=$(top -b -n 1 | awk '/^%Cpu/{print $8}' | cut -d. -f1)
if [ "${CPU_IDLE:-100}" -lt 20 ]; then
  HIGH_CPU=$(ps -eo pid,%cpu,etime,tty,args --sort=-%cpu | awk '/claude.*--dangerously-skip-permissions/ && $2>30.0 && $4!="?" {print $1}')
  if [ -n "$HIGH_CPU" ]; then
    HC_COUNT=$(echo "$HIGH_CPU" | wc -w)
    log "[WARN] CPU idle<20%, 고CPU claude ${HC_COUNT}개 감지: ${HIGH_CPU}"
    log "[HINT] 불필요하면: echo '${HIGH_CPU}' | xargs kill -9"
  fi
fi

# ── 핵심 체크: 포트 살아있나? ────────────────────────────────────────────────
if port_listening; then
  # 정상 — 아무것도 안 함 (quiet success)
  # 디버깅 시 주석 해제: log "[OK] 정상 (:${BACKEND_PORT} LISTEN)"
  exit 0
fi

# ── 포트 없음 → 수복 필요 ────────────────────────────────────────────────────
log "[ISSUE] 포트 ${BACKEND_PORT} LISTEN 없음"

# 5분 내 이미 시도했으면 루프 방지
if recently_restarted; then
  log "[SKIP] 5분 내 재시작 이력 있음 — 루프 방지 (수동 확인 필요)"
  log "[HINT] tail -30 ${DEV_LOG}"
  exit 0
fi

log "[FIX] 수복 시작"

# 1) 관련 프로세스 일괄 정리 (좀비 포함)
pkill -f "tsx watch backend" 2>/dev/null || true
pkill -f "concurrently.*dev" 2>/dev/null || true
pkill -f "vite.*${FRONTEND_PORT}" 2>/dev/null || true
sleep 2

# 2) 포트 잔여 점유 해제
fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true
fuser -k "${FRONTEND_PORT}/tcp" 2>/dev/null || true
sleep 1

# 3) 재시작
[ -d "$APP_DIR" ] || { log "[ERROR] APP_DIR 없음: ${APP_DIR}"; exit 1; }
cd "$APP_DIR"
nohup npm run dev > "$DEV_LOG" 2>&1 &
log "[START] PID=$!"

# 4) 최대 30초 대기
WAITED=0
while [ $WAITED -lt 30 ]; do
  sleep 5; WAITED=$((WAITED + 5))
  if port_listening; then
    log "[OK] 수복 성공 (${WAITED}초 후 포트 확인)"
    exit 0
  fi
done

log "[WARN] ${WAITED}초 내 포트 미응답 — 수동 확인 필요"
log "[HINT] tail -30 ${DEV_LOG}"
