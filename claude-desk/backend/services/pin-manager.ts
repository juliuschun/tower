import { getDb } from '../db/schema.js';

export interface Pin {
  id: number;
  title: string;
  file_path: string;
  file_type: string;
  sort_order: number;
  user_id: number | null;
  created_at: string;
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
