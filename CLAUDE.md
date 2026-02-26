# Project: Tower

AI command center for your team. Stack your own tower of AI and systems.

## Quick Start
- Dev: `npm run dev` (Vite HMR + tsx watch)
- Frontend changes → instant, Backend changes → ~2s auto-restart
- Ports: :32354 (Vite frontend) → proxy → :32355 (Backend)

## Key Conventions
- Document learnings in `codify.md`
- Environment variables → `.env` (copy from `.env.example`)

## Workspace

Each deployment has a workspace directory (set via `WORKSPACE_ROOT` env var).

### Recommended Structure
```
workspace/
├── principles.md          # Team principles
├── memory/MEMORY.md       # Team context (keep up to date)
├── decisions/             # Decision records (immutable, one file = one decision)
├── docs/                  # Process docs, guides
└── notes/                 # Temporary memos, ideas
```

Run `bash setup.sh` to bootstrap this structure automatically.

### Claude Behavior Rules

**Context**: Read `workspace/memory/MEMORY.md` at conversation start for team context.

**Documentation**: When decisions are made, suggest recording them.
- Decision record → `decisions/YYYY-MM-DD-title.md` (use `.template.md` format)
- Process/guide → `docs/title.md`
- Temporary memo → `notes/YYYY-MM-DD.md`

**Decision records**: Never delete files in decisions/. To change a decision, create a new file.

**Search**: When asked about past decisions or docs, search decisions/ and docs/ and answer with context.

**Gentle reminders**:
- Missing rationale: "Recording the reason will help later" (principle 2)
- Vague title: "A specific title makes it easier to find" (principle 3)
