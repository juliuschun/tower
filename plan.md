# Claude Desk — 리서치/분석 팀을 위한 Claude Code 웹 플랫폼

## Context

원격 서버(Azure VM)에서 Claude Code를 돌리고 브라우저에서 접속하는 환경.
SDK 기반 + 깔끔한 UI + 파일/에디터를 결합한 자체 플랫폼.

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
| **Frontend** | React 18 + Vite + TailwindCSS v4 | 검증됨 |
| **Backend** | Express + WebSocket (ws) | HTTP + 양방향 실시간 |
| **Claude 연동** | @anthropic-ai/claude-code SDK | PTY 아닌 SDK |
| **에디터** | CodeMirror 6 (@uiw/react-codemirror) | 가볍고 모바일 지원 |
| **MD 렌더링** | react-markdown + remark-gfm + rehype-highlight | GFM, 코드 하이라이팅 |
| **DB** | better-sqlite3 | 세션, 유저, 메시지 |
| **상태관리** | zustand | 단순 |
| **언어** | TypeScript | 프론트/백엔드 모두 |

---

## UI 레이아웃

```
┌──────────────────────────────────────────────────────┐
│  HEADER: 로고 · 워크스페이스 선택 · 세션 이름 · 설정  │
├────────┬─────────────────────────┬───────────────────┤
│ LEFT   │    CENTER               │   RIGHT           │
│ SIDEBAR│    CHAT PANEL           │   CONTEXT PANEL   │
│ 세션   │  [메시지 버블]           │  MD 렌더 뷰어     │
│ 히스토리│  [도구 사용 카드]        │  코드 에디터      │
│ 프롬프트│  [사고 과정 접기]        │  HTML iframe      │
│ 파일   │                         │  파일 미리보기     │
│ 트리   │  ┌───────────────────┐  │  프롬프트 미리보기 │
│ 버전   │  │ 입력창 + / 명령어  │  │                   │
│        │  └───────────────────┘  │                   │
├────────┴─────────────────────────┴───────────────────┤
│  BOTTOM BAR: 비용 · 토큰 사용량 · 세션 상태           │
└──────────────────────────────────────────────────────┘
```

---

## 핵심 아키텍처

```
브라우저 ←WebSocket→ Express 서버 ←SDK query()→ Claude CLI 바이너리
```

- SDK `query()` 비동기 제너레이터, `resume: sessionId`로 세션 이어하기
- `CLAUDECODE` 환경변수 제거 필수
- WebSocket 프로토콜: chat, abort, file_read/write/tree, set_active_session, reconnect
- `sendToSession` 간접 전송 (세션 격리 + 재연결 지원)
- `sessionClients` 맵 (sessionId → clientId) + epoch 기반 stale loop 방지
- chokidar 파일 감시 → broadcast
- 역할별 permissionMode (admin→bypass, user→acceptEdits)
- 동시 세션 상한 + 5분 hang 타이머

---

## 완료된 Phase 요약

> 상세 설계 내용은 `plan_done.md`, 구현 이력은 `history.md` 참조.

| Phase | 내용 | 상태 |
|-------|------|------|
| **1** | Core Chat + MD 렌더링 (SDK 연동, WS, 채팅 UI, JWT) | ✅ |
| **2** | 파일 시스템 + CodeMirror 에디터 + 세션 UX | ✅ |
| **3** | 메시지 영속화 + 핀보드 + 설정 패널 + UI 폴리시 | ✅ |
| **3.5** | ToolUseCard 칩 레이아웃 + DB 마이그레이션 | ✅ |
| **4** | ContextPanel 강화, 프롬프트, 슬래시 명령어, 첨부 칩, 안정성 | ✅ |
| **4.5** | ContextPanel 파일 편집 안정성 (충돌 감지, Ctrl+S, 미저장 가드) | ✅ |
| **5** | 모델 셀렉터, 세션 자동 이름, 세션 요약 카드 | ✅ |
| **6A** | 세션 연속성/복원력 (WS 재연결, 서버 재시작 감지) | ✅ |
| **7** | Git 자동 스냅샷 (autoCommit, rollback, 버전 탭) | ✅ |
| - | 세션 격리 수정 + 순수 함수 추출 + 테스트 39개 | ✅ |
| - | Plan mode 렌더링 수정 | ✅ |
| - | PM2 통일 관리 | ✅ |
| - | 세션 이름 편집 UX (연필 아이콘, 컨텍스트 메뉴) | ✅ |
| - | 동시 세션 스트리밍 + 사이드바 상태 표시 | ✅ |
| - | 실패 메시지 감지 + 재전송 (orphan detection) | ✅ |
| - | Mermaid 무한 루프 수정 + 메시지 복사 버튼 | ✅ |

---

## 최근 완료 (2026-02-23)

- [x] Mermaid 리-렌더 무한 루프 — `useMemo` 메모이제이션으로 해결
- [x] 대화 내용 부분 복사 — CopyButton (메시지 + 코드블록)
- [x] 동시 세션 스트리밍 — abort 제거, epoch guard 정리
- [x] 사이드바 스트리밍 표시 — 녹색 펄스 인디케이터 + `session_status` broadcast
- [x] 실패 메시지 감지 + 재전송 — orphan message detection (pending→delivered/failed)
- [x] 에러 로깅 강화 — 빈 catch 블록에 console.error/warn 추가

---

## TODO / 백로그

### 🔴 Admin Dashboard

**목적:** 관리자가 시스템 상태와 사용량을 한눈에 파악. 데모에서 핵심 보여주기용.

**구성:**
- **시스템 상태** — SDK 연결, DB 크기, 서버 uptime, 활성 WS 연결 수
- **활성 세션** — 누가 어떤 세션에서 작업 중인지, 스트리밍 상태 (실시간)
- **사용량 통계** — 세션별 토큰/비용, 일별/주별 사용 차트
- **사용자 관리** — 계정 목록, 역할(admin/user), 마지막 접속
- **워크스페이스 현황** — 파일 수, Git 커밋 수, 최근 변경

**구현 범위:**
- [ ] `/admin` 라우트 (admin 역할만 접근)
- [ ] `GET /api/admin/stats` — 시스템 통계 API
- [ ] `GET /api/admin/sessions` — 실시간 세션 현황 API
- [ ] AdminDashboard 컴포넌트 (카드 그리드 레이아웃)
- [ ] 비용 차트 (일별 누적, 세션별 비교)
- [ ] 사용자 관리 테이블

### 🔴 데모 콘텐츠 (Sample Workspace)

**목적:** 처음 접속한 사용자가 바로 체험할 수 있는 샘플 워크스페이스.
business_ai 프로젝트 구조에서 착안.

**샘플 워크스페이스 구조:**
```
/workspace/demo/
├── CLAUDE.md              ← 워크스페이스 안내 (Claude가 읽는 컨텍스트)
├── principles/
│   ├── core-values.md     ← 조직 핵심 가치
│   └── business-guide.md  ← 비즈니스 원칙
├── departments/
│   ├── marketing/
│   │   ├── guidelines.md
│   │   └── sops/social-media-campaign.md
│   ├── finance/
│   │   ├── guidelines.md
│   │   └── policies/expense-approval.md
│   └── product/
│       ├── guidelines.md
│       └── sops/feature-launch-checklist.md
├── templates/
│   ├── sop.md             ← SOP 양식
│   ├── policy.md          ← 정책 양식
│   └── report.md          ← 보고서 양식
└── reports/
    └── weekly-summary.md  ← 주간 요약 샘플
```

**슬래시 명령어 샘플:**
- `/generate-report` — 부서별 보고서 생성
- `/analyze` — 데이터 파일 분석 + 인사이트
- `/summarize-docs` — 폴더 내 문서 요약

**구현 범위:**
- [ ] 샘플 워크스페이스 파일 생성 (위 구조)
- [ ] 슬래시 명령어 3개 작성 (`~/.claude/commands/`)
- [ ] 세션 CWD를 데모 워크스페이스로 기본 설정 가능하게
- [ ] 첫 접속 시 가이드 메시지 or 온보딩 세션

### 🔴 세션 CWD (작업 디렉토리) 설계

**현재 문제:**
- 세션 생성 시 cwd가 항상 `config.defaultCwd`로 고정
- UI에서 CWD를 변경할 방법 없음
- Claude가 작업하는 폴더를 사용자가 제어 불가

**추천 방향 (B+C 조합):**
```
BottomBar: 🟢 대기 │ 📁 ~/tunnelingcc/claude-desk [▼]
                     클릭 시 폴더 피커 드롭다운
```
- 새 세션: 마지막 사용 cwd 기억 + 변경 가능
- 기존 세션: BottomBar 클릭으로 cwd 변경 → 다음 메시지부터 적용
- 변경 시 파일 트리도 해당 폴더로 갱신

**구현 범위:**
- [ ] BottomBar cwd 클릭 → 폴더 피커 드롭다운
- [ ] 세션 cwd 변경 API + chat 메시지에 cwd 반영
- [ ] 새 세션 생성 시 현재 세션의 cwd 상속
- [ ] `sendMessage`에서 `activeSession.cwd`를 chat 메시지에 포함

### 🔴 Plan Mode + AskUserQuestion 응답 UI

**증상:** Claude가 plan mode에서 AskUserQuestion을 던질 때 인터랙티브 응답 메커니즘 없음.

**수정 방향:**
- [ ] `AskUserQuestion` 전용 UI: 질문 + 옵션 버튼 → 사용자 선택 → SDK 응답 전달
- [ ] `EnterPlanMode`/`ExitPlanMode` 배너
- [ ] 미처리 SDK 메시지 fallback 렌더링 + console.warn
- [ ] SDK headless 환경에서 AskUserQuestion 동작 확인

### 🟡 세션 UX 잔여
- [ ] 이름 변경 후 정렬 순서 즉시 반영
- [ ] 세션 마지막 대화 시간 표시 (상대 시간, 정렬)

### 🟡 세션 연속성 잔여
- [ ] SDK `resume` 시 미완료 턴 처리 방식 확인
- [ ] 스트리밍 중 WS 끊김 → 재연결 후 미완료 응답 복구 가능성
- [ ] DB 메시지와 SDK 세션 상태 일관성 보장

### 🟢 전체 대화 내용 공유
- A) 마크다운 내보내기 (우선), B) 공유 링크 (확장)

---

## Phase 8: 멀티유저 작업 공간 — "내 책상 / 회의실 / 남의 책상"

5인 리서치/분석 팀이 단일 VM을 공유. 서로 방해 없이 팀 자원에 접근.

### 폴더 구조
```
/workspace/
  /team/
    /reports/     ← 완성 보고서 (본인 파일만 쓰기 or admin)
    /data/        ← 공유 데이터셋 (읽기/쓰기 자유)
    /templates/   ← 보고서 양식 (읽기 전용, admin만 수정)
  /users/
    /alice/       ← Alice 개인 작업 공간
    /bob/         ← Bob 개인 작업 공간
```

### 권한 모델 (3단계)
| 영역 | 보기 | 편집 | Claude 작업 | 비유 |
|------|------|------|------------|------|
| 내 폴더 | O | O | O | 내 책상 |
| 공유 폴더 | O | 규칙별 | 규칙별 | 회의실 |
| 다른 사람 폴더 | O | X | X | 남의 책상 |

### 구현 범위
- 유저별 폴더 자동 생성, `isWriteAllowed()` 경로 가드
- 선택적 git worktree (비개발자에게 git 용어 노출 안 함)
- 파일 단위 "공유 폴더에 내보내기"

### 선행 조건
- 세션 CWD 설계 (위 백로그)
- 역할별 permissionMode 적용 (완료)

---

## 🟡 워크플로우 자동화 (Kanban + Cron) — 기획 전

Claude를 활용한 반복 작업 자동화. 칸반 보드 + cron 트리거.

**가능 유즈케이스:**
- 매일 데이터 수집 → 요약 보고서 → Slack 전송
- 파일 변경 → 자동 코드 리뷰
- 주간 리서치 태스크 순차 처리

**현재 상태:** 아이디어 단계.

---

## Phase 6: 모바일 + 파일 업로드 + 배포

1. 로컬 파일 업로드 (OS 드래그 앤 드롭 → 워크스페이스 저장)
2. 모바일 반응형 (하단 탭바, ≤768px)
3. 다크/라이트 테마
4. 비용 추적 대시보드
5. Docker + Cloudflare Tunnel + PWA

---

## 배포 아키텍처 (Phase 6)

```
사용자 브라우저 → HTTPS(Cloudflare Tunnel) → Docker Compose(Caddy + claude-desk + cloudflared)
```

- **Tier 1: Docker Compose** — 1개 명령으로 전체 스택, 원클릭 설치 스크립트
- **Tier 2: Cloudflare Tunnel** — 무료 HTTPS, 고정 URL, 포트 열기 불필요
- **Tier 3: PWA** — 홈 화면 설치, 브라우저 크롬 없이 실행
- **Tier 4: 클라우드** — Fly.io/Railway 원클릭 배포

### 설치 시나리오
- A) 내 PC에서 혼자: `docker run -d ...`
- B) 팀 원격 접속: `install.sh` + Cloudflare Tunnel
- C) 서버 관리 싫어: Fly.io fork → 환경변수 → 자동 배포

---

## 프로젝트 구조

```
claude-desk/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts
  ecosystem.config.cjs          -- PM2 설정

  backend/
    index.ts                    -- Express + WS 서버 엔트리
    config.ts                   -- 설정 (포트, 경로, 인증, 모델)
    db/schema.ts                -- SQLite 스키마
    services/
      claude-sdk.ts, file-system.ts, pin-manager.ts,
      session-manager.ts, message-store.ts, command-loader.ts,
      auth.ts, auto-namer.ts, summarizer.ts, git-manager.ts
    routes/
      api.ts                    -- REST 엔드포인트
      ws-handler.ts             -- WebSocket 메시지 라우팅
      session-guards.ts         -- 세션 격리 순수 함수
      session-guards.test.ts    -- 유닛 테스트 (13개)
      ws-handler.test.ts        -- 통합 테스트 (8개)

  frontend/src/
    App.tsx, main.tsx
    stores/                     -- chat, file, session, pin, prompt, model, git, settings
    components/
      layout/                   -- Header, Sidebar, ContextPanel, ResizeHandle, ModelSelector
      chat/                     -- ChatPanel, MessageBubble, ToolUseCard, InputBox, AttachmentChip
      files/                    -- FileTree, MarkdownRenderer
      editor/                   -- CodeEditor
      sessions/                 -- SessionItem, SummaryCard
      pinboard/                 -- PinList
      prompts/                  -- PromptItem, PromptEditor
      git/                      -- GitPanel
      settings/                 -- SettingsPanel
      auth/                     -- LoginPage
    hooks/
      useWebSocket.ts, useClaudeChat.ts
    utils/
      message-parser.ts, session-filters.ts
      session-filters.test.ts   -- 유닛 테스트 (13개)
    components/chat/
      InputBox.test.tsx          -- 컴포넌트 테스트 (5개)
```

---

## 검증 방법

1. SDK 연동: "hello" → Claude 응답 스트리밍 ✅
2. 세션 이어하기: 새로고침 → 히스토리 선택 → 맥락 유지 ✅
3. 파일 편집: Claude 파일 생성 → 실시간 반영 → 클릭 열기/편집
4. Skills: `/` 입력 → 드롭다운 → 선택 실행 ✅
5. SSH 터널 접속 ✅
6. 핀보드: .html 핀 → iframe 렌더링 → 드래그→채팅
7. 프롬프트: 추가 → 미리보기 → 드래그→InputBox
8. 테스트: `npm run test` → 39개 통과 ✅
9. 빌드: `npm run build` → 회귀 없음 ✅

---

## Dev Mode (HMR 개발 워크플로우)

### 배경
`npm run restart` (production build) 는 매번 ~40초 소요. 개발 중 빈번한 수정에 비효율적.

### 해결
Vite dev server + tsx watch 조합으로 즉시 반영:
- Frontend: Vite HMR → CSS/컴포넌트 변경 즉시 반영
- Backend: tsx watch → 파일 변경 시 ~2초 자동 재시작
- 같은 포트(32354)로 원격 접속 가능

### 사용법
```bash
# 개발 모드 시작
pm2 stop claude-desk
npm run dev

# 프로덕션 복귀
Ctrl+C
npm run restart
```

### 포트 구조
- :32354 — Vite dev server (브라우저 접속)
- :32355 — Backend (Vite가 /api, /ws 프록시)
