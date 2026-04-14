# Tower 컨텍스트 아키텍처

Tower에서 Claude가 받는 컨텍스트는 5개 레이어가 누적(append)됩니다.

## 5-Layer Context Stack

```
┌─────────────────────────────────────────────────┐
│ ① 시스템 프롬프트 (system-prompt.ts)             │  ← 모든 세션, 하드코딩
│    팀 기본 프롬프트(DB) + Tower 환경 + 역할       │
│    + Visualization 18종 포맷 가이드               │
├─────────────────────────────────────────────────┤
│ ② 글로벌 CLAUDE.md (~/.claude/CLAUDE.md)         │  ← 모든 프로젝트
│    ASCII 규칙, 링크 규칙, dev 경고                │
├─────────────────────────────────────────────────┤
│ ③ 프로젝트 CLAUDE.md (cwd의 CLAUDE.md)           │  ← cwd 기준 자동 로딩
│    tower/ 또는 workspace/ 또는 프로젝트별         │
├─────────────────────────────────────────────────┤
│ ④ 스킬 descriptions (~/.claude/skills/*)         │  ← 전체 목록 항상 로딩
│    description만 로딩, 트리거 시 SKILL.md body    │
├─────────────────────────────────────────────────┤
│ ⑤ 메모리 (MEMORY.md + hooks)                     │  ← 프로젝트별 자동
│    학습 패턴, 세션 히스토리                        │
└─────────────────────────────────────────────────┘
```

## 레이어별 상세

### ① 시스템 프롬프트

- **파일**: `packages/backend/services/system-prompt.ts`
- **조립**: `buildSystemPrompt()` 함수가 아래를 결합:
  - DB `system_prompts.default` (Admin > Settings에서 편집 가능)
  - Tower 환경 설명 (멀티유저, workspace 공유 등)
  - 유저 역할 컨텍스트 (admin/operator/member/viewer)
  - Visualization 포맷 가이드 (기본 7 + 확장 11 = 18종)
- **적용**: Claude Engine, Pi Engine 양쪽 동일하게 주입
- **변경**: 코드 수정 → dev 자동 재시작, prod는 배포 필요

### ② 글로벌 CLAUDE.md

- **파일**: `~/.claude/CLAUDE.md`
- **내용**: ASCII 도표 규칙, 링크 규칙, dev server 경고
- **적용**: SDK `settingSources: ['user']`로 자동 로딩
- **변경**: 파일 수정 즉시 적용 (다음 세션부터)

### ③ 프로젝트 CLAUDE.md

- **파일**: cwd에 있는 `CLAUDE.md` (또는 `AGENTS.md` 심링크)
- **주요 파일들**:
  - `tower/CLAUDE.md` → `tower/AGENTS.md` 심링크 (Tower 개발용)
  - `workspace/CLAUDE.md` (일반 업무용)
  - `workspace/projects/*/CLAUDE.md` (프로젝트별)
  - `tower/templates/workspace/CLAUDE.md` (신규 고객 배포 템플릿)
- **적용**: SDK `settingSources: ['project']`로 자동 로딩
- **변경**: 파일 수정 즉시 적용

### ④ 스킬

- **위치**: `~/.claude/skills/*/SKILL.md`
- **로딩**: description만 항상 로딩 (트리거 판단용), 본문은 트리거 시 로딩
- **카탈로그**: `~/.claude/skills/library/library.yaml`
- **배포**: `deploy-profile.sh`로 고객 VM에 프로필별 rsync
- **변경**: 파일 수정 즉시 적용

### ⑤ 메모리

- **자동 메모리**: `~/.claude/projects/.../memory/MEMORY.md`
- **hooks DB**: `~/.claude/memory.db` (SQLite FTS5)
- **세션 요약**: hooks가 세션 종료 시 자동 캡처
- **변경**: hooks가 자동 관리, 수동 편집도 가능
