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

## 2026-02-22: Phase 4A/B/C/F — ContextPanel 리사이즈, 프롬프트, 슬래시 명령어, 안정성

### Batch 1: 백엔드 (5개 파일 수정)
- **`backend/db/schema.ts`** — ALTER TABLE 마이그레이션: `pin_type`, `content` 컬럼 추가 (try/catch 멱등성)
- **`backend/services/pin-manager.ts`** — Pin 인터페이스 확장, `createPromptPin()`, `updatePromptPin()`, `getPromptsWithCommands()` (DB 프롬프트 + `~/.claude/commands/` 병합)
- **`backend/services/command-loader.ts`** — frontmatter 파싱으로 description 추출, `fullContent` 필드 추가
- **`backend/routes/api.ts`** — `GET/POST/PATCH/DELETE /api/prompts` 엔드포인트
- **`backend/config.ts`** — `maxConcurrentSessions` (env 설정, 기본 3), `getPermissionMode(role)` (admin=bypass, user=acceptEdits)
- **`backend/services/claude-sdk.ts`** — `getActiveSessionCount()`, `permissionMode` 옵션
- **`backend/routes/ws-handler.ts`** — JWT에서 userRole 추출, 동시 세션 한도 체크 (`SESSION_LIMIT` 에러), 5분 hang 감지 타이머 + 자동 abort

### Batch 2: 프론트엔드 (4개 새 파일, 5개 수정)
- **새 파일** `frontend/src/stores/prompt-store.ts` — zustand 프롬프트 스토어
- **새 파일** `frontend/src/components/prompts/PromptItem.tsx` — 번개 아이콘 + 소스 뱃지(cmd/user) + 편집/삭제 버튼
- **새 파일** `frontend/src/components/prompts/PromptEditor.tsx` — 생성/편집 모달 (제목 + textarea)
- **새 파일** `frontend/src/components/layout/ResizeHandle.tsx` — 드래그 리사이즈 핸들 (280-800px, 더블클릭 리셋 384px)
- **수정** `frontend/src/components/layout/Sidebar.tsx` — 세션 탭 하단 접기 가능 프롬프트 섹션
- **수정** `frontend/src/App.tsx` — ResizeHandle 통합, 프롬프트 CRUD 핸들러, PromptEditor 모달, `/api/prompts` 로드
- **수정** `frontend/src/stores/chat-store.ts` — `slashCommands` 타입 `string[]` → `SlashCommandInfo[]` (name/description/source), `draftInput` 추가
- **수정** `frontend/src/hooks/useClaudeChat.ts` — SDK slash commands와 `/api/commands` 병합, `SESSION_LIMIT`/`SDK_HANG` 에러 분기 처리
- **수정** `frontend/src/components/chat/InputBox.tsx` — 키보드 네비게이션 (↑↓/Tab/Enter), 설명+소스 뱃지, `selectedIndex`, `draftInput` 수신

### Batch 3: 안정성
- **수정** `frontend/src/hooks/useWebSocket.ts` — 지수 백오프 재연결 (2s→4s→8s→...→30s max, 성공 시 리셋)
- SESSION_LIMIT, SDK_HANG 에러 시 전용 시스템 메시지 표시

### 디버깅 및 수정
- 빌드 오류: `createPin()` 반환 타입에 `pin_type`, `content` 누락 → 추가
- commands content가 frontmatter 첫 줄(`---`)만 반환 → `loadCommands()`에서 frontmatter description 파싱 + `fullContent` 추가
- 프롬프트 클릭 시 ContextPanel이 안 열림 → `setContextPanelTab('preview')` 호출 추가, 빈 content 시 fallback 텍스트

### 총 규모
- 새 파일 4개, 수정 ~12개, ~500줄 추가

## 2026-02-22: Phase 5 — 모델 셀렉터 + 세션 인텔리전스

### 환경 제약
- MAX 구독 환경이라 ANTHROPIC_API_KEY 없음
- `@anthropic-ai/sdk` 직접 호출 불가 → 5B/5C도 Claude Code SDK `query()`로 경량 프롬프트 전송
- SDK `Options.model` 파라미터 직접 지원 확인 → 환경변수 우회 불필요

### 5A: 모델 셀렉터
- **SDK Options.model 직접 지원 확인** — `sdk.d.ts`에서 `model?: string` 확인
- **`backend/config.ts`** — `availableModels: ModelInfo[]` (Sonnet 4.6, Opus 4.6, Haiku 4.5) + `connectionType: 'MAX'`
- **`backend/services/claude-sdk.ts`** — `executeQuery()`에 `model?` 옵션 추가, `queryOptions`에 spread
- **`backend/routes/ws-handler.ts`** — `handleChat()`에 `model?` 파라미터, `executeQuery()`에 전달
- **`backend/routes/api.ts`** — `GET /api/config`에 `models`, `connectionType` 필드 추가
- **새 파일** `frontend/src/stores/model-store.ts` — zustand 스토어 (availableModels, selectedModel, connectionType)
- **새 파일** `frontend/src/components/layout/ModelSelector.tsx` — 드롭다운 셀렉터 (보라색 MAX 배지, 모델별 id 표시)
- **`frontend/src/components/layout/Header.tsx`** — 정적 모델 배지 → ModelSelector 교체
- **`frontend/src/hooks/useClaudeChat.ts`** — `sendMessage` 시 `useModelStore.selectedModel`을 WS에 포함
- **`frontend/src/App.tsx`** — config 로드 시 `setAvailableModels()`, `setConnectionType()` 호출

### 5B: 세션 자동 이름 생성
- **새 파일** `backend/services/auto-namer.ts` — SDK query()로 Haiku에 경량 프롬프트: "15자 한글 제목 생성"
- **`backend/routes/api.ts`** — `POST /api/sessions/:id/auto-name` 엔드포인트 (첫 user+assistant 메시지 추출 → 이름 생성 → DB 업데이트)
- **`frontend/src/hooks/useClaudeChat.ts`** — `sdk_done` 시 세션 이름이 기본값(`세션 ...`)이면 auto-name API 호출
- **`frontend/src/App.tsx`** — 수동 이름 변경 시 `autoNamed: 0` PATCH (이후 자동 이름 방지)

### 5C: 세션 요약 카드
- **새 파일** `backend/services/summarizer.ts` — SDK query()로 Haiku에 요약 요청: "5줄 한글 요약"
- **`backend/routes/api.ts`** — `POST /api/sessions/:id/summarize` (최근 20메시지 → 요약 → DB 저장)
- **`backend/routes/ws-handler.ts`** — `sdk_done` 마다 `turn_count += 1`, tool_use Write/Edit 감지 → `files_edited` JSON 배열
- **`backend/services/session-manager.ts`** — SessionMeta 확장 (6필드), updateSession/getSessions/getSession에 반영, `mapRow()` 헬퍼
- **새 파일** `frontend/src/components/sessions/SummaryCard.tsx` — 접이식 카드 (요약+메타+stale경고+갱신버튼)
- **`frontend/src/components/chat/ChatPanel.tsx`** — 메시지 영역 상단에 SummaryCard 통합
- **`frontend/src/components/sessions/SessionItem.tsx`** — 상대시간 함수, 턴 수/비용 서브텍스트

### DB 마이그레이션 (6개 컬럼)
- `ALTER TABLE sessions ADD COLUMN model_used TEXT`
- `ALTER TABLE sessions ADD COLUMN auto_named INTEGER DEFAULT 1`
- `ALTER TABLE sessions ADD COLUMN summary TEXT`
- `ALTER TABLE sessions ADD COLUMN summary_at_turn INTEGER`
- `ALTER TABLE sessions ADD COLUMN turn_count INTEGER DEFAULT 0`
- `ALTER TABLE sessions ADD COLUMN files_edited TEXT DEFAULT '[]'`

### 총 규모
- 새 파일 5개, 수정 12개
- 29 files changed, ~1300 insertions, ~210 deletions (Phase 4 포함)

## 2026-02-22: Phase 4.5 — ContextPanel UX + 파일 편집 안정성

### file-store.ts 확장
- `lastOpenedFilePath` — 패널 닫아도 마지막 파일 경로 기억 (토글 재오픈용)
- `originalContent` — 로드/저장 시점 내용 기억 (실제 변경 여부를 원본 비교로 판단)
- `externalChange` — 충돌 배너 상태 (path + detectedAt)
- 새 액션: `markSaved()`, `setExternalChange()`, `reloadFromDisk()`, `keepLocalEdits()`
- `updateOpenFileContent` — originalContent와 비교하여 modified 정확히 판단

### file_saved 버그 수정 + file_changed 충돌 감지 (useClaudeChat.ts)
- `file_saved` 핸들러: `markSaved()` 호출 추가 (modified 리셋 + originalContent 갱신)
- `file_changed` 핸들러 확장:
  - 로컬 편집 없음 → 500ms 디바운스 자동 리로드
  - 로컬 편집 있음 → 충돌 배너 표시 (`setExternalChange`)
- `sendRef` 패턴: handleMessage 콜백 내부에서 send 접근 불가 → useRef로 우회

### Ctrl+S 저장 단축키 (CodeEditor.tsx)
- `onSave` prop 추가, CodeMirror `keymap` 확장으로 `Mod-s` 바인딩
- App.tsx에 글로벌 `keydown` 핸들러 (에디터 포커스 아닐 때 대비)

### ContextPanel UI 개선 (ContextPanel.tsx)
- 충돌 배너: 앰버 색상 경고 바 + "다시 불러오기" / "내 편집 유지" 버튼
- 미저장 경고: X 닫기 시 `window.confirm()` 다이얼로그
- `onReload` prop 추가 (requestFile 전달)

### 패널 토글 버튼 (App.tsx)
- 패널 닫힌 상태 + 파일 연 적 있음 → 우측 가장자리 얇은 토글 버튼 (◀ 아이콘)
- 클릭 시 lastOpenedFilePath로 requestFile 호출 → 패널 재오픈
- 파일 전환 시 미저장 가드 (`window.confirm`)

### 수정 파일
- `frontend/src/stores/file-store.ts` — 상태 3개 + 액션 4개 추가
- `frontend/src/hooks/useClaudeChat.ts` — file_saved 버그 수정, file_changed 충돌 감지
- `frontend/src/components/editor/CodeEditor.tsx` — onSave prop, Mod-s keymap
- `frontend/src/components/layout/ContextPanel.tsx` — 충돌 배너, 미저장 경고
- `frontend/src/App.tsx` — 토글 버튼, 글로벌 Ctrl+S, 파일 전환 미저장 가드

## 2026-02-22: Phase 5 개선 — 요약기/자동이름 프롬프트 강화 + SummaryCard 고정

### 백엔드: SDK 프롬프트 최적화
- **`backend/services/auto-namer.ts`** — `customSystemPrompt` + `disallowedTools` 추가, 도구 없이 순수 텍스트 생성
- **`backend/services/summarizer.ts`** — 구조화 요약 포맷 (화살표 흐름 + 불렛 + 현재 상태), `customSystemPrompt` + `disallowedTools`
- **`backend/routes/api.ts`** — 요약 API: user/assistant 필터링 강화, 디버그 로그 추가

### 프론트엔드: SummaryCard 개선
- **`frontend/src/components/sessions/SummaryCard.tsx`** — sticky top 고정 + backdrop-blur, 요약 텍스트 줄별 포매팅 (→ 흐름=보라, •불렛=들여쓰기, 현재:=에메랄드)

## 2026-02-22: Phase 4D — 첨부 칩 시스템 (Attachment Chips)

### 개요
프롬프트/파일을 채팅 입력창에 드래그 앤 드롭으로 첨부하는 기능. textarea 위에 칩 영역을 추가하여 ChatGPT/Claude.ai와 동일한 "textarea + 첨부 칩" 패턴 구현.

### chat-store 확장
- **`frontend/src/stores/chat-store.ts`** — `Attachment` 인터페이스 (id, type, label, content), `attachments[]` 상태, `addAttachment`/`removeAttachment`/`clearAttachments` 액션. 기존 `draftInput`/`setDraftInput` 제거

### 새 컴포넌트
- **새 파일** `frontend/src/components/chat/AttachmentChip.tsx` — 타입별 아이콘(⚡prompt/`/`command/📄file) + 라벨 + ✕ 삭제 버튼, 타입별 색상 (amber/primary/blue)

### InputBox 수정
- **`frontend/src/components/chat/InputBox.tsx`**
  - 칩 영역: `attachments.length > 0`일 때 textarea 위에 렌더링
  - 드롭 존: `onDragEnter`/`onDragLeave`/`onDragOver`/`onDrop` 핸들러 (dragCounter 패턴)
  - 드롭 시 시각 피드백: `ring-2 ring-primary-500/50` + "여기에 놓으세요" 오버레이
  - `buildMessage()`: 타입별 전송 로직 (prompt=prepend, command=`/cmd`, file=`[file: path]`)
  - 칩만 있어도 전송 가능 (빈 텍스트 + 칩 → 전송 허용)

### 사이드바 항목 draggable
- **`frontend/src/components/prompts/PromptItem.tsx`** — `draggable` + `onDragStart`, commands→`type:'command'`, user→`type:'prompt'`. 슬래시 중복 방지 (`title.startsWith('/')` 체크)
- **`frontend/src/components/pinboard/PinList.tsx`** — 핀 항목 `draggable`, `type:'file'`, `content: file_path`
- **`frontend/src/components/files/FileTree.tsx`** — 파일 항목(디렉토리 제외) `draggable`, `type:'file'`

### ContextPanel 프롬프트 저장 버그 수정
- **`frontend/src/App.tsx`** — `handleSaveFile`에서 `prompt:` 경로 감지 시 파일 시스템 대신 prompt store + API PATCH 호출. Ctrl+S도 `handleSaveFile` 경유하도록 수정

### 총 규모
- 새 파일 1개, 수정 6개, ~200줄 추가

## 2026-02-22: Phase 6A — 세션 연속성 / 복원력 (Session Resilience)

### 문제
스트리밍 중 WS 끊김이나 서버 재시작 시 프론트엔드가 "응답 중..." 상태에 영구 고착. 근본 원인 5가지: 서버 재시작 감지 불가, WS 재연결 핸드셰이크 없음, 스트림 분리(SDK 루프는 도는데 새 WS에 전달 안 됨), isStreaming 리셋 안 됨, DB 메시지 복구 안 됨.

### 핵심 설계: sendToSession 간접 전송
- 기존: `send(client.ws, data)` 직접 호출 → WS 끊기면 전송 실패
- 변경: `sendToSession(sessionId, data)` → sessionClients 맵에서 현재 활성 클라이언트 조회 후 전송
- 재연결 시 새 클라이언트가 맵에 등록되면 진행 중인 스트림이 자동으로 새 WS로 이어짐

### 백엔드 변경
- **`backend/config.ts`** — `serverEpoch` 추가 (서버 시작마다 고유 ID, 재시작 감지용)
- **`backend/routes/ws-handler.ts`**
  - `sessionClients` 맵 (sessionId → clientId) + `sendToSession()` 헬퍼
  - `handleReconnect()` — 재연결 시 세션 컨텍스트 복원, SDK isRunning 상태 확인 후 `reconnect_result` 응답
  - `handleChat` 내부 모든 `send(client.ws, ...)` → `sendToSession(sessionId, ...)` 교체
  - `connected` 메시지에 `serverEpoch` 포함
  - `ws.on('close')` — SDK 실행 중이면 sessionClients 유지 (재연결 대기)

### 프론트엔드 변경
- **`frontend/src/hooks/useWebSocket.ts`**
  - `onReconnect` 콜백 파라미터 추가
  - 15초 안전 타이머: WS 끊김 후 재연결 안 되면 `isStreaming` 강제 리셋 + 토스트
  - 재연결 성공 시 타이머 취소 + onReconnect 콜백 호출
- **`frontend/src/hooks/useClaudeChat.ts`**
  - `serverEpochRef` — epoch 추적, 변경 감지 시 "서버가 재시작되었습니다" 토스트 + 스트리밍 리셋
  - `handleReconnect` 콜백 — WS 재연결 시 `{type:'reconnect', sessionId, claudeSessionId}` 전송
  - `reconnect_result` 핸들러 — streaming이면 스트림 재연결, idle이면 DB에서 메시지 복구
  - `recoverMessagesFromDb()` — DB에서 메시지 로드 + normalizeContentBlocks 변환

### 커버하는 시나리오 4가지
1. **스트리밍 중 WS 끊김 → 재연결 (서버 살아있음)** — sendToSession으로 새 WS에 자동 전달
2. **스트림 완료 후 재연결** — reconnect_result idle → DB에서 전체 응답 복구
3. **서버 재시작** — serverEpoch 변경 감지 → 토스트 + isStreaming 리셋
4. **15초 초과 재연결 실패** — 안전 타이머로 isStreaming 강제 리셋 + InputBox 재활성화

### 총 규모
- 수정 4개, ~160줄 추가

## 2026-02-22: Phase 7 — 공유 워크스페이스 Git 자동 스냅샷

### 배경
5명이 동시에 같은 VM에서 Claude Code 사용. 파일 변경 추적 없이 실수로 덮어쓰면 복구 불가. 자동 기록 + 되돌리기 기능 구현.

### Phase A: 백엔드 기반

#### 신규: `backend/services/git-manager.ts`
- Git 명령어 래퍼. `child_process.execFile` 사용 (보안), promise mutex로 동시성 보호
- 핵심 함수: `initWorkspaceRepo`, `autoCommit`, `manualCommit`, `getLog`, `getFileDiff`, `rollbackToCommit`, `getStatus`
- `initWorkspaceRepo`: 서버 시작 시 workspace에 `.git` + `.gitignore` 자동 생성. `find` 명령으로 embedded git repo 자동 감지 → `.gitignore`에 추가
- `autoCommit`: Claude 작업 완료 시 editedFiles만 선택적 `git add` → commit. `--author` 옵션으로 사용자별 기록
- `manualCommit`: `git add -A --ignore-errors` → commit. embedded repo 경고 무시
- `rollbackToCommit`: `git checkout <hash> -- .` → 새 커밋으로 히스토리 보존 (git reset --hard 절대 미사용)
- 커밋 해시 검증: `/^[a-f0-9]{4,40}$/i` 정규식으로 injection 방지

#### 수정: `backend/routes/ws-handler.ts`
- `WsClient`에 `userId`, `username` 추가 (JWT에서 추출)
- `sdk_done` 직전 `autoCommit()` 호출 → `broadcast({ type: 'git_commit', commit })` 전송

#### 수정: `backend/db/schema.ts`
- `git_commits` 테이블 추가 (hash, author_name, message, commit_type, files_changed 등)

#### 수정: `backend/routes/api.ts`
- Git REST API 4개: `GET /git/log`, `GET /git/diff/:hash`, `POST /git/commit`, `POST /git/rollback`

#### 수정: `backend/config.ts`
- `gitAutoCommit` 설정 추가 (기본 true, `GIT_AUTO_COMMIT=false`로 비활성화)

#### 수정: `backend/index.ts`
- 서버 시작 시 `initWorkspaceRepo(config.workspaceRoot)` 호출

### Phase B+C: 프론트엔드 버전 탭

#### 신규: `frontend/src/stores/git-store.ts`
- zustand 스토어: commits, isLoading, expandedCommit

#### 신규: `frontend/src/components/git/GitPanel.tsx`
- 사이드바 "버전" 탭 내용: 스냅샷 저장 폼 + 커밋 목록 + Diff 보기 + 되돌리기 (확인 다이얼로그)
- commit_type별 뱃지: auto=회색, manual=파랑, rollback=빨강
- 커밋 클릭 시 변경 파일 목록 펼침

#### 수정: 프론트엔드 5개 파일
- `session-store.ts` — sidebarTab에 `'git'` 추가
- `Sidebar.tsx` — 4번째 "버전" 탭 + GitPanel 렌더링
- `useClaudeChat.ts` — `git_commit` WS 핸들러 + 토스트
- `App.tsx` — git log 초기 로드 + handleViewDiff

### 디버깅: 홈 디렉토리 workspace 문제
- `/home/azureuser`에 ~10개 git repo + embedded git (최대 6레벨 깊이)
- `.gitignore`에 `.*` (모든 hidden dirs) 추가 + `find -maxdepth 8`로 embedded repo 자동 감지
- `git add -A` → `git add -A --ignore-errors`로 변경 (embedded repo 경고 무시)
- mutex 데드락: `gitLock.then(fn, fn)` → `Promise resolve/reject` 패턴으로 안전한 에러 전파

### 총 규모
- 새 파일 3개, 수정 9개
- 백엔드 ~250줄, 프론트엔드 ~200줄
