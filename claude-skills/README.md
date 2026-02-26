# Claude Skills — Bundled with Tower

All skills, commands, and agents ship with this repo.
Installed to `~/.claude/` via `./install-skills.sh` (or `bash setup.sh`).

## Skills (20 total)

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
| `swarm` | Three expert perspectives on hard questions |
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

Add your own skills to `claude-skills/skills/your-skill/SKILL.md` and re-run `./install-skills.sh`.
