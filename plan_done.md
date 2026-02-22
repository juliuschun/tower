# Claude Desk — 완료된 Phase 상세 기록

이 문서는 plan.md에서 완료된 Phase들의 상세 설계 내용을 보존합니다.
현재 활성 계획은 `plan.md`를, 개발 이력은 `history.md`를 참조하세요.

---

## Phase 1: Core Chat + MD 렌더링 ✅

1. 프로젝트 스켈레톤 (Vite + React + Express + TS)
2. `claude-sdk.ts` — SDK query() 래핑, CLAUDECODE 환경변수 정리
3. WebSocket 서버 + 기본 chat 프로토콜
4. ChatPanel, MessageBubble, InputBox 컴포넌트
5. ToolUseCard (Bash, Read, Write, Edit 도구별 카드)
6. assistant 메시지 마크다운 렌더링
7. 세션 resume 기본 구현
8. 심플 토큰 인증 (JWT)

---

## Phase 2: 파일 시스템 + 에디터 + 세션 UX ✅

1. CodeMirror 6 에디터 (textarea 교체, 7언어 지원)
2. 파일 트리 SVG 아이콘 + lazy loading + 로딩 스피너
3. chokidar 실시간 파일 감시 + WS broadcast
4. 사이드바 탭 (세션/파일) 전환
5. 세션 검색, 즐겨찾기 토글, 인라인 이름 변경
6. 세션 자동 생성 + claudeSessionId resume
7. WS 인증 토큰 전달

---

## Phase 2.5 설계: 핀보드 + 프롬프트 패널

### 핀보드/프롬프트 UI 구조

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
  pin_type TEXT NOT NULL DEFAULT 'file',
  file_path TEXT,
  content TEXT,
  file_type TEXT DEFAULT 'markdown',
  sort_order INTEGER DEFAULT 0,
  user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**구현 항목:**
1. DB: `pins` 테이블 추가 (`schema.ts`)
2. `pin-manager.ts` — 핀 CRUD + `~/.claude/commands/` 자동 로드
3. REST API: `GET/POST /api/pins`, `PATCH/DELETE /api/pins/:id`, `POST /api/pins/reorder`, `GET /api/files/serve?path=...`
4. `pin-store.ts` — zustand 스토어
5. 핀보드 탭: `PinList` 컴포넌트 (클릭→ContextPanel, 드래그→채팅)
6. 프롬프트 섹션: 세션 탭 하단 접기 가능 영역
7. ContextPanel에 HTML iframe 렌더링 모드 추가
8. App.tsx 연결

---

## Phase 3: 메시지 영속화 + 핀보드 + 설정 + UI 폴리시 ✅

1. message-store.ts — 메시지 DB 저장/복원
2. 핀보드 — pin-manager CRUD, PinList UI, 사이드바 핀 탭, iframe file serve
3. 설정 패널 — SettingsPanel, settings-store, GET /config
4. UI 폴리시 — ErrorBoundary, toast, FileTree 개선

---

## Phase 3.5: ToolUseCard 칩 레이아웃 + DB 마이그레이션 ✅

1. ToolChip 가로 칩 컴포넌트 + ToolChipGroup (클릭 시 세로 펼침)
2. DB 마이그레이션 — messages, pins 테이블 직접 생성

---

## Phase 4: ContextPanel 강화 + 프롬프트 + 안정성 ✅

### 4A. ContextPanel 드래그 리사이즈 + 개선
1. 채팅↔패널 사이 드래그 핸들 (마우스/터치)
2. 더블클릭 시 기본 너비 리셋, 너비 localStorage 저장
3. 열기/닫기 토글 버튼
4. HTML 파일 iframe 렌더링 모드

### 4B. 슬래시 명령어 + Skills
1. SlashCommandPicker 컴포넌트 (`/` 입력 시 드롭다운)
2. command-loader.ts 개선 — `~/.claude/commands/` + skills 스캔
3. 명령어 선택 → InputBox에 삽입 → 전송

### 4C. 프롬프트 섹션
1. DB 스키마 확장 — pins 테이블에 `pin_type`, `content` 컬럼
2. 세션 탭 하단 접기 가능 프롬프트 영역
3. `~/.claude/commands/` 항목 자동 목록 포함
4. 클릭 → ContextPanel 미리보기, 드래그 → InputBox 삽입

### 4D. 첨부 칩 시스템 (Attachment Chips) ✅

InputBox에 "textarea + 첨부 칩 영역" 패턴 도입.

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

**구현:**
1. chat-store 확장: `Attachment` 인터페이스, `attachments[]` 상태
2. AttachmentChip 컴포넌트: 타입별 아이콘 + ✕ 삭제
3. InputBox: 칩 영역 + 드롭 존 + `buildMessage()` 타입별 전송 로직
4. 사이드바 항목 draggable (PromptItem, PinList, FileTree)

### 4E. 채팅 비주얼 개선
1. 폰트 정비 — 본문/코드/UI 폰트 분리
2. 메시지 버블 레이아웃 다듬기
3. 마크다운 렌더링 스타일 개선
4. ToolUseCard/ToolChip 시각 다듬기
5. 타이포그래피 일관성

### 4F. 안정성 + 보안
1. WebSocket 자동 재연결 (exponential backoff, 최대 30초)
2. SDK 프로세스 hang 감지 + abort + 유저 알림
3. 동시 세션 상한 (`MAX_CONCURRENT_SESSIONS`) + 큐잉 UI
4. 역할별 permissionMode 적용 (admin→bypass, user→acceptEdits)

---

## Phase 4.5: ContextPanel UX + 파일 편집 안정성 ✅

1. file-store.ts 확장 — `lastOpenedFilePath`, `originalContent`, `externalChange` 상태
2. file_saved 버그 수정 — `markSaved()` 호출로 modified 리셋
3. file_changed 충돌 감지 — 자동 리로드 vs 충돌 배너
4. Ctrl+S 저장 — CodeMirror `Mod-s` keymap
5. ContextPanel 충돌 배너
6. 미저장 경고 — X 닫기 / 파일 전환 시 `window.confirm()`
7. 패널 토글 버튼

---

## Phase 5: 모델 셀렉터 + 세션 인텔리전스 ✅

### 5A. 모델 셀렉터

```
┌──────────────────────────────────┐
│  Claude Opus 4.6      ✓  [MAX]  │
│  Claude Sonnet 4.6       [MAX]  │
│  Claude Haiku 4.5        [API]  │
│ ─────────────────────────────── │
│  ⚙ 모델 설정...                  │
└──────────────────────────────────┘
```

구현: Header 모델 배지→드롭다운, 연결 유형 배지(MAX/API), DB `model_used` 컬럼, model-store.ts

### 5B. 세션 자동 이름 생성
- `auto-namer.ts` — SDK query()로 Haiku에 경량 프롬프트
- 첫 대화 완료 후 자동 실행, 수동 변경 시 비활성화

### 5C. 세션 요약 카드

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

구현: `summarizer.ts`, 수동 🔄 트리거, stale 표시(5턴 이상), DB 6개 컬럼 추가

---

## Phase 6A: 세션 연속성 / 복원력 ✅

### 핵심 설계: sendToSession 간접 전송
- 기존: `send(client.ws, data)` 직접 → WS 끊기면 실패
- 변경: `sendToSession(sessionId, data)` → sessionClients 맵 조회 → 재연결 시 자동 전달

### 커버 시나리오
1. 스트리밍 중 WS 끊김 → 재연결 (서버 살아있음) — sendToSession으로 자동 전달
2. 스트림 완료 후 재연결 — DB에서 전체 응답 복구
3. 서버 재시작 — serverEpoch 변경 감지 → 토스트 + 리셋
4. 15초 초과 재연결 실패 — 안전 타이머로 강제 리셋

---

## Phase 7: 공유 워크스페이스 Git 자동 스냅샷 ✅

### 핵심 구현
- `git-manager.ts` — Git 명령어 래퍼, promise mutex 동시성 보호
- `autoCommit`: Claude 작업 완료 시 editedFiles만 `git add` → commit (--author로 사용자별)
- `rollbackToCommit`: `git checkout <hash> -- .` → 히스토리 보존 (reset --hard 미사용)
- `initWorkspaceRepo`: 서버 시작 시 자동 git init + embedded repo 감지→.gitignore
- 프론트엔드: GitPanel (버전 탭), 커밋 목록, diff 보기, 되돌리기

---

## 세션 격리 버그 수정 ✅

### 핵심 변경
- `sendToSession` 가드: 세션 불일치 시 메시지 드랍 + stale 매핑 삭제
- `set_active_session` WS 핸들러: old 세션 abort, 새 세션 등록
- 프론트 sessionId 필터 null 허점 수정 (3곳)
- activeSessions 5분 자동 정리

### 세션 격리 순수 함수 추출 + 테스트 (19→39개) ✅
- `session-guards.ts` — isEpochStale, resolveSessionClient, switchSession, abortCleanup
- `session-filters.ts` — shouldDropSessionMessage, shouldResetAssistantRef, shouldAutoSendQueue
- `ws-handler.test.ts` — 8개 통합 테스트 (실제 HTTP/WS 서버 + 8개 모듈 mock)

---

## Plan Mode 렌더링 수정 ✅

- `MessageBubble.tsx` — `tool_result` 타입 fallback 렌더링
- plan mode 도구 시각적 표시

---

## PM2 통일 관리 ✅

- ecosystem.config.cjs로 PM2 선언형 관리 통일
- `npx tsx` 직접 실행 금지 → PM2로 포트 충돌 해결

---

## 세션 이름 편집 UX 개선 ✅

- 호버 시 연필 아이콘 + 우클릭 컨텍스트 메뉴 + input 높이 안정화
