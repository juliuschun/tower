# Kanban Agent Board — Design Document

**Date**: 2026-02-25
**Status**: Approved

## Overview

3-column Kanban board (Todo → In Progress → Done) integrated into Claude Desk.
When a user drags a card to "In Progress", an AI agent session spawns automatically
and executes the task through a self-directed workflow (research → plan → implement → test).

## Key Decisions

- **3-column fixed layout**: Todo / In Progress / Done. Agent handles internal workflow stages autonomously.
- **Human-in-the-loop**: User drags card to In Progress (gate). Agent runs autonomously after that. Done is auto-moved on completion.
- **Observation model**: Card surface shows summary badge + progress. Click card → full ChatPanel streaming view.
- **Concurrency**: Up to ~10 simultaneous agent sessions (configurable).
- **Card input**: Title + Description + CWD (working directory).
- **Chat relationship**: One-way link. Click card → navigates to session ChatPanel. Sidebar shows kanban tasks with distinct icon.

## UI Structure

```
┌─ Header ──────────────────────────────────────────────┐
│  [Chat] [Kanban]  ← view toggle tabs                  │
├─ Sidebar ─┬─ Main Area ──────────────────────────────┤
│ Sessions  │  ┌─ Todo ──┐ ┌─ Progress ┐ ┌─ Done ───┐ │
│ (🔵chat)  │  │ Card A  │ │ Card C ⟳  │ │ Card E ✓ │ │
│ (🟢kanban)│  │ Card B  │ │  78% ···  │ │ Card F ✓ │ │
│           │  │ [+ New] │ │           │ │          │ │
│           │  └─────────┘ └───────────┘ └──────────┘ │
└───────────┴──────────────────────────────────────────┘
```

- Header: Chat / Kanban view toggle
- Sidebar: Kanban tasks shown with green icon (🟢) vs chat sessions (🔵)
- Card surface: title + status badge + progress + one-line stage summary
- Card click → ChatPanel with live streaming of that session

## Card Lifecycle

```
[User] Creates card (title + description + CWD)
    ↓
  Todo column (waiting)
    ↓
[User] Drags to In Progress → agent session created & auto-executes
    ↓
  Agent autonomous workflow:
    Research → Plan → Implement → Test → Self-verify
    (each stage summary updates card in real-time)
    ↓
  On completion → auto-move to Done (or show error badge on failure)
```

## Agent Execution Model

- 1 card = 1 session (reuse existing executeQuery())
- Max concurrent: ~10 (configurable via settings)
- Agent system prompt instructs step-by-step execution with stage summaries
- Cancel: drag card back to Todo → abortSession()
- Card moved back to Todo on failure, with error summary preserved

## Data Model

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,          -- uuid
  title TEXT NOT NULL,
  description TEXT,
  cwd TEXT NOT NULL,
  status TEXT DEFAULT 'todo',   -- todo | in_progress | done | failed
  session_id TEXT,              -- FK → sessions.id (created when moved to in_progress)
  sort_order INTEGER DEFAULT 0,
  progress_summary TEXT,        -- latest stage summary (JSON array)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
```

## WebSocket Messages

| Direction | Type | Payload | When |
|-----------|------|---------|------|
| Client→Server | `task_create` | { title, description, cwd } | New card |
| Client→Server | `task_spawn` | { taskId } | Card dragged to In Progress |
| Client→Server | `task_abort` | { taskId } | Card dragged back to Todo |
| Server→Client | `task_update` | { taskId, status, progress_summary } | Stage progress |
| Server→Client | `task_done` | { taskId, sessionId } | Agent completed |
| Server→Client | `task_failed` | { taskId, error } | Agent failed |

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id` | Update task (reorder, edit) |
| DELETE | `/api/tasks/:id` | Delete task |

## Implementation Notes

- Reuse `executeQuery()` from claude-sdk.ts for agent sessions
- Reuse `ChatPanel` for task observation (card click → switch to session view)
- New Zustand store: `kanban-store.ts`
- New components: `KanbanBoard.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx`, `NewTaskModal.tsx`
- Drag-and-drop: use `@dnd-kit/core` (lightweight, React-friendly)
- Agent prompt template should enforce structured stage reporting
