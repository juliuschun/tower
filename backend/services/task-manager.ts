import { getDb } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';

export type WorkflowMode = 'auto' | 'simple' | 'default' | 'feature' | 'big_task';

export interface TaskMeta {
  id: string;
  title: string;
  description: string;
  cwd: string;
  model: string;
  status: 'todo' | 'in_progress' | 'done' | 'failed';
  sessionId: string | null;
  sortOrder: number;
  progressSummary: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  userId: number | null;
  scheduledAt: string | null;
  scheduleCron: string | null;
  scheduleEnabled: boolean;
  workflow: WorkflowMode;
  parentTaskId: string | null;
  worktreePath: string | null;
}

export interface ScheduleCron {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour?: number;
  minute?: number;
  day?: number;   // 0=Sun, 1=Mon, ..., 6=Sat (for 'weekly')
  hours?: number; // for 'interval' type
}

function mapRow(row: any): TaskMeta {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    cwd: row.cwd,
    model: row.model || 'claude-opus-4-6',
    status: row.status,
    sessionId: row.session_id,
    sortOrder: row.sort_order,
    progressSummary: JSON.parse(row.progress_summary || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    userId: row.user_id,
    scheduledAt: row.scheduled_at || null,
    scheduleCron: row.schedule_cron || null,
    scheduleEnabled: row.schedule_enabled === 1,
    workflow: (row.workflow as WorkflowMode) || 'auto',
    parentTaskId: row.parent_task_id || null,
    worktreePath: row.worktree_path || null,
  };
}

export function createTask(
  title: string,
  description: string,
  cwd: string,
  userId?: number,
  model?: string,
  schedule?: { scheduledAt?: string | null; scheduleCron?: string | null; scheduleEnabled?: boolean },
  workflow?: WorkflowMode,
  parentTaskId?: string,
): TaskMeta {
  const db = getDb();
  const id = uuidv4();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?').get('todo') as any;
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;
  const resolvedModel = model || 'claude-opus-4-6';

  db.prepare(`
    INSERT INTO tasks (id, title, description, cwd, model, status, sort_order, user_id, scheduled_at, schedule_cron, schedule_enabled, workflow, parent_task_id)
    VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title, description, cwd, resolvedModel, sortOrder, userId ?? null,
    schedule?.scheduledAt ?? null,
    schedule?.scheduleCron ?? null,
    schedule?.scheduleEnabled ? 1 : 0,
    workflow || 'auto',
    parentTaskId ?? null,
  );

  return getTask(id)!;
}

export function getTasks(userId?: number): TaskMeta[] {
  const db = getDb();
  const rows = userId
    ? db.prepare('SELECT * FROM tasks WHERE user_id = ? AND (archived IS NULL OR archived = 0) ORDER BY status, sort_order').all(userId)
    : db.prepare('SELECT * FROM tasks WHERE (archived IS NULL OR archived = 0) ORDER BY status, sort_order').all();
  return rows.map(mapRow);
}

export function getTask(id: string): TaskMeta | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? mapRow(row) : null;
}

export function updateTask(id: string, updates: Partial<Pick<TaskMeta, 'title' | 'description' | 'cwd' | 'model' | 'status' | 'sessionId' | 'sortOrder' | 'progressSummary' | 'completedAt' | 'scheduledAt' | 'scheduleCron' | 'scheduleEnabled' | 'workflow' | 'parentTaskId' | 'worktreePath'>>): TaskMeta | null {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.cwd !== undefined) { fields.push('cwd = ?'); values.push(updates.cwd); }
  if (updates.model !== undefined) { fields.push('model = ?'); values.push(updates.model); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.sessionId !== undefined) { fields.push('session_id = ?'); values.push(updates.sessionId); }
  if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(updates.sortOrder); }
  if (updates.progressSummary !== undefined) { fields.push('progress_summary = ?'); values.push(JSON.stringify(updates.progressSummary)); }
  if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
  if (updates.scheduledAt !== undefined) { fields.push('scheduled_at = ?'); values.push(updates.scheduledAt); }
  if (updates.scheduleCron !== undefined) { fields.push('schedule_cron = ?'); values.push(updates.scheduleCron); }
  if (updates.scheduleEnabled !== undefined) { fields.push('schedule_enabled = ?'); values.push(updates.scheduleEnabled ? 1 : 0); }
  if (updates.workflow !== undefined) { fields.push('workflow = ?'); values.push(updates.workflow); }
  if (updates.parentTaskId !== undefined) { fields.push('parent_task_id = ?'); values.push(updates.parentTaskId); }
  if (updates.worktreePath !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktreePath); }

  if (fields.length === 0) return getTask(id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getTask(id);
}

export function getChildTasks(parentTaskId: string): TaskMeta[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tasks WHERE parent_task_id = ? AND (archived IS NULL OR archived = 0) ORDER BY sort_order').all(parentTaskId);
  return rows.map(mapRow);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  // Soft-delete: archive instead of permanent removal
  const result = db.prepare('UPDATE tasks SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getArchivedTasks(userId?: number): TaskMeta[] {
  const db = getDb();
  const rows = userId
    ? db.prepare('SELECT * FROM tasks WHERE user_id = ? AND archived = 1 ORDER BY updated_at DESC').all(userId)
    : db.prepare('SELECT * FROM tasks WHERE archived = 1 ORDER BY updated_at DESC').all();
  return rows.map(mapRow);
}

export function restoreTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE tasks SET archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return result.changes > 0;
}

export function permanentlyDeleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getDistinctCwds(userId?: number): string[] {
  const db = getDb();
  const rows = userId
    ? db.prepare('SELECT DISTINCT cwd FROM tasks WHERE user_id = ? ORDER BY cwd').all(userId) as any[]
    : db.prepare('SELECT DISTINCT cwd FROM tasks ORDER BY cwd').all() as any[];
  return rows.map((r) => r.cwd);
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
