# review-global

Cross-project situation reports for Claude Code. Scans session transcripts, git activity, project files, and running processes to produce a timestamped review of what's active, stalled, and needs attention.

## What it does

Spawns a Haiku subagent in the background that runs 4 scans:

1. **Session transcripts** — reads JSONL session files from `~/.claude/projects/`, extracts user messages, groups by project
2. **Git activity** — checks recent commits across all repos in your dev root
3. **Key files** — reads CLAUDE.md, plan.md, TODO, codify.md from active projects
4. **Previous review** — compares with last review to show trajectory

Produces a standalone markdown report at `~/.claude/memory/reviews/{date}_{time}.md`.

## Install

### Via marketplace (recommended)

```bash
# Add the marketplace first (one-time)
claude plugin marketplace add juliuschun/claude-marketplace

# Install this plugin
claude plugin install review-global@julius-marketplace
```

### Standalone (manual)

```bash
git clone https://github.com/juliuschun/skills-review.git ~/.claude/skills/review-global
```

## Usage

```
/review-global              # Standard background review
/review-global --deep       # Include stale projects (14+ days)
/review-global --compare    # Compare last 3 reviews
/review-global project-name # Deep review of one project
```

## Output

Each run creates a timestamped file:

```
~/.claude/memory/reviews/
  2026-02-18_0950.md
  2026-02-18_1405.md
  2026-02-19_0830.md
```

Reports include:
- Project categorization (active / stalled / new)
- Session message excerpts (what you were actually asking about)
- Git commit activity vs session activity (drift detection)
- Running process inventory (zombie flagging)
- Cross-project patterns and attention items

## Structure

```
.claude-plugin/
  plugin.json            # Plugin manifest
  marketplace.json       # Marketplace listing
SKILL.md                 # Skill definition
scripts/
  scan_sessions.py       # Session transcript scanner
README.md
```

## Requirements

- Python 3 (stdlib only — no pip dependencies)
- Claude Code with Task tool support (for Haiku subagent)
- `~/.claude/projects/` must exist (created automatically by Claude Code)

## License

MIT
