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

/** Attach a tool result to the matching tool_use block in DB */
export function attachToolResultInDb(sessionId: string, toolUseId: string, result: string): void {
  const db = getDb();
  // Find assistant messages in this session that contain this tool_use_id
  const rows = db.prepare(
    `SELECT id, content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC`
  ).all(sessionId) as { id: string; content: string }[];

  for (const row of rows) {
    try {
      const content = JSON.parse(row.content);
      let found = false;
      for (const block of content) {
        if (block.type === 'tool_use' && (block.id === toolUseId || block.toolUse?.id === toolUseId)) {
          if (block.toolUse) {
            block.toolUse.result = result;
          } else {
            block.result = result;
          }
          found = true;
          break;
        }
      }
      if (found) {
        db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(JSON.stringify(content), row.id);
        return;
      }
    } catch {}
  }
}

export function deleteMessages(sessionId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
}
