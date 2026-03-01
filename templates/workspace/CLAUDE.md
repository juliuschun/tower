# {{TEAM_NAME}} — Workspace

This directory is the **team brain** — decisions, docs, memos, and project outputs.
It is *not* a code project. For code-specific rules, see each repo's own CLAUDE.md.

## Role of This Directory

| This workspace | Code project CLAUDE.md |
|---|---|
| Team collaboration rules, doc structure, AI behavior | Build/dev rules for that specific codebase |

## Directory Structure

```
workspace/
├── CLAUDE.md              # ← This file (AI behavior + workspace guide)
├── principles.md          # Team principles
├── memory/MEMORY.md       # Team context (current priorities, structure, rhythm)
├── decisions/             # Decision records (immutable — never delete/modify)
├── docs/                  # Process docs, guides, SOPs
├── notes/                 # Temporary memos, ideas
└── projects/              # (Optional) Per-project outputs
```

## Agent Behavior Rules

### On Session Start

1. **Read `memory/MEMORY.md`** — understand team status and priorities
2. **Know `principles.md`** — especially "Write it down" and "Record the why"
3. **Search `decisions/` and `docs/`** before starting any task — check for prior art

### While Working

- **Decisions → suggest recording**: "Want to record this in `decisions/`?"
- **File naming**: decisions → `YYYY-MM-DD-title.md`, notes → `YYYY-MM-DD.md`
- **`decisions/` files are immutable.** To change a decision, create a new file.
- **Tasks under 15 min: just do them.** The task system is for 30+ min work.

### When Writing Docs

- Markdown. Specific titles ("Apply API cache" ✓, "Performance improvements" ✗)
- Always include the **why**: "We went with A over B because X."
- Assume the reader is smart but not a developer — explain jargon inline.

## Communication Style

When explaining technical decisions or architecture:
- Plain language, everyday analogies
- Simplest explanation first, detail only if asked
- If a technical term is necessary, explain it in one sentence right after

## Cleanup Rhythm

| Frequency | Action |
|---|---|
| **Weekly** | Scan `notes/` → promote anything important to `decisions/` or `docs/` |
| **Monthly** | Review `docs/` — still accurate? |
| **Quarterly** | Update `memory/MEMORY.md` — reprioritize |

## Warnings

- **Never commit `.env`, credentials, or secret files** (check `.gitignore`)
- **Never delete or modify files in `decisions/`** — create a new file instead
- When modifying this CLAUDE.md, note the reason in `decisions/`
