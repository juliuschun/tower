import { getDb } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';

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
  };
}

export function createTask(title: string, description: string, cwd: string, userId?: number, model?: string): TaskMeta {
  const db = getDb();
  const id = uuidv4();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?').get('todo') as any;
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;
  const resolvedModel = model || 'claude-opus-4-6';

  db.prepare(`
    INSERT INTO tasks (id, title, description, cwd, model, status, sort_order, user_id)
    VALUES (?, ?, ?, ?, ?, 'todo', ?, ?)
  `).run(id, title, description, cwd, resolvedModel, sortOrder, userId ?? null);

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
