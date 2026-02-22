import { getDb } from '../db/schema.js';

export interface StoredMessage {
  id: string;
  session_id: string;
  role: string;
  content: string; // JSON string of ContentBlock[]
  parent_tool_use_id?: string | null;
  created_at?: string;
}

export function saveMessage(
  sessionId: string,
  msg: { id: string; role: string; content: any; parentToolUseId?: string | null }
): void {
  const db = getDb();
  const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, session_id, role, content, parent_tool_use_id) VALUES (?, ?, ?, ?, ?)`
  ).run(msg.id, sessionId, msg.role, contentStr, msg.parentToolUseId || null);
}

export function getMessages(sessionId: string): StoredMessage[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId) as StoredMessage[];
}

export function updateMessageContent(messageId: string, content: any): void {
  const db = getDb();
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(contentStr, messageId);
}

export function deleteMessages(sessionId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
}
