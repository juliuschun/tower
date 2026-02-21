# Claude Desk — 개발 히스토리

## 2026-02-21: Phase 1 — Core Chat + MD 렌더링

### 프로젝트 생성 및 스켈레톤
- `claude-desk/` 디렉토리 구조 생성 (backend/frontend 분리)
- Tech stack: React 18 + Vite + TailwindCSS v4 / Express + WebSocket(ws) / @anthropic-ai/claude-code SDK / zustand / better-sqlite3 / TypeScript
- 포트: 32354 (`http://localhost:32354`)

### 백엔드 구현
- `backend/index.ts` — Express + HTTP 서버 엔트리, CLAUDECODE 환경변수 제거
- `backend/config.ts` — 포트, claude 실행파일 경로, 인증, 파일시스템 루트 등 설정
- `backend/db/schema.ts` — SQLite (users, sessions, scripts 테이블), WAL 모드
- `backend/services/claude-sdk.ts` — SDK `query()` 래퍼, AbortController, 세션 resume 지원
- `backend/services/file-system.ts` — 파일 트리/읽기/쓰기, 워크스페이스 외부 접근 차단
- `backend/services/session-manager.ts` — 세션 CRUD, Claude 네이티브 세션(~/.claude/projects/) 스캔
- `backend/services/auth.ts` — bcrypt + JWT 인증, 미들웨어, WS 토큰 검증
- `backend/services/command-loader.ts` — `~/.claude/commands/` 스캔하여 slash command 목록 생성
- `backend/routes/api.ts` — REST API (auth, sessions, files, commands, claude-sessions)
- `backend/routes/ws-handler.ts` — WebSocket 메시지 라우팅 (chat, abort, file_read/write/tree, ping)

### 프론트엔드 구현
- `frontend/src/App.tsx` — 메인 레이아웃: Header + Sidebar + ChatPanel + ContextPanel + BottomBar
- `frontend/src/stores/` — zustand 스토어 3개: chat-store, file-store, session-store
- `frontend/src/hooks/useWebSocket.ts` — WebSocket 연결, 자동 재연결, ping 유지
- `frontend/src/hooks/useClaudeChat.ts` — SDK 메시지 파싱, 채팅 통합 훅
- `frontend/src/utils/message-parser.ts` — SDK 메시지 → UI ContentBlock 변환, 도구 라벨/요약
- UI 컴포넌트: Header, Sidebar, ChatPanel, MessageBubble, ToolUseCard, ThinkingBlock, InputBox, ContextPanel, FileTree, LoginPage

### 테스트 (4개 에이전트 병렬 — 35/35 PASS)

| 테스트 | 결과 |
|---|---|
| REST API (15개) | 15/15 PASS — auth, sessions CRUD, files R/W, commands, security |
| WebSocket 파일 (7개) | 7/7 PASS — tree, read, write, verify, security block, ping/pong |
| Frontend 서빙 (6개) | 6/6 PASS — HTML, CSS, JS, favicon, SPA fallback |
| WebSocket Chat + SDK (7개) | 7/7 PASS — connect, system init(48tools, 19cmds), assistant, tool_use/result, cost, resume |

### 디버깅 중 발견 및 수정한 이슈 3건
1. **tool_result 파싱 누락** — SDK가 tool 결과를 `user` 타입 메시지의 `tool_result` 블록으로 보냄. `attachToolResult()` 추가하여 tool_use 카드에 결과 연결
2. **rate_limit_event 구조 불일치** — 실제 데이터가 `msg.data.rate_limit_info.status`에 중첩. 올바른 경로로 수정
3. **멀티턴 assistant 메시지 분리** — UUID 기반으로 새 assistant 메시지 구분 (도구 사용 후 최종 답변이 별도 버블)

## 2026-02-21: UI 개선 및 기능 추가

### UI 테마 업그레이드
- 앰버 → 바이올렛 악센트 테마로 변경 (primary-500: #8b5cf6)
- 서피스 색상: Zinc 계열로 변경
- glassmorphism 적용: backdrop-blur, 투명도 레이어, 링 보더
- Header: backdrop-blur, 로고 뱃지, breadcrumb 스타일 세션 이름
- Sidebar: 세팅 버튼, 개선된 호버/활성 상태
- ChatPanel: 플로팅 InputBox, 개선된 빈 상태 화면
- InputBox: 글래스모피즘, 부드러운 애니메이션
- BottomBar: SVG 아이콘, 탭형 레이아웃

### ToolUseCard 리뉴얼
- SVG 아이콘 + 도구별 색상 (Bash=초록, Read=파랑, Write=노랑, Edit=주황, Grep=보라 등)
- 실시간 상태: 스피너 + "실행 중" / 체크마크 + "완료"
- 결과 표시: tool_result 수신 시 결과 블록 자동 렌더링
- 기본 접힘 상태: 한 줄 요약, 클릭하면 확장
- Bash 명령어, Edit diff, 파일 경로 클릭 등 도구별 맞춤 렌더링
- Task(서브에이전트): description + prompt 미리보기

### 멀티 도구 블록 그룹핑
- MessageBubble에서 연속된 tool_use 블록을 그룹으로 묶어 표시
- 다수 도구 동시 사용 시 compact 모드로 깔끔하게 렌더링

### 메시지 큐 기능
- 스트리밍 중에도 타이핑 가능 (disabled 제거)
- Enter 시 큐에 저장 → 현재 턴 완료(sdk_done) 후 자동 전송
- "대기 중: ..." UI 표시, Esc/X로 대기 취소 가능
- 버튼 아이콘 변경: 스트리밍 중 `+` (큐 추가), 평상시 `↑` (전송)

### 세션 로드 수정
- useEffect 의존성 및 조건문 수정: authEnabled=false일 때도 세션 목록 확실히 로드
