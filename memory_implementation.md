# Claude 메모리 훅 시스템 구현 문서

## 배경

claude-brain 플러그인 실측 테스트 결과 3가지 blocking issue 발견:
1. **Free tier 50MB 제한** — 100개 메모리에서 초과, 사실상 유료
2. **동시 프로세스 쓰기에서 데이터 무음 유실**
3. **SDK `hits`/`frames` 반환값 불일치**로 search 기능 깨짐

**해결**: claude-brain의 훅 패턴은 유지하되, `@memvid/sdk`를 SQLite FTS5로 교체하여 자체 구축.

## 아키텍처

```
~/.claude/
├── settings.json              ← hooks 설정 추가
├── memory.db                  ← SQLite FTS5 (WAL 모드)
├── commands/
│   └── memory.md              ← /memory 슬래시 명령어
└── hooks/memory/
    ├── package.json           ← better-sqlite3 의존성
    ├── node_modules/          ← (설치됨)
    ├── db.mjs                 ← DB 연결 + 스키마 + 검색 함수
    ├── session-start.mjs      ← 최근 메모리 주입 (동기)
    ├── post-tool-use.mjs      ← 관찰 자동 캡처 (비동기)
    ├── stop.mjs               ← 세션 요약 저장 (동기)
    └── search.mjs             ← 수동 검색 유틸리티
```

## 데이터 흐름

```
사용자 메시지 → Claude CLI 프로세스 생성
  │
  ├─ [SessionStart] session-start.mjs (동기)
  │   memory.db에서 최근 요약 + 중요 메모리 쿼리
  │   → stdout으로 <memory-context> XML 출력 (Claude가 읽음)
  │   → 90일 초과 메모리 자동 정리 (1회)
  │
  ├─ [PostToolUse, async] post-tool-use.mjs (비동기)
  │   stdin으로 tool_name, tool_input, tool_result 수신
  │   → 노이즈 필터링 → 중복 방지 → SQLite INSERT (~1ms)
  │
  └─ [Stop] stop.mjs (동기)
      이 세션의 메모리 집계 → session_summaries UPSERT
```

## DB 스키마

### memories 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| session_id | TEXT | Claude CLI 세션 ID |
| tool_name | TEXT | Edit, Write, Bash 등 |
| type | TEXT | observation, file_edit, command, error |
| project | TEXT | cwd basename (프로젝트 식별) |
| file_path | TEXT | 수정된 파일 경로 |
| content | TEXT | 관찰 내용 (truncated) |
| tags | TEXT | 쉼표 구분 태그 |
| importance | INTEGER | 1=low, 2=medium, 3=high(에러) |
| created_at | TEXT | ISO 타임스탬프 |

인덱스: `session_id`, `project`, `importance`, `created_at`

### FTS5 이중 인덱스

- **`memories_fts`** — `unicode61` 토크나이저 (영어 단어 경계 검색)
  - 컬럼: `body`, `tags`, `file_path`
- **`memories_trigram`** — `trigram` 토크나이저 (한국어 부분 문자열 검색)
  - 컬럼: `body`, `tags`

INSERT 트리거로 자동 동기화. Standalone FTS (external content 아님).

### session_summaries 테이블

| 컬럼 | 설명 |
|------|------|
| session_id | TEXT PRIMARY KEY, UPSERT 지원 |
| project | 프로젝트명 |
| summary | 집계된 요약 텍스트 |
| tools_used | JSON 배열 |
| files_changed | JSON 배열 |
| memory_count | 관찰 개수 |
| duration_sec | 세션 지속 시간 |

### 검색 전략 (3-tier fallback)

1. **unicode61 FTS5** — 영어 단어 경계 매칭 (가장 정확)
2. **trigram FTS5** — 한국어/부분 문자열 매칭
3. **LIKE fallback** — 위 두 가지 실패 시

### 동시성

- `journal_mode=WAL` — 읽기/쓰기 동시 가능
- `busy_timeout=5000` — 5초 대기 후 실패
- `synchronous=NORMAL` — 성능/안전 균형

## 각 훅 상세

### post-tool-use.mjs — 캡처 로직

**필터링 전략:**

| 도구 | 캡처 | 스킵 |
|------|------|------|
| Edit | 파일 경로 + old→new diff 요약 | node_modules/.git/dist 등 |
| Write | 파일 경로 + 라인 수 + 미리보기 | 같은 노이즈 경로 |
| Bash | git/npm/docker 등 중요 명령 + 에러 | ls/cat/head/tail/echo/pwd |
| Bash 에러 | 전체 캡처 (importance=3) | — |
| NotebookEdit | 셀 편집 정보 | 노이즈 경로 |

**중복 방지**: 같은 session_id + 같은 content가 60초 내 존재하면 스킵

### session-start.mjs — 컨텍스트 주입

출력 형태:
```xml
<memory-context project="claude-desk">
## Recent Sessions
- [2026-02-23] Edited 5 files: schema.ts, handler.ts...
## Recent Changes
- [schema.ts] Edit: added memories table...
## Recent Errors
- [claude-desk] Bash error: npm test → ENOENT...
</memory-context>
```

- 최근 세션 요약 3개 + 중요 메모리 10개 + 에러 5개
- content 200자 truncate → 총 ~2KB 이하

### stop.mjs — 세션 요약

LLM 없이 구조적 집계:
```
Edited 3 files: config.ts, handler.ts, schema.ts
Commands: npm test; git commit -m "feat: memory"
Errors (1): ENOENT /tmp/missing.txt
[15 observations, 120s, tools: Edit/Bash/Write]
```

### /memory 명령어

```
/memory JWT 인증     → FTS5 검색
/memory --recent     → 최근 20개
/memory --stats      → 통계
/memory --summaries  → 세션 요약
```

## settings.json hooks 설정

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node $HOME/.claude/hooks/memory/session-start.mjs"
      }]
    }],
    "PostToolUse": [{
      "matcher": "Edit|Write|Bash|NotebookEdit",
      "hooks": [{
        "type": "command",
        "command": "node $HOME/.claude/hooks/memory/post-tool-use.mjs",
        "async": true
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node $HOME/.claude/hooks/memory/stop.mjs"
      }]
    }]
  }
}
```

## 구현 중 발견된 이슈 및 해결

### FTS5 외부 콘텐츠 테이블 DELETE 실패

**문제**: `content='memories', content_rowid='id'`로 external content FTS5 테이블을 만들면, DELETE 트리거에서 `INSERT INTO fts(fts, ...) VALUES('delete', ...)` 시 "SQL logic error" 발생. FTS5 컬럼명 `content`와 FTS5 옵션 `content=`가 충돌.

**해결**:
1. FTS 컬럼명을 `content` → `body`로 변경
2. External content 방식을 포기하고 standalone FTS5 사용
3. INSERT-only 트리거 (DELETE/UPDATE 트리거 제거)
4. `cleanupOld()` 함수에서 DELETE 후 FTS 전체 rebuild

**트레이드오프**: FTS 데이터 중복 저장 (디스크 약간 더 사용), 하지만 안정성 확보.

## claude-brain 대비 비교

| | claude-brain | 우리 구현 |
|--|-------------|----------|
| 스토리지 | .mv2 바이너리 (50MB 제한) | SQLite (무제한) |
| 비용 | 유료 API 키 필요 | 완전 무료 |
| 검색 | BM25 (search 버그) | FTS5 이중 인덱스 (영어+한국어) |
| 동시성 | 데이터 유실 | WAL + busy_timeout |
| 쓰기 속도 | ~800ms/op | ~1ms/op |
| 가독성 | 바이너리 | SQL 직접 조회 가능 |
| 노이즈 필터 | 전부 캡처 | 스마트 필터링 |

## 검증 결과 (2026-02-23)

| 테스트 | 결과 |
|--------|------|
| DB 초기화 (WAL) | PASS |
| INSERT 3개 메모리 | PASS |
| FTS unicode61 검색 ("dark mode") | PASS |
| FTS trigram 검색 ("JWT 인증") | PASS |
| 중복 방지 (60초 윈도우) | PASS |
| 세션 요약 UPSERT | PASS |
| 통계 조회 | PASS |
| 90일 cleanup + FTS rebuild | PASS |
| 에러 보존 (importance=3) | PASS |
| session-start.mjs 단독 실행 | PASS |
| post-tool-use.mjs 캡처 | PASS |
| stop.mjs 요약 생성 | PASS |
| search.mjs CLI | PASS |

## Tech Lead 리뷰 결과 및 수정 (2026-02-23)

### 발견된 약점과 수정 내역

| # | 심각도 | 약점 | 수정 |
|---|--------|------|------|
| 1 | **HIGH** | `stderr.length > 50`이면 exit 0이어도 에러로 오분류 (npm install 등 정상 경고도 importance=3) | exit code만으로 에러 판단하도록 변경 |
| 2 | **HIGH** | `cleanupOld(90)` 매 세션마다 동기 실행 — FTS rebuild 포함 시 수천 row에서 블로킹 | 파일 마커 기반 1일 1회 스로틀링 (`~/.claude/memory_last_cleanup`) |
| 3 | **MED** | readStdin의 setTimeout이 `unref()` 안 됨 — 프로세스 불필요 2초 대기 | `t.unref()` + 이중 resolve 방지 패턴 적용 |
| 4 | **MED** | `<memory-context project="...">` — project에 XML 특수문자 있으면 출력 깨짐 | `escapeXml()` 함수 추가 |
| 5 | **MED** | prepared statement 미캐싱 — 매 호출마다 `db.prepare()` | 핫패스 5개 stmt를 `prepareStatements()`로 사전 캐싱 |
| 6 | **LOW** | 전체 훅이 silent fail — 디버깅 불가 | stderr에 `[memory-hook]` 접두사로 에러 로깅 추가 |
| 7 | **LOW** | session_id = 'unknown' 폴백 — 세션 간 데이터 오염 | session_id 없으면 stop.mjs가 early return |

### 수정 후 재검증 (모두 PASS)

- npm install (exit 0 + stderr 경고) → command로 정확 분류 (이전: error 오분류)
- cleanup 스로틀 마커 생성 → 24시간 내 재실행 시 스킵
- readStdin timeout unref → 프로세스 즉시 종료
- XML escape → 특수문자 프로젝트명 안전
- prepared statement 캐싱 → 동일 stmt 재사용
- 에러 로깅 → stderr로 디버그 가능

## 메모리 시스템 중첩 분석 (2026-02-23)

현재 3개의 메모리 시스템이 공존. 역할이 겹치지 않도록 정리.

### 3-Layer 구조

| Layer | 시스템 | 위치 | 역할 |
|-------|--------|------|------|
| 1 | **Auto Memory** | `~/.claude/projects/.../memory/MEMORY.md` | 안정적 패턴, "이건 기억해" |
| 2 | **Workspace** | `/workspace/memory/MEMORY.md` + `decisions/` | 팀 결정, 프로세스 |
| 3 | **Memory Hooks** | `~/.claude/memory.db` | 세션 활동 자동 캡처 |

### 역할 구분 원칙

- **"이건 기억해"** (의도적 메모리) → Layer 1 Auto Memory 담당. 매 대화 자동 로딩.
- **"이건 팀 결정이야"** → Layer 2 Workspace 담당. decisions/ 에 불변 기록.
- **"이전 세션에서 뭐 했지?"** → Layer 3 Hooks 담당. `/memory` 검색.

### "의도적 메모리 저장" 기능을 새로 만들지 않은 이유

Claude Code에 내장된 Auto Memory (`MEMORY.md`)가 이미 이 역할을 수행:
- 매 대화 시작 시 자동 로딩 (시스템 프롬프트에 포함)
- 200줄 제한이지만 핵심 패턴/학습만 저장하면 충분
- 별도 설치 불필요

Memory Hooks(Layer 3)는 **자동 활동 로그**에 집중하는 것이 올바른 경계.

### 설치 안내

Memory Hooks 설치: `cd claude-desk/memory-hooks && bash install.sh`

통합 가이드: `claude-desk/memory-hooks/README.md`

## Claude Code 메모리 생태계 연구 (2026-02-23)

### 배경: OpenClaw과의 관계

Claude Code의 Auto Memory(MEMORY.md) 시스템이 OpenClaw 프로젝트에서 영감을 받았는지 조사.

**결론**: 직접적 영향 관계는 확인 불가. Claude Code의 MEMORY.md는 Anthropic이 자체 설계한 시스템으로, `.claude/` 디렉토리 구조와 프로젝트별 메모리 파일 관리 방식은 Anthropic 고유의 접근. 다만 "AI 코딩 에이전트에 영구 메모리를 부여한다"는 큰 흐름은 2024~2025년에 업계 전반에서 동시 발생 (GitHub Copilot Memory, Cursor Rules, Windsurf Rules 등).

### 커뮤니티 평가: Claude Code Memory의 장단점

#### 장점 (커뮤니티 공통 평가)

| 장점 | 설명 |
|------|------|
| **컨텍스트 지속성** | 세션 간 학습 유지. "매번 처음부터 설명" 문제 해결 |
| **프로젝트별 격리** | `~/.claude/projects/` 경로 기반 자동 분리 |
| **사용 단순성** | "이건 기억해" 한마디로 저장, 매 대화 자동 로딩 |
| **투명성** | MEMORY.md가 평문 마크다운 → 사람이 직접 확인/편집 가능 |
| **제로 설정** | 별도 설치나 API 키 불필요, Claude Code에 내장 |

#### 단점 (커뮤니티 보고 이슈)

| 단점 | 설명 |
|------|------|
| **200줄 제한** | MEMORY.md가 200줄 초과 시 잘림. 장기 프로젝트에서 부족 |
| **구조 없는 텍스트** | 마크다운 자유 형식이라 검색/필터링 어려움 |
| **수동 관리 부담** | 자동 정리 없음. 오래된 메모리가 쌓여 노이즈 증가 |
| **단일 파일 한계** | 프로젝트당 MEMORY.md 하나. 주제별 분리 불편 |
| **환각 증폭 위험** | 잘못 저장된 메모리가 이후 세션에 계속 주입 (GitHub #27430) |
| **공유 불가** | 개인 로컬 파일. 팀 단위 메모리 공유 메커니즘 없음 |

#### 경쟁 도구 비교

| 도구 | 메모리 방식 | 특징 |
|------|------------|------|
| **GitHub Copilot** | Repo-scoped memory | 레포지토리 기반, 팀 공유 가능 |
| **Cursor** | .cursorrules | 프로젝트 규칙 파일, 버전 관리 가능 |
| **Windsurf** | .windsurfrules | Cursor와 유사, 커스텀 규칙 |
| **Tabnine** | Knowledge graph | 조직 코드 베이스 학습, 82% 코드 생성 개선 주장 |
| **Claude Code** | MEMORY.md + hooks | 평문 마크다운 + 훅 시스템으로 확장 가능 |

### 기업 환경(Enterprise) 메모리 확장 분석

기업 전체의 AI 메모리를 만들어야 하는 경우의 장단점 분석.

#### 기업 메모리가 필요한 이유

1. **온보딩 가속**: 신규 개발자가 "이 프로젝트에서 왜 이렇게 하지?"를 즉시 파악
2. **결정 일관성**: 아키텍처 결정이 팀 전체에 공유되어 중복 토론 방지
3. **지식 보존**: 퇴사자의 암묵지가 시스템에 남음
4. **코드 품질**: 팀 컨벤션이 AI에 주입되어 일관된 코드 생성

#### 기업 메모리의 위험

| 위험 | 설명 | 완화 방법 |
|------|------|----------|
| **환각 전파** | 잘못된 메모리가 팀 전체에 확산 | 사람의 승인(approval) 게이트 필수 |
| **보안** | 민감 정보(API 키, 내부 URL)가 메모리에 캡처 | 자동 필터링 + 정기 감사 |
| **정보 부패** | 오래된 결정이 현재 컨텍스트에 부적합하게 적용 | TTL(보존 기간) + 버전 관리 |
| **규정 준수** | GDPR/개인정보가 메모리에 포함될 수 있음 | PII 필터, 삭제 권한 |
| **컨텍스트 오염** | A 프로젝트 메모리가 B 프로젝트에 누출 | 프로젝트 격리 + RBAC |
| **저장소 비용** | 팀 전원의 활동 로그가 중앙 DB에 쌓임 | 자동 요약 + 압축 + 보존 정책 |

#### 기업 메모리 아키텍처 패턴

```
┌─────────────────────────────────────────────┐
│  개인 메모리 (Local)                          │
│  MEMORY.md + memory.db per developer         │
│  → 개인 선호, 습관, 세션 히스토리             │
├─────────────────────────────────────────────┤
│  팀 메모리 (Shared)                           │
│  Git 관리되는 decisions/, CLAUDE.md           │
│  → 아키텍처 결정, 코딩 컨벤션, 리뷰 기준     │
├─────────────────────────────────────────────┤
│  조직 메모리 (Central)                        │
│  중앙 API 또는 MCP 서버                       │
│  → 크로스 프로젝트 패턴, 보안 정책, 인프라 규칙 │
└─────────────────────────────────────────────┘
```

**MCP(Model Context Protocol)의 역할**: Anthropic의 MCP는 "AI의 USB-C"로 불리며, 외부 도구/데이터 소스를 표준화된 방식으로 연결. 기업 메모리를 MCP 서버로 구축하면:
- Claude Code가 네이티브로 접근 가능
- 인증/권한 제어를 서버 측에서 처리
- 여러 AI 도구가 동일 메모리 소스를 공유

#### 우리의 3-Layer 시스템과 기업 확장

| Layer | 현재 (개인) | 기업 확장 시 |
|-------|------------|-------------|
| **1. Auto Memory** | 로컬 MEMORY.md | → 팀 공유 MEMORY.md (Git) |
| **2. Workspace** | 로컬 decisions/ | → 중앙 의사결정 DB (MCP) |
| **3. Memory Hooks** | 로컬 SQLite | → 중앙 활동 로그 서버 (MCP) |

현재 구현은 **개인 개발자 생산성**에 최적화. 기업 확장은 다음 단계:
1. Layer 2를 Git 기반 팀 공유로 확장 (가장 낮은 위험)
2. Layer 3의 SQLite를 MCP 서버 뒤 중앙 DB로 전환
3. Layer 1을 팀 템플릿 기반으로 표준화

### 핵심 인사이트

1. **메모리는 양날의 검**: 컨텍스트 지속성은 생산성을 높이지만, 잘못된 메모리는 환각을 증폭시킨다
2. **개인 → 팀 확장의 핵심은 승인 게이트**: 자동 캡처는 개인까지, 팀 공유는 사람의 검증 필요
3. **MCP가 기업 메모리의 표준 인터페이스가 될 가능성 높음**: Anthropic이 적극 추진 중
4. **우리의 3-Layer 구조는 올바른 기초**: 각 레이어의 역할이 명확히 분리되어 있어 단계별 확장 가능

## 향후 개선 가능성

- Read/Grep 도구 캡처 추가 (현재 Edit/Write/Bash/NotebookEdit만)
- 메모리 중요도 자동 분류 고도화
- 프로젝트 간 크로스 검색
- 웹 UI 대시보드 (claude-desk 통합)
- MCP 서버 기반 팀 메모리 공유
- 메모리 승인 게이트 (팀 공유 전 검증)
- PII/민감정보 자동 필터링
