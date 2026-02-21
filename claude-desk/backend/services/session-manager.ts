import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SessionMeta {
  id: string;
  claudeSessionId?: string;
  name: string;
  cwd: string;
  tags: string[];
  favorite: boolean;
  totalCost: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export function createSession(name: string, cwd: string, userId?: number): SessionMeta {
  const id = uuidv4();
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, name, cwd, user_id) VALUES (?, ?, ?, ?)
  `).run(id, name, cwd, userId || null);

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
  };
}

export function updateSession(id: string, updates: Partial<Pick<SessionMeta, 'name' | 'claudeSessionId' | 'totalCost' | 'totalTokens' | 'tags' | 'favorite'>>) {
  const db = getDb();
  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.claudeSessionId !== undefined) { sets.push('claude_session_id = ?'); values.push(updates.claudeSessionId); }
  if (updates.totalCost !== undefined) { sets.push('total_cost = ?'); values.push(updates.totalCost); }
  if (updates.totalTokens !== undefined) { sets.push('total_tokens = ?'); values.push(updates.totalTokens); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
  if (updates.favorite !== undefined) { sets.push('favorite = ?'); values.push(updates.favorite ? 1 : 0); }

  values.push(id);
  db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getSessions(userId?: number): SessionMeta[] {
  const db = getDb();
  const query = userId
    ? db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC')
    : db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');

  const rows = userId ? query.all(userId) : query.all();
  return (rows as any[]).map(row => ({
    id: row.id,
    claudeSessionId: row.claude_session_id,
    name: row.name,
    cwd: row.cwd,
    tags: JSON.parse(row.tags || '[]'),
    favorite: !!row.favorite,
    totalCost: row.total_cost,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getSession(id: string): SessionMeta | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    claudeSessionId: row.claude_session_id,
    name: row.name,
    cwd: row.cwd,
    tags: JSON.parse(row.tags || '[]'),
    favorite: !!row.favorite,
    totalCost: row.total_cost,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
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
