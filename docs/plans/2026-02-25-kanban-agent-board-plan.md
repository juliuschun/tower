# Kanban Agent Board — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Kanban board view to Claude Desk where cards in "In Progress" automatically spawn AI agent sessions that execute tasks autonomously.

**Architecture:** 3-column Kanban (Todo → In Progress → Done) alongside existing Chat view. Each card maps 1:1 to a Claude SDK session. Moving a card to In Progress triggers `executeQuery()` in background. Real-time progress via existing WS broadcast. Card click navigates to session's ChatPanel for live observation.

**Tech Stack:** React 18 + Zustand + @dnd-kit/core + @dnd-kit/sortable (new dep), Express REST + WS, better-sqlite3, @anthropic-ai/claude-agent-sdk

---

## Phase 1: Backend Foundation

### Task 1: Install @dnd-kit dependencies

**Step 1: Install packages**

Run: `cd /home/enterpriseai/claude-desk && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

**Step 2: Verify installation**

Run: `ls node_modules/@dnd-kit/core/package.json && echo "OK"`
Expected: path printed + "OK"

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit/core, sortable, utilities for kanban drag-and-drop"
```

---

### Task 2: DB schema — tasks table

**Files:**
- Modify: `backend/db/schema.ts:82` (after existing tables, add migration)

**Step 1: Add tasks table migration**

In `backend/db/schema.ts`, after the `sessionMigrations` block (line 118), add:

```typescript
    // Kanban tasks table
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        cwd TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        session_id TEXT,
        sort_order INTEGER DEFAULT 0,
        progress_summary TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        user_id INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    `);
```

**Step 2: Verify server starts without error**

Run: `cd /home/enterpriseai/claude-desk && timeout 5 npx tsx backend/index.ts 2>&1 || true`
Expected: Server starts, no SQL errors. (Will timeout — that's fine.)

**Step 3: Commit**

```bash
git add backend/db/schema.ts
git commit -m "feat(kanban): add tasks table to DB schema"
```

---

### Task 3: Task manager service (CRUD)

**Files:**
- Create: `backend/services/task-manager.ts`

**Step 1: Create the service**

```typescript
import { getDb } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';

export interface TaskMeta {
  id: string;
  title: string;
  description: string;
  cwd: string;
  status: 'todo' | 'in_progress' | 'done' | 'failed';
  sessionId: string | null;
  sortOrder: number;
  progressSummary: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  userId: number | null;
}

function mapRow(row: any): TaskMeta {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    cwd: row.cwd,
    status: row.status,
    sessionId: row.session_id,
    sortOrder: row.sort_order,
    progressSummary: JSON.parse(row.progress_summary || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    userId: row.user_id,
  };
}

export function createTask(title: string, description: string, cwd: string, userId?: number): TaskMeta {
  const db = getDb();
  const id = uuidv4();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?').get('todo') as any;
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  db.prepare(`
    INSERT INTO tasks (id, title, description, cwd, status, sort_order, user_id)
    VALUES (?, ?, ?, ?, 'todo', ?, ?)
  `).run(id, title, description, cwd, sortOrder, userId ?? null);

  return getTask(id)!;
}

export function getTasks(userId?: number): TaskMeta[] {
  const db = getDb();
  const rows = userId
    ? db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY status, sort_order').all(userId)
    : db.prepare('SELECT * FROM tasks ORDER BY status, sort_order').all();
  return rows.map(mapRow);
}

export function getTask(id: string): TaskMeta | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? mapRow(row) : null;
}

export function updateTask(id: string, updates: Partial<Pick<TaskMeta, 'title' | 'description' | 'cwd' | 'status' | 'sessionId' | 'sortOrder' | 'progressSummary' | 'completedAt'>>): TaskMeta | null {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.cwd !== undefined) { fields.push('cwd = ?'); values.push(updates.cwd); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.sessionId !== undefined) { fields.push('session_id = ?'); values.push(updates.sessionId); }
  if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(updates.sortOrder); }
  if (updates.progressSummary !== undefined) { fields.push('progress_summary = ?'); values.push(JSON.stringify(updates.progressSummary)); }
  if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }

  if (fields.length === 0) return getTask(id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

export function reorderTasks(taskIds: string[], status: string): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE tasks SET sort_order = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const transaction = db.transaction(() => {
    taskIds.forEach((id, index) => {
      stmt.run(index, status, id);
    });
  });
  transaction();
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /home/enterpriseai/claude-desk && npx tsc --noEmit backend/services/task-manager.ts 2>&1 | head -20`

**Step 3: Commit**

```bash
git add backend/services/task-manager.ts
git commit -m "feat(kanban): add task-manager service with CRUD operations"
```

---

### Task 4: REST API — /api/tasks endpoints

**Files:**
- Modify: `backend/routes/api.ts` (add after existing endpoints, before `export default`)

**Step 1: Add task REST endpoints**

At the top of `api.ts`, add import:
```typescript
import { createTask, getTasks, getTask, updateTask, deleteTask, reorderTasks } from '../services/task-manager.js';
```

Before `export default router;`, add:

```typescript
// ── Kanban Tasks ──────────────────────────────────────────
router.get('/tasks', requireAuth, (req, res) => {
  try {
    const tasks = getTasks((req as any).user?.id);
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', requireAuth, (req, res) => {
  try {
    const { title, description, cwd } = req.body;
    if (!title || !cwd) return res.status(400).json({ error: 'title and cwd required' });
    const task = createTask(title, description || '', cwd, (req as any).user?.id);
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/tasks/:id', requireAuth, (req, res) => {
  try {
    const task = updateTask(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tasks/:id', requireAuth, (req, res) => {
  try {
    const ok = deleteTask(req.params.id);
    if (!ok) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/reorder', requireAuth, (req, res) => {
  try {
    const { taskIds, status } = req.body;
    if (!taskIds || !status) return res.status(400).json({ error: 'taskIds and status required' });
    reorderTasks(taskIds, status);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Verify server starts**

Run: `cd /home/enterpriseai/claude-desk && timeout 5 npx tsx backend/index.ts 2>&1 || true`

**Step 3: Commit**

```bash
git add backend/routes/api.ts
git commit -m "feat(kanban): add REST API endpoints for task CRUD"
```

---

### Task 5: Task runner service — agent execution engine

**Files:**
- Create: `backend/services/task-runner.ts`

**Step 1: Create the task runner**

This service spawns agent sessions for kanban tasks and tracks progress.

```typescript
import { executeQuery, abortSession, getActiveSessionCount } from './claude-sdk.js';
import { createSession, updateSession } from './session-manager.js';
import { updateTask, getTask } from './task-manager.js';
import { saveMessage } from './message-store.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_CONCURRENT_TASKS = 10;
const runningTasks = new Map<string, { sessionId: string; aborted: boolean }>();

type BroadcastFn = (type: string, data: any) => void;

function buildTaskPrompt(title: string, description: string): string {
  return `# Task: ${title}

${description}

## Instructions
You are an autonomous agent executing a kanban task. Work through these stages:
1. **Research** — Understand the problem, read relevant files, gather context
2. **Plan** — Outline your approach briefly
3. **Implement** — Make the necessary changes
4. **Verify** — Run tests or verify your changes work correctly

At the start of each stage, output a single line: \`[STAGE: StageName]\` (e.g., \`[STAGE: Research]\`)
When you complete the entire task, output: \`[TASK COMPLETE]\`
If you encounter an unrecoverable error, output: \`[TASK FAILED: reason]\`

Work autonomously. Do not ask questions — make reasonable decisions and proceed.`;
}

export async function spawnTask(
  taskId: string,
  broadcastToAll: BroadcastFn,
  userId?: number
): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'todo' && task.status !== 'failed') throw new Error(`Task status is ${task.status}, expected todo or failed`);

  // Check concurrency limit
  if (runningTasks.size >= MAX_CONCURRENT_TASKS) {
    throw new Error(`Max concurrent tasks (${MAX_CONCURRENT_TASKS}) reached`);
  }

  // Create a session for this task
  const session = createSession(`🟢 ${task.title}`, task.cwd, userId);
  const sessionId = session.id;

  // Update task to in_progress
  updateTask(taskId, {
    status: 'in_progress',
    sessionId,
    progressSummary: ['Starting task...'],
  });

  runningTasks.set(taskId, { sessionId, aborted: false });

  broadcastToAll('task_update', {
    taskId,
    status: 'in_progress',
    sessionId,
    progressSummary: ['Starting task...'],
  });

  // Run agent in background (non-blocking)
  runTaskAgent(taskId, sessionId, task.title, task.description, task.cwd, broadcastToAll)
    .catch((err) => {
      console.error(`[task-runner] Task ${taskId} error:`, err.message);
    });
}

async function runTaskAgent(
  taskId: string,
  sessionId: string,
  title: string,
  description: string,
  cwd: string,
  broadcastToAll: BroadcastFn
): Promise<void> {
  const prompt = buildTaskPrompt(title, description);
  const progressStages: string[] = ['Starting task...'];
  let claudeSessionId: string | undefined;
  let turnCount = 0;
  let lastSummary = '';

  try {
    const generator = executeQuery(sessionId, prompt, {
      cwd,
      permissionMode: 'bypassPermissions',
      model: 'claude-sonnet-4-6',
    });

    for await (const msg of generator) {
      const running = runningTasks.get(taskId);
      if (!running || running.aborted) break;

      // Track claude session ID
      if (msg.session_id) {
        claudeSessionId = msg.session_id;
      }

      // Save messages to DB (same as handleChat)
      if (msg.type === 'assistant' && msg.message) {
        const content = JSON.stringify(msg.message.content || []);
        const msgId = (msg.message as any).uuid || uuidv4();
        saveMessage(msgId, sessionId, 'assistant', content);
        turnCount++;

        // Extract progress from text blocks
        const textBlocks = (msg.message.content || []).filter((b: any) => b.type === 'text');
        for (const block of textBlocks) {
          const text = block.text || '';

          // Detect stage markers
          const stageMatch = text.match(/\[STAGE:\s*(.+?)\]/);
          if (stageMatch) {
            const stage = stageMatch[1];
            if (!progressStages.includes(stage)) {
              progressStages.push(stage);
              updateTask(taskId, { progressSummary: progressStages });
              broadcastToAll('task_update', {
                taskId,
                status: 'in_progress',
                progressSummary: progressStages,
              });
            }
          }

          // Detect completion
          if (text.includes('[TASK COMPLETE]')) {
            lastSummary = 'Completed successfully';
          }

          // Detect failure
          const failMatch = text.match(/\[TASK FAILED:\s*(.+?)\]/);
          if (failMatch) {
            lastSummary = failMatch[1];
          }

          // Keep last meaningful text as summary
          if (text.trim().length > 10 && !text.startsWith('[')) {
            lastSummary = text.trim().slice(0, 200);
          }
        }

        // Broadcast sdk_message to anyone viewing this session
        broadcastToAll('task_sdk_message', {
          taskId,
          sessionId,
          sdkMessage: msg,
        });
      }
    }

    // Task completed
    const running = runningTasks.get(taskId);
    const wasAborted = running?.aborted;
    runningTasks.delete(taskId);

    if (wasAborted) {
      updateTask(taskId, {
        status: 'todo',
        progressSummary: [...progressStages, 'Aborted by user'],
      });
      broadcastToAll('task_update', {
        taskId,
        status: 'todo',
        progressSummary: [...progressStages, 'Aborted by user'],
      });
    } else {
      const finalStatus = lastSummary.startsWith('Completed') || !lastSummary.includes('FAILED') ? 'done' : 'failed';
      const finalSummary = [...progressStages, lastSummary || 'Done'];

      updateTask(taskId, {
        status: finalStatus,
        progressSummary: finalSummary,
        completedAt: new Date().toISOString(),
      });

      if (claudeSessionId) {
        updateSession(sessionId, { claudeSessionId, turnCount });
      }

      broadcastToAll('task_update', {
        taskId,
        status: finalStatus,
        sessionId,
        progressSummary: finalSummary,
      });
    }
  } catch (err: any) {
    runningTasks.delete(taskId);
    const errorSummary = [...progressStages, `Error: ${err.message}`];

    updateTask(taskId, {
      status: 'failed',
      progressSummary: errorSummary,
    });

    broadcastToAll('task_update', {
      taskId,
      status: 'failed',
      progressSummary: errorSummary,
    });
  }
}

export function abortTask(taskId: string): boolean {
  const running = runningTasks.get(taskId);
  if (!running) return false;
  running.aborted = true;
  abortSession(running.sessionId);
  return true;
}

export function getRunningTaskCount(): number {
  return runningTasks.size;
}

export function isTaskRunning(taskId: string): boolean {
  return runningTasks.has(taskId);
}
```

**Step 2: Check imports resolve** — `saveMessage` is in message-store or similar. Verify:

Run: `grep -r "export.*function saveMessage" /home/enterpriseai/claude-desk/backend/ --include="*.ts" -l`

Adjust the import path if needed (may be in `ws-handler.ts` directly — if so, extract to shared module or inline the DB insert).

**Step 3: Commit**

```bash
git add backend/services/task-runner.ts
git commit -m "feat(kanban): add task-runner service for autonomous agent execution"
```

---

### Task 6: WS handler — task message types

**Files:**
- Modify: `backend/routes/ws-handler.ts` (add cases to handleMessage switch)

**Step 1: Add imports at top of ws-handler.ts**

```typescript
import { spawnTask, abortTask } from '../services/task-runner.js';
import { getTasks } from '../services/task-manager.js';
```

**Step 2: Add WS message handlers**

In the `handleMessage` switch block, add these cases:

```typescript
      case 'task_spawn': {
        const { taskId } = data;
        try {
          await spawnTask(taskId, (type, payload) => broadcastToAll({ type, ...payload }), client.userId);
        } catch (err: any) {
          client.ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;
      }

      case 'task_abort': {
        const { taskId } = data;
        const ok = abortTask(taskId);
        if (!ok) {
          client.ws.send(JSON.stringify({ type: 'error', message: 'Task not running' }));
        }
        break;
      }

      case 'task_list': {
        const tasks = getTasks(client.userId);
        client.ws.send(JSON.stringify({ type: 'task_list', tasks }));
        break;
      }
```

**Step 3: Commit**

```bash
git add backend/routes/ws-handler.ts
git commit -m "feat(kanban): add WS handlers for task_spawn, task_abort, task_list"
```

---

## Phase 2: Frontend Foundation

### Task 7: Kanban store (Zustand)

**Files:**
- Create: `frontend/src/stores/kanban-store.ts`

**Step 1: Create the store**

```typescript
import { create } from 'zustand';

export interface TaskMeta {
  id: string;
  title: string;
  description: string;
  cwd: string;
  status: 'todo' | 'in_progress' | 'done' | 'failed';
  sessionId: string | null;
  sortOrder: number;
  progressSummary: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface KanbanState {
  tasks: TaskMeta[];
  loading: boolean;

  setTasks: (tasks: TaskMeta[]) => void;
  addTask: (task: TaskMeta) => void;
  updateTask: (taskId: string, updates: Partial<TaskMeta>) => void;
  removeTask: (taskId: string) => void;
  moveTask: (taskId: string, newStatus: TaskMeta['status']) => void;
  setLoading: (loading: boolean) => void;
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  tasks: [],
  loading: false,

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),

  updateTask: (taskId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
    })),

  removeTask: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),

  moveTask: (taskId, newStatus) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t
      ),
    })),

  setLoading: (loading) => set({ loading }),
}));
```

**Step 2: Commit**

```bash
git add frontend/src/stores/kanban-store.ts
git commit -m "feat(kanban): add Zustand kanban store"
```

---

### Task 8: View toggle — activeView state + Header tabs

**Files:**
- Modify: `frontend/src/stores/session-store.ts` — add `activeView` state
- Modify: `frontend/src/components/layout/Header.tsx` — add Chat/Kanban tabs
- Modify: `frontend/src/App.tsx` — conditionally render KanbanBoard vs ChatPanel

**Step 1: Add activeView to session store**

In `session-store.ts`, add to state interface and initial state:

```typescript
  activeView: 'chat' | 'kanban';
  setActiveView: (view: 'chat' | 'kanban') => void;
```

With initial value `'chat'` and setter:
```typescript
  setActiveView: (view) => set({ activeView: view }),
```

**Step 2: Add tabs to Header.tsx**

Add `activeView` and `setActiveView` props (or consume from store directly). Render two tab buttons between the logo and session name:

```tsx
const activeView = useSessionStore((s) => s.activeView);
const setActiveView = useSessionStore((s) => s.setActiveView);

// In the JSX, after the logo:
<div className="flex items-center gap-1 bg-surface-900 rounded-lg p-0.5">
  <button
    onClick={() => setActiveView('chat')}
    className={`px-3 py-1 text-xs rounded-md transition-colors ${
      activeView === 'chat'
        ? 'bg-surface-700 text-white'
        : 'text-gray-400 hover:text-gray-300'
    }`}
  >
    Chat
  </button>
  <button
    onClick={() => setActiveView('kanban')}
    className={`px-3 py-1 text-xs rounded-md transition-colors ${
      activeView === 'kanban'
        ? 'bg-surface-700 text-white'
        : 'text-gray-400 hover:text-gray-300'
    }`}
  >
    Board
  </button>
</div>
```

**Step 3: Conditionally render in App.tsx**

In the main content area (desktop normal mode, around line 709), wrap the ChatPanel render with a view check:

```tsx
const activeView = useSessionStore((s) => s.activeView);

// Replace direct <ChatPanel> rendering with:
{activeView === 'kanban' ? (
  <KanbanBoard />
) : (
  <ChatPanel onSend={handleSendMessage} onAbort={abort} onFileClick={...} onAnswerQuestion={...} />
)}
```

Do the same for expanded mode (line 685) and mobile mode (line 748).

**Step 4: Commit**

```bash
git add frontend/src/stores/session-store.ts frontend/src/components/layout/Header.tsx frontend/src/App.tsx
git commit -m "feat(kanban): add view toggle between Chat and Kanban board"
```

---

### Task 9: KanbanBoard + KanbanColumn components

**Files:**
- Create: `frontend/src/components/kanban/KanbanBoard.tsx`
- Create: `frontend/src/components/kanban/KanbanColumn.tsx`

**Step 1: Create KanbanBoard.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useKanbanStore, type TaskMeta } from '../../stores/kanban-store';
import { useSessionStore } from '../../stores/session-store';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { NewTaskModal } from './NewTaskModal';

const COLUMNS: { id: TaskMeta['status']; title: string; color: string }[] = [
  { id: 'todo', title: 'Todo', color: 'text-gray-400' },
  { id: 'in_progress', title: 'In Progress', color: 'text-blue-400' },
  { id: 'done', title: 'Done', color: 'text-green-400' },
];

export function KanbanBoard() {
  const { tasks, setTasks, setLoading } = useKanbanStore();
  const [activeTask, setActiveTask] = useState<TaskMeta | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Load tasks on mount
  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/tasks', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  const getTasksByStatus = (status: TaskMeta['status']) =>
    tasks
      .filter((t) => (status === 'done' ? t.status === 'done' || t.status === 'failed' : t.status === status))
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Determine target column
    let targetStatus: TaskMeta['status'];
    const overTask = tasks.find((t) => t.id === over.id);
    if (overTask) {
      targetStatus = overTask.status;
    } else {
      // Dropped on column directly
      targetStatus = over.id as TaskMeta['status'];
    }

    if (task.status === targetStatus) return; // No change

    // Trigger spawn or abort via WS
    if (targetStatus === 'in_progress' && task.status === 'todo') {
      // Will be handled by WS task_spawn in the parent
      onSpawnTask(taskId);
    } else if (targetStatus === 'todo' && task.status === 'in_progress') {
      onAbortTask(taskId);
    }
    // Note: manual move to 'done' is not allowed — agent does that
  };

  const onSpawnTask = (taskId: string) => {
    const ws = (window as any).__claudeWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'task_spawn', taskId }));
    }
  };

  const onAbortTask = (taskId: string) => {
    const ws = (window as any).__claudeWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'task_abort', taskId }));
    }
  };

  const handleCardClick = (task: TaskMeta) => {
    if (task.sessionId) {
      // Switch to chat view and select this session
      const { setActiveView } = useSessionStore.getState();
      setActiveView('chat');
      // Trigger session selection (will be wired in App.tsx)
      window.dispatchEvent(new CustomEvent('kanban-select-session', { detail: { sessionId: task.sessionId } }));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-4">
      {/* Board header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-200">Agent Board</h2>
        <button
          onClick={() => setShowNewTask(true)}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          + New Task
        </button>
      </div>

      {/* Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex gap-4 overflow-x-auto">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              color={col.color}
              tasks={getTasksByStatus(col.id)}
              onCardClick={handleCardClick}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <KanbanCard task={activeTask} isDragOverlay onClick={() => {}} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={(task) => {
            useKanbanStore.getState().addTask(task);
            setShowNewTask(false);
          }}
        />
      )}
    </div>
  );
}
```

**Step 2: Create KanbanColumn.tsx**

```tsx
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard } from './KanbanCard';
import type { TaskMeta } from '../../stores/kanban-store';

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  tasks: TaskMeta[];
  onCardClick: (task: TaskMeta) => void;
}

export function KanbanColumn({ id, title, color, tasks, onCardClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[280px] max-w-[400px] flex flex-col rounded-xl transition-colors ${
        isOver ? 'bg-surface-800/80 ring-1 ring-blue-500/30' : 'bg-surface-900/50'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-800">
        <span className={`text-sm font-medium ${color}`}>{title}</span>
        <span className="text-xs text-gray-500 bg-surface-800 rounded-full px-2 py-0.5">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanCard key={task.id} task={task} onClick={() => onCardClick(task)} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-8">
            {id === 'todo' ? 'Add a task to get started' : 'Drop cards here'}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add frontend/src/components/kanban/KanbanBoard.tsx frontend/src/components/kanban/KanbanColumn.tsx
git commit -m "feat(kanban): add KanbanBoard and KanbanColumn components with dnd-kit"
```

---

### Task 10: KanbanCard component

**Files:**
- Create: `frontend/src/components/kanban/KanbanCard.tsx`

**Step 1: Create the card component**

```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskMeta } from '../../stores/kanban-store';

interface KanbanCardProps {
  task: TaskMeta;
  onClick: () => void;
  isDragOverlay?: boolean;
}

const STATUS_STYLES: Record<string, { badge: string; border: string }> = {
  todo: { badge: 'bg-gray-700 text-gray-300', border: 'border-surface-700' },
  in_progress: { badge: 'bg-blue-900/50 text-blue-300', border: 'border-blue-500/30' },
  done: { badge: 'bg-green-900/50 text-green-300', border: 'border-green-500/30' },
  failed: { badge: 'bg-red-900/50 text-red-300', border: 'border-red-500/30' },
};

export function KanbanCard({ task, onClick, isDragOverlay }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const styles = STATUS_STYLES[task.status] || STATUS_STYLES.todo;
  const lastProgress = task.progressSummary?.[task.progressSummary.length - 1] || '';

  return (
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      style={!isDragOverlay ? style : undefined}
      {...(!isDragOverlay ? { ...attributes, ...listeners } : {})}
      onClick={onClick}
      className={`
        p-3 rounded-lg border cursor-pointer transition-all
        bg-surface-850 hover:bg-surface-800
        ${styles.border}
        ${isDragging ? 'opacity-40' : ''}
        ${isDragOverlay ? 'shadow-xl shadow-black/50 rotate-2' : ''}
      `}
    >
      {/* Title */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-200 line-clamp-2">{task.title}</h3>
        {task.status === 'in_progress' && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-blue-400 animate-pulse mt-1.5" />
        )}
        {task.status === 'done' && (
          <span className="shrink-0 text-green-400 text-xs mt-0.5">✓</span>
        )}
        {task.status === 'failed' && (
          <span className="shrink-0 text-red-400 text-xs mt-0.5">✗</span>
        )}
      </div>

      {/* Description preview */}
      {task.description && (
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
      )}

      {/* Progress summary */}
      {task.status === 'in_progress' && lastProgress && (
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex-1 h-1 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (task.progressSummary.length / 5) * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500 shrink-0">{lastProgress}</span>
        </div>
      )}

      {/* Footer: CWD + time */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-gray-600">
        <span className="truncate max-w-[60%]" title={task.cwd}>
          {task.cwd.split('/').pop()}
        </span>
        <span>{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>

      {/* Stage pills (for done/failed) */}
      {(task.status === 'done' || task.status === 'failed') && task.progressSummary.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.progressSummary.slice(1, -1).map((stage, i) => (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${styles.badge}`}>
              {stage}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/kanban/KanbanCard.tsx
git commit -m "feat(kanban): add KanbanCard component with status styles and progress"
```

---

### Task 11: NewTaskModal component

**Files:**
- Create: `frontend/src/components/kanban/NewTaskModal.tsx`

**Step 1: Create the modal**

```tsx
import { useState } from 'react';
import { useSessionStore } from '../../stores/session-store';
import type { TaskMeta } from '../../stores/kanban-store';

interface NewTaskModalProps {
  onClose: () => void;
  onCreated: (task: TaskMeta) => void;
}

export function NewTaskModal({ onClose, onCreated }: NewTaskModalProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cwd, setCwd] = useState(activeSession?.cwd || '/home/enterpriseai/workspace');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !cwd.trim()) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), cwd: cwd.trim() }),
      });
      if (res.ok) {
        const task = await res.json();
        onCreated(task);
      }
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-200 mb-4">New Task</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fix login bug, Add dark mode..."
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed task description for the agent..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Working Directory</label>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !cwd.trim() || submitting}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/kanban/NewTaskModal.tsx
git commit -m "feat(kanban): add NewTaskModal component"
```

---

## Phase 3: Integration

### Task 12: WS message handling in useClaudeChat

**Files:**
- Modify: `frontend/src/hooks/useClaudeChat.ts` — add `task_update` and `task_sdk_message` handlers

**Step 1: Add import**

```typescript
import { useKanbanStore } from '../stores/kanban-store';
```

**Step 2: Add cases to handleMessage switch**

In the `handleMessage` function, add these cases (after existing cases):

```typescript
        case 'task_update': {
          const { taskId, status, sessionId, progressSummary } = data;
          useKanbanStore.getState().updateTask(taskId, {
            ...(status && { status }),
            ...(sessionId && { sessionId }),
            ...(progressSummary && { progressSummary }),
          });
          break;
        }

        case 'task_list': {
          useKanbanStore.getState().setTasks(data.tasks || []);
          break;
        }
```

**Step 3: Expose WS reference globally for KanbanBoard**

In `useClaudeChat.ts`, after the WS is connected, store a reference:

```typescript
// After ws.onopen or when connected:
(window as any).__claudeWs = ws;
```

This allows `KanbanBoard.tsx` to send WS messages directly. (Alternatively, expose `send` via the hook return — but the global ref is simpler for the initial implementation.)

**Step 4: Commit**

```bash
git add frontend/src/hooks/useClaudeChat.ts
git commit -m "feat(kanban): handle task WS messages in useClaudeChat"
```

---

### Task 13: App.tsx integration — wire KanbanBoard + card-to-session navigation

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Import KanbanBoard**

```typescript
import { KanbanBoard } from './components/kanban/KanbanBoard';
```

**Step 2: Add kanban-select-session event listener**

Inside the `App()` function, add an effect:

```typescript
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { sessionId } = e.detail;
      if (sessionId) {
        // Find session and select it
        const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (session) handleSelectSession(session);
      }
    };
    window.addEventListener('kanban-select-session', handler as any);
    return () => window.removeEventListener('kanban-select-session', handler as any);
  }, []);
```

**Step 3: Replace ChatPanel with view-conditional rendering**

In the desktop normal-mode JSX (around line 709), replace the `<ChatPanel>` with:

```tsx
{activeView === 'kanban' ? (
  <KanbanBoard />
) : (
  <ChatPanel
    onSend={handleSendMessage}
    onAbort={abort}
    onFileClick={handleFileClick}
    onAnswerQuestion={answerQuestion}
  />
)}
```

Do the same substitution in:
- Desktop expanded mode (around line 685)
- Mobile mode (around line 748)

**Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(kanban): wire KanbanBoard into App.tsx with view toggle and session navigation"
```

---

### Task 14: Sidebar — kanban task indicators

**Files:**
- Modify: `frontend/src/components/sessions/SessionItem.tsx`

**Step 1: Detect kanban sessions**

In `SessionItem.tsx`, check if the session name starts with `🟢`:

```typescript
const isKanbanTask = session.name.startsWith('🟢');
```

**Step 2: Render different icon for kanban sessions**

Replace the default chat bubble icon with a board icon when `isKanbanTask` is true:

```tsx
{isKanbanTask ? (
  <span className="text-green-400 text-xs">▣</span>
) : (
  // existing icon logic
)}
```

**Step 3: Commit**

```bash
git add frontend/src/components/sessions/SessionItem.tsx
git commit -m "feat(kanban): show distinct icon for kanban task sessions in sidebar"
```

---

### Task 15: Handle saveMessage import in task-runner

**Files:**
- Modify: `backend/services/task-runner.ts` — verify/fix import path for `saveMessage`

**Step 1: Check where saveMessage lives**

Run: `grep -rn "function saveMessage" /home/enterpriseai/claude-desk/backend/ --include="*.ts"`

If it's inside `ws-handler.ts` (not exported), extract it to a shared module or duplicate the simple DB insert inline in task-runner:

```typescript
function saveTaskMessage(id: string, sessionId: string, role: string, content: string) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(id, sessionId, role, content);
}
```

**Step 2: Commit**

```bash
git add backend/services/task-runner.ts
git commit -m "fix(kanban): ensure saveMessage works in task-runner service"
```

---

### Task 16: Final integration test

**Step 1: Start dev server**

Run: `cd /home/enterpriseai/claude-desk && npm run dev`

**Step 2: Manual test checklist**

- [ ] Header shows Chat / Board toggle tabs
- [ ] Clicking "Board" shows kanban 3-column layout
- [ ] "New Task" button opens modal with title, description, CWD fields
- [ ] Creating a task adds card to Todo column
- [ ] Dragging card to In Progress spawns agent (check server logs)
- [ ] Card shows progress animation while agent runs
- [ ] Card auto-moves to Done when agent completes
- [ ] Clicking a card navigates to ChatPanel with agent's session
- [ ] Sidebar shows kanban sessions with green indicator
- [ ] Dragging In Progress card back to Todo aborts the agent

**Step 3: Fix any issues found during testing**

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(kanban): complete kanban agent board integration"
```

---

## Summary

| Phase | Tasks | Components |
|-------|-------|------------|
| Phase 1: Backend | Tasks 1-6 | DB schema, task-manager, REST API, task-runner, WS handlers |
| Phase 2: Frontend | Tasks 7-11 | kanban-store, view toggle, KanbanBoard, KanbanColumn, KanbanCard, NewTaskModal |
| Phase 3: Integration | Tasks 12-16 | WS handlers in useClaudeChat, App.tsx wiring, sidebar indicators, testing |

**Total new files:** 6 (task-manager.ts, task-runner.ts, kanban-store.ts, KanbanBoard.tsx, KanbanColumn.tsx, KanbanCard.tsx, NewTaskModal.tsx)
**Modified files:** 6 (schema.ts, api.ts, ws-handler.ts, session-store.ts, Header.tsx, App.tsx, SessionItem.tsx, useClaudeChat.ts)
**New dependency:** @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
