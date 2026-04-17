# Skill Distribution Architecture

Tower의 스킬이 어떻게 배포·관리되는지 설명합니다.

## 핵심 구조

Tower 스킬은 **DB가 소스 오브 트루스**이고, 파일시스템은 캐시입니다.
스킬 원본은 **library 카탈로그**(`~/.claude/skills/library/library.yaml`)가 관리하고,
관리형 고객 VM으로는 **`deploy-profile.sh`** 가 rsync로 배포합니다.

```
~/.claude/skills/library/library.yaml     ← 카탈로그 (소스/버전/태그/프로필)
        │
        │  /library sync 또는 deploy-profile.sh
        ▼
  ~/.claude/skills/                       ← Claude SDK 네이티브 경로
        │
        ▼  (서버 시작 시)
  seedBundledSkills()                     ← 파일 → DB 시딩
  seedPluginSkills()                      ← 플러그인 마켓플레이스 → DB 시딩
        │
        ▼
  PostgreSQL skill_registry               ← 소스 오브 트루스
        │
        ▼
  syncCompanySkillsToFs()                 ← DB → data/skills/company/ (캐시)
```

## 배포 경로

### Tower 운영자 (Moat AI) → 관리형 고객 VM

중앙 서버(`~/.claude/skills/`)의 스킬을 프로필 단위로 rsync 합니다.

```bash
# 프로필 미리보기
bash ~/.claude/skills/library/deploy-profile.sh --list

# dry-run
bash ~/.claude/skills/library/deploy-profile.sh --dry-run managed

# 고객 레지스트리 기반 배포 (library.yaml → customers: 섹션)
bash ~/.claude/skills/library/deploy-profile.sh --customer okusystem

# 차이 확인 (managed vs custom 구분)
bash ~/.claude/skills/library/deploy-profile.sh --diff okusystem
```

배포 시 `~/.claude/skills/.managed-manifest.json` 도 함께 심어,
**관리형 스킬**과 **고객이 직접 만든 커스텀 스킬**을 구분합니다.

### 일반 사용자

Tower 채팅에서 `/library sync` → library.yaml의 source 정보대로
각 스킬을 로컬 혹은 GitHub에서 풉니다.

## 프로필 시스템 (2026-04-14 재설계)

`library.yaml`에 태그 기반 프로필이 정의되어 있습니다:

| 프로필        | 포함 태그                                    | 용도                                    |
|---------------|----------------------------------------------|-----------------------------------------|
| `standalone`  | core + business + docs                       | 고객 자체 운영 (인프라 의존 없음)       |
| `managed`     | standalone + browser + presentation          | 우리가 운영하는 고객 VM (Docker/Neko)   |
| `full`        | 전체                                         | Moat AI 내부                            |

## 3-Tier 스코프

| 스코프     | 범위            | 관리                 |
|------------|-----------------|----------------------|
| **Company**| 모든 사용자     | admin만 생성/수정    |
| **Project**| 프로젝트 멤버   | 멤버가 관리          |
| **Personal**| 본인만         | 사용자 자유          |

## 파일 경로 정리

| 경로                         | 역할                              | Git 추적         |
|------------------------------|-----------------------------------|------------------|
| `~/.claude/skills/`          | Claude SDK 네이티브 경로          | ❌               |
| `~/.claude/skills/library/`  | 카탈로그 (git repo)               | 별도 repo         |
| `data/skills/company/`       | DB → 파일 캐시 (Pi SDK용)         | ❌ (.gitignore)  |
| `~/.claude/plugins/`         | 마켓플레이스 캐시                 | ❌               |

## 스킬 업데이트 흐름

1. 스킬 수정 → library 소스(로컬 혹은 GitHub)에 반영
2. `library.yaml`에서 해당 스킬 `version` 증가
3. 고객 VM: `deploy-profile.sh --customer <name>` → 변경분만 rsync
4. 서버 재시작 → DB 자동 시딩
5. `/fleet skills <customer>` 로 diff 재확인

## 관련 코드/문서

- `packages/backend/services/skill-registry.ts` — 시딩, 동기화, CRUD
- `packages/backend/routes/api.ts` — `/api/skills` REST 엔드포인트
- `packages/backend/index.ts` — 서버 시작 시 시딩 호출
- `~/.claude/skills/library/deploy-profile.sh` — 프로필 배포 스크립트
- `~/.claude/skills/library/library.yaml` — 카탈로그 + 고객 레지스트리
- `~/.claude/skills/fleet/SKILL.md` — 고객 VM 운영 스킬
