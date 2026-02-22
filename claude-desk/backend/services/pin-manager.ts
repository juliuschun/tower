import { getDb } from '../db/schema.js';
import { loadCommands } from './command-loader.js';

export interface Pin {
  id: number;
  title: string;
  file_path: string;
  file_type: string;
  pin_type: 'file' | 'prompt';
  content: string | null;
  sort_order: number;
  user_id: number | null;
  created_at: string;
}

export interface PromptItem {
  id: number | string;
  title: string;
  content: string;
  source: 'user' | 'commands';
  readonly: boolean;
}

export function getPins(userId?: number): Pin[] {
  const db = getDb();
  if (userId) {
    return db.prepare(
      `SELECT * FROM pins WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC`
    ).all(userId) as Pin[];
  }
  return db.prepare(
    `SELECT * FROM pins ORDER BY sort_order ASC, created_at DESC`
  ).all() as Pin[];
}

export function createPin(title: string, filePath: string, fileType: string, userId?: number): Pin {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO pins (title, file_path, file_type, user_id) VALUES (?, ?, ?, ?)`
  ).run(title, filePath, fileType, userId || null);
  return {
    id: result.lastInsertRowid as number,
    title,
    file_path: filePath,
    file_type: fileType,
    pin_type: 'file',
    content: null,
    sort_order: 0,
    user_id: userId || null,
    created_at: new Date().toISOString(),
  };
}

export function updatePin(id: number, updates: { title?: string; sortOrder?: number }): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(updates.sortOrder); }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE pins SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deletePin(id: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM pins WHERE id = ?`).run(id);
}

export function reorderPins(orderedIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare(`UPDATE pins SET sort_order = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      stmt.run(index, id);
    });
  });
  tx();
}

// ───── Prompt CRUD ─────

export function createPromptPin(title: string, content: string, userId?: number): Pin {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO pins (title, file_path, file_type, pin_type, content, user_id) VALUES (?, '', 'text', 'prompt', ?, ?)`
  ).run(title, content, userId || null);
  return {
    id: result.lastInsertRowid as number,
    title,
    file_path: '',
    file_type: 'text',
    pin_type: 'prompt',
    content,
    sort_order: 0,
    user_id: userId || null,
    created_at: new Date().toISOString(),
  };
}

export function updatePromptPin(id: number, updates: { title?: string; content?: string }): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.content !== undefined) { sets.push('content = ?'); vals.push(updates.content); }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE pins SET ${sets.join(', ')} WHERE id = ? AND pin_type = 'prompt'`).run(...vals);
}

export function getPromptsWithCommands(userId?: number): PromptItem[] {
  const db = getDb();
  const prompts: PromptItem[] = [];

  // DB prompts
  const rows = userId
    ? db.prepare(`SELECT * FROM pins WHERE pin_type = 'prompt' AND user_id = ? ORDER BY sort_order ASC, created_at DESC`).all(userId) as Pin[]
    : db.prepare(`SELECT * FROM pins WHERE pin_type = 'prompt' ORDER BY sort_order ASC, created_at DESC`).all() as Pin[];

  for (const row of rows) {
    prompts.push({
      id: row.id,
      title: row.title,
      content: row.content || '',
      source: 'user',
      readonly: false,
    });
  }

  // Merge ~/.claude/commands/
  const commands = loadCommands();
  for (const cmd of commands) {
    prompts.push({
      id: `cmd:${cmd.name}`,
      title: cmd.name,
      content: cmd.fullContent,
      source: 'commands',
      readonly: true,
    });
  }

  return prompts;
}
