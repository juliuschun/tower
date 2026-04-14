/**
 * Room Repository — Pure data-access layer for room-related tables.
 *
 * All raw SQL queries live here. Zero business logic, zero broadcasting.
 * Uses pg-repo.ts helpers exclusively (no direct getPgPool() calls).
 */

import { query, queryOne, execute, transaction, withClient } from '../db/pg-repo.js';
import type { PoolClient } from 'pg';

// ── Row types (raw DB rows before domain mapping) ───────────────────

export type RoomRow = any;
export type MemberRow = any;
export type MessageRow = any;

// ── Room Queries ────────────────────────────────────────────────────

export async function insertRoom(
  name: string,
  description: string | null,
  roomType: string,
  projectId: string | null,
  createdBy: number,
): Promise<RoomRow> {
  return queryOne(
    `INSERT INTO chat_rooms (name, description, room_type, project_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, description, roomType, projectId, createdBy],
  );
}

export async function findRoomById(roomId: string): Promise<RoomRow | undefined> {
  return queryOne(
    'SELECT * FROM chat_rooms WHERE id = $1',
    [roomId],
  );
}

export async function findAllActiveRooms(): Promise<RoomRow[]> {
  return query(
    `SELECT * FROM chat_rooms WHERE (archived IS NULL OR archived = 0) ORDER BY updated_at DESC`,
  );
}

export async function updateRoomFields(
  roomId: string,
  sets: string[],
  vals: any[],
  idx: number,
): Promise<RoomRow | undefined> {
  sets.push(`updated_at = NOW()`);
  vals.push(roomId);

  const rows = await query(
    `UPDATE chat_rooms SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals,
  );
  return rows[0];
}

export async function deleteRoomById(roomId: string): Promise<number> {
  const { changes } = await execute(
    'DELETE FROM chat_rooms WHERE id = $1',
    [roomId],
  );
  return changes;
}

// ── Member Queries ──────────────────────────────────────────────────

export async function upsertMember(
  roomId: string,
  userId: number,
  role: string,
): Promise<MemberRow> {
  const row = await queryOne(
    `INSERT INTO room_members (room_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [roomId, userId, role],
  );
  return row;
}

export async function insertMemberIfNotExists(
  roomId: string,
  userId: number,
  role: string,
): Promise<void> {
  await execute(
    `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    [roomId, userId, role],
  );
}

export async function batchInsertMembersIfNotExists(
  entries: Array<{ roomId: string; userId: number; role: string }>,
): Promise<string[]> {
  if (entries.length === 0) return [];

  const placeholders: string[] = [];
  const values: any[] = [];
  entries.forEach((entry, i) => {
    const base = i * 2;
    placeholders.push(`($${base + 1}, $${base + 2}, '${entry.role}')`);
    values.push(entry.roomId, entry.userId);
  });

  const rows = await query<{ room_id: string }>(
    `INSERT INTO room_members (room_id, user_id, role)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT DO NOTHING
     RETURNING room_id`,
    values,
  );
  return rows.map(r => r.room_id);
}

export async function deleteMember(roomId: string, userId: number): Promise<number> {
  const { changes } = await execute(
    'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return changes;
}

export async function findMembersByRoom(roomId: string): Promise<MemberRow[]> {
  return query(
    'SELECT * FROM room_members WHERE room_id = $1 ORDER BY joined_at ASC',
    [roomId],
  );
}

export async function updateMemberRoleRow(
  roomId: string,
  userId: number,
  role: string,
): Promise<number> {
  const { changes } = await execute(
    'UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3',
    [role, roomId, userId],
  );
  return changes;
}

export async function updateLastReadAt(roomId: string, userId: number): Promise<void> {
  await execute(
    'UPDATE room_members SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
}

export async function findMembership(roomId: string, userId: number): Promise<{ exists: boolean }> {
  const row = await queryOne<any>(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return { exists: !!row };
}

export async function findMemberRole(roomId: string, userId: number): Promise<string | null> {
  const row = await queryOne<{ role: string }>(
    'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return row?.role ?? null;
}

export async function findMemberRoomIds(userId: number, roomIds: string[]): Promise<Set<string>> {
  if (roomIds.length === 0) return new Set();
  const rows = await query<{ room_id: string }>(
    `SELECT room_id FROM room_members WHERE user_id = $1 AND room_id = ANY($2::text[])`,
    [userId, roomIds],
  );
  return new Set(rows.map(r => r.room_id));
}

export async function findUserIdsByRoom(roomId: string): Promise<number[]> {
  const rows = await query<{ user_id: number }>(
    'SELECT user_id FROM room_members WHERE room_id = $1',
    [roomId],
  );
  return rows.map(r => r.user_id);
}

export async function findAllDistinctMemberUserIds(): Promise<number[]> {
  const rows = await query<{ user_id: number }>(
    'SELECT DISTINCT user_id FROM room_members',
  );
  return rows.map(r => r.user_id);
}

export async function deleteAllMembershipsForUser(userId: number): Promise<void> {
  await execute(
    'DELETE FROM room_members WHERE user_id = $1',
    [userId],
  );
}

export async function roomExistsById(roomId: string): Promise<boolean> {
  const row = await queryOne<any>(
    'SELECT 1 FROM chat_rooms WHERE id = $1',
    [roomId],
  );
  return !!row;
}

export async function findAllRoomIds(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM chat_rooms',
  );
  return rows.map(r => r.id);
}

// ── Message Queries ─────────────────────────────────────────────────

export async function insertMessage(
  roomId: string,
  senderId: number | null,
  msgType: string,
  content: string,
  metadata: string,
  taskId: string | null,
  replyTo: string | null,
): Promise<MessageRow> {
  return queryOne(
    `INSERT INTO room_messages (room_id, sender_id, msg_type, content, metadata, task_id, reply_to)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING *`,
    [roomId, senderId, msgType, content, metadata, taskId, replyTo],
  );
}

export async function findMessages(
  roomId: string,
  conditions: string[],
  vals: any[],
  limitIdx: number,
): Promise<MessageRow[]> {
  return query(
    `SELECT * FROM room_messages
     WHERE ${conditions.join(' AND ')}
     ORDER BY seq ASC
     LIMIT $${limitIdx}`,
    vals,
  );
}

export async function updateMessageContent(
  messageId: string,
  content: string,
): Promise<MessageRow | undefined> {
  return queryOne(
    `UPDATE room_messages SET content = $1, edited_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [content, messageId],
  );
}

export async function softDeleteMessage(messageId: string): Promise<number> {
  const { changes } = await execute(
    'UPDATE room_messages SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
    [messageId],
  );
  return changes;
}

export async function findMessageById(messageId: string): Promise<MessageRow | undefined> {
  return queryOne(
    'SELECT * FROM room_messages WHERE id = $1',
    [messageId],
  );
}

export async function findMessageRef(messageId: string): Promise<{ id: string; room_id: string } | undefined> {
  return queryOne<{ id: string; room_id: string }>(
    'SELECT id, room_id FROM room_messages WHERE id = $1',
    [messageId],
  );
}

export async function insertSystemMessage(
  roomId: string,
  msgType: string,
  content: string,
  metadata: string,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO room_messages (room_id, sender_id, msg_type, content, metadata)
     VALUES ($1, NULL, $2, $3, $4::jsonb)
     RETURNING id`,
    [roomId, msgType, content, metadata],
  );
  return row!.id;
}

export async function findTaskRefMessageIds(): Promise<Array<{ messageId: string; taskId: string }>> {
  const rows = await query<{ message_id: string; task_id: string }>(
    `SELECT id AS message_id, task_id FROM room_messages
     WHERE msg_type = 'ai_task_ref' AND task_id IS NOT NULL AND deleted_at IS NULL`,
  );
  return rows.map(r => ({ messageId: r.message_id, taskId: r.task_id }));
}

// ── Unread Counts ───────────────────────────────────────────────────

export async function findUnreadCounts(userId: number): Promise<Array<{ room_id: string; unread: number }>> {
  return query<{ room_id: string; unread: number }>(
    `SELECT m.room_id, COUNT(msg.id)::INTEGER AS unread
     FROM room_members m
     JOIN room_messages msg
       ON msg.room_id = m.room_id
       AND msg.created_at > m.last_read_at
       AND msg.deleted_at IS NULL
     WHERE m.user_id = $1
     GROUP BY m.room_id`,
    [userId],
  );
}

// ── Channel AI Session Queries ──────────────────────────────────────

export async function findChannelAiSession(
  roomId: string,
): Promise<{ id: string; claude_session_id: string | null; turn_count: number | null } | undefined> {
  return queryOne<{ id: string; claude_session_id: string | null; turn_count: number | null }>(
    `SELECT id, claude_session_id, turn_count
     FROM sessions
     WHERE room_id = $1 AND label = 'channel_ai' AND (archived IS NULL OR archived = 0)
     ORDER BY updated_at DESC LIMIT 1`,
    [roomId],
  );
}

export async function incrementSessionTurnCount(sessionId: string): Promise<void> {
  await execute(
    `UPDATE sessions SET turn_count = COALESCE(turn_count, 0) + 1, updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

export async function syncRoomAiSession(
  roomId: string,
  engineSessionId: string,
): Promise<void> {
  await execute(
    `UPDATE chat_rooms
     SET ai_engine_session_id = $2,
         ai_session_created_at = COALESCE(ai_session_created_at, NOW()),
         ai_session_message_count = COALESCE(ai_session_message_count, 0) + 1
     WHERE id = $1`,
    [roomId, engineSessionId],
  );
}

export async function archiveChannelAiSessions(roomId: string): Promise<void> {
  await execute(
    `UPDATE sessions SET archived = 1, updated_at = NOW()
     WHERE room_id = $1 AND label = 'channel_ai' AND (archived IS NULL OR archived = 0)`,
    [roomId],
  );
}

export async function clearRoomAiSessionCache(roomId: string): Promise<void> {
  await execute(
    `UPDATE chat_rooms
     SET ai_engine_session_id = NULL,
         ai_session_created_at = NULL,
         ai_session_message_count = 0
     WHERE id = $1`,
    [roomId],
  );
}

// ── AI Context Queries ──────────────────────────────────────────────

export async function insertAiContext(
  roomId: string,
  content: string,
  tokenCount: number,
  sourceTaskId: string,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO room_ai_context (room_id, context_type, content, token_count, source_task_id)
     VALUES ($1, 'task_summary', $2, $3, $4)
     RETURNING id`,
    [roomId, content, tokenCount, sourceTaskId],
  );
  return row!.id;
}

export async function findAiContexts(
  roomId: string,
  limit: number,
): Promise<any[]> {
  return query(
    `SELECT id, content, token_count, source_task_id, created_at, expires_at
     FROM room_ai_context
     WHERE room_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC
     LIMIT $2`,
    [roomId, limit],
  );
}

export async function deleteExpiredContexts(): Promise<number> {
  const { changes } = await execute(
    'DELETE FROM room_ai_context WHERE expires_at IS NOT NULL AND expires_at <= NOW()',
  );
  return changes;
}

// ── Notification Queries ────────────────────────────────────────────

export async function insertNotification(
  id: string,
  userId: number,
  roomId: string | null,
  type: string,
  title: string,
  body: string | null,
  metadataJson: string,
): Promise<void> {
  await execute(
    `INSERT INTO notifications (id, user_id, room_id, notif_type, title, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [id, userId, roomId, type, title, body, metadataJson],
  );
}

export async function batchInsertNotifications(
  rows: string[],
  vals: any[],
): Promise<void> {
  await execute(
    `INSERT INTO notifications (id, user_id, room_id, notif_type, title, body, metadata)
     VALUES ${rows.join(', ')}`,
    vals,
  );
}

export async function findNotifications(
  userId: number,
  unreadOnly: boolean,
  limit: number,
): Promise<any[]> {
  const conditions = ['user_id = $1'];
  const vals: any[] = [userId];

  if (unreadOnly) {
    conditions.push('read = 0');
  }

  vals.push(limit);

  return query(
    `SELECT * FROM notifications
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${vals.length}`,
    vals,
  );
}

export async function markNotificationReadById(notifId: string, userId?: number): Promise<number> {
  const sql = userId
    ? 'UPDATE notifications SET read = 1 WHERE id = $1 AND user_id = $2'
    : 'UPDATE notifications SET read = 1 WHERE id = $1';
  const params: any[] = userId ? [notifId, userId] : [notifId];
  const { changes } = await execute(sql, params);
  return changes;
}

export async function markAllNotificationsReadForUser(userId: number): Promise<number> {
  const { changes } = await execute(
    'UPDATE notifications SET read = 1 WHERE user_id = $1 AND read = 0',
    [userId],
  );
  return changes;
}

export async function countUnreadNotifications(userId: number): Promise<number> {
  const row = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM notifications WHERE user_id = $1 AND read = 0',
    [userId],
  );
  return row?.cnt ?? 0;
}

// ── User Queries (cross-DB, SQLite via pgRepoQuery) ────────────────

export async function findUserRole(userId: number): Promise<string | undefined> {
  const row = await queryOne<{ role: string }>(
    'SELECT role FROM users WHERE id = $1',
    [userId],
  );
  return row?.role;
}

export async function findFellowGroupMembers(
  groupIds: number[],
  excludeUserId: number,
): Promise<Array<{ id: number }>> {
  const placeholders = groupIds.map((_, i) => `$${i + 1}`).join(',');
  return query<{ id: number }>(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_groups ug ON ug.user_id = u.id
     WHERE ug.group_id IN (${placeholders}) AND u.id != $${groupIds.length + 1} AND u.disabled = 0`,
    [...groupIds, excludeUserId],
  );
}
