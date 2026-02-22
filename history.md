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

## 2026-02-22: Phase 2 — File System + Editor + Session UX

### Step 1: CodeMirror 6 에디터
- **새 파일** `frontend/src/components/editor/CodeEditor.tsx` — `@uiw/react-codemirror` 래핑 컴포넌트
  - oneDark 테마 + 투명 배경 커스텀
  - 7개 언어 지원: js/ts/python/json/markdown/html/css
  - basicSetup: lineNumbers, foldGutter, bracketMatching ON / autocompletion OFF
- **수정** `ContextPanel.tsx` — `<textarea>` → `<CodeEditor>` 교체
  - 마크다운 파일: preview/editor 토글 유지 (react-markdown + CodeEditor)
  - 기타 파일: CodeEditor 직접 표시

### Step 2: 파일 트리 강화 + chokidar 실시간 감시
- **수정** `backend/services/file-system.ts`
  - `setupFileWatcher(rootPath, onChange)` — chokidar 사용
  - ignored: .git, node_modules, __pycache__, .venv, dist, data, .claude
  - depth: 3, ignoreInitial: true
  - `stopFileWatcher()` export
- **수정** `backend/routes/ws-handler.ts`
  - chokidar 이벤트 → 모든 클라이언트에 `{ type: 'file_changed', event, path }` broadcast
  - `broadcast()` 헬퍼 함수 추가
  - `handleChat`에서 프론트가 보내는 `claudeSessionId`를 resume에 사용
- **수정** `backend/index.ts` — graceful shutdown에 `stopFileWatcher()` 추가
- **수정** `frontend/src/stores/file-store.ts`
  - `setDirectoryChildren()` — lazy loading용 (서브디렉토리 자식 설정)
  - `setDirectoryLoading()` — 로딩 상태 관리
  - `handleFileChange()` — add/unlink/change 이벤트 처리
- **수정** `frontend/src/hooks/useClaudeChat.ts`
  - `file_changed` 메시지 핸들러 추가
  - `file_tree` 응답 시 서브디렉토리 판별 (재귀 findInTree)
  - WS URL에 localStorage 토큰 쿼리 파라미터 추가 (인증 연동)
  - `sdk_done` 시 claudeSessionId를 DB에 PATCH 저장
  - `sendMessage`에서 `claudeSessionId`를 같이 전송
- **수정** `frontend/src/components/files/FileTree.tsx`
  - 이모지 아이콘 → SVG 아이콘 (ChevronIcon, FolderIcon, FileIcon)
  - 파일 확장자별 색상 (ts=파랑, js=노랑, py=초록 등)
  - 디렉토리 로딩 스피너 (LoadingSpinner 컴포넌트)

### Step 3: 사이드바 탭 전환 + 세션 UX
- **새 파일** `frontend/src/components/sessions/SessionItem.tsx`
  - 인라인 이름 변경 (더블클릭 → input, Enter/Blur로 커밋)
  - 즐겨찾기 별표 토글 (SVG star icon, 노란색)
  - 비용 뱃지 + 삭제 버튼 (기존 기능 분리)
  - `PATCH /api/sessions/:id` 호출
- **수정** `frontend/src/stores/session-store.ts`
  - `sidebarTab: 'sessions' | 'files'` + `setSidebarTab`
  - `searchQuery` + `setSearchQuery`
- **수정** `frontend/src/components/layout/Sidebar.tsx`
  - 탭 시스템: 세션 / 파일 (하단 보더 인디케이터)
  - 세션 탭: 검색 입력 + SessionItem 리스트 (즐겨찾기 우선 정렬)
  - 파일 탭: FileTree 통합 + requestFileTree 연결
  - 새 대화 버튼은 탭 위에 항상 표시

### 세션 관리 버그 수정
- **WS 인증 토큰 전달**: `useClaudeChat`에서 localStorage 토큰을 WS URL 쿼리에 추가 (401 해결)
- **자동 세션 생성**: 메시지 보낼 때 activeSessionId 없으면 DB에 세션 자동 생성
- **sessionId 동기화**: handleNewSession, handleSelectSession에서 chat-store의 sessionId도 동기화
- **세션 전환 resume**: 프론트에서 claudeSessionId를 chat 메시지와 함께 전송, 백엔드가 세션별 resume 처리
- **전환 피드백**: 세션 전환 시 시스템 메시지 표시 ("세션 X 으로 전환됨")
- **같은 세션 재클릭 방지**: 이미 활성인 세션 클릭 시 불필요한 클리어 안 함

### 총 규모
- 새 파일 2개, 수정 9개 + App.tsx
- 빌드 성공, 서버 32354 포트 가동

## 2026-02-22: Phase 3 — 메시지 영속화, 핀보드, 설정 패널, UI 폴리시

### 메시지 영속화
- **새 파일** `backend/services/message-store.ts` — saveMessage, getMessages, updateMessageContent, deleteMessages
- **수정** `backend/db/schema.ts` — `messages` + `pins` 테이블 추가 (CREATE TABLE IF NOT EXISTS)
- **수정** `backend/routes/ws-handler.ts` — 유저/어시스턴트 메시지 실시간 DB 저장, 스트리밍 중 updateMessageContent
- **수정** `backend/routes/api.ts` — `GET /sessions/:id/messages` 엔드포인트
- **수정** `frontend/src/App.tsx` — 세션 전환 시 DB에서 메시지 복원 (fetch → setMessages)
- 설계 결정: SDK jsonl 파싱 대신 DB 저장 방식 채택. SDK가 `resume: sessionId`로 대화 연속성 관리하므로, DB는 순수 UI 표시용

### 핀보드
- **새 파일** `backend/services/pin-manager.ts` — 핀 CRUD (getPins, createPin, updatePin, deletePin, reorderPins)
- **새 파일** `frontend/src/components/pinboard/PinList.tsx` — 핀 목록 UI
- **새 파일** `frontend/src/stores/pin-store.ts` — zustand 핀 스토어
- **수정** `backend/routes/api.ts` — 핀 REST API (GET/POST/PATCH/DELETE/reorder) + `/files/serve` (iframe용)
- **수정** `frontend/src/components/layout/Sidebar.tsx` — 핀 탭 추가 (세션/파일/핀 3탭)

### 설정 패널
- **새 파일** `frontend/src/components/settings/SettingsPanel.tsx`
- **새 파일** `frontend/src/stores/settings-store.ts` — zustand 설정 스토어
- **수정** `backend/routes/api.ts` — `GET /config` 엔드포인트

### UI 폴리시
- **새 파일** `frontend/src/components/common/ErrorBoundary.tsx` — React 에러 경계
- **새 파일** `frontend/src/utils/toast.ts` — 토스트 유틸리티
- **수정** `frontend/src/components/files/FileTree.tsx` — 핀 아이콘, 개선
- **수정** `frontend/src/hooks/useWebSocket.ts` — 안정성 개선
- **수정** `frontend/src/stores/chat-store.ts` — setMessages 추가

## 2026-02-22: Phase 3.5 — ToolUseCard 칩 레이아웃 + DB 마이그레이션

### ToolUseCard 가로 칩 레이아웃
- **수정** `frontend/src/components/chat/ToolUseCard.tsx`
  - `ToolChip` 컴포넌트 추가: 도구별 색상 아이콘, 요약 텍스트, 상태 표시(pulse/체크), active 시 화살표
  - `defaultExpanded` prop 추가: 칩에서 펼칠 때 바로 내용 표시
- **수정** `frontend/src/components/chat/MessageBubble.tsx`
  - `ToolChipGroup` 인라인 컴포넌트: 가로 칩 나열 + 클릭 시 아래 상세 카드 펼침/접힘
  - 단일/복수 tool_use 모두 칩 레이아웃으로 통일 (기존 세로 스택 제거)

### DB 마이그레이션
- 문제: `initSchema()`의 `CREATE TABLE IF NOT EXISTS`가 기존 DB에 반영 안 됨
  - 원인: 서버가 DB 싱글턴 캐시를 이미 들고 있었고, DB 파일에 테이블이 없는 채로 유지
  - 해결: 직접 SQL 실행으로 `messages` + `pins` 테이블 생성 후 서버 재시작
- 교훈: `try {} catch {}` 으로 에러 무시하면 테이블 부재를 알 수 없음

### 총 규모
- 수정 2개 (ToolUseCard, MessageBubble) + DB 직접 마이그레이션
- 26 files changed, 984 insertions(+), 124 deletions(-) (Phase 3 포함)
