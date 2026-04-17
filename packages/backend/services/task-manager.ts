import { query, queryOne, execute, transaction, withClient } from '../db/pg-repo.js';
import { v4 as uuidv4 } from 'uuid';
import { getAccessibleProjectIds } from './group-manager.js';
export type { WorkflowMode, TaskMeta } from '@tower/shared';
import type { TaskMeta, WorkflowMode } from '@tower/shared';

export interface ScheduleCron {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour?: number;
  minute?: number;
  day?: number;   // 0=Sun, 1=Mon, ..., 6=Sat (for 'weekly')
  hours?: number; // for 'interval' type
}

function mapRow(row: any): TaskMeta {
  let todoSnapshot = null;
  if (row.todo_snapshot) {
    try { todoSnapshot = JSON.parse(row.todo_snapshot); } catch {}
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    cwd: row.cwd,
    model: row.model || 'claude-opus-4-7',
    status: row.status,
    sessionId: row.session_id,
    sortOrder: row.sort_order,
    progressSummary: JSON.parse(row.progress_summary || '[]'),
    todoSnapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    userId: row.user_id,
    scheduledAt: row.scheduled_at || null,
    scheduleCron: row.schedule_cron || null,
    scheduleEnabled: row.schedule_enabled === 1 || row.schedule_enabled === true,
    workflow: (row.workflow as WorkflowMode) || 'auto',
    parentTaskId: row.parent_task_id || null,
    worktreePath: row.worktree_path || null,
    projectId: row.project_id || null,
    roomId: row.room_id || null,
    triggeredBy: row.triggered_by || null,
    roomMessageId: row.room_message_id || null,
  };
}

/**
 * Resolve projectId from cwd by longest-prefix-match against project root_path.
 * e.g. cwd="/home/enterpriseai/tower/src" matches project with root_path="/home/enterpriseai/tower"
 */
export async function resolveProjectFromCwd(cwd: string): Promise<string | null> {
  const projects = await query<{ id: string; root_path: string }>(
    'SELECT id, root_path FROM projects WHERE root_path IS NOT NULL AND (archived IS NULL OR archived = 0)'
  );
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const p of projects) {
    const rp = p.root_path.endsWith('/') ? p.root_path.slice(0, -1) : p.root_path;
    // cwd must equal root_path or be a subdirectory of it
    if ((cwd === rp || cwd.startsWith(rp + '/')) && rp.length > bestLen) {
      bestMatch = p.id;
      bestLen = rp.length;
    }
  }
  return bestMatch;
}

export async function createTask(
  title: string,
  description: string,
  cwd: string,
  userId?: number,
  model?: string,
  schedule?: { scheduledAt?: string | null; scheduleCron?: string | null; scheduleEnabled?: boolean },
  workflow?: WorkflowMode,
  parentTaskId?: string,
  projectId?: string,
  roomInfo?: { roomId: string; triggeredBy: number; roomMessageId: string },
): Promise<TaskMeta> {
  const id = uuidv4();
  const maxOrder = await queryOne<any>('SELECT MAX(sort_order) as max_order FROM tasks WHERE status = $1', ['todo']);
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;
  const resolvedModel = model || 'claude-opus-4-7';

  // Auto-resolve project from cwd if not explicitly provided
  const resolvedProjectId = projectId ?? await resolveProjectFromCwd(cwd);

  await execute(`
    INSERT INTO tasks (id, title, description, cwd, model, status, sort_order, user_id, scheduled_at, schedule_cron, schedule_enabled, workflow, parent_task_id, project_id, room_id, triggered_by, room_message_id)
    VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `, [
    id, title, description, cwd, resolvedModel, sortOrder, userId ?? null,
    schedule?.scheduledAt ?? null,
    schedule?.scheduleCron ?? null,
    schedule?.scheduleEnabled ? 1 : 0,
    workflow || 'auto',
    parentTaskId ?? null,
    resolvedProjectId,
    roomInfo?.roomId ?? null,
    roomInfo?.triggeredBy ?? null,
    roomInfo?.roomMessageId ?? null,
  ]);

  return (await getTask(id))!;
}

export async function getTasks(userId?: number, role?: string): Promise<TaskMeta[]> {
  const rows = await query<any>('SELECT * FROM tasks WHERE (archived IS NULL OR archived = 0) ORDER BY status, sort_order');

  if (userId && role) {
    const accessibleIds = await getAccessibleProjectIds(userId, role);
    if (accessibleIds !== null) {
      // Same pattern as sessions: project tasks visible by group, non-project tasks by creator
      return rows.filter(r => {
        if (!r.project_id) return r.user_id === userId;
        return accessibleIds.includes(r.project_id);
      }).map(mapRow);
    }
  }

  // No group filtering (admin or no groups exist): filter by user_id only
  if (userId) {
    return rows.filter(r => r.user_id === userId || r.user_id === null).map(mapRow);
  }
  return rows.map(mapRow);
}

export async function getTask(id: string): Promise<TaskMeta | null> {
  const row = await queryOne<any>('SELECT * FROM tasks WHERE id = $1', [id]);
  return row ? mapRow(row) : null;
}

export async function updateTask(id: string, updates: Partial<Pick<TaskMeta, 'title' | 'description' | 'cwd' | 'model' | 'status' | 'sessionId' | 'sortOrder' | 'progressSummary' | 'todoSnapshot' | 'completedAt' | 'scheduledAt' | 'scheduleCron' | 'scheduleEnabled' | 'workflow' | 'parentTaskId' | 'worktreePath' | 'projectId' | 'roomId' | 'triggeredBy' | 'roomMessageId'>>): Promise<TaskMeta | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) { fields.push(`title = $${paramIndex++}`); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push(`description = $${paramIndex++}`); values.push(updates.description); }
  if (updates.cwd !== undefined) { fields.push(`cwd = $${paramIndex++}`); values.push(updates.cwd); }
  if (updates.model !== undefined) { fields.push(`model = $${paramIndex++}`); values.push(updates.model); }
  if (updates.status !== undefined) { fields.push(`status = $${paramIndex++}`); values.push(updates.status); }
  if (updates.sessionId !== undefined) { fields.push(`session_id = $${paramIndex++}`); values.push(updates.sessionId); }
  if (updates.sortOrder !== undefined) { fields.push(`sort_order = $${paramIndex++}`); values.push(updates.sortOrder); }
  if (updates.progressSummary !== undefined) { fields.push(`progress_summary = $${paramIndex++}`); values.push(JSON.stringify(updates.progressSummary)); }
  if (updates.todoSnapshot !== undefined) { fields.push(`todo_snapshot = $${paramIndex++}`); values.push(updates.todoSnapshot ? JSON.stringify(updates.todoSnapshot) : null); }
  if (updates.completedAt !== undefined) { fields.push(`completed_at = $${paramIndex++}`); values.push(updates.completedAt); }
  if (updates.scheduledAt !== undefined) { fields.push(`scheduled_at = $${paramIndex++}`); values.push(updates.scheduledAt); }
  if (updates.scheduleCron !== undefined) { fields.push(`schedule_cron = $${paramIndex++}`); values.push(updates.scheduleCron); }
  if (updates.scheduleEnabled !== undefined) { fields.push(`schedule_enabled = $${paramIndex++}`); values.push(updates.scheduleEnabled ? 1 : 0); }
  if (updates.workflow !== undefined) { fields.push(`workflow = $${paramIndex++}`); values.push(updates.workflow); }
  if (updates.parentTaskId !== undefined) { fields.push(`parent_task_id = $${paramIndex++}`); values.push(updates.parentTaskId); }
  if (updates.worktreePath !== undefined) { fields.push(`worktree_path = $${paramIndex++}`); values.push(updates.worktreePath); }
  if (updates.projectId !== undefined) { fields.push(`project_id = $${paramIndex++}`); values.push(updates.projectId); }
  if (updates.roomId !== undefined) { fields.push(`room_id = $${paramIndex++}`); values.push(updates.roomId); }
  if (updates.triggeredBy !== undefined) { fields.push(`triggered_by = $${paramIndex++}`); values.push(updates.triggeredBy); }
  if (updates.roomMessageId !== undefined) { fields.push(`room_message_id = $${paramIndex++}`); values.push(updates.roomMessageId); }

  if (fields.length === 0) return getTask(id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  await execute(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
  return getTask(id);
}

export async function getChildTasks(parentTaskId: string): Promise<TaskMeta[]> {
  const rows = await query<any>('SELECT * FROM tasks WHERE parent_task_id = $1 AND (archived IS NULL OR archived = 0) ORDER BY sort_order', [parentTaskId]);
  return rows.map(mapRow);
}

export async function deleteTask(id: string): Promise<boolean> {
  // Soft-delete: archive instead of permanent removal
  const result = await execute('UPDATE tasks SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  return result.changes > 0;
}

export async function getArchivedTasks(userId?: number): Promise<TaskMeta[]> {
  const rows = userId
    ? await query<any>('SELECT * FROM tasks WHERE user_id = $1 AND archived = 1 ORDER BY updated_at DESC', [userId])
    : await query<any>('SELECT * FROM tasks WHERE archived = 1 ORDER BY updated_at DESC');
  return rows.map(mapRow);
}

export async function restoreTask(id: string): Promise<boolean> {
  const result = await execute('UPDATE tasks SET archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  return result.changes > 0;
}

export async function permanentlyDeleteTask(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM tasks WHERE id = $1', [id]);
  return result.changes > 0;
}

export async function getDistinctCwds(userId?: number): Promise<string[]> {
  const rows = userId
    ? await query<any>('SELECT DISTINCT cwd FROM tasks WHERE user_id = $1 ORDER BY cwd', [userId])
    : await query<any>('SELECT DISTINCT cwd FROM tasks ORDER BY cwd');
  return rows.map((r) => r.cwd);
}

/**
 * Backfill project_id for existing tasks that have NULL project_id.
 * Matches task cwd against project root_path using longest-prefix-match.
 * Safe to run multiple times (idempotent).
 */
export async function backfillTaskProjects(): Promise<{ updated: number; total: number }> {
  const orphans = await query<{ id: string; cwd: string }>(
    'SELECT id, cwd FROM tasks WHERE project_id IS NULL AND (archived IS NULL OR archived = 0)'
  );
  let updated = 0;
  for (const task of orphans) {
    const projectId = await resolveProjectFromCwd(task.cwd);
    if (projectId) {
      await execute('UPDATE tasks SET project_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [projectId, task.id]);
      updated++;
    }
  }
  return { updated, total: orphans.length };
}

export async function reorderTasks(taskIds: string[], status: string): Promise<void> {
  await transaction(async (client) => {
    const db = withClient(client);
    for (let index = 0; index < taskIds.length; index++) {
      await db.execute('UPDATE tasks SET sort_order = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [index, status, taskIds[index]]);
    }
  });
}
