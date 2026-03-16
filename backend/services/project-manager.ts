import { getDb } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAccessibleProjectIds, addProjectMember } from './group-manager.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(process.env.HOME || '/tmp', 'workspace');

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

export function getProjects(userId?: number, role?: string): Project[] {
  const db = getDb();

  if (userId && role) {
    const accessibleIds = getAccessibleProjectIds(userId, role);
    if (accessibleIds !== null) {
      // Non-admin: show only projects user is a member of or created
      const allRows = db.prepare(
        `SELECT * FROM projects WHERE archived = 0 ORDER BY sort_order, created_at`
      ).all() as any[];
      return allRows.filter(r => accessibleIds.includes(r.id)).map(rowToProject);
    }
  }

  // admin or no auth: show all non-archived projects
  const rows = db.prepare(
    `SELECT * FROM projects WHERE archived = 0 ORDER BY sort_order, created_at`
  ).all() as any[];
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
    // Create AGENTS.md (open standard) with project context + CLAUDE.md symlink for backward compat
    const agentsMd = `# ${name}\n\n${opts?.description || 'Project context goes here. Edit this file to set instructions for all chats in this project.'}\n`;
    const agentsMdPath = path.join(finalDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) {
      fs.writeFileSync(agentsMdPath, agentsMd, 'utf-8');
      // Symlink so Claude SDK still discovers CLAUDE.md
      const claudeLink = path.join(finalDir, 'CLAUDE.md');
      try { fs.symlinkSync('AGENTS.md', claudeLink); } catch {}
    }
    rootPath = finalDir;
  }

  db.prepare(
    `INSERT INTO projects (id, name, description, root_path, color, sort_order, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, opts?.description ?? null, rootPath, opts?.color ?? '#f59e0b', maxOrder + 1, userId ?? null);

  // Auto-add creator as project owner
  if (userId) {
    addProjectMember(id, userId, 'owner');
  }

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

  // ── Safe Rename: when name changes, cascade folder + sessions + CLAUDE.md ──
  if (updates.name !== undefined) {
    const current = getProject(id);
    if (current && updates.name !== current.name && current.rootPath) {
      const renamed = _cascadeRename(current, updates.name, db);
      if (renamed.newRootPath) {
        // Override rootPath so the DB update below picks it up
        updates.rootPath = renamed.newRootPath;
      }
    }
  }

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

/**
 * Cascade rename: moves the project folder and updates all references.
 * Only applies to workspace-managed folders (under WORKSPACE_ROOT/projects/).
 * External rootPaths (e.g. ~/claude-desk) are left untouched — only CLAUDE.md title is updated.
 */
function _cascadeRename(
  current: Project,
  newName: string,
  db: ReturnType<typeof getDb>
): { newRootPath: string | null } {
  const oldRootPath = current.rootPath!;
  const workspaceProjectsDir = path.join(WORKSPACE_ROOT, 'projects');
  const isWorkspaceManaged = oldRootPath.startsWith(workspaceProjectsDir + path.sep);

  // 1. Update CLAUDE.md title (works for both workspace-managed and external folders)
  _updateAgentsMdTitle(oldRootPath, current.name, newName);

  // 2. For external rootPaths (e.g. ~/claude-desk), don't move the folder
  if (!isWorkspaceManaged) {
    return { newRootPath: null };
  }

  // 3. Compute new folder path from new name
  const newSlug = slugify(newName);
  let newDir = path.join(workspaceProjectsDir, newSlug);

  // Avoid collision: if target already exists (and isn't the same folder), append id prefix
  if (fs.existsSync(newDir) && newDir !== oldRootPath) {
    newDir = `${newDir}-${current.id.slice(0, 8)}`;
  }

  // If the path wouldn't actually change, skip filesystem ops
  if (newDir === oldRootPath) {
    return { newRootPath: null };
  }

  // 4. Rename the actual folder
  try {
    fs.renameSync(oldRootPath, newDir);
  } catch (err: any) {
    // If rename fails (e.g. cross-device), fall back to just updating DB
    console.error(`[project-manager] folder rename failed: ${err.message}`);
    return { newRootPath: null };
  }

  // 5. Update session cwd for all sessions that referenced the old path
  //    Exact match OR subpaths only (old/subdir → new/subdir).
  //    Must NOT match sibling folders that share a prefix (e.g. yujin vs yujinrfp).
  const sessions = db.prepare(
    `SELECT id, cwd FROM sessions WHERE cwd = ? OR cwd LIKE ? || '/%'`
  ).all(oldRootPath, oldRootPath) as { id: string; cwd: string }[];

  if (sessions.length > 0) {
    const updateStmt = db.prepare('UPDATE sessions SET cwd = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const s of sessions) {
        const newCwd = newDir + s.cwd.slice(oldRootPath.length);
        updateStmt.run(newCwd, s.id);
      }
    });
    tx();
  }

  // 6. Rename SDK project directory so resume (.jsonl files) keeps working.
  //    SDK stores session data at ~/.claude/projects/<encoded-cwd>/
  //    where encoded-cwd replaces / and _ with -
  try {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    const encode = (p: string) => p.replace(/\//g, '-').replace(/_/g, '-');
    const oldSdkDir = path.join(claudeProjectsDir, encode(oldRootPath));
    const newSdkDir = path.join(claudeProjectsDir, encode(newDir));
    if (fs.existsSync(oldSdkDir) && !fs.existsSync(newSdkDir)) {
      fs.renameSync(oldSdkDir, newSdkDir);
      console.log(`[project-manager] SDK dir renamed: ${encode(oldRootPath)} → ${encode(newDir)}`);
    }
  } catch (err: any) {
    // Non-critical — resume will fail but conversation history in Tower DB is preserved
    console.warn(`[project-manager] SDK dir rename failed: ${err.message}`);
  }

  console.log(`[project-manager] renamed: ${oldRootPath} → ${newDir} (${sessions.length} sessions updated)`);
  return { newRootPath: newDir };
}

/**
 * Update the first H1 title in AGENTS.md (or CLAUDE.md) to reflect the new project name.
 */
function _updateAgentsMdTitle(rootPath: string, oldName: string, newName: string): void {
  // Prefer AGENTS.md, fall back to CLAUDE.md for older projects
  const candidates = ['AGENTS.md', 'CLAUDE.md'];
  for (const filename of candidates) {
    const filePath = path.join(rootPath, filename);
    try {
      if (!fs.existsSync(filePath)) continue;
      let content = fs.readFileSync(filePath, 'utf-8');
      const oldTitle = `# ${oldName}`;
      const newTitle = `# ${newName}`;
      if (content.startsWith(oldTitle)) {
        content = newTitle + content.slice(oldTitle.length);
        fs.writeFileSync(filePath, content, 'utf-8');
      }
      return; // Updated one file — done
    } catch {
      // Non-critical — don't fail the rename if context file update fails
    }
  }
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
