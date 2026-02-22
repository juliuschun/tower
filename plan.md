# Claude Desk — 리서치/분석 팀을 위한 Claude Code 웹 플랫폼

## Context

원격 서버(Azure VM)에서 Claude Code를 돌리고 브라우저에서 접속하는 환경을 구축 중.
기존 오픈소스 3개(claude-code-webui, claude-code-web, claude-code-ui)를 분석한 결과,
SDK 기반 + 깔끔한 UI + 파일/에디터를 결합한 자체 플랫폼이 필요.

**타겟 유저:** 리서치/분석 팀 (비개발자 포함)
**핵심 니즈:** Claude와 대화하며 리서치 → MD 보고서 렌더링 → 파일 편집

**비-목표 (Non-goals):**
- 멀티 서버 클러스터링 / 수평 스케일링 (단일 VM 전제)
- 실시간 협업 (동시 편집, 커서 공유 등)
- Claude API 직접 호출로 SDK 우회

---

## Tech Stack

| 레이어 | 선택 | 이유 |
|--------|------|------|
| **Frontend** | React 18 + Vite + TailwindCSS v4 | 세 오픈소스 모두 사용. 검증됨 |
| **Backend** | Express + WebSocket (ws) | HTTP + 양방향 실시간 통신 |
| **Claude 연동** | @anthropic-ai/claude-code SDK | PTY 아닌 SDK. API 키 전환 용이 |
| **에디터** | CodeMirror 6 (@uiw/react-codemirror) | Monaco보다 가볍고 모바일 지원 |
| **MD 렌더링** | react-markdown + remark-gfm + rehype-highlight | GFM 테이블, 코드 하이라이팅 |
| **DB** | better-sqlite3 | 세션 메타, 유저, 스크립트 저장 |
| **상태관리** | zustand | Redux보다 단순 |
| **언어** | TypeScript | 프론트/백엔드 모두 |

---

## UI 레이아웃

```
┌──────────────────────────────────────────────────────┐
│  HEADER: 로고 · 워크스페이스 선택 · 세션 이름 · 설정  │
├────────┬─────────────────────────┬───────────────────┤
│        │                         │                   │
│ LEFT   │    CENTER               │   RIGHT           │
│ SIDEBAR│    CHAT PANEL           │   CONTEXT PANEL   │
│        │                         │                   │
│ 세션   │  [메시지 버블]           │  MD 렌더 뷰어     │
│ 히스토리│  [도구 사용 카드]        │  코드 에디터      │
│        │  [사고 과정 접기]        │                   │
│ 프롬프트│                         │  HTML iframe      │
│        │                         │  파일 미리보기     │
│ 파일   │                         │  프롬프트 미리보기 │
│ 트리   │  ┌───────────────────┐  │                   │
│        │  │ 입력창 + / 명령어  │  │                   │
│ 핀보드  │  └───────────────────┘  │                   │
├────────┴─────────────────────────┴───────────────────┤
│  BOTTOM BAR: 비용 · 토큰 사용량 · 세션 상태           │
└──────────────────────────────────────────────────────┘
```

- **좌측 사이드바:** 접기 가능. 세션 히스토리 (하단에 프롬프트 섹션) + 파일 트리 + 핀보드
- **중앙 채팅:** 메인 인터랙션. Claude 응답은 마크다운 렌더링
- **우측 컨텍스트:** 파일 클릭 시 열림. MD 렌더/에디터/HTML iframe. 드래그 리사이즈 + 열기/닫기 토글 (너비 localStorage 저장)
- **모바일 (≤768px):** 하단 탭바로 전환 (💬채팅 | 📁파일 | ✏️편집 | 📌핀). 파일 클릭 시 편집 탭 자동 전환. 드래그&드롭 대신 롱프레스→"채팅에 첨부"

### 비개발자를 위한 UI 원칙

- Git 용어 없음: "commit" → "스냅샷 저장", "branch" → "버전"
- 파일 경로 대신 빵크럼 네비게이션
- 도구 사용 카드: "명령어 실행됨: 패키지 3개 설치" (접으면 상세)
- 에러: 요약 먼저, "기술 상세" 접기
- MD 파일은 렌더링 뷰가 기본, "편집" 토글로 에디터 전환

---

## 핵심 아키텍처

### 1. SDK 연동 (backend/services/claude-sdk.ts)

```
브라우저 ←WebSocket→ Express 서버 ←SDK query()→ Claude CLI 바이너리
```

- `@anthropic-ai/claude-code` SDK의 `query()` 비동기 제너레이터 사용
- `pathToClaudeCodeExecutable: "/home/azureuser/.local/bin/claude"`
- `permissionMode: "bypassPermissions"` (--dangerously-skip-permissions 대응)
- `resume: sessionId` 로 세션 이어하기
- **CLAUDECODE 환경변수 제거 필수** — `delete process.env.CLAUDECODE` at startup

### 2. WebSocket 프로토콜

```
CLIENT → SERVER:
  chat        { message, sessionId, cwd }
  abort       { sessionId }
  file_read   { path }
  file_write  { path, content }
  file_tree   { path }
SERVER → CLIENT:
  sdk_message { data: SDKMessage }
  sdk_done    { sessionId, cost, duration }
  file_content { path, content, language }
  file_tree    { entries }
  file_changed { path, changeType }
  error         { message }
```

### 3. SDK 메시지 → UI 매핑

| SDK 메시지 타입 | UI 렌더링 |
|----------------|-----------|
| `system` (subtype: init) | 세션 초기화, 사용 가능한 slash_commands 목록 파싱 |
| `assistant` → content `text` | 마크다운 렌더링된 메시지 버블 |
| `assistant` → content `tool_use` | 도구 사용 카드 (Bash→명령+출력, Read→파일미리보기, Write/Edit→diff) |
| `assistant` → content `thinking` | 접기 가능한 "사고 과정" 블록 |
| `result` | 비용 배지 업데이트, 세션 통계 |

### 4. 파일 시스템

- Express REST API로 파일 트리 / 읽기 / 쓰기
- `chokidar`로 워크스페이스 감시 → 변경 시 WebSocket push
- 경로 검증: 워크스페이스 밖 접근 차단
- `.git/`, `node_modules/`, `__pycache__/` 기본 숨김

### 5. 슬래시 명령어 & Skills

- `~/.claude/commands/` 와 `~/.claude/skills/` 스캔하여 명령어 목록 생성
- `/` 입력 시 드롭다운 피커 표시 (이름 + 설명)
- SDK가 slash commands를 네이티브 처리 — `/` 떼고 prompt로 전달

### 7. 세션 관리

- **Claude 네이티브 세션:** `~/.claude/projects/<encoded-path>/*.jsonl` (읽기 전용)
- **플랫폼 메타데이터:** SQLite (세션 이름, 태그, 즐겨찾기, 유저)
- 세션 히스토리 목록 + 검색 + 이어하기 + 리플레이

### 8. 인증

- 첫 실행: 관리자 계정 생성
- bcrypt + JWT (24시간 만료)
- 역할: admin / user
- `--no-auth` 플래그로 단독 사용 시 인증 끄기

### 9. 동시성 모델

다중 사용자가 동시에 Claude와 대화할 때의 정책.

- **SDK 호출 방식:** `query()` 호출 시 별도 자식 프로세스 생성 → 동시 세션 가능하나 리소스 제한 필요
- **동시 세션 상한:** 환경변수 `MAX_CONCURRENT_SESSIONS` (기본 3)
- **초과 시 동작:** 큐잉 + "현재 N명이 사용 중, 잠시 후 시도하세요" UI 메시지
- **프로세스 타임아웃:** 단일 query가 5분 이상 응답 없으면 abort
- **리소스 모니터링:** 활성 세션 수 + 메모리 사용량을 BOTTOM BAR에 표시 (admin만)

### 10. 권한 정책 (permissionMode 전략)

`bypassPermissions`를 외부에 그대로 노출하면 위험. 역할별 분리:

| 역할 | permissionMode | 근거 |
|------|---------------|------|
| admin | `bypassPermissions` | 서버 관리자, 전체 제어 |
| user | `acceptEdits` | 파일 편집은 허용, 임의 명령 실행은 차단 |

- 역할 → permissionMode 매핑은 `config.ts`에서 관리
- Phase 5 외부 노출 전에 반드시 적용
- 장기: 유저별 워크스페이스 디렉토리 격리 (`/workspace/{username}/`) 검토

### 11. 에러 복구 & 안정성

Phase별로 흩어지지 않고 공통 인프라로 관리할 항목:

- **WebSocket 재연결:** 클라이언트 자동 재연결 (exponential backoff, 최대 30초)
- **SDK 프로세스 hang 감지:** heartbeat 없이 N초 경과 시 abort + 유저 알림
- **SQLite WAL 비대화:** 주기적 `PRAGMA wal_checkpoint(TRUNCATE)` 또는 앱 시작 시 실행
- **데이터 수명 관리:** 90일 이상 된 세션 JSONL 자동 정리 (설정 가능), DB vacuum 주기

---

## 프로젝트 구조

```
claude-desk/
  package.json
  tsconfig.json
  vite.config.ts

  backend/
    index.ts                 -- Express + WS 서버 엔트리
    config.ts                -- 설정 (포트, 경로, 인증)
    db/
      schema.ts              -- SQLite 스키마
    services/
      claude-sdk.ts          -- SDK query() 래퍼
      file-system.ts         -- 파일 트리, 읽기/쓰기, chokidar
      pin-manager.ts         -- 핀 CRUD
      session-manager.ts     -- 세션 CRUD, JSONL 파싱
      command-loader.ts      -- Skills 로더
      auth.ts                -- JWT + bcrypt
    routes/
      api.ts                 -- REST 엔드포인트
      ws-handler.ts          -- WebSocket 메시지 라우팅

  frontend/
    src/
      App.tsx
      main.tsx
      stores/                -- zustand 스토어
        chat-store.ts
        file-store.ts
        pin-store.ts
        session-store.ts
      components/
        layout/              -- Header, Sidebar, MainPanel, ContextPanel
        chat/                -- ChatPanel, MessageBubble, ToolUseCard,
                                ThinkingBlock, InputBox, SlashCommandPicker
        files/               -- FileTree, MarkdownRenderer, DiffView
        editor/              -- CodeEditor
        sessions/            -- SessionList, SessionReplay
        auth/                -- LoginPage, SetupPage
      hooks/
        useWebSocket.ts
        useClaudeChat.ts
      utils/
        message-parser.ts    -- SDK 메시지 → UI 컴포넌트 매핑
```

---

## 개발 단계

### Phase 1: Core Chat + MD 렌더링 ✅ DONE
1. 프로젝트 스켈레톤 (Vite + React + Express + TS) ✅
2. `claude-sdk.ts` — SDK query() 래핑, CLAUDECODE 환경변수 정리 ✅
3. WebSocket 서버 + 기본 chat 프로토콜 ✅
4. ChatPanel, MessageBubble, InputBox 컴포넌트 ✅
5. ToolUseCard (Bash, Read, Write, Edit 도구별 카드) ✅
6. assistant 메시지 마크다운 렌더링 ✅
7. 세션 resume 기본 구현 ✅
8. 심플 토큰 인증 (JWT) ✅

### Phase 2: 파일 시스템 + 에디터 + 세션 UX ✅ DONE
1. CodeMirror 6 에디터 (textarea 교체, 7언어 지원) ✅
2. 파일 트리 SVG 아이콘 + lazy loading + 로딩 스피너 ✅
3. chokidar 실시간 파일 감시 + WS broadcast ✅
4. 사이드바 탭 (세션/파일) 전환 ✅
5. 세션 검색, 즐겨찾기 토글, 인라인 이름 변경 ✅
6. 세션 자동 생성 + claudeSessionId resume ✅
7. WS 인증 토큰 전달 ✅

### Phase 2.5: 핀보드 + 프롬프트 패널

두 가지 즐겨찾기 기능. 역할이 다르므로 위치도 분리.

```
┌──────────────────┐
│ 세션 | 파일 | 핀  │
├──────────────────┤
│ [검색...]        │       ┌───────────────────┐
│                  │       │                   │
│ 세션 A           │       │  ContextPanel     │
│ 세션 B           │       │  (핀 파일 렌더링)  │
│ 세션 C           │       │                   │
│                  │       │                   │
│ ▼ 프롬프트 (3)   │       │                   │
│ ⚡ 일일 리서치    │──드래그──→ 채팅 InputBox
│ ⚡ 코드 리뷰     │       │                   │
│ [+ 추가]         │       │                   │
├──────────────────┤       └───────────────────┘
│ Settings  v0.1.0 │
└──────────────────┘
```

**A. 핀보드 (사이드바 3번째 탭 "핀") — 파일/대시보드 전용**

클릭 → ContextPanel에서 렌더링. 드래그 → 채팅에 파일 컨텍스트 첨부.

| 파일 타입 | ContextPanel 렌더 방식 |
|----------|----------------------|
| `.md` | react-markdown (미리보기/편집 토글) |
| `.html` / `.htm` | iframe (`sandbox="allow-scripts"`, same-origin 제외) |
| 기타 | CodeMirror (읽기 전용) |

**B. 프롬프트 섹션 (세션 탭 하단, 접기 가능) — 채팅 전용**

클릭 → ContextPanel에 프롬프트 미리보기 표시. 드래그 → 채팅 InputBox에 삽입.
`~/.claude/commands/` 항목은 자동으로 목록에 포함.

**DB 스키마:**

```sql
CREATE TABLE IF NOT EXISTS pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  pin_type TEXT NOT NULL DEFAULT 'file',  -- 'file' | 'prompt'
  file_path TEXT,                          -- file: 파일 경로
  content TEXT,                            -- prompt: 프롬프트 내용
  file_type TEXT DEFAULT 'markdown',       -- file 렌더링용
  sort_order INTEGER DEFAULT 0,
  user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**구현 항목:**

1. DB: `pins` 테이블 추가 (`schema.ts`) — file/prompt 통합
2. `pin-manager.ts` — 핀 CRUD + `~/.claude/commands/` 자동 로드
3. REST API (`api.ts`):
   - `GET/POST /api/pins`, `PATCH/DELETE /api/pins/:id`, `POST /api/pins/reorder`
   - `GET /api/files/serve?path=...` — HTML iframe용 raw 파일 서빙
4. `pin-store.ts` — zustand 스토어
5. 핀보드 탭: `PinList` 컴포넌트 (파일 핀 목록)
   - 클릭 → ContextPanel 열기
   - 드래그 → 채팅 컨텍스트 첨부
   - FileTree에서 hover 시 📌 아이콘으로 추가
6. 프롬프트 섹션: 세션 탭 하단 접기 가능 영역 + `+` 추가 버튼
   - 클릭 → ContextPanel에 미리보기
   - 드래그 → 채팅 InputBox에 삽입
   - 우클릭 → 편집 / 삭제
7. ContextPanel에 HTML iframe 렌더링 모드 추가
8. App.tsx 연결: 핀/프롬프트 로드, 드래그&드롭 핸들링

**설계 노트:**
- 파일 핀: 경로만 저장, 디스크에서 실시간 읽기 (`readFile()` 재사용)
- 프롬프트 핀: content에 내용 직접 저장
- `~/.claude/commands/` 항목은 서버 시작 시 프롬프트 목록에 자동 포함 (읽기 전용)
- `file_changed` WebSocket으로 핀된 파일 변경 자동 감지
- `isPathSafe()` 재사용하여 워크스페이스 밖 접근 차단

### Phase 3: 메시지 영속화 + 핀보드 + 설정 + UI 폴리시 ✅ DONE
1. message-store.ts — 메시지 DB 저장/복원 (ws-handler 실시간 저장, 세션 전환 시 복원) ✅
2. 핀보드 — pin-manager CRUD, PinList UI, 사이드바 핀 탭, iframe file serve ✅
3. 설정 패널 — SettingsPanel, settings-store, GET /config ✅
4. UI 폴리시 — ErrorBoundary, toast, FileTree 개선 ✅

### Phase 3.5: ToolUseCard 칩 레이아웃 + DB 마이그레이션 ✅ DONE
1. ToolChip 가로 칩 컴포넌트 + ToolChipGroup (클릭 시 세로 펼침) ✅
2. DB 마이그레이션 — messages, pins 테이블 직접 생성 ✅

### Phase 4: ContextPanel 강화 + 프롬프트 + 안정성 ✅ DONE

실사용에서 가장 임팩트가 큰 기능 순으로 정렬.

#### 4A. ContextPanel 드래그 리사이즈 + 개선
1. 채팅↔패널 사이 드래그 핸들 (마우스/터치)
2. 더블클릭 시 기본 너비 리셋, 너비 localStorage 저장
3. 열기/닫기 토글 버튼
4. HTML 파일 iframe 렌더링 모드 (핀보드 연동)

#### 4B. 슬래시 명령어 + Skills
1. SlashCommandPicker 컴포넌트 (`/` 입력 시 드롭다운)
2. command-loader.ts 개선 — `~/.claude/commands/` + skills 스캔
3. 명령어 선택 → InputBox에 삽입 → 전송

#### 4C. 프롬프트 섹션 (Phase 2.5에서 이동)
1. DB 스키마 확장 — pins 테이블에 `pin_type` (file/prompt), `content` 컬럼 추가
2. 세션 탭 하단 접기 가능 프롬프트 영역
3. `~/.claude/commands/` 항목 자동 목록 포함
4. 클릭 → ContextPanel에 미리보기, 드래그 → InputBox에 삽입

#### 4D. 첨부 칩 시스템 (Attachment Chips) ✅

InputBox에 "textarea + 첨부 칩 영역" 패턴 도입. ChatGPT/Claude.ai와 동일한 UX.

**UI 구조:**
```
┌──────────────────────────────────────┐
│ [⚡ 일일 리서치 ✕] [📄 report.md ✕]  │  ← 첨부 칩 영역
├──────────────────────────────────────┤
│ 메시지를 입력하세요...                │  ← 기존 textarea
└──────────────────────────────────────┘
```

**칩 타입:**
| 소스 | 드래그 대상 | 칩 표시 | 전송 시 동작 |
|------|-----------|---------|------------|
| 프롬프트 (user) | 사이드바 프롬프트 | ⚡ 제목 | content를 메시지 앞에 삽입 |
| 프롬프트 (commands) | 사이드바 프롬프트 | ⚡ /명령어 | `/명령어`로 전송 |
| 파일 (핀/트리) | 사이드바 파일/핀 | 📄 파일명 | 파일 경로를 컨텍스트로 첨부 |
| 이미지 (Phase 6) | OS 드래그 앤 드롭 | 🖼 파일명 | 업로드 후 경로 첨부 |

**구현 항목:**

1. **chat-store 확장** — `attachments: Attachment[]` 배열 추가
   ```ts
   interface Attachment {
     id: string;
     type: 'prompt' | 'command' | 'file' | 'image';
     label: string;       // 칩에 표시할 이름
     content: string;     // 실제 전송할 내용 (프롬프트 텍스트 or 파일 경로)
   }
   ```
2. **AttachmentChip 컴포넌트** — 타입별 아이콘 + 이름 + ✕ 삭제 버튼
3. **InputBox 수정** — textarea 위에 칩 영역 렌더링, 전송 시 attachments 조합
4. **드래그 앤 드롭**
   - 사이드바 항목에 `draggable` + `onDragStart` (dataTransfer에 타입/데이터 세팅)
   - InputBox에 `onDragOver` + `onDrop` (칩으로 변환하여 attachments에 추가)
   - 드롭 존 하이라이트 (드래그 진입 시 보더 강조)
5. **전송 로직** — attachments를 메시지 텍스트와 조합
   - prompt: content + "\n\n" + 사용자 텍스트
   - command: `/명령어 사용자 텍스트`
   - file: `[파일: /path/to/file]\n\n사용자 텍스트` (또는 SDK 컨텍스트 방식)

**확장성:**
- Phase 6에서 OS 파일 드래그 앤 드롭, 이미지 업로드도 동일한 칩 시스템으로 통합
- 복수 첨부 지원 (여러 파일/프롬프트 동시)
- 칩 순서 변경 (드래그)은 추후

#### 4E. 채팅 비주얼 개선
1. 폰트 정비 — 본문/코드/UI 폰트 분리, 가독성 좋은 웹폰트 적용 (Pretendard, JetBrains Mono 등)
2. 메시지 버블 레이아웃 다듬기 — 여백, 줄간격, 최대 너비 조정
3. 마크다운 렌더링 스타일 개선 — 코드블록 테마, 테이블/리스트 간격, 인라인 코드 배경색
4. ToolUseCard/ToolChip 시각 다듬기 — 아이콘, 색상, hover/active 상태
5. 타이포그래피 일관성 — 헤더/본문/캡션 크기 체계 정리

#### 4F. 안정성 + 보안
1. WebSocket 자동 재연결 (exponential backoff, 최대 30초)
2. SDK 프로세스 hang 감지 + abort + 유저 알림
3. 동시 세션 상한 (`MAX_CONCURRENT_SESSIONS`) + 큐잉 UI
4. 역할별 permissionMode 적용 (admin→bypass, user→acceptEdits)

### Phase 4.5: ContextPanel UX + 파일 편집 안정성 ✅ DONE

1. file-store.ts 확장 — `lastOpenedFilePath`, `originalContent`, `externalChange` 상태 + `markSaved()`, `reloadFromDisk()`, `keepLocalEdits()` 액션 ✅
2. file_saved 버그 수정 — `markSaved()` 호출로 modified 리셋 + originalContent 갱신 ✅
3. file_changed 충돌 감지 — 로컬 편집 없으면 500ms 디바운스 자동 리로드, 로컬 편집 있으면 충돌 배너 ✅
4. Ctrl+S 저장 — CodeMirror `Mod-s` keymap + App.tsx 글로벌 keydown 핸들러 ✅
5. ContextPanel 충돌 배너 — "이 파일이 외부에서 수정되었습니다" + 다시 불러오기 / 내 편집 유지 ✅
6. 미저장 경고 — X 닫기 / 파일 전환 시 `window.confirm()` 다이얼로그 ✅
7. 패널 토글 버튼 — 닫힌 상태에서 우측 얇은 ◀ 버튼, 클릭 시 마지막 파일 재오픈 ✅

### Phase 5: 모델 셀렉터 + 세션 인텔리전스 ✅ DONE

#### 5A. 모델 셀렉터 ✅

Header의 모델 배지를 클릭하면 드롭다운으로 모델 전환 가능.

**드롭다운 UI:**
```
┌──────────────────────────────────┐
│  Claude Opus 4.6      ✓  [MAX]  │
│  Claude Sonnet 4.6       [MAX]  │
│  Claude Haiku 4.5        [API]  │
│ ─────────────────────────────── │
│  ⚙ 모델 설정...                  │
└──────────────────────────────────┘
```

**구현 항목:**
1. Header 모델 배지 → 클릭 시 드롭다운 (ModelSelector 컴포넌트)
2. 연결 유형 배지 표시: MAX (보라) / API (초록) — 실행 환경 자동 감지
3. 모델 선택 시 다음 메시지부터 적용 (진행 중 대화 영향 없음)
4. Settings 패널에 "모델 설정" 탭 추가 — 사용 가능 모델 목록 관리, 기본 모델 지정
5. DB: `sessions` 테이블에 `model_used TEXT` 컬럼 추가 (세션별 모델 추적)
6. 새 store: `model-store.ts` — 사용 가능 모델 목록, 선택된 모델, 연결 유형

**기술 노트:**
- SDK `query()` 호출 시 모델 파라미터 전달 가능 여부 확인 필요
- 불가능하면 Claude Code 실행 시 `--model` 플래그 또는 환경변수로 전달
- 연결 유형은 `ANTHROPIC_API_KEY` 유무 또는 `~/.claude/credentials` 상태로 판별

#### 5B. 세션 자동 이름 생성 ✅

첫 대화 완료 후 Haiku 에이전트가 자동으로 세션 제목 생성.

**구현 항목:**
1. 백엔드: `POST /api/sessions/:id/auto-name` — Haiku API 직접 호출 (SDK와 별개)
2. 트리거: 첫 assistant 응답 완료 후 자동 실행
3. 15자 내외 한글 제목 생성 (예: "React 라우터 버그 수정", "DB 스키마 마이그레이션")
4. 유저가 직접 이름 변경 시 자동 이름 생성 비활성화 (`auto_named` 플래그)
5. DB: `sessions` 테이블에 `auto_named INTEGER DEFAULT 1` 컬럼 추가

#### 5C. 세션 요약 카드 ✅

수동 트리거 방식 + stale 힌트로 요약 최신성 인지.

**요약 카드 UI:**
```
┌─────────────────────────────────────────────────┐
│ 📋 세션 요약                            🔄  ✕   │
│                                                 │
│ React 프로젝트의 라우터 이슈를 디버깅함.           │
│ App.tsx에서 중첩 라우트 구조를 리팩토링하고         │
│ 인증 가드 미들웨어를 추가함. 테스트 통과 확인.      │
│                                                 │
│ 💬 12 turns · 📝 4 files edited · ⏱ 23분       │
│ ⚠ 요약 이후 8턴 진행됨                    🔄     │
└─────────────────────────────────────────────────┘
```

**구현 항목:**
1. 백엔드: `POST /api/sessions/:id/summarize` — Haiku API 직접 호출, 주요 메시지 읽고 5줄 요약
2. 요약 생성: 오직 유저가 🔄 버튼 클릭 시에만 (자동 실행 안 함)
3. stale 표시: `summary_at_turn` 저장 → 현재 turn 수와 비교 → 5턴 이상 차이 시 ⚠ 경고색
4. 요약 없는 세션: "아직 요약 없음 — 🔄 요약 생성" 버튼만 표시
5. 위치: 세션 진입 시 채팅 영역 상단 접이식 카드
6. DB: `sessions` 테이블에 `summary TEXT`, `summary_at_turn INTEGER`, `turn_count INTEGER DEFAULT 0`, `files_edited TEXT DEFAULT '[]'` 추가
7. `SummaryCard.tsx` 컴포넌트 — 접이식, 새로고침 버튼, stale 힌트
8. 메타 정보 표시: 턴 수, 수정 파일 수, 소요 시간, 비용/토큰, 사용 모델

**사이드바 세션 목록 개선:**
```
┌───────────────────────────┐
│ ⭐ React 라우터 버그 수정    │
│    12 turns · $0.42       │
│    2시간 전                │
├───────────────────────────┤
│    DB 스키마 설계            │
│    5 turns · $0.18        │
│    어제                    │
└───────────────────────────┘
```

---

## TODO / 백로그

### Footer: 현재 세션 CWD 표시

채팅이 어느 폴더에서 실행 중인지 BottomBar에 표시.

- 위치: `App.tsx` > `BottomBar` 컴포넌트 (하단 footer)
- 소스: `useSessionStore`의 `activeSession.cwd` (이미 세션 메타에 포함됨)
- 표시 방식: 폴더 아이콘 + 경로 (긴 경로는 앞부분 truncate)
- 세션 없을 때: 미표시

---

실사용 중 발견된 이슈와 향후 개선 항목.

### ✅ 세션 격리 (Cross-session message leak / 응답 유실) — DONE

커밋 `32ddd8d`에서 수정 완료.
- [x] A. 세션 전환 시 abort (프론트 `abort()` + 백엔드 `abortSession`)
- [x] B+C. `set_active_session` 핸들러 + `sendToSession` 가드
- [x] D. 프론트 sessionId 필터 null 허점 수정 (3곳)
- [x] activeSessions 메모리 누수 5분 자동 정리
- [x] JWT 토큰 만료 시 자동 로그아웃

### 🔴 세션 CWD (작업 디렉토리) 설계

**현재 문제:**
- 세션 생성 시 cwd가 항상 `config.defaultCwd`로 고정 (프론트가 cwd를 안 보냄)
- UI에서 CWD를 변경할 방법이 전혀 없음
- BottomBar에 경로가 잘려서 표시되고 클릭 불가
- Claude가 작업하는 폴더 = 세션 cwd인데, 사용자가 제어 불가

**설계 결정 필요:**

1. **세션 생성 시 CWD 어떻게 결정?**
   - A) 서버 기본값 고정 (`config.defaultCwd`) — 현재 방식, 단순하지만 유연성 없음
   - B) 새 세션 UI에 폴더 선택 피커 — 사이드바 파일 트리에서 폴더 선택 후 세션 생성
   - C) BottomBar 또는 Header에 폴더 선택 드롭다운 — 세션 중에도 변경 가능
   - D) 파일 트리에서 폴더 우클릭 → "여기서 새 세션" — 파일 탐색과 자연스럽게 연결

2. **세션 도중 CWD 변경 허용?**
   - 허용하면: 백엔드에서 다음 chat부터 새 cwd 적용 + DB 업데이트
   - 비허용하면: 세션 생성 시에만 결정, 이후 고정 (더 단순)
   - Claude Code CLI는 세션 중 `cd`로 자유롭게 이동하지만, SDK의 cwd는 초기값

3. **BottomBar CWD 표시 개선:**
   - 클릭 시 폴더 피커 열기 (breadcrumb 스타일로 경로 표시, 각 세그먼트 클릭 가능)
   - 또는 클릭 시 파일 트리를 해당 폴더로 이동
   - 긴 경로: 앞부분 생략 (`.../claude-desk`) 또는 `~` 상대 경로

**추천 방향 (B+C 조합):**
```
┌─────────────────────────────────────────────────┐
│ BottomBar: 🟢 대기 │ 📁 ~/tunnelingcc/claude-desk [▼]  │
│                     클릭 시 폴더 피커 드롭다운         │
└─────────────────────────────────────────────────┘
```
- 새 세션: 마지막 사용 cwd 기억 + 변경 가능
- 기존 세션: BottomBar 클릭으로 cwd 변경 → 다음 메시지부터 적용
- 변경 시 파일 트리도 해당 폴더로 갱신
- DB에 cwd 업데이트 (`PATCH /api/sessions/:id`)

**구현 범위:**
- [ ] BottomBar cwd 클릭 → 폴더 피커 드롭다운 (파일 트리 재활용 또는 breadcrumb)
- [ ] 세션 cwd 변경 API (`PATCH /sessions/:id` + chat 메시지에 cwd 반영)
- [ ] 새 세션 생성 시 현재 세션의 cwd 상속
- [ ] `sendMessage`에서 `activeSession.cwd`를 chat 메시지에 포함

### 세션 이름 인라인 편집 (사이드바)

현재 세션 이름 변경은 더블클릭 → input으로 가능하지만, 리스트에서의 UX가 불완전.

- [x] 세션 목록에서 이름 수정 진입이 직관적이지 않음 (더블클릭 발견성 낮음) — 호버 시 연필 아이콘 추가
- [x] 이름 변경 시 리스트 레이아웃 깜빡임 (input 크기 전환) — min-h + 고정 높이 input 적용
- [x] 개선안: 우클릭 컨텍스트 메뉴 또는 호버 시 연필 아이콘 표시 — 둘 다 구현
- [ ] 이름 변경 후 정렬 순서 즉시 반영

### 세션 연속성 / 메시지 유실 문제

세션 작업 중간에 다른 세션으로 전환 후 돌아왔을 때, 또는 서버 재시작이 발생했을 때 기존 작업 흐름이 끊기는 문제.

**증상:**
- thinking 중에 서버가 재시작되면 해당 턴의 응답이 유실됨
- 세션 A에서 작업 중 → 세션 B로 전환 → 세션 A로 복귀 시, SDK 내부 상태와 UI 상태 불일치
- 서버 재시작 후 `claudeSessionId`로 resume해도, 마지막 턴이 반영되지 않은 채 이어지는 경우 있음

**조사 필요 항목:**
- [ ] SDK `resume` 시 마지막 미완료 턴의 처리 방식 확인 (SDK가 재전송하는지, 무시하는지)
- [ ] 서버 재시작 감지 → 프론트에 "서버가 재시작되었습니다. 마지막 응답이 유실되었을 수 있습니다" 알림
- [ ] ws reconnect 시 세션 상태 재동기화 (현재 claudeSessionId, 마지막 메시지 ID 비교)
- [ ] 스트리밍 중 WS 끊김 → 재연결 후 미완료 응답 복구 가능성 (SDK abort 후 재시도?)
- [ ] DB에 저장된 메시지와 실제 SDK 세션 상태의 일관성 보장 방안

**잠재 해결 방향:**
- 서버 시작 시 `boot_id` 발급 → 프론트가 reconnect 시 이전 boot_id와 비교 → 다르면 서버 재시작 감지
- 스트리밍 중 WS 끊김 시, 재연결 후 마지막 `sdk_done` 이후의 메시지만 DB에서 복원
- 세션 전환 시 진행 중인 query를 abort하고 상태를 확정(committed)한 후 전환

### 🔴 Plan Mode + AskUserQuestion 응답 사라짐 버그

**증상:** Claude가 plan mode 진입 후 사용자에게 질문(AskUserQuestion)을 던질 때 응답이 렌더링되지 않고 사라짐.

**발견된 원인 3가지:**

1. **`tool_result` 블록 렌더링 누락** (`MessageBubble.tsx:103`)
   - `groupContentBlocks`가 `tool_result` 타입 그룹을 만들지만, 렌더러는 `text`, `tool_use`, `thinking` 3가지만 처리
   - 나머지 타입은 `return null` → 해당 그룹이 통째로 사라짐
   - SDK `user` 메시지의 tool_result는 `attachToolResult`로 기존 tool_use에 병합되지만, `assistant` 메시지 내 tool_result 블록은 독립 렌더링 불가

2. **인터랙티브 도구 UI 미지원**
   - `AskUserQuestion`: CLI에서는 옵션 선택 UI가 뜨지만, 웹 UI에는 응답 메커니즘 없음
   - `EnterPlanMode` / `ExitPlanMode`: 동일하게 인터랙티브 도구
   - `bypassPermissions` 모드에서 SDK가 자동 응답할 수 있지만, headless 환경에서 입력 대기로 hang → 5분 뒤 `SDK_HANG` timeout 가능성

3. **`mergeConsecutiveAssistant` 블록 재정렬 시 `tool_result` 소실**
   - thinking → tool_use → text → other 순으로 재정렬하면서 `tool_result`는 `other`로 밀림
   - 이후 렌더러에서 `return null` 처리

**수정 방향:**
- [ ] `MessageBubble.tsx`: `tool_result` 타입 그룹을 tool_use 칩과 유사하게 렌더링 (최소한 fallback)
- [ ] `AskUserQuestion` 전용 UI 컴포넌트: 질문 + 옵션 버튼 표시 → 사용자 선택 → SDK에 응답 전달
- [ ] `EnterPlanMode` / `ExitPlanMode` 시각적 표시 (plan mode 진입/종료 배너)
- [ ] 미처리 SDK 메시지 타입에 대한 fallback 렌더링 + console.warn 로깅
- [ ] SDK headless 환경에서 AskUserQuestion 동작 확인 (자동 응답 vs hang)

**우선순위:** `tool_result` 렌더링 → AskUserQuestion UI → plan mode 배너

### Mermaid 차트 렌더링

Claude 응답이나 MD 파일에 mermaid 코드블록이 포함될 경우, 다이어그램으로 렌더링.

- **대상:** ChatPanel의 마크다운 렌더링 + ContextPanel의 MD 미리보기
- **라이브러리:** `mermaid` (공식) — react-markdown 커스텀 코드블록 렌더러에서 ` ```mermaid ` 감지 시 `mermaid.render()` 호출
- **구현 방향:**
  - react-markdown의 `components.code`에서 language가 `mermaid`일 때 별도 `MermaidBlock` 컴포넌트 렌더
  - `MermaidBlock`: useEffect로 mermaid.render() 호출, SVG 출력
  - 에러 시 원본 코드 fallback 표시
  - 다크모드 대응: mermaid theme을 `dark`/`default`로 전환
- **지원 다이어그램:** flowchart, sequence, class, state, ER, gantt, pie 등 mermaid 기본 전체

### 대화 내용 부분 복사

채팅 메시지 개별 버블에서 해당 내용만 클립보드에 복사할 수 있는 기능.

- **UI:** 메시지 버블 hover 시 우상단에 📋 복사 아이콘 표시
- **복사 대상:**
  - assistant 메시지: 마크다운 원본 텍스트 (렌더링된 HTML 아님)
  - user 메시지: 입력 원본 텍스트
  - 코드블록: 코드블록 우상단에 별도 복사 버튼 (코드만 복사)
- **구현:** `navigator.clipboard.writeText()` + 복사 완료 토스트
- **추가 고려:** 여러 메시지 범위 선택 복사 (Shift+클릭?)

### 세션 마지막 대화 시간 표시

사이드바 세션 목록에서 각 세션의 마지막 대화 시간을 표시.

- **데이터:** `sessions` 테이블의 `updated_at` 또는 마지막 메시지의 `created_at`
- **표시 형식:** 상대 시간 ("방금 전", "3시간 전", "어제", "3일 전")
- **위치:** 세션 목록 각 항목 하단 (턴 수 · 비용 옆)
- **정렬:** 기본 정렬을 마지막 대화 시간 기준 내림차순으로
- **실시간 갱신:** 대화 완료(`sdk_done`) 시 타임스탬프 업데이트

### 전체 대화 내용 공유

세션의 전체 대화를 외부에 공유할 수 있는 기능.

- **공유 형태 후보:**
  - A) **마크다운 내보내기** — 대화 전체를 `.md` 파일로 다운로드 (가장 단순)
  - B) **공유 링크** — 읽기 전용 퍼블릭 URL 생성 (인증 없이 접근 가능)
  - C) **HTML 내보내기** — 스타일 포함된 단일 HTML 파일로 다운로드
  - D) **PDF 내보내기** — 보고서용
- **설계 미정 사항:**
  - 공유 링크 방식 시: 만료 기간? 비밀번호 보호? 공유 취소?
  - 민감 정보 (API 키, 파일 경로 등) 자동 마스킹 필요?
  - 도구 사용 카드도 포함할지, 텍스트만 추출할지
- **우선 구현:** A(마크다운 내보내기)부터 시작, 이후 B(공유 링크) 확장

### Phase 8: 멀티유저 작업 공간 — "내 책상 / 회의실 / 남의 책상"

#### 목적

5인 리서치/분석 팀이 단일 VM을 공유하며 Claude를 사용할 때, 서로의 작업을 방해하지 않으면서도 팀 자원(데이터, 보고서, 템플릿)에 접근할 수 있는 환경 제공.

#### 배경 문제

- 현재: 모든 세션이 동일한 `config.defaultCwd`를 공유 → 파일 충돌 위험
- `git checkout`하면 같은 폴더를 쓰는 모든 세션이 영향 받음
- 유저별 작업 격리가 전혀 없음
- 비개발자에게 git/branch/worktree 개념 노출 불가

#### 설계 결정

**1. 권한 관리 방식: 앱 레벨 경로 가드 (B안 채택)**

| 검토 방식 | 판정 | 이유 |
|----------|------|------|
| OS 레벨 (Linux 계정 분리) | ❌ | 유저마다 계정 필요, SDK 프로세스 권한 관리 복잡 |
| 앱 레벨 경로 가드 | ✅ 채택 | 기존 `isPathSafe()` 확장, 가볍고 유연 |
| 하이브리드 (심링크) | ❌ | 심링크 관리 복잡, 디버깅 어려움 |

기존 `isPathSafe()`를 `isWriteAllowed(userId, targetPath)`로 확장. SDK는 `permissionMode: 'acceptEdits'` (user 역할)로 파일 쓰기 범위를 앱에서 통제.

**2. 세션 격리 방식: CWD 기반 + 선택적 worktree**

- 기본: 세션 CWD = 유저 개인 폴더 (`/workspace/users/{username}/`)
- 선택: "독립 작업 공간에서" 옵션 시 git worktree 생성 (내부 메커니즘, UI에 git 용어 노출 안 함)
- worktree 불필요한 경우가 대부분 (리서치 산출물은 병합 필요 없음)

**3. 작업 결과 공유: 파일 단위 내보내기 (C안 기반)**

- git merge 같은 병합 없음 — 비개발자에게 불필요
- 완성된 파일을 "공유 폴더에 내보내기" 또는 "핀보드에 등록"
- 파일 단위로 명확하게 이동 → 충돌 시 "덮어쓸까요?" 확인

#### 폴더 구조

```
/workspace/
  /team/                         ← 팀 공유 영역
    /reports/                    ← 완성 보고서 (쓰기 보호: 본인 파일만 or admin)
    /data/                       ← 공유 데이터셋 (읽기/쓰기 자유)
    /templates/                  ← 보고서 양식, 프롬프트 모음 (읽기 전용, admin만 수정)
  /users/
    /alice/                      ← Alice 개인 작업 공간
    /bob/                        ← Bob 개인 작업 공간
```

#### 권한 모델 (3단계)

| 영역 | 보기 | 편집 | Claude 작업 | 비유 |
|------|------|------|------------|------|
| **내 폴더** (`/users/{me}/`) | O | O | O | 내 책상 |
| **공유 폴더** (`/team/`) | O | 규칙별 | 규칙별 | 회의실 |
| **다른 사람 폴더** (`/users/{other}/`) | O | X | X | 남의 책상 |

공유 폴더 세부 규칙 (admin이 Settings에서 관리):
- `/team/data/` → 전원 읽기/쓰기
- `/team/reports/` → 전원 읽기, 쓰기는 본인 파일만 (파일 owner 추적)
- `/team/templates/` → 전원 읽기, admin만 쓰기

#### 구현 범위

**A. 백엔드 — 유저별 폴더 + 경로 가드**
- [ ] 유저 생성 시 `/workspace/users/{username}/` 자동 생성
- [ ] `isWriteAllowed(userId, role, targetPath)` — 경로+역할 기반 쓰기 허용 판단
- [ ] `ws-handler.ts` — chat 요청 시 CWD 검증, file_write 시 쓰기 가드 적용
- [ ] `api.ts` — 파일 REST API에도 동일 가드 적용
- [ ] SDK `permissionMode` — admin=`bypassPermissions`, user=`acceptEdits`
- [ ] 공유 폴더 권한 설정 API (`GET/PATCH /api/workspace/permissions`)

**B. 백엔드 — 선택적 worktree (git 프로젝트용)**
- [ ] `git-manager.ts` — `createWorktree(sessionId)`, `removeWorktree(sessionId)`, `listChangedFiles(worktreePath)`
- [ ] 세션 삭제/만료 시 worktree 자동 정리
- [ ] "파일 가져오기" API — worktree에서 공유/개인 폴더로 파일 복사

**C. 프론트엔드 — 작업 공간 선택 UI**
- [ ] 새 세션 생성 시 작업 위치 선택: 내 폴더 (기본) / 팀 공유 / 직접 선택
- [ ] "독립 작업 공간에서" 체크박스 (내부적으로 worktree 생성)
- [ ] 파일 트리에 권한 시각화 (🔒 읽기 전용 표시, 쓰기 불가 시 편집 버튼 비활성)
- [ ] "공유 폴더에 내보내기" 버튼 (ContextPanel 또는 파일 우클릭)
- [ ] Settings > "작업 공간 권한" 탭 (admin 전용)

**D. DB 스키마**
- [ ] `users` 테이블에 `workspace_path TEXT` 추가
- [ ] `workspace_permissions` 테이블 (path, role/userId, read, write)
- [ ] `sessions` 테이블에 `worktree_path TEXT` 추가

#### 검증

1. Alice 로그인 → 기본 CWD가 `/workspace/users/alice/`
2. Alice가 `/workspace/users/bob/` 파일 편집 시도 → 차단 + "읽기 전용" 안내
3. Alice가 `/workspace/team/data/`에 파일 생성 → 성공
4. Alice가 `/workspace/team/templates/`에 파일 편집 시도 → 차단
5. Claude 세션에서 다른 유저 폴더에 Write 시도 → `acceptEdits` + 앱 가드로 차단
6. "독립 작업 공간" 세션 → 파일 변경 → "내보내기" → 공유 폴더에 반영

#### 선행 조건

- Phase 4F 역할별 permissionMode 적용 (admin→bypass, user→acceptEdits)
- 세션 CWD 설계 (TODO 백로그의 "세션 CWD" 항목)

---

### 🟡 워크플로우 자동화 (Kanban + Cron) — 기획 전

Claude를 활용한 반복 작업 자동화 시스템. 아직 기획 단계 전.

**컨셉 (브레인스토밍):**
- 칸반 보드 중심의 작업 관리 — 각 카드가 Claude에게 보낼 프롬프트 + 트리거 조건
- cron 스케줄 또는 이벤트 트리거로 Claude 세션 자동 실행
- 실행 결과를 카드에 기록, 상태 전이 (대기 → 실행 중 → 완료/실패)

**가능한 유즈케이스:**
- 매일 아침 특정 데이터 수집 → 요약 보고서 생성 → Slack/이메일 전송
- 파일 변경 감지 → 자동 코드 리뷰 → 결과 카드에 기록
- 주간 리서치 태스크 → Claude가 순차 처리 → 결과물 핀보드에 자동 등록
- 정기 보안 점검 / 의존성 업데이트 체크

**필요한 구성요소 (추정):**
- 칸반 보드 UI (드래그&드롭 카드, 컬럼: 대기/스케줄/실행중/완료/실패)
- 스케줄러 (node-cron 또는 시스템 cron 연동)
- 작업 정의 스키마 (프롬프트 템플릿, 변수, 트리거 조건, 후속 액션)
- 실행 로그 / 히스토리
- 알림 연동 (Slack, 이메일 등)

**현재 상태:** 아이디어 단계. 유즈케이스 구체화 + MVP 범위 정의 필요.

---

### Phase 6: 모바일 + 파일 업로드 + 배포 (이후)

1. 사이드바 파일 드래그&드롭 → 채팅 컨텍스트 첨부
2. 로컬 파일 업로드 (OS에서 브라우저로 드래그&드롭)
   - **드롭 존 2곳:**
     - 채팅 영역에 드롭 → 파일 내용을 컨텍스트로 첨부하여 Claude에게 전달
     - 파일 트리에 드롭 → 워크스페이스 디렉토리에 업로드 (저장)
   - **백엔드:** `POST /api/files/upload` (multer, multipart/form-data), `isPathSafe()` 검증
   - **프론트:** HTML5 Drag & Drop API, 드롭 존 하이라이트 표시, 업로드 프로그레스 바
   - **제한:** 파일 크기 상한 (기본 10MB, 설정 가능), 위험 확장자 차단 (.exe, .sh 등)
   - **복수 파일:** 여러 파일 동시 드롭 지원
3. 모바일 반응형 (하단 탭바, ≤768px)
4. 다크/라이트 테마
5. 비용 추적 대시보드
6. Docker + Cloudflare Tunnel + PWA (기존 배포 계획)

---

## 검증 방법

1. **SDK 연동:** 서버 시작 → 브라우저에서 "hello" 전송 → Claude 응답 스트리밍 확인 ✅
2. **세션 이어하기:** 대화 후 새로고침 → 히스토리에서 선택 → 이전 맥락 유지 확인 ✅
3. **파일 편집:** Claude에게 파일 생성 요청 → 파일 트리에 실시간 반영 → 클릭하여 열기/편집
4. **MD 렌더링:** .md 파일 생성 → 렌더링 뷰에서 테이블/코드블록/이미지 확인
5. **Skills:** `/` 입력 → 드롭다운에 prime, ralph 등 표시 → 선택 시 실행 확인 ✅
7. **SSH 터널:** `ssh -L 32354:localhost:32354 azureuser@4.230.33.35` → 브라우저 접속 ✅
8. **핀보드:** 핀 탭에서 .html 파일 핀 → 클릭 시 iframe 렌더링 → 드래그→채팅 컨텍스트 첨부 → 핀 해제 확인
9. **프롬프트:** 세션 탭 하단 프롬프트 섹션 → `+`로 추가 → 클릭 시 ContextPanel에 미리보기 → 드래그→채팅 InputBox 삽입 → ~/.claude/commands/ 항목 자동 표시 확인

---

## Phase 6: 배포 & 서빙 — "설치하면 그냥 돌아가야 한다"

### 문제 정의

현재 접속 방식: SSH 터널 → localhost:32354. 이건 개발자 전용이고 모바일 접속 불가.
**목표:** 비개발자가 URL 하나로 PC/모바일에서 접속. 설치는 명령어 1~2줄로 끝.

---

### 배포 아키텍처 (3-Tier)

```
┌─────────────────────────────────────────────────────────┐
│                   사용자 브라우저 (PC/모바일)               │
│                   https://desk.example.com               │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS (자동 인증서)
┌───────────────────────────┼─────────────────────────────┐
│  Cloudflare Tunnel        │                             │
│  (무료, 아웃바운드만)       │                             │
└───────────────────────────┼─────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────┐
│  Docker Compose           │                             │
│  ┌─────────────┐  ┌──────┴──────┐  ┌────────────────┐  │
│  │   Caddy     │  │ claude-desk │  │  cloudflared   │  │
│  │ (리버스     │──│ (Node.js    │  │  (터널 데몬)    │  │
│  │  프록시)    │  │  앱 서버)   │  │                │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│                          │                              │
│  Volumes: ~/.claude, workspace/, sqlite-data/           │
└─────────────────────────────────────────────────────────┘
```

---

### Tier 1: Docker Compose (기본 배포 방식)

**왜 Docker인가:**
- 1개 명령으로 전체 스택 구동
- OS 무관 (Linux, Mac, Windows)
- Claude Code CLI + Node.js + 의존성 전부 이미지에 포함
- 업데이트: `docker compose pull && docker compose up -d`

**docker-compose.yml 구성:**

```yaml
services:
  app:
    image: ghcr.io/your-org/claude-desk:latest
    build: .
    ports:
      - "32354:32354"
    volumes:
      - ~/.claude:/home/app/.claude          # Claude 인증 정보
      - ./workspace:/workspace               # 작업 디렉토리
      - sqlite-data:/app/data                # DB 영속화
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}  # 또는 ~/.claude 마운트
      - AUTH_ENABLED=true
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}        # 첫 실행 시 관리자 비번
    restart: unless-stopped

  # 선택: 원격 접속이 필요할 때만
  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
    depends_on:
      - app
    restart: unless-stopped

volumes:
  sqlite-data:
```

**Dockerfile 핵심:**

```dockerfile
FROM node:20-slim

# 호스트 azureuser와 uid 일치시켜 ~/.claude 권한 문제 방지
ARG HOST_UID=1000
ARG HOST_GID=1000
RUN groupmod -g ${HOST_GID} node && usermod -u ${HOST_UID} -g ${HOST_GID} node

# Claude Code CLI 설치
RUN npm install -g @anthropic-ai/claude-code

# 앱 빌드
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --production
COPY --chown=node:node dist/ ./dist/

# CLAUDECODE 환경변수 제거 (SDK 요구사항)
ENV CLAUDECODE=""

# non-root 실행 (uid가 호스트와 일치하므로 volume 권한 OK)
USER node
EXPOSE 32354
CMD ["node", "dist/backend/index.js"]
```

> **주의:** `~/.claude` volume mount 시 컨테이너 내부 uid와 호스트 uid가 일치해야 함.
> `permission_issue.md` 참고. 빌드 시 `--build-arg HOST_UID=$(id -u)` 로 조정 가능.

**설치 플로우 (사용자 시점):**

```bash
# 1. 다운로드
curl -fsSL https://raw.githubusercontent.com/your-org/claude-desk/main/install.sh | bash

# 이 스크립트가 하는 일:
#   - docker-compose.yml 다운로드
#   - .env 템플릿 생성
#   - ADMIN_PASSWORD 자동 생성
#   - "ANTHROPIC_API_KEY를 .env에 입력하세요" 안내

# 2. API 키 설정
nano .env   # ANTHROPIC_API_KEY=sk-ant-... 입력

# 3. 실행
docker compose up -d

# 4. 접속
# → http://localhost:32354 (로컬)
# → 또는 Cloudflare Tunnel 설정 시 https://desk.example.com
```

---

### Tier 2: 네트워크 접근 — Cloudflare Tunnel (무료 HTTPS)

**왜 Cloudflare Tunnel인가:**
- 완전 무료 (사용량 제한 없음)
- 인바운드 포트 열 필요 없음 (방화벽 걱정 X)
- 자동 HTTPS (인증서 관리 불필요)
- 고정 URL (커스텀 도메인 지원)
- SSH 터널과 달리 항상 켜져 있음 (systemd/Docker로 데몬화)

**설정 (한 번만):**

```bash
# 1. Cloudflare 계정에서 터널 생성 (Zero Trust 대시보드)
#    → 터널 토큰 발급

# 2. .env에 토큰 추가
CF_TUNNEL_TOKEN=eyJ...

# 3. docker compose up -d  (tunnel 서비스 자동 시작)
```

**결과:** `https://desk.yourteam.com` 으로 PC/모바일 어디서든 접속.

**대안 비교:**

| 방식 | 무료 | 커스텀 도메인 | 설정 난이도 | 안정성 |
|------|------|-------------|-----------|--------|
| SSH 터널 | ✅ | ❌ | 높음 | 끊김 잦음 |
| Cloudflare Tunnel | ✅ | ✅ | 중간 | 높음 |
| Tailscale Funnel | ✅ | ❌ (.ts.net 고정) | 낮음 | 중간 |
| ngrok | 부분 무료 | 유료만 | 낮음 | 중간 |
| VPS + Caddy + Let's Encrypt | ✅ | ✅ | 높음 | 높음 |

---

### Tier 3: 모바일 지원 — PWA

**PWA (Progressive Web App)로 모바일 앱처럼 동작:**
- 홈 화면에 아이콘 추가 → 브라우저 크롬 없이 실행
- 전체 화면, 스플래시 스크린, 앱 전환기에 별도 앱으로 표시
- 별도 앱스토어 배포 불필요

**구현 (vite-plugin-pwa):**

```bash
npm install -D vite-plugin-pwa
```

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Claude Desk',
        short_name: 'Desk',
        description: '리서치 팀을 위한 Claude Code 웹 플랫폼',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})
```

**Phase 4에 통합:** 모바일 반응형 + PWA를 함께 진행.

---

### Tier 4: 클라우드 원클릭 배포 (서버 없이)

**서버를 직접 관리하고 싶지 않은 팀용.**

| 플랫폼 | WebSocket 지원 | 장점 | 단점 |
|--------|---------------|------|------|
| **Fly.io** | 네이티브 (최적) | 글로벌 엣지, WS 특화 | 수동 스케일링 |
| **Railway** | 완전 지원 | 가장 쉬운 배포, GitHub 연동 | 비용 예측 어려움 |
| **Render** | 지원 (제약 있음) | 관리형 DB | WS sticky session 없음, keepalive 필수 |

**추천: Fly.io** (WebSocket 앱에 최적화)

```bash
# fly.toml
[http_service]
  internal_port = 32354
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[env]
  AUTH_ENABLED = "true"
```

**README에 원클릭 배포 버튼:**

```markdown
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/...)
[![Deploy on Fly.io](https://fly.io/button.svg)](https://fly.io/launch/...)
```

---

### 설치 시나리오별 가이드

#### 시나리오 A: "내 PC에서 혼자 쓸래" (가장 단순)

```bash
docker run -d -p 32354:32354 \
  -v ~/.claude:/home/app/.claude \
  -e AUTH_ENABLED=false \
  ghcr.io/your-org/claude-desk:latest
# → http://localhost:32354
```

#### 시나리오 B: "팀이 원격으로 접속해야 해" (추천)

```bash
curl -fsSL .../install.sh | bash
# .env 편집 (API키 + Cloudflare 터널 토큰)
docker compose up -d
# → https://desk.yourteam.com
```

#### 시나리오 C: "서버 관리 싫어" (클라우드)

```
GitHub repo fork → Fly.io 연결 → 환경변수 설정 → 자동 배포
```

---

### 보안 체크리스트

- [ ] HTTPS 필수 (Cloudflare Tunnel 또는 Caddy)
- [ ] JWT 인증 기본 활성화 (AUTH_ENABLED=true)
- [ ] ANTHROPIC_API_KEY는 환경변수로만 (이미지에 포함 금지)
- [ ] 워크스페이스 경로 밖 파일 접근 차단 (기존 설계)
- [ ] Docker 컨테이너 non-root 유저로 실행 (uid 매핑 포함)
- [ ] Rate limiting (로그인 시도 제한)
- [ ] 역할별 permissionMode 적용 (user 역할은 bypass 금지)
- [ ] 동시 세션 수 상한 설정
- [ ] 세션 JSONL / DB 자동 정리 정책 (90일 기본)
- [ ] 모바일: PWA는 HTTPS에서만 설치 가능 → Tunnel 필수

---

### 개발 단계에 추가

이 배포 작업은 **Phase 5**로 진행:

1. Dockerfile + docker-compose.yml 작성
2. install.sh 스크립트 (다운로드 + .env 템플릿 + 안내)
3. Cloudflare Tunnel 통합 (docker-compose에 선택적 서비스)
4. PWA 설정 (vite-plugin-pwa + manifest + 아이콘)
5. Fly.io / Railway 배포 설정 (fly.toml, railway.json)
6. README에 시나리오별 설치 가이드 작성

---

## 새 Azure VM에 재설치 가이드 (business-ai 등)

### 사전 조건

| 항목 | 필요 버전 | 확인 명령 |
|------|----------|----------|
| **OS** | Ubuntu 22.04+ (추천) | `lsb_release -a` |
| **Node.js** | v20.20.0+ | `node --version` |
| **npm** | v10+ | `npm --version` |
| **Git** | 2.x | `git --version` |
| **build-essential** | (any) | `dpkg -l build-essential` |
| **Python 3** | 3.8+ (better-sqlite3 빌드용) | `python3 --version` |
| **Claude Code CLI** | latest | `claude --version` |
| **Azure CLI** | 2.x (로컬에서 VM 관리 시) | `az --version` |

---

### Step 0: Azure VM 생성 (business-ai가 아직 없을 경우)

```bash
# 로컬에서 실행 (Azure CLI 연결된 머신)
az group create --name rg-business-ai --location koreacentral

az vm create \
  --resource-group rg-business-ai \
  --name business-ai \
  --image Ubuntu2204 \
  --size Standard_D2s_v3 \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard

# NSG에 포트 32354 오픈 (SSH 터널 사용 시 불필요)
az vm open-port \
  --resource-group rg-business-ai \
  --name business-ai \
  --port 32354 --priority 1010

# VM IP 확인
az vm show -d --resource-group rg-business-ai --name business-ai \
  --query publicIps -o tsv
```

---

### Step 1: 대상 VM 기초 환경 구성

```bash
# SSH 접속
ssh azureuser@<BUSINESS-AI-IP>

# 시스템 업데이트 + 빌드 도구
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential python3 git curl

# Node.js 20 설치 (nvm 방식)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20

# 확인
node --version   # v20.x.x
npm --version    # 10.x.x
```

---

### Step 2: Claude Code CLI 설치

```bash
# npm 글로벌 설치
npm install -g @anthropic-ai/claude-code

# 또는 직접 바이너리 (이미 설치된 경우 경로 확인)
which claude    # /home/azureuser/.local/bin/claude 또는 nvm 경로

# Claude 인증 (최초 1회 — 브라우저 OAuth 또는 API 키)
claude          # 실행 후 인증 플로우 진행
# 또는 API 키 방식:
export ANTHROPIC_API_KEY=sk-ant-...
```

> **참고:** `config.ts`의 `claudeExecutable` 경로가 실제 설치 경로와 일치하는지 확인.
> 다르면 환경변수 `CLAUDE_PATH`로 오버라이드 가능.

---

### Step 3: 프로젝트 코드 전송

**방법 A: Git (추천 — remote 설정 필요)**

```bash
# 현재 서버 (tunnelingcc)에서 — GitHub 등에 remote 추가
cd /home/azureuser/tunnelingcc
git remote add origin git@github.com:<org>/claude-desk.git
git add -A && git commit -m "snapshot for deployment"
git push -u origin main

# 대상 VM에서
cd ~
git clone git@github.com:<org>/claude-desk.git tunnelingcc
```

**방법 B: scp / rsync (remote 없을 때)**

```bash
# 현재 서버에서 대상 VM으로 직접 전송
rsync -avz --exclude='node_modules' --exclude='dist' --exclude='data/*.db*' \
  /home/azureuser/tunnelingcc/ \
  azureuser@<BUSINESS-AI-IP>:~/tunnelingcc/

# 또는 로컬을 경유
scp -r azureuser@4.230.33.35:~/tunnelingcc/ ./tunnelingcc-backup/
scp -r ./tunnelingcc-backup/ azureuser@<BUSINESS-AI-IP>:~/tunnelingcc/
```

**방법 C: Azure CLI로 VM 간 전송 (같은 구독)**

```bash
# 현재 VM에서 대상 VM IP 확인 후 직접 rsync
DEST_IP=$(az vm show -d -g rg-business-ai -n business-ai --query publicIps -o tsv)
rsync -avz --exclude='node_modules' --exclude='dist' --exclude='data/*.db*' \
  /home/azureuser/tunnelingcc/ azureuser@$DEST_IP:~/tunnelingcc/
```

---

### Step 4: 의존성 설치 + 빌드

```bash
ssh azureuser@<BUSINESS-AI-IP>

cd ~/tunnelingcc/claude-desk

# 의존성 설치 (better-sqlite3 네이티브 컴파일 포함)
npm ci

# 프로덕션 빌드
npm run build

# 빌드 결과 확인
ls dist/backend/index.js    # 백엔드
ls dist/frontend/index.html # 프론트엔드
```

> **better-sqlite3 빌드 실패 시:**
> `sudo apt install -y build-essential python3` 확인 후 `npm rebuild better-sqlite3`

---

### Step 5: 환경 설정

```bash
# start.sh 수정 — 경로를 대상 VM에 맞게
cd ~/tunnelingcc/claude-desk

cat > start.sh << 'STARTEOF'
#!/bin/bash
# Claude Desk 서버 시작 스크립트
cd "$(dirname "$0")"

export NO_AUTH=true
export DEFAULT_CWD=/home/azureuser
export WORKSPACE_ROOT=/home/azureuser
# export CLAUDE_PATH=/home/azureuser/.nvm/versions/node/v20.x.x/bin/claude  # nvm 경로일 경우

echo "Starting Claude Desk..."
echo "접속: http://localhost:32354"
echo ""

npx tsx backend/index.ts
STARTEOF

chmod +x start.sh
```

**config.ts 경로 확인 체크리스트:**
- [ ] `claudeExecutable` — Claude CLI 실제 경로 (`which claude`로 확인)
- [ ] `defaultCwd` — 환경변수 또는 기본값
- [ ] `workspaceRoot` — 환경변수 또는 기본값
- [ ] `dbPath` — data/ 디렉토리 존재 확인 (`mkdir -p data`)

---

### Step 6: 서비스 등록 (systemd — 재부팅 시 자동 시작)

```bash
sudo tee /etc/systemd/system/claude-desk.service << 'EOF'
[Unit]
Description=Claude Desk Web Platform
After=network.target

[Service]
Type=simple
User=azureuser
WorkingDirectory=/home/azureuser/tunnelingcc/claude-desk
ExecStart=/home/azureuser/.nvm/versions/node/v20.20.0/bin/node dist/backend/index.js
Restart=on-failure
RestartSec=5
Environment=NO_AUTH=true
Environment=DEFAULT_CWD=/home/azureuser
Environment=WORKSPACE_ROOT=/home/azureuser
# Environment=CLAUDE_PATH=/home/azureuser/.local/bin/claude
# Environment=ANTHROPIC_API_KEY=sk-ant-...

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable claude-desk
sudo systemctl start claude-desk

# 상태 확인
sudo systemctl status claude-desk
journalctl -u claude-desk -f   # 로그 실시간 확인
```

> **주의:** nvm 사용 시 `ExecStart`의 node 경로를 절대경로로 지정해야 함.
> `which node` 로 확인 후 적용.

---

### Step 7: 접속 확인

```bash
# 로컬에서 SSH 터널
ssh -L 32354:localhost:32354 azureuser@<BUSINESS-AI-IP>

# 브라우저에서
# http://localhost:32354
```

---

### Step 8: 데이터 마이그레이션 (선택)

기존 서버의 세션/메시지 데이터를 이전하려면:

```bash
# 현재 서버에서 DB 파일 복사
scp azureuser@4.230.33.35:~/tunnelingcc/claude-desk/data/claude-desk.db \
    azureuser@<BUSINESS-AI-IP>:~/tunnelingcc/claude-desk/data/

# Claude 네이티브 세션도 이전하려면 (선택)
rsync -avz ~/.claude/projects/ azureuser@<BUSINESS-AI-IP>:~/.claude/projects/
```

---

### 재설치 원커맨드 스크립트 (향후 자동화)

아래 스크립트를 만들어두면 추후 재설치가 간편해짐:

```bash
#!/bin/bash
# install-claude-desk.sh — 새 VM에서 실행
set -e

echo "=== Claude Desk 설치 스크립트 ==="

# 1. 시스템 의존성
sudo apt update && sudo apt install -y build-essential python3 git curl

# 2. Node.js 20
if ! command -v node &> /dev/null; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20
fi

# 3. Claude Code CLI
if ! command -v claude &> /dev/null; then
  npm install -g @anthropic-ai/claude-code
  echo "⚠ Claude CLI 인증을 완료하세요: claude"
fi

# 4. 프로젝트 설치
cd ~/tunnelingcc/claude-desk
npm ci
npm run build
mkdir -p data

# 5. systemd 등록
echo "=== systemd 서비스 등록 ==="
# (Step 6의 내용을 여기에 포함)

echo "=== 설치 완료 ==="
echo "시작: sudo systemctl start claude-desk"
echo "접속: http://localhost:32354"
```

---

### 재설치 전 코드 개선 권장 사항

현재 코드에서 재설치 용이성을 높이려면 다음을 권장:

1. **Git remote 설정** — 코드 버전 관리 및 전송용 (현재 remote 없음)
2. **경로 하드코딩 제거** — `config.ts`의 기본값들이 `/home/azureuser`를 참조함. 환경변수 우선으로 이미 설계되어 있어 `.env` 파일만 잘 세팅하면 됨
3. **`.env.example` 파일 추가** — 필요한 환경변수 목록 문서화
4. **Dockerfile 작성** (Phase 6에 계획됨) — Docker 방식이면 위 Step 1~5가 모두 생략 가능
