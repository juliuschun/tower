# Skill Distribution Architecture

Tower의 스킬이 어떻게 배포되고 관리되는지 설명합니다.

## 핵심 구조

Tower 스킬은 **DB가 소스 오브 트루스**이고, 파일시스템은 캐시입니다.

```
GitHub (juliuschun/internal-skills)     ← 스킬 원본
        │
        ▼
  /library sync                         ← library 스킬이 GitHub → 로컬로 풀
        │
        ▼
  ~/.claude/skills/                     ← Claude SDK 네이티브 경로
        │
        ▼  (서버 시작 시)
  seedBundledSkills()                   ← 파일 → DB 시딩
  seedPluginSkills()                    ← 플러그인 마켓플레이스 → DB 시딩
        │
        ▼
  PostgreSQL skill_registry             ← 소스 오브 트루스
        │
        ▼
  syncCompanySkillsToFs()              ← DB → data/skills/company/ (캐시)
```

## 스킬 배포 방법 (fork 사용자)

### 1단계: 설치

`bash setup.sh` → `install-skills.sh` 실행 시 `claude-skills/skills/` 에 번들된
**library 스킬**이 `~/.claude/skills/library/`에 설치됩니다.

### 2단계: 스킬 카탈로그 동기화

```
/library sync
```

library 스킬의 `library.yaml`에 정의된 모든 스킬을 GitHub에서 풀합니다.
프로필별로 필요한 스킬만 설치할 수도 있습니다.

### 3단계: 서버 재시작

서버가 시작되면 `seedBundledSkills()`가 `~/.claude/skills/`를 스캔하여
DB에 자동 시딩합니다. UI에서도 바로 사용 가능합니다.

## 프로필 시스템

`library.yaml`에 태그 기반 프로필이 정의되어 있습니다:

| 프로필 | 태그 | 용도 |
|--------|------|------|
| `core` | core | 모든 고객 필수 스킬 |
| `customer-basic` | core, business, docs | 비개발 고객용 |
| `customer-full` | core, business, docs, dev | 기술 고객용 |
| `internal` | 전체 | Moat AI 내부 전용 |

## 3-Tier 스코프

| 스코프 | 범위 | 관리 |
|--------|------|------|
| **Company** | 모든 사용자 | admin만 생성/수정 |
| **Project** | 프로젝트 멤버 | 멤버가 관리 |
| **Personal** | 본인만 | 사용자 자유 |

## 파일 경로 정리

| 경로 | 역할 | Git 추적 |
|------|------|----------|
| `claude-skills/skills/` | 번들 스킬 (library만) | ✅ |
| `~/.claude/skills/` | Claude SDK 네이티브 경로 | ❌ |
| `data/skills/company/` | DB → 파일 캐시 (Pi SDK용) | ❌ (.gitignore) |
| `~/.claude/plugins/` | 마켓플레이스 캐시 | ❌ |

## 스킬 업데이트 흐름

스킬 내용을 수정했을 때:

1. **GitHub에 push** → `juliuschun/internal-skills` 레포
2. **각 서버에서** `/library sync` 실행 → 최신 버전 풀
3. **서버 재시작** → DB 자동 시딩

또는 Tower UI에서 직접 스킬 내용을 수정하면 DB에 바로 반영됩니다.

## 관련 코드

- `packages/backend/services/skill-registry.ts` — 시딩, 동기화, CRUD
- `packages/backend/routes/api.ts` — `/api/skills` REST 엔드포인트
- `packages/backend/index.ts` — 서버 시작 시 시딩 호출 (line ~117)
- `install-skills.sh` — 번들 스킬 설치 스크립트
- `claude-skills/skills/library/` — library 스킬 번들
