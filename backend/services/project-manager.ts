import { getDb } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(process.env.HOME || '/home/enterpriseai', 'workspace');

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  rootPath: string | null;
  color: string;
  sortOrder: number;
  collapsed: number;
  archived: number;
  userId: number | null;
  createdAt: string;
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rootPath: row.root_path,
    color: row.color,
    sortOrder: row.sort_order,
    collapsed: row.collapsed,
    archived: row.archived,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

export function getProjects(userId?: number): Project[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM projects WHERE archived = 0 AND (user_id IS NULL OR user_id = ?) ORDER BY sort_order, created_at`
  ).all(userId ?? null) as any[];
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  return row ? rowToProject(row) : null;
}

export function createProject(
  name: string,
  userId?: number,
  opts?: { description?: string; rootPath?: string; color?: string }
): Project {
  const db = getDb();
  const id = uuidv4();
  const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM projects WHERE user_id IS NULL OR user_id = ?').get(userId ?? null) as any)?.m ?? 0;

  // Determine rootPath: use provided path, or auto-create under workspace/projects/
  let rootPath = opts?.rootPath ?? null;
  if (!rootPath) {
    const slug = slugify(name);
    const projectDir = path.join(WORKSPACE_ROOT, 'projects', slug);
    // Avoid collision with existing slugs by appending id prefix
    const finalDir = fs.existsSync(projectDir) ? `${projectDir}-${id.slice(0, 8)}` : projectDir;
    fs.mkdirSync(finalDir, { recursive: true });
    // Create CLAUDE.md with project context
    const claudeMd = `# ${name}\n\n${opts?.description || 'Project context goes here. Edit this file to set instructions for all chats in this project.'}\n`;
    const claudeMdPath = path.join(finalDir, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, claudeMd, 'utf-8');
    }
    rootPath = finalDir;
  }

  db.prepare(
    `INSERT INTO projects (id, name, description, root_path, color, sort_order, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, opts?.description ?? null, rootPath, opts?.color ?? '#f59e0b', maxOrder + 1, userId ?? null);
  return getProject(id)!;
}

export function updateProject(id: string, updates: Partial<{
  name: string;
  description: string | null;
  rootPath: string | null;
  color: string;
  sortOrder: number;
  collapsed: number;
  archived: number;
}>): Project | null {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); vals.push(updates.description); }
  if (updates.rootPath !== undefined) { sets.push('root_path = ?'); vals.push(updates.rootPath); }
  if (updates.color !== undefined) { sets.push('color = ?'); vals.push(updates.color); }
  if (updates.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(updates.sortOrder); }
  if (updates.collapsed !== undefined) { sets.push('collapsed = ?'); vals.push(updates.collapsed); }
  if (updates.archived !== undefined) { sets.push('archived = ?'); vals.push(updates.archived); }
  if (sets.length === 0) return getProject(id);
  vals.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  // Unassign all sessions from this project first
  db.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id);
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}

export function moveSessionToProject(sessionId: string, projectId: string | null): boolean {
  const db = getDb();
  // Validate projectId exists if not null
  if (projectId) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) return false;
  }
  const result = db.prepare('UPDATE sessions SET project_id = ? WHERE id = ?').run(projectId, sessionId);
  return result.changes > 0;
}

export function reorderProjects(projectIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => {
    projectIds.forEach((id, i) => stmt.run(i, id));
  });
  tx();
}
