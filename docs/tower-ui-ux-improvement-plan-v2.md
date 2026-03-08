# Tower UI/UX Improvement Plan v2

> Version: 2.0 (refined)
> Date: 2026-03-08
> Method: Code verification + Plan Refine (ATDD/HAZOP/PBR) + Tech Lead principles
> Scope: `frontend/src/` components

---

## Analysis Summary

Original plan (v1)에서 18개 항목을 코드베이스 대조 검증.
- 14개 항목: 코드와 정확히 일치 (Verified)
- 3개 항목: 부분적으로 정확 (수정 반영)
- 1개 항목: 이미 구현되어 있어 제외 (GitPanel 중복 제출 방지)
- 3개 항목: 비용 대비 효과 낮거나 범주 부적합으로 제외

우선순위를 Tech Lead P1 (Define the job and the edges) 원칙에 따라 재분류:
- **Critical**: 사용자가 기능을 아예 쓸 수 없는 것
- **High**: 기능은 되지만 품질/접근성이 부족한 것
- **Medium**: 개선하면 좋지만 당장 문제는 아닌 것

---

## 1. Critical (기능 차단)

### C1. KanbanCard 모바일 액션 접근 불가

- **File**: `components/kanban/KanbanCard.tsx` L170-233
- **Verified**: 5개 액션 버튼 모두 `opacity-0 group-hover:opacity-100` — 터치 기기에서 완전히 숨겨짐
- **영향**: 모바일에서 태스크 실행/삭제/스케줄/정지 불가능
- **Solution**:
  - 카드 우측 상단에 `...` 더보기 버튼 항상 표시
  - 클릭 시 액션 메뉴 팝오버
  - 기존 hover 동작은 데스크탑에서 유지 (progressive enhancement)
- **Acceptance Test**: 모바일 뷰포트(375px)에서 KanbanCard의 모든 액션에 접근 가능

```tsx
// 더보기 버튼 — 항상 표시
<button
  onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
  className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
  aria-label="Task actions"
>
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
  </svg>
</button>
```

- **Regression risk**: Low. 기존 hover 동작 건드리지 않고 메뉴만 추가.
- **Effort**: S (1-2h)

---

### C2. Header 사용자 메뉴 추가

- **File**: `components/layout/Header.tsx` L146-266
- **Verified**: 현재 사용자명 표시 없음. 로그아웃은 Settings 모달 내부에만 존재. aria-label 0개.
- **영향**: "내가 누구로 로그인했는지" 알 수 없음. 로그아웃 경로가 2단계(Settings 열기 > 스크롤 > Logout)
- **Solution**:
  - Header 우측 끝(연결 표시 왼쪽)에 사용자 드롭다운 추가
  - 내용: 사용자명 + 역할, Settings 바로가기, Logout
  - `App.tsx`에서 `localStorage.username`, `localStorage.userRole` 참조 (기존 패턴)
- **Acceptance Test**:
  1. Header에 현재 로그인한 사용자명이 표시됨
  2. 클릭 시 드롭다운 열림 (외부 클릭으로 닫힘)
  3. Logout 클릭 시 토큰 삭제 + 로그인 페이지 이동

```
현재:  [=] [T Tower] [Chat|Board|History] [session] ---- [Model] [Git] [Publish] [Admin] [Theme] [*]
제안:  [=] [T Tower] [Chat|Board|History] [session] ---- [Model] [Git] [Publish] [Admin] [Theme] [user v] [*]
```

- **Regression risk**: Medium. Header 레이아웃 변경 → 모바일 넘침 가능. 반드시 375px 테스트.
- **HAZOP**: 사용자명이 길 경우(20자+) Header 레이아웃 깨짐 → `max-w-[100px] truncate` 필수
- **Effort**: M (2-4h)

---

## 2. High (품질/접근성)

### H1. Header 아이콘 버튼 aria-label 전면 누락

- **File**: `components/layout/Header.tsx` 전체
- **Verified**: aria-label 0개. `title` 속성만 있음 (L161, 195, 221, 232, 245).
- **Solution**: 모든 아이콘 버튼에 `aria-label` 추가. `title`은 유지 (tooltip 역할).
- **Acceptance Test**: 스크린리더(VoiceOver/NVDA)에서 모든 Header 버튼의 이름이 읽힘
- **Regression risk**: None
- **Effort**: XS (30min)

---

### H2. NewTaskModal 폼 접근성

- **File**: `components/kanban/NewTaskModal.tsx` L300-396
- **Verified**: `htmlFor`/`id` 연결 0개. Label 클릭 시 input 포커스 안 됨.
- **Verified (수정)**: 3열 레이아웃은 `grid-cols-3`가 아니라 `flex gap-3` + `w-32` (L370-395). 모바일에서 `w-32` 고정폭이 화면을 넘길 수 있음.
- **Solution**:
  1. 각 input/select에 고유 id 부여 + label htmlFor 연결
  2. L370의 `flex gap-3` → `flex flex-col sm:flex-row gap-3`, `w-32` → `w-full sm:w-32`
- **Acceptance Test**: label 클릭 시 해당 input에 포커스. 375px에서 가로 스크롤 없음.
- **Regression risk**: Low
- **Effort**: S (1h)

---

### H3. ErrorBoundary role="alert" 누락

- **File**: `components/common/ErrorBoundary.tsx` L27 (v1에서 경로 오류: `shared/` -> `common/`)
- **Verified**: `role="alert"` 없음. 에러 상세가 항상 표시되어 긴 에러 메시지 시 가독성 저하.
- **Solution**:
  1. 최외곽 div에 `role="alert"` 추가
  2. 에러 메시지를 `<details>` 안에 넣어 기본 접힘
  3. Retry 버튼에 `cursor-pointer` 추가 (현재 누락)
- **Acceptance Test**: 에러 발생 시 스크린리더가 alert 읽음. 에러 세부사항은 접힌 상태.
- **Regression risk**: None
- **Effort**: XS (20min)

---

### H4. 색상 체계 불일치

- **Verified**: 16개 파일에서 `emerald-500`과 `green-500` 혼용 (같은 "성공" 의미)
  - Header: `bg-emerald-500` (연결 표시)
  - KanbanCard: `text-green-300`, `border-green-500/30` (done 상태)
  - PublishPanel: `bg-emerald-500` (up/live 상태)
  - SessionItem: `text-green-400`/`text-green-600` (활성 세션)
- **Solution**: index.css `@theme`에 semantic 변수 추가, 점진적 마이그레이션
- **Tech Lead P4 (Isolate Volatility)**: 색상 변수를 한곳에 정의하면 이후 테마 변경이 쉬워짐

```css
--color-success: var(--color-emerald-500);   /* 통일: emerald 계열 */
--color-warning: var(--color-amber-500);
--color-danger: var(--color-red-500);
```

- **Acceptance Test**: `green-500`으로 "성공"을 표현하는 곳이 0개
- **Regression risk**: Medium. 전체 파일 변경 → 별도 브랜치 권장
- **Effort**: M (3-4h, 점진적)
- **Sequencing**: 다른 작업 완료 후 마지막에 진행 (merge conflict 최소화)

---

### H5. ResizeHandle 터치 미지원

- **File**: `components/layout/ResizeHandle.tsx`, `HorizontalResizeHandle.tsx`
- **Verified**: 3개 핸들 모두 `onMouseDown` + `mousemove` + `mouseup` 사용. PointerEvent 미사용.
- **Solution**: `onMouseDown` -> `onPointerDown`, `mousemove` -> `pointermove`, `mouseup` -> `pointerup`
- **Acceptance Test**: iPad Safari에서 사이드바/패널 리사이징 동작
- **Regression risk**: Low. PointerEvent는 MouseEvent의 상위 호환.
- **Effort**: S (1h)

---

### H6. MessageBubble 코드 Copy 버튼 (터치)

- **File**: `components/chat/MessageBubble.tsx`
- **Verified**: hover 기반 표시 패턴 사용 (C1과 동일 문제)
- **Solution**: `opacity-60` 기본 표시 + `hover:opacity-100`
- **Acceptance Test**: 모바일에서 코드 블록의 Copy 버튼 접근 가능
- **Regression risk**: None. 시각적 변경만.
- **Effort**: XS (15min)

---

## 3. Medium (개선)

### M1. 폰트 크기 체계화

- **Verified**: 28개 파일에서 임의 크기 205회 사용 (`text-[9px]` ~ `text-[15px]`)
- **Decision (Tech Lead P6 - Consistency)**: 한 번에 하지 않음. 파일별 점진적 통일.
- **Target mapping**:
  - `text-[9px]` → 유지 (배지/극소 라벨, 사용처 소수)
  - `text-[10px]`~`text-[11px]` → `text-xs` (12px)
  - `text-[12px]`~`text-[13px]` → `text-sm` (14px)
  - `text-[15px]` → `text-sm` 또는 `text-base`
- **Regression risk**: High. 글자 크기 변경은 레이아웃 깨짐 유발 가능. 컴포넌트별 테스트 필수.
- **Effort**: L (분산 진행)

---

### M2. Sidebar Settings 버튼 발견성

- **File**: `components/layout/Sidebar.tsx`
- **현황**: C2(사용자 메뉴) 추가 시 Settings 접근 경로가 확보되므로 우선순위 하락
- **Solution**: C2 완료 후 재평가. 필요 시 `text-surface-500 hover:text-surface-300`으로 변경.
- **Effort**: XS

---

### M3. ShareModal 링크 복사 UX

- **Solution**: 입력 필드 + Copy 버튼. 복사 성공 시 "Copied!" 피드백 (2초 후 원복)
- **Effort**: S (1h)

---

### ~~M4. GitPanel 커밋 중복 제출 방지~~ (REMOVED)

- **사유**: 코드 검증 결과 이미 구현되어 있음 (`disabled={!commitMessage.trim() || isSaving}`, GitPanel.tsx L214)

---

### M5. FloatingQuestionCard 터치 타겟

- **Solution**: 버튼에 `min-h-[44px] min-w-[44px]` 적용
- **Effort**: XS (15min)

---

### M6. FileTree 컨텍스트 메뉴 뷰포트 보정

- **Solution**: 메뉴 렌더 후 `useLayoutEffect`에서 `getBoundingClientRect()` → 위치 보정
- **Effort**: S (1-2h)

---

### M7. SessionItem 편집 모드 blur 동작

- **현황**: blur 시 자동 저장 → 의도치 않은 저장 가능
- **Solution**: blur 시 변경값이 있을 때만 저장 (변경 없으면 취소)
- **Effort**: XS (20min)

---

### M8. OfflineBanner 개선

- **File**: `components/common/OfflineBanner.tsx` (v1 경로 오류: 실제 `common/`)
- **Solution**: Retry 버튼 추가 (`window.location.reload()`), 경고 아이콘 추가
- **Effort**: XS (20min)

---

### M9. 언어 혼재

- **Solution**: 영어 통일 (i18n 도입은 현 단계에서 과도)
- **Effort**: S (1h, 발견 시 점진적 수정)

---

### M10. 모달 백드롭 안전성

- **현황**: 폼 변경 중 배경 클릭 시 데이터 손실 가능
- **Solution**: 폼 dirty 상태 체크 → confirm 대화상자 표시
- **대상**: NewTaskModal (가장 입력이 많은 모달)만 우선 적용
- **Effort**: S (1h)

---

## NEW: Project-Grouped Sidebar

### 배경과 문제

t3code, OpenAI Codex 등 최신 AI 코딩 도구는 사이드바에서 세션을 프로젝트별로 묶어 보여준다.
Tower의 현재 사이드바는 549개 세션을 flat list로 나열. 10개만 넘어도 "어떤 작업이었지?" 찾기 어렵다.

### Tower에서 cwd 기반 감지가 안 되는 이유

실제 DB를 조회해보면:

```
/home/enterpriseai/workspace    → 302 sessions  (55%)
/home/enterpriseai/claude-desk  → 216 sessions  (39%)
/home/enterpriseai              →  16 sessions
기타                             →  15 sessions
```

**302개 세션이 전부 같은 `/workspace`를 공유.** 마커 기반 프로젝트 감지(.git 등)를 써도
전부 "workspace"라는 하나의 거대 그룹이 될 뿐이다.

t3code/Codex는 **1 repo = 1 project**라서 cwd로 자동 분류가 된다.
Tower는 **1 workspace에서 다양한 주제**(견적서, 리서치, 회의록, 코드 작업 등)를 다루므로
cwd ≠ project. **프로젝트는 별도 개념으로 설계해야 한다.**

---

### Design: 3-Track Project Assignment

프로젝트에 세션이 배정되는 3가지 경로:

```
                ┌──────────────────────┐
                │   세션 생성 시점      │
                └──────────┬───────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ① 명시적 생성    ② AI 자동 분류   ③ 수동 이동
     프로젝트 그룹     첫 메시지 분석    드래그/우클릭
     안에서 New Chat   → 기존 프로젝트    → 프로젝트 변경
                       매칭 or 새 제안
```

#### Track 1: 명시적 생성 (In-context creation)

프로젝트 그룹 안에서 "New Chat" 버튼을 누르면 → 자동으로 그 프로젝트 소속.

```
┌─────────────────────────────┐
│ ▼ Tower 개발           (5)  │
│   ┣ Fix login bug           │
│   ┣ UI/UX improvement       │
│   ┗ [+ New Chat]            │  ← 이 프로젝트 안에서 생성
│                             │
│ ▼ 견적/제안서           (3)  │
│   ┣ A사 견적서               │
│   ┗ [+ New Chat]            │
│                             │
│ [+ New Project]             │  ← 새 프로젝트 생성
│ [+ New Chat]                │  ← 프로젝트 미지정 (→ Track 2로)
└─────────────────────────────┘
```

- 가장 마찰 없는 경로. 사용자가 이미 맥락 안에 있으므로 추가 판단 불필요.
- 사이드바 상단 "New Chat" 버튼은 기존처럼 프로젝트 미지정 세션 생성 (하위 호환).

#### Track 2: AI 자동 분류 (Auto-classification)

프로젝트 미지정 상태로 생성된 세션에서 첫 사용자 메시지가 전송되면,
Haiku가 기존 프로젝트 목록과 대조하여 분류를 제안한다.

**동작 흐름**:
```
1. 사용자가 프로젝트 미지정 세션에서 첫 메시지 전송
2. 백엔드가 비동기로 분류 요청 (Haiku, 1-turn)
3. 기존 프로젝트와 매칭되면 → 자동 배정 + 토스트 알림
   "Tower 개발 프로젝트에 배정됨 [Undo]"
4. 매칭 안 되면 → 새 프로젝트 제안
   "새 프로젝트 생성: ETF 리서치? [확인] [다른 이름] [무시]"
5. 사용자가 무시하면 → Ungrouped에 유지
```

**분류 프롬프트** (기존 `summarizer.ts` 패턴 활용):
```ts
// backend/services/project-classifier.ts
export async function classifySession(
  userMessage: string,
  sessionName: string,
  existingProjects: { id: string; name: string; description?: string }[]
): Promise<{ projectId: string | null; suggestedName: string | null }> {

  const projectList = existingProjects
    .map(p => `- "${p.name}"${p.description ? `: ${p.description}` : ''}`)
    .join('\n');

  const prompt = `Given a user's first message and existing project list, determine the best match.

Existing projects:
${projectList || '(none)'}

Session name: "${sessionName}"
First message: "${userMessage.slice(0, 500)}"

Rules:
- If the message clearly relates to an existing project, return its name
- If it's a new topic, suggest a short project name (2-4 words)
- If unclear or too generic ("hello", "test"), return null

Respond in JSON only: {"match": "project name" | null, "suggest": "new name" | null}`;

  // Haiku 1-turn query (same pattern as summarizer.ts)
  // ...
}
```

**분류 판단 기준** (프롬프트 내부):
- 세션 이름에 기존 프로젝트 키워드가 포함되면 → 매칭
- cwd가 기존 프로젝트의 root_path와 같으면 → 매칭 (cwd를 보조 신호로 활용)
- 첫 메시지의 주제가 기존 프로젝트와 유사하면 → 매칭
- 전혀 새로운 주제면 → 새 프로젝트 제안

**비용**: Haiku 1-turn, ~100 input tokens → 세션당 ~$0.0001. 무시 가능.

#### Track 3: 수동 이동 (Manual reassignment)

언제든 세션을 다른 프로젝트로 옮길 수 있다.

- **UI 1**: 세션 우클릭 → "Move to Project" → 프로젝트 선택 드롭다운
- **UI 2**: 세션을 프로젝트 그룹으로 드래그 앤 드롭
- **UI 3**: 세션 상세에서 프로젝트 태그 편집

---

### DB Schema

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT NOT NULL,            -- "Tower 개발", "견적/제안서", "ETF 리서치"
  description TEXT,              -- 프로젝트 설명 (AI 분류 시 매칭 정확도 향상)
  root_path TEXT,                -- 연관 경로 (보조 매칭 신호, optional)
  color TEXT DEFAULT '#f59e0b',  -- 사이드바 색상 (amber default)
  sort_order INTEGER DEFAULT 0,
  collapsed INTEGER DEFAULT 0,  -- 사이드바 접힘 상태
  archived INTEGER DEFAULT 0,   -- 완료된 프로젝트 숨기기
  user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 세션에 project_id FK 추가
ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
```

### Frontend: SessionMeta 확장

```ts
export interface SessionMeta {
  // ... 기존 필드
  projectId?: string | null;
  projectName?: string;       // JOIN으로 가져옴
  projectColor?: string;
}
```

### Sidebar UI

```
┌─────────────────────────────┐
│ [Search...]                 │
├─────────────────────────────┤
│ ▼ Tower 개발 ●        (5)  │  ← 프로젝트 (색상 dot + 이름)
│   ┣ Fix login bug      ●   │  ← streaming 표시
│   ┣ UI/UX improvement       │
│   ┣ Add dark mode           │
│   ┗ [+ New Chat]            │  ← 이 프로젝트 안에서 생성
│                             │
│ ▶ 견적/제안서           (4)  │  ← 접힌 그룹 (세션 수만 표시)
│                             │
│ ▼ ETF 리서치            (2)  │
│   ┣ 국내 ETF 비교            │
│   ┗ 해외 ETF 분석            │
│                             │
│ ─── Ungrouped ──────────── │  ← 프로젝트 미배정
│   Quick question            │
│   Hello test                │
├─────────────────────────────┤
│ [+ New Project]             │
│ [+ New Chat]                │  ← 미지정 생성 (→ AI 분류)
└─────────────────────────────┘
```

**프로젝트 그룹 헤더 동작**:
- 클릭: 접기/펼치기 토글
- 우클릭: 컨텍스트 메뉴 (Rename, Change Color, Archive, Delete)
- 내부 [+ New Chat]: Track 1 (명시적 생성)

**세션 아이템 동작**:
- 기존 동작 유지 (클릭: 선택, 더블클릭: 이름 편집)
- 추가: 우클릭 메뉴에 "Move to Project" 항목
- 추가: 드래그로 프로젝트 간 이동

### 접힘 상태 관리

```ts
// session-store.ts에 추가
collapsedProjects: Set<string>;  // 접힌 프로젝트 ID Set
toggleProjectCollapsed: (projectId: string) => void;
```

`localStorage`에 persist → 새로고침 후에도 유지.

### 그룹핑 로직

```ts
const groupedSessions = useMemo(() => {
  const projectGroups = new Map<string, {
    project: Project;
    sessions: SessionMeta[];
  }>();
  const ungrouped: SessionMeta[] = [];

  for (const session of sessions) {
    if (session.projectId) {
      if (!projectGroups.has(session.projectId)) {
        projectGroups.set(session.projectId, {
          project: projects.find(p => p.id === session.projectId)!,
          sessions: [],
        });
      }
      projectGroups.get(session.projectId)!.sessions.push(session);
    } else {
      ungrouped.push(session);
    }
  }

  // 각 그룹 내 세션: updatedAt 내림차순
  for (const group of projectGroups.values()) {
    group.sessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  // 그룹 정렬: sort_order 우선, 그다음 최신 활동 순
  const sorted = [...projectGroups.values()]
    .sort((a, b) => {
      if (a.project.sortOrder !== b.project.sortOrder)
        return a.project.sortOrder - b.project.sortOrder;
      const aLatest = a.sessions[0]?.updatedAt || '';
      const bLatest = b.sessions[0]?.updatedAt || '';
      return bLatest.localeCompare(aLatest);
    });

  return { groups: sorted, ungrouped };
}, [sessions, projects]);
```

### 검색과의 통합

- 검색어 입력 시: 그룹핑 해제, flat list로 결과 표시 (현재 동작 유지)
- 프로젝트 이름도 검색 대상에 포함 (프론트엔드 필터)

### 기존 세션 마이그레이션

549개 기존 세션 처리:
1. `claude-desk` cwd 세션 (216개) → "Tower 개발" 프로젝트 자동 배정 (cwd 매칭)
2. `workspace` cwd 세션 (302개) → Ungrouped로 시작, AI 배치 분류 제안
3. 배치 분류 UI: "302개 미분류 세션이 있습니다. [AI 자동 분류] [나중에]"

배치 분류 시 Haiku가 세션 이름 + summary를 보고 프로젝트 제안:
```ts
// 배치 분류 (admin 기능)
for (const session of unclassified) {
  const result = await classifySession(
    session.summary || session.name,  // summary가 있으면 우선 사용
    session.name,
    existingProjects
  );
  if (result.match) {
    // 자동 배정 (confidence 높을 때만)
  } else if (result.suggest) {
    // 제안 목록에 추가 (사용자 확인 필요)
  }
}
```

---

### Risk Analysis (HAZOP)

| # | Parameter | Guideword | Deviation | Consequence | Severity |
|---|-----------|-----------|-----------|-------------|----------|
| 1 | AI 분류 | NO (Haiku 실패) | 분류 API 타임아웃/에러 | 세션이 Ungrouped에 남음 (graceful) | Low |
| 2 | AI 분류 | OTHER THAN (오분류) | 잘못된 프로젝트에 배정 | 사용자 혼란 → Undo로 복구 | Medium |
| 3 | 프로젝트 수 | MORE (20개+) | 프로젝트가 너무 많음 | 사이드바 스크롤 → flat보다 나쁨 | Medium |
| 4 | 배치 마이그레이션 | MORE (302개) | 대량 Haiku 호출 | 비용 ~$0.03 + 시간 ~1분 | Low |
| 5 | 드래그 앤 드롭 | PART OF (모바일) | 터치에서 D&D 어려움 | 우클릭 메뉴로 fallback | Medium |

**완화 방안**:
- Risk 1: 분류 실패 시 Ungrouped에 남기고 토스트로 안내. 수동 배정 가능.
- Risk 2: 자동 배정 시 항상 Undo 토스트 표시 (3초간). Undo 시 Ungrouped로 복귀.
- Risk 3: Archive 기능으로 완료된 프로젝트 숨기기. 활성 프로젝트만 표시.
- Risk 4: 배치 분류는 optional. 관리자가 원할 때만 실행.
- Risk 5: 모바일에서는 우클릭 메뉴 (long-press) → "Move to Project" 제공.

---

### Acceptance Tests

1. **Track 1**: 프로젝트 그룹 내 [+ New Chat] → 해당 프로젝트에 자동 배정
2. **Track 2**: 미지정 세션에서 첫 메시지 → AI가 기존 프로젝트와 매칭 or 새 프로젝트 제안
3. **Track 2 Undo**: AI 배정 후 Undo → Ungrouped로 복귀
4. **Track 3**: 세션 우클릭 → "Move to Project" → 프로젝트 변경 성공
5. **접기/펼치기**: 프로젝트 그룹 클릭 → 토글. 새로고침 후에도 상태 유지.
6. **검색**: 검색어 입력 시 그룹핑 해제, flat list로 결과 표시
7. **프로젝트 관리**: 새 프로젝트 생성, 이름 변경, 색상 변경, 아카이브
8. **정렬**: sort_order 우선, 그 다음 최신 활동 순
9. **기존 세션**: cwd가 구체적인 세션(claude-desk)은 자동 매칭, workspace 세션은 Ungrouped

### Effort / Priority

- **Effort**: L (8-12h) — DB 스키마 + AI 분류 서비스 + Sidebar UI 리팩터링
- **Priority**: High — 549개 세션 → 찾기 불가능. 지금 해야 나중에 안 막힘.
- **Regression risk**: Medium — Sidebar.tsx 전체 리팩터링. 기존 세션 리스트 변경.
- **Sequencing**: Phase 3 (C2 User Menu) 이후에 진행. 둘 다 Sidebar를 건드리므로 순서 중요.

---

## 4. Removed (v1에서 제외)

### ~~FileTree WAI-ARIA Tree View~~

- **사유**: `role="tree"` + 키보드 네비게이션 full 구현은 비용 대비 효과 낮음. Tower의 주 사용자가 스크린리더 사용자가 아님. 필요 시 향후 별도 프로젝트로.

### ~~SessionItem 상태 지시자 과다~~

- **사유**: 코드 확인 결과 동시 표시가 실제로 문제 되는 케이스가 드뭄. 현재로 충분.

### ~~GitPanel diff 뷰어~~

- **사유**: 새 컴포넌트 작성 필요. UI/UX 개선이 아니라 기능 추가에 해당. 별도 기획.

### ~~SummaryCard 모바일 배경~~

- **사유**: 코드 확인 필요하나, 영향 범위가 작아 발견 시 즉시 수정 가능.

---

## 5. Risk Report (HAZOP)

| # | Parameter | Guideword | Deviation | Consequence | Severity |
|---|-----------|-----------|-----------|-------------|----------|
| 1 | H4 색상 변경 | MORE (범위) | 예상보다 많은 파일 영향 | 비의도적 색상 변경으로 UX 혼란 | High |
| 2 | M1 폰트 변경 | PART OF | 일부 컴포넌트만 변경 시 | 같은 화면에서 두 체계 공존 → 더 불일치 | High |
| 3 | C2 사용자 메뉴 | MORE (길이) | 사용자명 20자+ | Header 레이아웃 깨짐 | Medium |
| 4 | C2 사용자 메뉴 | NO (데이터) | localStorage에 username 없음 | 드롭다운에 빈 문자열 표시 | Medium |
| 5 | H5 PointerEvent | OTHER THAN | 구형 브라우저 | PointerEvent 미지원 → 리사이징 불가 | Low* |

*PointerEvent는 2019년 이후 모든 주요 브라우저 지원. 실질적 위험 없음.

---

## 6. Perspective Report (PBR)

### End User (매일 사용하는 사람)

**What this person notices**:
- 모바일에서 KanbanCard 액션을 쓸 수 없음 (C1) — 가장 답답한 문제
- 누구로 로그인했는지 모름 (C2) — 팀 환경에서 혼란
- 코드 블록 Copy가 모바일에서 안 됨 (H6)

**What's missing for this person**:
- 키보드 단축키 안내 (Ctrl+K 등). 파워 유저를 위한 발견성 부족.
- 다크/라이트 전환 후 일부 색상 깨짐 — 계획에 라이트 모드 검증이 빠져 있음.

### On-call Engineer (새벽 3시 디버깅하는 사람)

**What this person notices**:
- H4 색상 변경이 전체 파일에 영향 → regression 테스트 범위가 넓음
- M1 폰트 변경 205곳 → 시각적 regression 자동 테스트 없이 위험

**What's missing for this person**:
- Visual regression test 도구 (Playwright screenshot comparison 등) 없이 H4, M1을 진행하면 감지 못하는 깨짐 발생 가능
- Rollback plan: 색상/폰트 변경은 revert 가능하지만, 여러 파일에 걸쳐 있어 cherry-pick 어려움

### Security Adversary (악용하려는 사람)

**What this person notices**:
- C2 사용자 메뉴: `localStorage.username`은 클라이언트에서 변조 가능. UI 표시 목적으로는 문제없으나, 이 값으로 권한 판단하면 위험.
- M3 ShareModal 링크 복사: `navigator.clipboard.writeText`는 HTTPS 필수. HTTP 환경에서 실패 가능.

**What's missing for this person**:
- XSS: 사용자명에 HTML/스크립트가 들어갈 경우 드롭다운에서 렌더링되면 위험 → React의 기본 escaping으로 방어되지만 `dangerouslySetInnerHTML` 미사용 확인 필요.

---

## 7. Implementation Sequence

Tech Lead P2 (Treat uncertainty as the real work) 원칙에 따라, regression risk가 낮은 것부터 시작.

### Phase 1: Quick Wins (1일)

독립적이고 regression risk 없는 작업. 병렬 진행 가능.

| # | Item | Effort | Risk |
|---|------|--------|------|
| H1 | Header aria-label 추가 | XS | None |
| H3 | ErrorBoundary role="alert" | XS | None |
| H6 | Copy 버튼 항상 표시 | XS | None |
| M5 | FloatingQuestionCard 터치 타겟 | XS | None |
| M8 | OfflineBanner retry 버튼 | XS | None |

### Phase 2: Touch/Mobile (1-2일)

모바일 사용성 핵심 개선.

| # | Item | Effort | Risk |
|---|------|--------|------|
| C1 | KanbanCard 더보기 메뉴 | S | Low |
| H5 | ResizeHandle PointerEvent | S | Low |
| H2 | NewTaskModal 접근성 + 반응형 | S | Low |
| M7 | SessionItem blur 동작 | XS | Low |

### Phase 3: User Menu (2-4h)

단일 기능이지만 Header 레이아웃 변경 포함.

| # | Item | Effort | Risk |
|---|------|--------|------|
| C2 | Header 사용자 드롭다운 | M | Medium |

### Phase 4: Project-Grouped Sidebar (별도 브랜치)

Sidebar 구조 변경. Phase 3 완료 후 진행 (둘 다 Sidebar 변경).

| # | Item | Effort | Risk |
|---|------|--------|------|
| NEW | 프로젝트 루트 감지 API | S | Low |
| NEW | Sidebar 그룹핑 UI | M | Medium |
| NEW | 접힘 상태 persist | XS | None |

### Phase 5: Design System (별도 브랜치)

전체 파일 영향. Phase 1-4 완료 후 진행.

| # | Item | Effort | Risk |
|---|------|--------|------|
| H4 | 색상 체계 통일 | M | Medium |
| M1 | 폰트 크기 체계화 | L | High |

**주의**: Phase 5는 반드시 별도 브랜치(`feat/design-system`)에서 진행.
다른 작업과 동시에 진행하면 merge conflict 폭발.

### Phase 6: Polish (여유 시)

| # | Item | Effort | Risk |
|---|------|--------|------|
| M3 | ShareModal 복사 UX | S | None |
| M6 | FileTree 메뉴 위치 보정 | S | Low |
| M9 | 언어 통일 | S | None |
| M10 | 모달 백드롭 안전성 | S | Low |
| M2 | Sidebar Settings 발견성 | XS | None |

---

## 8. Pre-delivery Checklist

각 항목 완료 시 확인:

- [ ] `cursor-pointer` on all clickable elements
- [ ] `transition-colors duration-200` on hover states
- [ ] `aria-label` on icon buttons
- [ ] `htmlFor` + `id` on label-input pairs
- [ ] `role="alert"` on error messages
- [ ] 375px viewport: no horizontal scroll
- [ ] Touch target >= 44x44px on mobile-facing buttons
- [ ] 라이트 모드에서 텍스트 대비 4.5:1 이상

---

## 9. v1 Errata (원본 계획서 오류 정정)

| v1 내용 | 실제 |
|---------|------|
| `ErrorBoundary.tsx` 경로: `shared/` | `common/ErrorBoundary.tsx` |
| `OfflineBanner.tsx` 경로: 미명시 | `common/OfflineBanner.tsx` |
| NewTaskModal `grid-cols-3` | 실제는 `flex gap-3` + `w-32` (Grid 아님) |
| 1-2, 1-4를 Critical로 분류 | 기능은 동작함. High로 재분류 |
| Header에 `title`만 있다 | 정확. aria-label 0개 확인 |
| GitPanel 중복 제출 미방지 | 이미 `disabled={!commitMessage.trim() \|\| isSaving}` 구현됨 (L214) |
| GitPanel onViewDiff 미구현 | 실제로 diff fetch + 콜백 호출 구현됨 (L169-179) |
