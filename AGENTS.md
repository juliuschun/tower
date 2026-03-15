# Project: Tower

AI command center for your team. Stack your own tower of AI and systems.

## Quick Start
- Dev: `npm run dev` (Vite HMR + tsx watch)
- Frontend changes → instant, Backend changes → ~2s auto-restart
- Ports: :32354 (Vite frontend) → proxy → :32355 (Backend)

## Key Conventions
- Document learnings in `codify.md`
- Environment variables → `.env` (copy from `.env.example`)

## ⚠️ Dev Server Warnings
- **`npm run dev` is a single-instance command.** Running it multiple times (e.g., via `nohup npm run dev &` in different sessions) stacks zombie `tsx watch` processes that fight over port 32355 → streaming cuts off mid-response.
- Before starting, check: `pgrep -fa "tsx.*backend"` — if more than one, kill extras first.
- **Do NOT restart the backend while working on a task.** Restarting kills running tasks and loses context. Finish all current work first, then restart if needed.
- Full server ops guide → `devserver.md`
- Full warning history → `codify.md` (search "좀비" or "zombie")

## Workspace

Each deployment has a workspace directory (set via `WORKSPACE_ROOT` env var).

### Recommended Structure
```
workspace/
├── principles.md          # Team principles
├── memory/MEMORY.md       # Team context (keep up to date)
├── decisions/             # Decision records (immutable, one file = one decision)
├── docs/                  # Process docs, guides
├── notes/                 # Temporary memos, ideas
└── projects/              # Project folders (auto-created by Tower)
    ├── etf-research/      # Each project gets its own folder
    │   └── CLAUDE.md      # Project context — SDK reads this automatically
    ├── marketing-plan/
    │   └── CLAUDE.md
    └── ...
```

Run `bash setup.sh` to bootstrap this structure automatically.

### Projects

Projects group related chat sessions and provide context via CLAUDE.md files.

- Each project has a folder under `workspace/projects/` (auto-created on project creation)
- The `CLAUDE.md` inside defines project-specific instructions for Claude
- New chats created in a project automatically work in that folder (cwd)
- Codebase projects can point to external paths (e.g., `~/tower/`) instead
- Edit `CLAUDE.md` to customize what Claude knows about each project

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

## UI Navigation

Sidebar is the single navigation point. No header view toggle.

| Sidebar Tab | Internal `activeView` | Center Panel | Description |
|-------------|----------------------|--------------|-------------|
| **Sessions** | `chat` | `ChatPanel` | 1:1 AI conversation |
| **Channel** | `rooms` | `RoomPanel` | Team chat channels |
| **Files** | (no view change) | (file tree) | File browser |

Header has a **Task board icon** (kanban grid) that toggles `activeView = 'kanban'`.
Sidebar footer: Pins, History (toggle views), Settings.

## Dynamic Visual — 시각화 포맷

Tower 채팅에서 AI 응답에 다음 코드블록을 사용하면 자동 렌더링됩니다.
Sessions(1:1 대화)과 Rooms(팀 채널 AI 메시지) 양쪽에서 동작합니다.

| 포맷 | 코드블록 | 설명 |
|------|---------|------|
| 다이어그램 | ` ```mermaid ` | flowchart, sequence, class, ER 등 |
| 차트 | ` ```chart ` | JSON: `{ "type": "bar", "data": [...], "xKey": "...", "yKey": "..." }` |
| 수식 | `$$...$$` | LaTeX 블록 수식. **인라인 `$`는 비활성** (금융 달러 충돌 방지) |
| 데이터 테이블 | ` ```datatable ` | JSON: `{ "columns": [...], "data": [[...]] }` (Phase 3) |
| 타임라인 | ` ```timeline ` | JSON: `{ "items": [{ "date", "title", "status" }] }` (Phase 5) |
| HTML 샌드박스 | ` ```html-sandbox ` | iframe sandbox 실행 (Phase 4) |
| 지도 | ` ```map ` | Leaflet 기반 마커/폴리곤 (Phase 6) |

**차트 type**: `bar`, `line`, `area`, `pie`, `scatter`, `radar`, `composed`

**핵심 동작**:
- 코드블록이 닫히면 즉시 렌더 (스트리밍 중에도)
- JSON 파싱 실패 시 원본 코드블록 폴백 (크래시 없음)
- `React.lazy` 코드 스플릿 — 사용 안 하는 시각화는 로드 안 됨
- 인프라: `shared/RichContent.tsx` → `splitDynamicBlocks` → 블록별 컴포넌트

**PRD**: `docs/plans/dynamic-visual.md`

## Communication Style

When explaining architecture, systems, or technical decisions — use plain language and everyday analogies, as if explaining to a smart non-developer. Avoid jargon. If a technical term is necessary, explain it in one sentence right after. Default to the simplest possible explanation first, then add detail only if asked.
