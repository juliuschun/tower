import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/pg-repo.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAccessibleProjectIds } from './group-manager.js';
import { findJsonlFile } from './jsonl-utils.js';
export type { SessionMeta } from '@tower/shared';
import type { SessionMeta } from '@tower/shared';

export async function createSession(name: string, cwd: string, userId?: number, projectId?: string | null, engine?: string, roomId?: string | null, sourceMessageId?: string | null): Promise<SessionMeta> {
  const id = uuidv4();
  // Sessions within a project default to 'project' visibility (shared with members)
  const visibility = projectId ? 'project' : 'private';
  await execute(`
    INSERT INTO sessions (id, name, cwd, user_id, project_id, engine, room_id, source_message_id, visibility) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [id, name, cwd, userId || null, projectId || null, engine || 'claude', roomId || null, sourceMessageId || null, visibility]);

  return {
    id,
    name,
    cwd,
    tags: [],
    favorite: false,
    totalCost: 0,
    totalTokens: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectId: projectId || null,
    engine: engine || 'claude',
    roomId: roomId || null,
    sourceMessageId: sourceMessageId || null,
  };
}

/** Get AI Panel sessions for a specific room + user */
export async function getPanelSessions(roomId: string, userId: number): Promise<SessionMeta[]> {
  const rows = await query(
    `SELECT * FROM sessions WHERE room_id = $1 AND user_id = $2 AND (archived IS NULL OR archived = 0) ORDER BY updated_at DESC`,
    [roomId, userId]
  ) as any[];
  return rows.map(mapRow);
}

export async function updateSession(id: string, updates: Partial<Pick<SessionMeta, 'name' | 'cwd' | 'claudeSessionId' | 'totalCost' | 'totalTokens' | 'tags' | 'favorite' | 'modelUsed' | 'autoNamed' | 'summary' | 'summaryAtTurn' | 'turnCount' | 'filesEdited' | 'visibility'>>) {
  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) { sets.push(`name = $${paramIndex++}`); values.push(updates.name); }
  if (updates.cwd !== undefined) { sets.push(`cwd = $${paramIndex++}`); values.push(updates.cwd); }
  if (updates.claudeSessionId !== undefined) { sets.push(`claude_session_id = $${paramIndex++}`); values.push(updates.claudeSessionId || null); }
  if (updates.totalCost !== undefined) { sets.push(`total_cost = $${paramIndex++}`); values.push(updates.totalCost); }
  if (updates.totalTokens !== undefined) { sets.push(`total_tokens = $${paramIndex++}`); values.push(updates.totalTokens); }
  if (updates.tags !== undefined) { sets.push(`tags = $${paramIndex++}`); values.push(JSON.stringify(updates.tags)); }
  if (updates.favorite !== undefined) { sets.push(`favorite = $${paramIndex++}`); values.push(updates.favorite ? 1 : 0); }
  if (updates.modelUsed !== undefined) { sets.push(`model_used = $${paramIndex++}`); values.push(updates.modelUsed); }
  if (updates.autoNamed !== undefined) { sets.push(`auto_named = $${paramIndex++}`); values.push(updates.autoNamed); }
  if (updates.summary !== undefined) { sets.push(`summary = $${paramIndex++}`); values.push(updates.summary); }
  if (updates.summaryAtTurn !== undefined) { sets.push(`summary_at_turn = $${paramIndex++}`); values.push(updates.summaryAtTurn); }
  if (updates.turnCount !== undefined) { sets.push(`turn_count = $${paramIndex++}`); values.push(updates.turnCount); }
  if (updates.filesEdited !== undefined) { sets.push(`files_edited = $${paramIndex++}`); values.push(JSON.stringify(updates.filesEdited)); }
  if (updates.visibility !== undefined) { sets.push(`visibility = $${paramIndex++}`); values.push(updates.visibility); }

  values.push(id);
  await execute(`UPDATE sessions SET ${sets.join(', ')} WHERE id = $${paramIndex}`, values);
}

export async function getSessions(userId?: number, role?: string): Promise<SessionMeta[]> {
  const rows = await query('SELECT s.*, u.username AS owner_username FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE (s.archived IS NULL OR s.archived = 0) ORDER BY s.updated_at DESC') as any[];

  if (userId && role) {
    const accessibleIds = await getAccessibleProjectIds(userId, role);
    if (accessibleIds !== null) {
      // Non-admin: filter by project membership + ownership + visibility
      return rows.filter(r => {
        // Sessions without a project: visible only to creator
        if (!r.project_id) return r.user_id === userId;
        // Sessions in a project the user isn't a member of: hidden
        if (!accessibleIds.includes(r.project_id)) return false;
        // Project member: see own sessions + shared sessions
        if (r.user_id === userId) return true;
        return r.visibility === 'project';
      }).map(mapRow);
    }
  }

  // Admin or no auth: show all
  return rows.map(mapRow);
}

function mapRow(row: any): SessionMeta {
  return {
    id: row.id,
    claudeSessionId: row.claude_session_id || undefined,
    name: row.name,
    cwd: row.cwd,
    tags: JSON.parse(row.tags || '[]'),
    favorite: !!row.favorite,
    totalCost: row.total_cost,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    modelUsed: row.model_used || undefined,
    autoNamed: row.auto_named ?? 1,
    summary: row.summary || undefined,
    summaryAtTurn: row.summary_at_turn ?? undefined,
    turnCount: row.turn_count ?? 0,
    filesEdited: JSON.parse(row.files_edited || '[]'),
    projectId: row.project_id || null,
    engine: row.engine || 'claude',
    visibility: row.visibility || 'private',
    roomId: row.room_id || null,
    sourceMessageId: row.source_message_id || null,
    ownerUsername: row.owner_username || null,
  };
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  const row = await queryOne('SELECT * FROM sessions WHERE id = $1', [id]) as any;
  if (!row) return null;
  return mapRow(row);
}

export async function deleteSession(id: string): Promise<boolean> {
  // Soft-delete: hide from sidebar, preserve data for recovery
  const result = await execute('UPDATE sessions SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  return result.changes > 0;
}

export async function getArchivedSessions(userId?: number, role?: string): Promise<SessionMeta[]> {
  const rows = await query(
    'SELECT * FROM sessions WHERE archived = 1 ORDER BY updated_at DESC'
  ) as any[];

  // Apply same project access control as getSessions
  if (userId && role) {
    const accessibleIds = await getAccessibleProjectIds(userId, role);
    // admin → accessibleIds === null → show all
    if (accessibleIds === null) return rows.map(mapRow);
    // non-admin → filter by ownership + project membership
    return rows.filter(r => {
      if (!r.project_id) return r.user_id === userId;
      if (!accessibleIds.includes(r.project_id)) return false;
      if (r.user_id === userId) return true;
      return r.visibility === 'project';
    }).map(mapRow);
  }

  // No auth context: return all (backward compat)
  return rows.map(mapRow);
}

export async function restoreSession(id: string): Promise<boolean> {
  const result = await execute('UPDATE sessions SET archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  return result.changes > 0;
}

export async function permanentlyDeleteSession(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM sessions WHERE id = $1', [id]);
  return result.changes > 0;
}


/**
 * Startup cleanup: clear stale claudeSessionId values where the .jsonl file no longer exists.
 * Without this, the first message in a chat session after restart tries to resume from a gone
 * .jsonl file. Kanban tasks already handle this via recoverZombieTasks(), but regular chat
 * sessions had no equivalent — causing resume failures only for chat.
 */
export async function cleanupStaleSessions(): Promise<number> {
  const rows = await query(
    `SELECT id, claude_session_id, cwd FROM sessions
     WHERE claude_session_id IS NOT NULL AND claude_session_id != ''
       AND (archived IS NULL OR archived = 0)`
  ) as { id: string; claude_session_id: string; cwd: string }[];

  let cleared = 0;
  for (const row of rows) {
    // Search beyond the DB cwd — .jsonl may be in a different project directory
    // (e.g. session created via project feature with project-specific cwd)
    const found = findJsonlFile(row.claude_session_id, row.cwd);

    if (!found) {
      await execute('UPDATE sessions SET claude_session_id = NULL WHERE id = $1', [row.id]);
      cleared++;
    }
  }

  if (cleared > 0) {
    console.log(`[session-manager] Cleared ${cleared} stale claudeSessionId(s) (missing .jsonl files)`);
  }
  return cleared;
}

/** Scan Claude native session files from ~/.claude/projects/ */
export function scanClaudeNativeSessions(): { sessionId: string; projectPath: string; modified: string }[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  const sessions: { sessionId: string; projectPath: string; modified: string }[] = [];

  try {
    const projectDirs = fs.readdirSync(claudeDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = path.join(claudeDir, dir.name);
      const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = path.join(projectPath, file);
        const stat = fs.statSync(filePath);
        sessions.push({
          sessionId: file.replace('.jsonl', ''),
          projectPath: dir.name,
          modified: stat.mtime.toISOString(),
        });
      }
    }
  } catch {}

  return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
}
