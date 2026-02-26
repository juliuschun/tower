# Claude Memory System

Claude Code의 3개 메모리 레이어를 정리한 통합 가이드.

---

## 전체 구조: 3-Layer Memory

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Auto Memory (MEMORY.md)                    │
│  "이건 기억해" → 영구 저장, 매 대화 자동 로딩        │
│  위치: ~/.claude/projects/.../memory/MEMORY.md       │
├─────────────────────────────────────────────────────┤
│  Layer 2: Workspace Memory                           │
│  팀 결정, 프로세스, 원칙 → 사람이 관리              │
│  위치: /workspace/memory/MEMORY.md + decisions/      │
├─────────────────────────────────────────────────────┤
│  Layer 3: Memory Hooks (이 프로젝트)                  │
│  세션 활동 자동 캡처 → SQLite, 90일 보존            │
│  위치: ~/.claude/memory.db                           │
└─────────────────────────────────────────────────────┘
```

### 각 레이어 비교

| | Auto Memory | Workspace | Memory Hooks |
|--|-------------|-----------|-------------|
| **뭘 저장** | 패턴, 선호, 학습 | 팀 결정, 프로세스 | 편집/명령/에러 로그 |
| **누가 쓰나** | Claude (자동+수동) | 사람 (수동) | 훅 (완전 자동) |
| **언제 로딩** | 매 대화 시작 | CLAUDE.md 지시로 | session-start 훅 |
| **보존 기간** | 영구 | 영구 | 90일 (에러는 영구) |
| **검색** | 항상 컨텍스트에 있음 | `decisions/` 검색 | `/memory <키워드>` |
| **용도** | "이건 기억해" | "이건 결정이야" | "이전에 뭐 했지?" |

### 중첩 없이 역할이 나뉨

- **"이건 기억해"** → Layer 1 (Auto Memory MEMORY.md)
- **"이건 팀 결정이야"** → Layer 2 (Workspace decisions/)
- **"지난 세션에서 뭐 했지?"** → Layer 3 (Memory Hooks)

---

## 설치

### Memory Hooks 설치 (1분)

```bash
cd memory-hooks
bash install.sh
```

끝. 다음 Claude 세션부터 자동 작동합니다.

### 요구사항

- Node.js 18+
- Claude Code (CLI)

### 삭제

```bash
bash install.sh --uninstall
```

---

## 사용법

### 자동으로 되는 것 (설치만 하면)

**세션 시작**: 최근 세션 요약 + 변경 파일 + 에러가 Claude에게 자동 주입
```xml
<memory-context project="my-app">
## Recent Sessions
- [2026-02-23] Edited 5 files: App.tsx, Header.tsx...
## Recent Changes
- [App.tsx] Edit: added dark mode toggle
## Recent Errors
- $ npm test → ENOENT /tmp/missing.txt
</memory-context>
```

**세션 중**: Edit/Write/Bash 사용할 때마다 SQLite에 자동 기록 (노이즈 필터링)

**세션 종료**: 요약 자동 저장 ("5개 파일 편집, 명령 3개, 에러 1건")

### /memory 명령어

| 명령 | 설명 |
|------|------|
| `/memory JWT 인증` | 키워드 검색 (한국어/영어) |
| `/memory --recent` | 최근 20개 |
| `/memory --recent 50` | 최근 50개 |
| `/memory --stats` | DB 통계 |
| `/memory --summaries` | 세션 요약 목록 |

### "이건 기억해" (의도적 메모리)

Memory Hooks의 기능이 아닙니다. Claude Code의 **Auto Memory**가 담당합니다.

Claude에게 "이건 기억해", "항상 bun을 써", "dark mode 선호해" 같이 말하면
`~/.claude/projects/.../memory/MEMORY.md`에 자동 기록되어 **매 대화마다 로딩**됩니다.

→ 이건 별도 설치 없이 Claude Code에 내장된 기능입니다.

---

## 시나리오별 가이드

### "어제 하던 작업 이어서"
→ 그냥 새 세션을 열면 됩니다. session-start 훅이 최근 작업을 자동 주입합니다.

### "이 버그 전에도 본 적 있는데..."
```
/memory ENOENT
/memory "connection refused"
/memory CORS
```

### "이 파일 최근에 뭘 바꿨지?"
```
/memory App.tsx
/memory ContextPanel
```

### "어떤 git/npm 명령을 실행했지?"
```
/memory git commit
/memory npm install
```

### "최근 전체 작업 히스토리"
```
/memory --summaries
```

### "이 프로젝트 통계"
```
/memory --stats
```

---

## 기술 상세

### 자동 캡처 규칙

| 도구 | 캡처 | 스킵 |
|------|------|------|
| Edit | 파일 경로 + diff 요약 | node_modules, .git, dist |
| Write | 파일 경로 + 라인 수 + 미리보기 | 같은 노이즈 경로 |
| Bash | git/npm/docker 등 + 모든 에러 | ls, cat, echo, pwd |
| NotebookEdit | 셀 편집 정보 | 노이즈 경로 |

### 중요도

| 등급 | 조건 | 보존 |
|------|------|------|
| 3 (High) | Bash 에러 | 영구 |
| 2 (Medium) | 파일 편집, 중요 명령 | 90일 |
| 1 (Low) | 기타 명령 | 90일 |

### 검색 엔진 (3단계 폴백)

1. FTS5 unicode61 — 영어 단어 경계 매칭
2. FTS5 trigram — 한국어/부분 문자열 매칭
3. LIKE — 폴백

### 성능

- 쓰기: ~1ms (비동기, 작업 영향 없음)
- 검색: ~5ms
- DB: 1000개 메모리 ≈ 1MB
- 동시성: WAL + busy_timeout 5s

### 파일 구조

```
~/.claude/
├── settings.json                      ← hooks 설정
├── memory.db                          ← SQLite DB (자동 생성)
├── memory_last_cleanup                ← 정리 스로틀 마커
├── projects/.../memory/MEMORY.md      ← Auto Memory (Layer 1)
├── commands/
│   └── memory.md                      ← /memory 명령어
└── hooks/memory/
    ├── package.json + node_modules/
    ├── db.mjs              ← DB 스키마 + 검색
    ├── session-start.mjs   ← 세션 시작 → 컨텍스트 주입
    ├── post-tool-use.mjs   ← 도구 사용 → 자동 캡처
    ├── stop.mjs            ← 세션 종료 → 요약 저장
    └── search.mjs          ← 검색 유틸리티
```

---

## 수동 확인

```bash
# DB 조회
sqlite3 ~/.claude/memory.db "SELECT count(*) FROM memories;"

# 최근 기록
node ~/.claude/hooks/memory/search.mjs --recent 10

# 검색
node ~/.claude/hooks/memory/search.mjs "키워드"

# 통계
node ~/.claude/hooks/memory/search.mjs --stats
```

## 트러블슈팅

**훅이 동작 안 함**:
```bash
cat ~/.claude/settings.json | grep -A5 hooks
echo '{}' | node ~/.claude/hooks/memory/session-start.mjs
```

**DB 리셋**:
```bash
rm ~/.claude/memory.db
# 다음 세션에서 자동 재생성
```
