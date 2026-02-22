# Claude Desk — 리서치/분석 팀을 위한 Claude Code 웹 플랫폼

## Context

원격 서버(Azure VM)에서 Claude Code를 돌리고 브라우저에서 접속하는 환경을 구축 중.
기존 오픈소스 3개(claude-code-webui, claude-code-web, claude-code-ui)를 분석한 결과,
SDK 기반 + 깔끔한 UI + 파일/에디터/Python 실행을 결합한 자체 플랫폼이 필요.

**타겟 유저:** 리서치/분석 팀 (비개발자 포함)
**핵심 니즈:** Claude와 대화하며 리서치 → MD 보고서 렌더링 → 데이터 분석(Python) → 파일 편집

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
| **Python 실행** | node-pty (PTY) | Claude용이 아닌 Python 전용 |
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
│        │  [사고 과정 접기]        │  Python 출력      │
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
- **우측 컨텍스트:** 파일 클릭 시 열림. MD 렌더/에디터/HTML iframe/Python 출력. 드래그 리사이즈 + 열기/닫기 토글 (너비 localStorage 저장)
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
  python_exec { code, workspaceId }
  python_kill { workspaceId }

SERVER → CLIENT:
  sdk_message { data: SDKMessage }
  sdk_done    { sessionId, cost, duration }
  file_content { path, content, language }
  file_tree    { entries }
  file_changed { path, changeType }
  python_output { data, stream }
  python_exit   { code }
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

### 5. Python 실행

- `node-pty`로 Python PTY 생성 (Claude용 아님, Python 전용)
- 워크스페이스별 venv 격리 (`pip install` 안전)
- 스크래치패드 UI: CodeMirror + ▶ 실행 버튼 + 출력 패널
- 스크립트 저장/재실행 기능

### 6. 슬래시 명령어 & Skills

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
- **Python PTY 보호:** 실행 시간 상한 (기본 5분), 메모리 상한 (ulimit)
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
      python-runner.ts       -- Python PTY 실행
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
        editor/              -- CodeEditor, PythonScratchpad, PythonOutput
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

### Phase 4: ContextPanel 강화 + Python + 안정성 (진행 예정)

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

#### 4C. Python 실행 환경
1. python-runner.ts (node-pty, venv 관리)
2. PythonScratchpad + PythonOutput 컴포넌트
3. 실행 시간/메모리 상한 (ulimit)
4. 스크립트 저장/재실행 (scripts 테이블 활용)

#### 4D. 안정성 + 보안
1. WebSocket 자동 재연결 (exponential backoff, 최대 30초)
2. SDK 프로세스 hang 감지 + abort + 유저 알림
3. 동시 세션 상한 (`MAX_CONCURRENT_SESSIONS`) + 큐잉 UI
4. 역할별 permissionMode 적용 (admin→bypass, user→acceptEdits)

### Phase 5: 모바일 + 배포 + 폴리싱 (이후)
1. 파일 드래그&드롭 → 채팅 컨텍스트 첨부
2. 모바일 반응형 (하단 탭바, ≤768px)
3. 다크/라이트 테마
4. 비용 추적 대시보드
5. Docker + Cloudflare Tunnel + PWA (기존 Phase 5 배포 계획)

---

## 검증 방법

1. **SDK 연동:** 서버 시작 → 브라우저에서 "hello" 전송 → Claude 응답 스트리밍 확인 ✅
2. **세션 이어하기:** 대화 후 새로고침 → 히스토리에서 선택 → 이전 맥락 유지 확인 ✅
3. **파일 편집:** Claude에게 파일 생성 요청 → 파일 트리에 실시간 반영 → 클릭하여 열기/편집
4. **MD 렌더링:** .md 파일 생성 → 렌더링 뷰에서 테이블/코드블록/이미지 확인
5. **Python 실행:** 스크래치패드에 코드 작성 → 실행 → 출력 확인 → pip install 테스트
6. **Skills:** `/` 입력 → 드롭다운에 prime, ralph 등 표시 → 선택 시 실행 확인 ✅
7. **SSH 터널:** `ssh -L 32354:localhost:32354 azureuser@4.230.33.35` → 브라우저 접속 ✅
8. **핀보드:** 핀 탭에서 .html 파일 핀 → 클릭 시 iframe 렌더링 → 드래그→채팅 컨텍스트 첨부 → 핀 해제 확인
9. **프롬프트:** 세션 탭 하단 프롬프트 섹션 → `+`로 추가 → 클릭 시 ContextPanel에 미리보기 → 드래그→채팅 InputBox 삽입 → ~/.claude/commands/ 항목 자동 표시 확인

---

## Phase 5: 배포 & 서빙 — "설치하면 그냥 돌아가야 한다"

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

# Python (분석용)
RUN apt-get update && apt-get install -y python3 python3-venv python3-pip

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
