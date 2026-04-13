import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/pg-repo.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAccessibleProjectIds } from './group-manager.js';
import { findJsonlFile } from './jsonl-utils.js';
export type { SessionMeta } from '@tower/shared';
import type { SessionMeta } from '@tower/shared';

export async function createSession(name: string, cwd: string, userId?: number, projectId?: string | null, engine?: string, roomId?: string | null, sourceMessageId?: string | null, parentSessionId?: string | null, label?: string): Promise<SessionMeta> {
  const id = uuidv4();
  // Sessions within a project default to 'project' visibility (shared with members)
  const visibility = projectId ? 'project' : 'private';
  const defaultLabel = label || 'temp';
  await execute(`
    INSERT INTO sessions (id, name, cwd, user_id, project_id, engine, room_id, source_message_id, parent_session_id, visibility, label) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [id, name, cwd, userId || null, projectId || null, engine || 'claude', roomId || null, sourceMessageId || null, parentSessionId || null, visibility, defaultLabel]);

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
    parentSessionId: parentSessionId || null,
    sourceMessageId: sourceMessageId || null,
    label: defaultLabel,
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

/** Get AI Panel sessions for a parent session + user */
export async function getSessionPanelSessions(parentSessionId: string, userId: number): Promise<SessionMeta[]> {
  const rows = await query(
    `SELECT * FROM sessions WHERE parent_session_id = $1 AND user_id = $2 AND (archived IS NULL OR archived = 0) ORDER BY updated_at DESC`,
    [parentSessionId, userId]
  ) as any[];
  return rows.map(mapRow);
}

/** Fields that represent real activity (chat turns, cost) — these bump updated_at.
 *  Metadata-only changes (label, favorite, tags, visibility) do NOT bump updated_at
 *  so that sidebar "last used" times remain accurate. */
const ACTIVITY_FIELDS = new Set(['cwd', 'claudeSessionId', 'totalCost', 'totalTokens', 'modelUsed', 'summary', 'summaryAtTurn', 'turnCount', 'filesEdited']);

export async function updateSession(id: string, updates: Partial<Pick<SessionMeta, 'name' | 'cwd' | 'claudeSessionId' | 'totalCost' | 'totalTokens' | 'tags' | 'favorite' | 'modelUsed' | 'autoNamed' | 'summary' | 'summaryAtTurn' | 'turnCount' | 'filesEdited' | 'visibility' | 'label' | 'engine'>>) {
  const hasActivity = Object.keys(updates).some(k => ACTIVITY_FIELDS.has(k) && (updates as any)[k] !== undefined);
  const sets: string[] = hasActivity ? ['updated_at = CURRENT_TIMESTAMP'] : [];
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
  if ('label' in updates) { sets.push(`label = $${paramIndex++}`); values.push(updates.label || null); }
  if (updates.engine !== undefined) { sets.push(`engine = $${paramIndex++}`); values.push(updates.engine); }

  values.push(id);
  await execute(`UPDATE sessions SET ${sets.join(', ')} WHERE id = $${paramIndex}`, values);
}

export async function getSessions(userId?: number, role?: string): Promise<SessionMeta[]> {
  // LEFT JOIN against pre-aggregated "real user turns" (user messages with type='text').
  // Uses partial index idx_messages_user_text_session — ~14ms on 130k messages.
  const rows = await query(`
    SELECT s.*,
           u.username AS owner_username,
           COALESCE(utc.cnt, 0)::int AS user_turn_count
    FROM sessions s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN (
      SELECT session_id, COUNT(*) AS cnt
      FROM messages
      WHERE role = 'user' AND content LIKE '[{"type":"text"%'
      GROUP BY session_id
    ) utc ON utc.session_id = s.id
    WHERE (s.archived IS NULL OR s.archived = 0)
    ORDER BY s.updated_at DESC
  `) as any[];

  if (userId && role) {
    const accessibleIds = await getAccessibleProjectIds(userId, role);
    if (accessibleIds !== null) {
      // Non-admin: filter by project membership + ownership + visibility
      return rows.filter(r => {
        // System-owned sessions (e.g. channel AI): visible if project-scoped and accessible
        if (r.user_id === null) {
          if (!r.project_id) return r.label === 'channel_ai'; // channel AI without project: show to all
          return accessibleIds.includes(r.project_id);
        }
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    modelUsed: row.model_used || undefined,
    autoNamed: row.auto_named ?? 1,
    summary: row.summary || undefined,
    summaryAtTurn: row.summary_at_turn ?? undefined,
    turnCount: row.turn_count ?? 0,
    userTurnCount: row.user_turn_count ?? 0,
    filesEdited: JSON.parse(row.files_edited || '[]'),
    projectId: row.project_id || null,
    engine: row.engine || 'claude',
    visibility: row.visibility || 'private',
    roomId: row.room_id || null,
    parentSessionId: row.parent_session_id || null,
    sourceMessageId: row.source_message_id || null,
    ownerUsername: row.owner_username || null,
    label: row.label || null,
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
 * Startup audit: log sessions whose .jsonl files are missing.
 * We intentionally do NOT clear claude_session_id — clearing it causes permanent context loss
 * (every subsequent turn silently starts a fresh SDK session with no memory).
 * Instead, sdk.ts will throw an explicit error on resume, telling the user to start a new session.
 */
export async function auditStaleSessions(): Promise<number> {
  const rows = await query(
    `SELECT id, claude_session_id, cwd FROM sessions
     WHERE claude_session_id IS NOT NULL AND claude_session_id != ''
       AND (archived IS NULL OR archived = 0)`
  ) as { id: string; claude_session_id: string; cwd: string }[];

  let stale = 0;
  for (const row of rows) {
    const found = findJsonlFile(row.claude_session_id, row.cwd);
    if (!found) stale++;
  }

  if (stale > 0) {
    console.log(`[session-manager] ${stale} session(s) have missing .jsonl files (will fail on resume with explicit error)`);
  }
  return stale;
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
