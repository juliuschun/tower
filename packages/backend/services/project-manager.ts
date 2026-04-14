import { query, queryOne, execute, transaction, withClient } from '../db/pg-repo.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAccessibleProjectIds, addProjectMember } from './group-manager.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(process.env.HOME || '/tmp', 'workspace');

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}

// ─────────────────────────────────────────────────────────────
// Project scaffolding templates
// ─────────────────────────────────────────────────────────────
// These templates are what agents see when they first read a project.
// They must *explicitly* describe the .project/ structure — otherwise
// agents don't know the scaffolding exists (dot-folders are hidden by
// default listings) and the progress/decisions/heartbeat loop dies.

function renderProjectAgentsMd(name: string, description: string): string {
  return `# ${name}

${description}

## Project Memory

This project has a self-evolving memory under \`.project/\`. **Use it.**

- **\`.project/progress.md\`** — Work log. After any meaningful change
  (files created/modified, decisions made, blockers hit, discoveries),
  append a line: \`- YYYY-MM-DD: one-line summary\`. Even one line counts.
- **\`.project/decisions/YYYY-MM-DD-<slug>.md\`** — Immutable decision
  records. For significant choices, copy \`.template.md\` to a dated file
  and fill it in. **Never edit an existing decision** — create a new file
  that supersedes it.
- **\`.project/state.json\`** — Heartbeat tracking. Managed by the system;
  don't edit by hand.

When progress.md accumulates enough new entries, the heartbeat service
automatically proposes an AGENTS.md refresh. You can also trigger it
manually with \`/agents-md --evolve\`.

> Dot-folder note: \`.project/\` is hidden from casual \`ls\`. If you're
> an agent exploring this project, check it explicitly — it's where the
> project's memory lives.

## Decisions — which folder?

- Affects only this project → \`.project/decisions/\`
- Affects multiple projects or team-wide policy → \`workspace/decisions/\`
- Unsure → \`.project/decisions/\` (can be moved later)

Decision files are immutable. To change a decision, create a new file
with \`Status: supersedes <old-file>\`.

## Context

<!--
Describe the project in enough detail that an agent opening this file
for the first time understands:
  - What this project is for
  - Key files and where they live
  - Conventions / rules specific to this project
  - External references (docs, APIs, related projects)
-->
`;
}

function renderProgressSeed(today: string): string {
  return `# Progress Log

Append dated entries as work progresses. Format: \`- YYYY-MM-DD: one-line summary\`.
This log feeds the heartbeat service, which proposes AGENTS.md refreshes
once enough new entries accumulate.

## Entries

- ${today}: Project created.
`;
}

function renderDecisionTemplate(): string {
  return `<!--
Decision record template.

HOW TO USE:
  1. Copy this file to \`YYYY-MM-DD-<slug>.md\` in this same directory.
     Example: \`2026-04-10-use-postgres-over-sqlite.md\`
  2. Fill in the sections below.
  3. Commit / save. Do NOT edit later — decisions are immutable.
  4. To change a decision, create a NEW file with
     \`Status: supersedes <previous-file>\`.

Keep decisions scoped to this project. Team-wide or cross-project
decisions belong in \`workspace/decisions/\` instead.
-->

# [Decision title]

**Date**: YYYY-MM-DD
**Status**: proposed | accepted | superseded by <file>

## Context

What was the situation, and why did a decision need to be made?

## Options

- Option A — pros / cons
- Option B — pros / cons

## Decision

What we chose.

## Rationale

Why this option over the alternatives. Include constraints and trade-offs.
`;
}

import type { Project as ProjectBase } from '@tower/shared';

export interface Project extends ProjectBase {
  userId: number | null;
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
    spaceId: row.space_id ?? null,
    spaceName: row.space_name ?? null,
    spaceSlug: row.space_slug ?? null,
    claude_account_id: row.claude_account_id ?? null,
  };
}

const PROJECTS_BASE_QUERY = `
  SELECT p.*, s.name as space_name, s.slug as space_slug
  FROM projects p
  LEFT JOIN spaces s ON p.space_id = s.id
  WHERE (p.archived IS NULL OR p.archived = 0)
  ORDER BY p.sort_order, p.created_at
`;

export async function getProjects(userId?: number, role?: string): Promise<Project[]> {
  if (userId && role) {
    const accessibleIds = await getAccessibleProjectIds(userId, role);
    if (accessibleIds !== null) {
      // Non-admin: show only projects user is a member of or created
      const allRows = await query(PROJECTS_BASE_QUERY);
      return allRows.filter(r => accessibleIds.includes(r.id)).map(rowToProject);
    }
  }

  // admin or no auth: show all non-archived projects
  const rows = await query(PROJECTS_BASE_QUERY);
  return rows.map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const row = await queryOne(
    `SELECT p.*, s.name as space_name, s.slug as space_slug
     FROM projects p LEFT JOIN spaces s ON p.space_id = s.id
     WHERE p.id = $1`, [id]
  );
  return row ? rowToProject(row) : null;
}

export async function createProject(
  name: string,
  userId?: number,
  opts?: { description?: string; rootPath?: string; color?: string; spaceId?: number | null }
): Promise<Project> {
  const id = uuidv4();
  const maxOrderRow = await queryOne(
    'SELECT MAX(sort_order) as m FROM projects WHERE user_id IS NULL OR user_id = $1',
    [userId ?? null]
  );
  const maxOrder = maxOrderRow?.m ?? 0;

  // Determine rootPath: use provided path, or auto-create under workspace/projects/
  let rootPath = opts?.rootPath ?? null;
  if (!rootPath) {
    const slug = slugify(name);
    const projectDir = path.join(WORKSPACE_ROOT, 'projects', slug);
    // Avoid collision with existing slugs by appending id prefix
    const finalDir = fs.existsSync(projectDir) ? `${projectDir}-${id.slice(0, 8)}` : projectDir;
    fs.mkdirSync(finalDir, { recursive: true });
    // Create AGENTS.md (open standard) with project context + CLAUDE.md symlink for backward compat
    const description = opts?.description || 'Project context goes here. Edit this section to describe the project\'s purpose, scope, and key rules.';
    const agentsMd = renderProjectAgentsMd(name, description);
    const agentsMdPath = path.join(finalDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) {
      fs.writeFileSync(agentsMdPath, agentsMd, 'utf-8');
      // Symlink so Claude SDK still discovers CLAUDE.md
      const claudeLink = path.join(finalDir, 'CLAUDE.md');
      try { fs.symlinkSync('AGENTS.md', claudeLink); } catch {}
    }
    // Seed .project/ — progress log + decisions + state for recursive project evolution
    const projectMetaDir = path.join(finalDir, '.project');
    if (!fs.existsSync(projectMetaDir)) {
      fs.mkdirSync(path.join(projectMetaDir, 'decisions'), { recursive: true });
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      fs.writeFileSync(path.join(projectMetaDir, 'progress.md'),
        renderProgressSeed(today), 'utf-8');
      fs.writeFileSync(path.join(projectMetaDir, 'decisions', '.template.md'),
        renderDecisionTemplate(), 'utf-8');
      fs.writeFileSync(path.join(projectMetaDir, 'state.json'),
        JSON.stringify({ lastAgentsUpdate: null, lastProgressLine: 0, cycle: 0, changeLog: [] }, null, 2), 'utf-8');
    }
    rootPath = finalDir;
  }

  await execute(
    `INSERT INTO projects (id, name, description, root_path, color, sort_order, user_id, space_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, name, opts?.description ?? null, rootPath, opts?.color ?? '#f59e0b', maxOrder + 1, userId ?? null, opts?.spaceId ?? null]
  );

  // Auto-add creator as project owner
  if (userId) {
    await addProjectMember(id, userId, 'owner');
  }

  return (await getProject(id))!;
}

// ── Default projects: auto-created on first boot, new users auto-join ──

const DEFAULT_PROJECTS = [
  { slug: 'general', name: 'General', color: '#3b82f6', description: 'Team-wide shared project for general work' },
  { slug: 'test-project', name: 'Test Project', color: '#8b5cf6', description: 'Sandbox for testing and experiments' },
];

/**
 * Ensure default projects exist. Called once on server startup.
 * Returns the IDs of default projects (for new-user auto-join).
 */
export async function seedDefaultProjects(): Promise<string[]> {
  const ids: string[] = [];
  for (const def of DEFAULT_PROJECTS) {
    const rootPath = path.join(WORKSPACE_ROOT, 'projects', def.slug);
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM projects WHERE root_path = $1 AND (archived IS NULL OR archived = 0)`,
      [rootPath]
    );
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    // Create the project (no userId — system-owned)
    const project = await createProject(def.name, undefined, {
      description: def.description,
      rootPath: undefined, // let createProject auto-scaffold
      color: def.color,
    });
    // Fix slug: createProject may append uuid suffix if slug collision — update if needed
    if (project.rootPath !== rootPath && fs.existsSync(project.rootPath!)) {
      // Rename to clean slug if possible
      if (!fs.existsSync(rootPath)) {
        fs.renameSync(project.rootPath!, rootPath);
        await execute(`UPDATE projects SET root_path = $1 WHERE id = $2`, [rootPath, project.id]);
      }
    }
    ids.push(project.id);
    console.log(`[projects] Created default project: ${def.name} (${def.slug})`);
  }
  return ids;
}

/** Get IDs of default projects (for new-user auto-join) */
export async function getDefaultProjectIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const def of DEFAULT_PROJECTS) {
    const rootPath = path.join(WORKSPACE_ROOT, 'projects', def.slug);
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM projects WHERE root_path = $1 AND (archived IS NULL OR archived = 0)`,
      [rootPath]
    );
    if (row) ids.push(row.id);
  }
  return ids;
}

export async function updateProject(id: string, updates: Partial<{
  name: string;
  description: string | null;
  rootPath: string | null;
  color: string;
  sortOrder: number;
  collapsed: number;
  archived: number;
  spaceId: number | null;
}>): Promise<Project | null> {
  // ── Safe Rename: when name changes, cascade folder + sessions + CLAUDE.md ──
  if (updates.name !== undefined) {
    const current = await getProject(id);
    if (current && updates.name !== current.name && current.rootPath) {
      const renamed = await _cascadeRename(current, updates.name);
      if (renamed.newRootPath) {
        // Override rootPath so the DB update below picks it up
        updates.rootPath = renamed.newRootPath;
      }
    }
  }

  const sets: string[] = [];
  const vals: any[] = [];
  let paramIdx = 1;
  if (updates.name !== undefined) { sets.push(`name = $${paramIdx++}`); vals.push(updates.name); }
  if (updates.description !== undefined) { sets.push(`description = $${paramIdx++}`); vals.push(updates.description); }
  if (updates.rootPath !== undefined) { sets.push(`root_path = $${paramIdx++}`); vals.push(updates.rootPath); }
  if (updates.color !== undefined) { sets.push(`color = $${paramIdx++}`); vals.push(updates.color); }
  if (updates.sortOrder !== undefined) { sets.push(`sort_order = $${paramIdx++}`); vals.push(updates.sortOrder); }
  if (updates.collapsed !== undefined) { sets.push(`collapsed = $${paramIdx++}`); vals.push(updates.collapsed); }
  if (updates.archived !== undefined) { sets.push(`archived = $${paramIdx++}`); vals.push(updates.archived); }
  if ('spaceId' in updates) { sets.push(`space_id = $${paramIdx++}`); vals.push(updates.spaceId); }
  if (sets.length === 0) return await getProject(id);
  vals.push(id);
  await execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${paramIdx}`, vals);
  return await getProject(id);
}

/**
 * Cascade rename: moves the project folder and updates all references.
 * Only applies to workspace-managed folders (under WORKSPACE_ROOT/projects/).
 * External rootPaths (e.g. ~/claude-desk) are left untouched — only CLAUDE.md title is updated.
 */
async function _cascadeRename(
  current: Project,
  newName: string,
): Promise<{ newRootPath: string | null }> {
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
  const sessions = await query<{ id: string; cwd: string }>(
    `SELECT id, cwd FROM sessions WHERE cwd = $1 OR cwd LIKE $2 || '/%'`,
    [oldRootPath, oldRootPath]
  );

  if (sessions.length > 0) {
    await transaction(async (client) => {
      const db = withClient(client);
      for (const s of sessions) {
        const newCwd = newDir + s.cwd.slice(oldRootPath.length);
        await db.execute('UPDATE sessions SET cwd = $1 WHERE id = $2', [newCwd, s.id]);
      }
    });
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

export async function deleteProject(id: string): Promise<boolean> {
  // Unassign all sessions from this project
  await execute('UPDATE sessions SET project_id = NULL WHERE project_id = $1', [id]);
  // Archive all channels belonging to this project
  try {
    const { getPgPool } = await import('../db/pg.js');
    await getPgPool().query('UPDATE chat_rooms SET archived = 1, project_id = NULL WHERE project_id = $1', [id]);
  } catch {}
  const result = await execute('DELETE FROM projects WHERE id = $1', [id]);
  return result.changes > 0;
}

export async function moveSessionToProject(sessionId: string, projectId: string | null): Promise<boolean> {
  // Validate projectId exists if not null
  if (projectId) {
    const project = await queryOne('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (!project) return false;
  }
  const result = await execute('UPDATE sessions SET project_id = $1 WHERE id = $2', [projectId, sessionId]);
  return result.changes > 0;
}

export async function reorderProjects(projectIds: string[]): Promise<void> {
  await transaction(async (client) => {
    const db = withClient(client);
    for (let i = 0; i < projectIds.length; i++) {
      await db.execute('UPDATE projects SET sort_order = $1 WHERE id = $2', [i, projectIds[i]]);
    }
  });
}
