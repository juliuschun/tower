# PinchTab MCP Server

Claude Code에서 `browser_*` tool로 실제 Chrome을 제어할 수 있게 해주는 MCP 서버.

## 파일 구조

```
mcp/
├── pinchtab-server.ts   # MCP stdio 서버 (6 browser tools)
└── pinchtab-manager.ts  # Bridge 프로세스 lifecycle + self-healing
```

## 실행 방식

Claude Code가 `.mcp.json`을 읽어 자동으로 시작:

```bash
npx tsx mcp/pinchtab-server.ts
```

직접 실행 시 (디버그):

```bash
cd /home/enterpriseai/claude-desk
PINCHTAB_BINARY=data/pinchtab npx tsx mcp/pinchtab-server.ts
```

## PinchTab API 특이사항

### /screenshot 응답 포맷

raw binary가 아닌 **JSON 래퍼**:

```json
{ "base64": "/9j/4AAQ...", "format": "jpeg" }
```

`Content-Type: application/json`, HTTP 200.
`pinchtab-server.ts`의 `browser_screenshot`이 이를 파싱해 MCP image content로 변환.

### /health 응답

```json
{ "status": "ok",           "cdp": "ws://...", "tabs": 1 }  // 정상
{ "status": "disconnected", "error": "..." }                 // Chrome 단절
```

`status: disconnected`는 unhealthy로 처리 (Bridge는 살아있어도 Chrome과 끊긴 상태).

## Self-Healing 동작

```
browser_* 호출
  │
  ├─ processAlive === false  →  ensureRestarted() → 재시도
  │
  ├─ 정상 fetch 성공 → 반환
  │
  └─ 네트워크 에러
       └─ isHealthy() 확인
            ├─ unhealthy → ensureRestarted() → 재시도 1회
            └─ healthy   → 에러 그대로 throw
```

재시작 소요 시간: 2–10초. Claude 입장에선 느린 응답으로 보임.

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CHROME_BINARY` | auto-detect | Chrome 경로. 미설정 시 `google-chrome` → `chromium-browser` → `chromium` 순 탐색 |
| `BRIDGE_PROFILE` | Chrome 기본 | Chrome 프로파일 경로 (로그인 세션 유지용) |
| `BRIDGE_HEADLESS` | `true` | headless 모드 |
| `PINCHTAB_URL` | (없음) | 외부 인스턴스 URL. 설정 시 바이너리 spawn 건너뜀 |
| `PINCHTAB_BINARY` | `data/pinchtab` | 바이너리 경로 오버라이드 |
| `PINCHTAB_TOKEN` | (없음) | Bridge 인증 토큰 |

## 문제 해결

```bash
# 브리지 상태 확인
curl http://localhost:9867/health

# 스크린샷 직접 테스트
curl -s http://localhost:9867/screenshot | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('format:', d.get('format'), '| base64 length:', len(d.get('base64','')))
"

# 브리지 강제 재시작 (포트 점유 시)
pkill -9 -f data/pinchtab
# → Claude Code 재시작하면 자동 respawn
```
