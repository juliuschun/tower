# claude-brain 리서치 & 도입 검토

> 작성일: 2026-02-23
> 대상: https://github.com/memvid/claude-brain

---

## 1. 개요

**claude-brain**은 [memvid](https://github.com/memvid/memvid) 팀이 만든 Claude Code 플러그인으로, 세션 간 지속적인 메모리를 단일 `.mv2` 바이너리 파일에 저장한다.

| 항목 | 내용 |
|------|------|
| Stars | 302 |
| License | MIT |
| Language | TypeScript (Rust 코어) |
| Version | 1.0.11 |
| Created | 2025-12-18 |
| Last Updated | 2026-02-23 |
| Dependencies | `@memvid/sdk ^2.0.149`, `proper-lockfile` |
| 최소 요구사항 | Node.js >= 18, Claude Code v2.0+ |

### 해결하는 문제

Claude Code는 세션 간 메모리가 없다. 매번 맥락을 다시 설명해야 하고, 과거 결정/버그/솔루션이 사라진다. claude-brain은 이를 자동 캡처 + 검색 가능한 `.mv2` 파일로 해결한다.

---

## 2. 아키텍처 & 작동 원리

### 플러그인 구조

```
claude-brain/
├── .claude-plugin/       # 플러그인 매니페스트
│   ├── plugin.json       # 이름, 버전, 설명
│   └── marketplace.json  # 마켓플레이스 정보
├── hooks/
│   └── hooks.json        # 3가지 훅 정의
├── commands/             # 슬래시 커맨드
│   ├── stats.md
│   ├── search.md
│   ├── ask.md
│   └── recent.md
├── skills/
│   └── mind/SKILL.md     # Claude에게 주입되는 메모리 사용법
└── src/core/
    └── mind.ts           # 핵심 엔진 (Mind 클래스)
```

### 훅 (자동 실행)

```json
{
  "SessionStart": [
    "smart-install.js",    // @memvid/sdk 자동 설치 (30초 타임아웃)
    "session-start.js"     // 최근 메모리 자동 주입 (5초)
  ],
  "PostToolUse": [
    "post-tool-use.js"     // 모든 도구 사용 후 관찰 자동 캡처 (10초)
  ],
  "Stop": [
    "stop.js"              // 세션 종료 시 요약 저장 (10초)
  ]
}
```

- **SessionStart**: 세션 시작 시 `@memvid/sdk`가 없으면 자동 설치, 이후 최근 메모리를 Claude 컨텍스트에 주입
- **PostToolUse**: 매 도구 사용 후 관찰(observation)을 자동 분류/저장
- **Stop**: 세션 종료 시 세션 요약을 `.mv2`에 기록

### 핵심 엔진 (Mind 클래스)

```typescript
// 싱글톤 패턴
const mind = await Mind.open();

// 기억 저장
await mind.remember({
  type: "decision",              // 10가지 타입 분류
  summary: "JWT 선택",
  content: "세션 대신 JWT 선택 이유: 마이크로서비스..."
});

// 검색 (BM25 lexical search)
const results = await mind.search("authentication", 10);

// 질문
const answer = await mind.ask("왜 JWT를 선택했나?");

// 컨텍스트 주입
const context = await mind.getContext("auth");
```

### 메모리 타입 (10가지)

`discovery`, `decision`, `problem`, `solution`, `pattern`, `warning`, `success`, `refactor`, `bugfix`, `feature`

### .mv2 파일 특성

- 초기 크기: ~70KB
- 메모리당 ~1KB 증가
- 1년 사용 시 ~5MB 이하
- Rust 코어로 10,000+ 메모리 < 1ms 검색
- 파일 락킹 (`proper-lockfile`) 지원
- 100MB 초과 시 자동 백업 + 재생성 (corruption 방지)

---

## 3. 사용법

### 설치

```bash
# Git 설정 (1회)
git config --global url."https://github.com/".insteadOf "git@github.com:"

# Claude Code에서
/plugin add marketplace memvid/claude-brain

# /plugins → Installed → mind → Enable Plugin → 재시작
```

### 명령어

```bash
/mind stats                       # 메모리 통계
/mind search "authentication"     # 과거 맥락 검색
/mind ask "왜 X를 선택했나?"       # 메모리에 질문
/mind recent                      # 최근 활동
```

### CLI (선택)

```bash
npm install -g memvid-cli
memvid stats .claude/mind.mv2
memvid find .claude/mind.mv2 "auth"
```

---

## 4. 우리 시스템 현황 비교

### 현재 상태

| 항목 | 현재 | claude-brain 도입 시 |
|------|------|---------------------|
| **메모리 방식** | CLAUDE.md + auto memory dir | `.mv2` 바이너리 파일 |
| **저장 위치** | `~/.claude/projects/.../memory/` | `.claude/mind.mv2` (프로젝트 내) |
| **캡처 방식** | Claude가 판단하여 수동 기록 | 훅으로 자동 캡처 (PostToolUse) |
| **검색** | 파일 읽기 (전체 스캔) | BM25 lexical search (< 1ms) |
| **포맷** | 마크다운 (사람이 읽기 쉬움) | 바이너리 (사람이 직접 읽기 불가) |
| **Git 추적** | diff 가능, 리뷰 가능 | 바이너리라 diff 불가 |
| **Claude 버전** | v2.1.50 | v2.0+ 필요 (호환) |

### 현재 우리가 쓰는 메모리 시스템

- **CLAUDE.md**: 프로젝트 지침, 서버 정보, 워크스페이스 규칙 등 수동 관리
- **auto memory**: `~/.claude/projects/...memory/` 디렉토리에 Claude가 자동 기록 (아직 MEMORY.md 미생성)
- **workspace**: `/home/enterpriseai/workspace/` — decisions, docs, notes 디렉토리 구조

---

## 5. 도입 시 장점

### 확실한 장점

1. **자동 캡처**: PostToolUse 훅으로 모든 도구 사용 결과를 자동 기록 → 놓치는 맥락 없음
2. **빠른 검색**: 10,000+ 메모리를 1ms 미만으로 검색 (현재 마크다운 전체 읽기 대비 압도적)
3. **세션 시작 시 자동 주입**: 별도 프롬프트 없이 관련 메모리가 컨텍스트에 들어감
4. **세션 종료 시 자동 요약**: 명시적으로 "기억해"라고 하지 않아도 저장됨
5. **파일 크기 효율**: 1년 써도 5MB 이하 vs 마크다운은 빠르게 커짐

### 추가 장점

6. **타입 분류**: 10가지 타입으로 자동 분류 → 구조적 검색 가능
7. **질문 기능**: `mind ask` — 자연어로 과거 맥락에 질문 가능
8. **Corruption 방지**: 파일 락킹, 자동 백업, 100MB 초과 시 재생성

---

## 6. 도입 시 우려사항

### 기술적 우려

| 우려 | 심각도 | 설명 |
|------|--------|------|
| **바이너리 포맷** | 중 | `.mv2`는 diff 불가, Git에서 변경 내용 리뷰 불가 |
| **`@memvid/sdk` 의존성** | 중 | 네이티브 Rust 바이너리 포함, 서버 환경 호환성 확인 필요 |
| **PostToolUse 훅 오버헤드** | 저 | 매 도구 호출마다 10초 타임아웃 node 프로세스 실행 |
| **기존 메모리 시스템과 충돌** | 중 | auto memory + claude-brain 이중 운영 시 혼란 |
| **플러그인 생태계 성숙도** | 중 | Claude Code 플러그인 시스템 자체가 아직 초기 단계 |

### 운영적 우려

| 우려 | 심각도 | 설명 |
|------|--------|------|
| **노이즈 메모리** | 중 | 자동 캡처로 무의미한 관찰이 쌓일 수 있음 |
| **메모리 정리** | 중 | 오래된/부정확한 메모리 정리 메커니즘 부재 |
| **디버깅 어려움** | 저 | 바이너리라 문제 발생 시 내부 확인 불가 |
| **사람이 읽기 불가** | 중 | workspace decisions/docs와 달리 사람이 직접 내용 확인 불가 |

### 우리 시스템 특수 상황

- **tunnelingcc (웹 브라우저 접근)**: 플러그인이 웹 인터페이스에서도 정상 작동하는지 확인 필요
- **PM2 프로세스 관리**: 훅 실행이 PM2 환경에서 문제 없는지 확인 필요
- **동시 세션**: 여러 사용자가 동시 접속 시 `.mv2` 파일 락 경쟁 우려

---

## 7. 기존 시스템과의 공존 방안

### Option A: claude-brain만 사용 (교체)

```
기존 auto memory → 비활성화
workspace decisions/docs → 유지 (사람이 관리하는 문서)
claude-brain .mv2 → Claude 메모리 전담
```

- 장점: 단순, 이중 관리 없음
- 단점: 기존 MEMORY.md의 사람 가독성 포기

### Option B: 병행 사용 (보완)

```
auto memory/MEMORY.md → 핵심 패턴, 사용자 선호 (수동, 사람 가독)
claude-brain .mv2 → 세션 맥락, 자동 관찰 (자동, 기계 검색)
workspace → 정식 결정/문서 (변경 불가)
```

- 장점: 각 시스템의 강점 활용
- 단점: 이중 관리, 정보 중복 가능

### Option C: 도입 보류 (관망)

```
현 시스템 유지 + MEMORY.md 적극 활용
claude-brain은 플러그인 생태계 안정화 후 재검토
```

- 장점: 리스크 없음, 현 시스템으로 충분할 수 있음
- 단점: 자동 캡처, 빠른 검색 이점을 놓침

---

## 8. 도입 절차 (진행 시)

### Step 1: 환경 확인

```bash
# Node.js 버전 확인 (>= 18 필요)
node --version  # v20.20.0 ✅

# Claude Code 버전 확인 (>= 2.0 필요)
claude --version  # 2.1.50 ✅

# @memvid/sdk 네이티브 빌드 가능한지 확인
npm install @memvid/sdk --dry-run
```

### Step 2: 설치

```bash
# Claude Code에서
/plugin add marketplace memvid/claude-brain
# /plugins → mind → Enable → 재시작
```

### Step 3: 검증

```bash
# 새 세션 시작 후
/mind stats                    # 작동 확인
/mind search "test"           # 검색 확인
ls .claude/mind.mv2           # 파일 생성 확인
```

### Step 4: 기존 시스템 조정

- `.gitignore`에 `.claude/mind.mv2` 추가 여부 결정
- auto memory 설정 조정 (중복 방지)
- CLAUDE.md에 claude-brain 사용 규칙 추가

---

## 9. 실측 테스트 결과 (2026-02-23)

> 테스트 환경: Azure VM, Ubuntu Linux 6.8.0, Node.js v20.20.0, Claude Code v2.1.50
> 테스트 방법: `/home/enterpriseai/claude-brain-test/` 에서 @memvid/sdk 직접 사용

### Test 1: 설치 및 네이티브 빌드 — PASS

```
@memvid/sdk@2.0.149 설치 성공 (2분)
SDK import 성공, create/use/put/find/ask 모든 API 사용 가능
.mv2 파일 생성 성공 (초기 72KB, 221ms)
```

- 9개 high severity npm 취약점 경고 (deprecated 패키지들)
- `@finom/zod-to-json-schema`, `@langchain/langgraph-sdk` 등 deprecated 의존성

### Test 2: CRUD 동작 — PASS (단, 중요 버그 발견)

| 작업 | 결과 | 속도 |
|------|------|------|
| put (저장) | OK | 772ms ~ 1.3s/op |
| find (검색) | **SDK 반환값 불일치** | 1 ~ 17ms |
| ask (질문) | OK, 정확도 높음 | 10 ~ 25ms |
| timeline | OK | < 5ms |
| stats | OK | < 5ms |

**발견된 버그**: claude-brain 플러그인의 `mind.ts` search 메서드가 `results.frames`를 읽지만, SDK v2는 `results.hits`를 반환. 결과적으로 **`/mind search` 명령어가 항상 0건 반환** (사실상 깨진 기능).

### Test 3: 성능 벤치마크 — FAIL (심각한 문제 발견)

#### 쓰기 성능

| 건수 | 소요 시간 | 건당 속도 | 파일 크기 |
|------|----------|----------|----------|
| 7건 | ~7s | **~1s/op** | 141KB |
| 100건 | 80.6s | **805.9ms/op** | **51MB** |
| 100건 초과 | ERROR | - | 50MB 초과 |

#### 치명적 문제: Free Tier 50MB 제한

```
ERROR: MemvidError: File size (52.6 MB) exceeds 50 MB free tier limit.
Set MEMVID_API_KEY environment variable.
Get your API key at https://memvid.com/dashboard/api-keys
```

- README 주장: "~1KB per memory, 1년 5MB 이하"
- **실측**: 20KB/memory (소량), ~510KB/memory (100건 이상)
- **Free tier에서 최대 ~100개 메모리만 저장 가능**
- 그 이상은 **유료 API 키 필요** (memvid.com 가입)

#### 쓰기 속도 문제

- 건당 800ms ~ 1.3s — PostToolUse 훅(10초 타임아웃) 안에서는 가능하지만
- 매 도구 호출마다 ~1초 지연 추가 → 체감 성능 저하

### Test 4: 동시 접근 파일 락 — FAIL (데이터 유실)

#### 단일 프로세스 동시 쓰기

```
5개 비동기 쓰기 → 5/5 성공 (파일 내 직렬화)
```

#### 멀티 프로세스 동시 쓰기 (실제 시나리오)

```
3개 OS 프로세스 × 3건 = 9건 쓰기 시도
기대 결과: 21건 (기존 12 + 9)
실제 결과: 19건 → 2건 무음 유실 (에러 없이 성공 보고)
검색 가능: 9건 중 1건만 발견
```

**판정: 우리 환경(동시 다중 세션)에서 데이터 무결성 보장 불가**

### Test 5: 메모리 품질 & 검색 정확도 — PASS

#### ask 정확도: 83% (5/6)

| 쿼리 | 기대 결과 | 판정 |
|------|----------|------|
| "왜 SSE를 선택했나?" | SSE decision | PASS |
| "streaming bug" | epoch guard bugfix | PASS |
| "dark mode color" | slate palette | **FAIL** (WAL 결과 반환) |
| "WAL mode" | SQLite WAL | PASS |
| "재시도 패턴" | orphan/retry | PASS |
| "PM2 environment variable priority" | env 우선순위 | PASS |

#### 한국어 토크나이징: 양호

```
"스트리밍" → 1 hit ✓     "동시성" → 1 hit ✓
"재연결" → 1 hit ✓       "팔레트" → 1 hit ✓
"멀티플렉싱" → 1 hit ✓
```

- 복합 한국어 단어도 잘 검색됨
- 영어-한국어 혼합 쿼리("dark mode color")에서 부정확

---

## 10. 최종 판단 (테스트 기반)

### 종합 평가 (테스트 후 수정)

| 평가 항목 | 테스트 전 | 테스트 후 | 근거 |
|----------|----------|----------|------|
| 기술 완성도 | 7/10 | **4/10** | search 버그, free tier 제한, 용량 문제 |
| 실용성 | 8/10 | **5/10** | ask는 우수하나 쓰기 느림, 유료 전환 필요 |
| 안정성 | 6/10 | **3/10** | 동시 쓰기에서 무음 데이터 유실 |
| 우리 시스템 적합성 | 6/10 | **2/10** | 동시 세션 환경에서 데이터 무결성 미보장 |

### 결론: **도입 보류 (Option C)** 권고

**도입 불가 사유 (3가지 blocking issue):**

1. **Free tier 50MB 제한**: README는 "1년 5MB"라 했지만 실측 100건에서 초과. 실질적으로 **유료 서비스**에 종속됨 (memvid.com API 키 필요)

2. **동시 세션 데이터 유실**: 멀티 프로세스 환경에서 2/9건 쓰기 무음 유실. 에러 없이 성공 보고 후 데이터가 없음. 우리 tunnelingcc는 다중 세션이 기본 → **데이터 무결성 보장 불가**

3. **플러그인 자체 버그**: `mind.ts`의 search가 SDK 반환값(`hits`)을 잘못 참조(`frames`). 핵심 기능인 `/mind search`가 깨져 있음

**추가 우려:**
- 쓰기 속도 800ms/op → 매 도구 호출마다 ~1초 지연
- 메모리당 20~510KB → README 주장(~1KB)과 20~500배 차이
- npm 의존성에 9개 high severity 취약점

### 향후 재검토 조건

다음 조건이 충족되면 재평가:
- [ ] SDK `hits` vs `frames` 반환값 버그 수정
- [ ] Free tier 용량 현실적 수준으로 확대 (또는 정확한 문서화)
- [ ] 멀티 프로세스 쓰기 안전성 보장
- [ ] 쓰기 성능 100ms 이하로 개선

### 대안 검토

현재 우리 시스템의 `auto memory` + `CLAUDE.md` + `workspace/` 구조가 더 적합:
- 마크다운 기반 → 사람이 읽기/편집 가능
- Git diff 가능 → 변경 이력 추적
- 무료, 외부 의존성 없음
- 동시 세션 안전 (파일별 독립)

---

## 참고 자료

- [GitHub - memvid/claude-brain](https://github.com/memvid/claude-brain)
- [GitHub - memvid/memvid](https://github.com/memvid/memvid) (부모 프로젝트)
- [Memvid Documentation](https://docs.memvid.com/)
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference)
