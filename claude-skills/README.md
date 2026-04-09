# Claude Skills — Bundled with Tower

Installed to `~/.claude/` via `./install-skills.sh` (or `bash setup.sh`).

## Skill Distribution

Tower 스킬은 **library 스킬**을 통해 배포됩니다.
이 디렉토리에는 library 스킬만 번들로 포함되어 있고,
나머지 스킬은 설치 후 `/library sync`로 GitHub에서 가져옵니다.

```
setup.sh → install-skills.sh → library 스킬 설치
                                      ↓
                              /library sync → GitHub에서 전체 스킬 풀
```

상세 구조: [`docs/skill-distribution.md`](../docs/skill-distribution.md)

## Bundled: library

| Skill | Description |
|-------|-------------|
| `library` | 스킬 카탈로그 관리 — install, sync, add, use, push, list, search |

설치 후 사용:
- `/library list` — 설치 가능한 스킬 전체 목록
- `/library sync` — 카탈로그의 모든 스킬을 GitHub에서 설치/업데이트

## Available via Library (카탈로그)

### Workflow
| Skill | Description |
|-------|-------------|
| `brainstorming` | Collaborative design before implementation |
| `writing-plans` | Multi-step implementation planning |
| `executing-plans` | Plan execution with review checkpoints |
| `dispatching-parallel-agents` | Parallel task execution |
| `subagent-driven-development` | Multi-agent implementation |
| `finishing-a-development-branch` | Branch completion workflow |
| `using-git-worktrees` | Isolated feature work in git worktrees |
| `using-superpowers` | Skill discovery and usage |

### Quality
| Skill | Description |
|-------|-------------|
| `test-driven-development` | TDD workflow |
| `systematic-debugging` | Bug investigation methodology |
| `receiving-code-review` | Handle incoming code review feedback |
| `requesting-code-review` | Request and verify code reviews |
| `verification-before-completion` | Pre-commit verification checks |
| `writing-skills` | Create and test new skills |

### Domain
| Skill | Description |
|-------|-------------|
| `ready` | Session resume — shows recent work and todos |
| `review-global` | Periodic situation report across all projects |
| `tech-lead` | Adaptive expert judgment for architectural decisions |
| `ui-ux-pro-max` | UI/UX design intelligence (50 styles, 21 palettes, 50 font pairings) |
| `humanize` | Rewrite AI text to reduce detection (requires Pangram API) |

## Commands
| Command | Description |
|---------|-------------|
| `prime` | Gain general understanding of a codebase |
| `gdrive` | Google Drive integration (requires setup) |
| `gmail` | Gmail integration (requires setup) |

## Agents
| Agent | Description |
|-------|-------------|
| `rapid-web-researcher` | Fast web research using Haiku model |

## Customization

- **카탈로그에 스킬 추가**: `/library add <details>` → `library.yaml`에 등록
- **로컬 스킬 직접 추가**: `claude-skills/skills/your-skill/SKILL.md` 생성 후 `./install-skills.sh`
- **스킬 배포 구조 상세**: [`docs/skill-distribution.md`](../docs/skill-distribution.md)
