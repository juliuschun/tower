# {{TEAM_NAME}} — Workspace

This directory is the **team brain** — decisions, docs, and project outputs.
It is *not* a code project. For code-specific rules, see each repo's own CLAUDE.md.

## Directory Structure

```
workspace/
├── CLAUDE.md              # ← This file (AI behavior + workspace guide)
├── principles.md          # Team principles
├── decisions/             # Decision records (immutable — never delete/modify)
├── docs/                  # Process docs, guides, SOPs
└── projects/              # Project folders (Tower auto-creates)
```

## Project-Centric Architecture

**Project is the center of everything.** A project groups:
- Channels (team chat)
- Sessions (AI work, private or shared)
- Files (project folder = shared drive)
- AI context (CLAUDE.md per project)

Inviting someone to a project grants access to all of the above.

## Agent Behavior Rules

### On Session Start

1. **Know `principles.md`** — especially "Write it down" and "Record the why"
2. **Search `decisions/` and `docs/`** before starting any task — check for prior art

### While Working

- **Decisions → suggest recording**: "Want to record this in `decisions/`?"
- **File naming**: decisions → `YYYY-MM-DD-title.md`
- **`decisions/` files are immutable.** To change a decision, create a new file.
- **Tasks under 15 min: just do them.** The task system is for 30+ min work.

### When Writing Docs

- Markdown. Specific titles ("Apply API cache" O, "Performance improvements" X)
- Always include the **why**: "We went with A over B because X."
- Assume the reader is smart but not a developer — explain jargon inline.

## Communication Style

When explaining technical decisions or architecture:
- Plain language, everyday analogies
- Simplest explanation first, detail only if asked
- If a technical term is necessary, explain it in one sentence right after

## Warnings

- **Never commit `.env`, credentials, or secret files** (check `.gitignore`)
- Modifying this file requires team discussion and a `decisions/` record
