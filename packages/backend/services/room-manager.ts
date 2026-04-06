/**
 * Room Manager — PostgreSQL-backed room CRUD + PgAdapter implementation.
 *
 * All room data (chat_rooms, room_members, room_messages, room_ai_context,
 * notifications, attachments) lives in PG.  User data lives in SQLite.
 * This module bridges the two.
 */

import { v4 as uuidv4 } from 'uuid';
import { getPgPool } from '../db/pg.js';
import { queryOne, query as pgRepoQuery } from '../db/pg-repo.js';
import { getAccessibleProjectIds } from './group-manager.js';
import type { PgAdapter } from './cross-db.js';

// ── Types ────────────────────────────────────────────────────────────

export interface Room {
  id: string;
  name: string;
  description: string | null;
  roomType: 'team' | 'project' | 'dashboard';
  projectId: string | null;
  avatarUrl: string | null;
  archived: boolean;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomMember {
  roomId: string;
  userId: number;
  username: string;
  role: 'owner' | 'admin' | 'member' | 'readonly';
  joinedAt: string;
  lastReadAt: string;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  senderId: number | null;
  senderName: string | null;
  seq: number;
  msgType: 'human' | 'ai_summary' | 'ai_task_ref' | 'ai_error' | 'ai_reply' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  taskId: string | null;
  replyTo: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

// ── Validation Helpers ───────────────────────────────────────────────

const VALID_ROOM_TYPES = new Set(['team', 'project', 'dashboard']);
const VALID_MEMBER_ROLES = new Set(['owner', 'admin', 'member', 'readonly']);
const VALID_MSG_TYPES = new Set(['human', 'ai_summary', 'ai_task_ref', 'ai_error', 'ai_reply', 'system']);

function assertRoomType(v: string): asserts v is Room['roomType'] {
  if (!VALID_ROOM_TYPES.has(v)) throw new Error(`Invalid room type: ${v}`);
}

function assertMemberRole(v: string): asserts v is RoomMember['role'] {
  if (!VALID_MEMBER_ROLES.has(v)) throw new Error(`Invalid member role: ${v}`);
}

function assertMsgType(v: string): asserts v is RoomMessage['msgType'] {
  if (!VALID_MSG_TYPES.has(v)) throw new Error(`Invalid message type: ${v}`);
}

// ── Username Cache (SQLite → memory) ─────────────────────────────────

const usernameCache = new Map<number, string>();

async function lookupUsername(userId: number): Promise<string | null> {
  const cached = usernameCache.get(userId);
  if (cached !== undefined) return cached;

  const row = await queryOne<{ username: string }>(
    'SELECT username FROM users WHERE id = $1', [userId]
  );

  if (row) {
    usernameCache.set(userId, row.username);
    return row.username;
  }
  return null;
}

/** Clear cache entry (e.g. after user rename). */
export function invalidateUsernameCache(userId?: number): void {
  if (userId !== undefined) {
    usernameCache.delete(userId);
  } else {
    usernameCache.clear();
  }
}

// ── Row → Domain Mappers ─────────────────────────────────────────────

function rowToRoom(r: any): Room {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    roomType: r.room_type,
    projectId: r.project_id ?? null,
    avatarUrl: r.avatar_url ?? null,
    archived: !!r.archived,
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

async function rowToMessage(r: any): Promise<RoomMessage> {
  return {
    id: r.id,
    roomId: r.room_id,
    senderId: r.sender_id ?? null,
    senderName: r.sender_id != null ? await lookupUsername(r.sender_id) : null,
    seq: Number(r.seq),
    msgType: r.msg_type,
    content: r.content,
    metadata: r.metadata ?? {},
    taskId: r.task_id ?? null,
    replyTo: r.reply_to ?? null,
    editedAt: r.edited_at ? (r.edited_at instanceof Date ? r.edited_at.toISOString() : String(r.edited_at)) : null,
    deletedAt: r.deleted_at ? (r.deleted_at instanceof Date ? r.deleted_at.toISOString() : String(r.deleted_at)) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

async function rowToMember(r: any): Promise<RoomMember> {
  return {
    roomId: r.room_id,
    userId: r.user_id,
    username: (await lookupUsername(r.user_id)) ?? `user_${r.user_id}`,
    role: r.role,
    joinedAt: r.joined_at instanceof Date ? r.joined_at.toISOString() : String(r.joined_at),
    lastReadAt: r.last_read_at instanceof Date ? r.last_read_at.toISOString() : String(r.last_read_at ?? r.joined_at),
  };
}

// ── Room CRUD ────────────────────────────────────────────────────────

export async function createRoom(
  name: string,
  description: string | null,
  roomType: string,
  createdBy: number,
  projectId?: string,
): Promise<Room> {
  assertRoomType(roomType);
  const pool = getPgPool();

  const { rows } = await pool.query(
    `INSERT INTO chat_rooms (name, description, room_type, project_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, description, roomType, projectId ?? null, createdBy],
  );
  const room = rowToRoom(rows[0]);

  // Auto-add creator as owner
  await pool.query(
    `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [room.id, createdBy],
  );

  // Auto-add fellow group members (from SQLite groups)
  try {
    const { getUserGroups } = await import('./group-manager.js');
    const creatorGroups = await getUserGroups(createdBy);
    if (creatorGroups.length > 0) {
      const groupIds = creatorGroups.map((g: any) => g.id);
      const placeholders = groupIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      const fellowMembers = await pgRepoQuery<{ id: number }>(
        `SELECT DISTINCT u.id FROM users u
         JOIN user_groups ug ON ug.user_id = u.id
         WHERE ug.group_id IN (${placeholders}) AND u.id != $${groupIds.length + 1} AND u.disabled = 0`,
        [...groupIds, createdBy]
      );

      for (const member of fellowMembers) {
        await pool.query(
          `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member')
           ON CONFLICT (room_id, user_id) DO NOTHING`,
          [room.id, member.id],
        );
      }
      if (fellowMembers.length > 0) {
        console.log(`[room-manager] Auto-added ${fellowMembers.length} group member(s) to room "${name}"`);
      }
    }
  } catch (err: any) {
    console.error(`[room-manager] Failed to auto-add group members:`, err.message);
  }

  // Auto-add project members if room belongs to a project
  if (projectId) {
    try {
      const { getProjectMembers } = await import('./group-manager.js');
      const members = await getProjectMembers(projectId);
      for (const m of members) {
        if (m.userId === createdBy) continue; // already owner
        await pool.query(
          `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member')
           ON CONFLICT (room_id, user_id) DO NOTHING`,
          [room.id, m.userId],
        );
      }
    } catch (err: any) {
      console.error(`[room-manager] Failed to auto-add project members:`, err.message);
    }
  }

  return room;
}

export async function getRoom(roomId: string): Promise<Room | null> {
  const { rows } = await getPgPool().query(
    'SELECT * FROM chat_rooms WHERE id = $1',
    [roomId],
  );
  return rows.length > 0 ? rowToRoom(rows[0]) : null;
}

export async function listRooms(userId: number, role?: string): Promise<Room[]> {
  const pool = getPgPool();
  const userRole = role || (await queryOne<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]))?.role || 'member';
  const isAdmin = userRole === 'admin';

  // Admin: see all rooms, auto-join as admin
  if (isAdmin) {
    const { rows } = await pool.query(
      `SELECT * FROM chat_rooms WHERE (archived IS NULL OR archived = 0) ORDER BY updated_at DESC`,
    );
    for (const room of rows) {
      await pool.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
        [room.id, userId],
      );
    }
    return rows.map(rowToRoom);
  }

  // Non-admin: rooms where user is a member OR room belongs to an accessible project
  const accessibleIds = await getAccessibleProjectIds(userId, userRole);

  const { rows } = await pool.query(
    `SELECT * FROM chat_rooms WHERE (archived IS NULL OR archived = 0) ORDER BY updated_at DESC`,
  );

  const visible = rows.filter(r => {
    // Room without project: must be explicit member
    if (!r.project_id) return true; // will check room_members below
    // Room with project: visible if user has project access
    if (accessibleIds === null) return true; // admin fallback
    return accessibleIds.includes(r.project_id);
  });

  // Auto-join project rooms the user can see (so they appear in room_members)
  // Only auto-join rooms WITH a project — non-project rooms require explicit invitation
  for (const room of visible) {
    if (room.project_id) {
      await pool.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [room.id, userId],
      );
    }
  }

  // For non-project rooms, only return if user is already a member
  const result: Room[] = [];
  for (const room of visible) {
    if (room.project_id) {
      result.push(rowToRoom(room));
    } else {
      const { rows: memberRows } = await pool.query(
        `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`,
        [room.id, userId],
      );
      if (memberRows.length > 0) result.push(rowToRoom(room));
    }
  }

  return result;
}

export async function updateRoom(
  roomId: string,
  updates: { name?: string; description?: string; archived?: boolean; projectId?: string | null },
): Promise<Room | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${idx++}`);
    vals.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${idx++}`);
    vals.push(updates.description);
  }
  if (updates.archived !== undefined) {
    sets.push(`archived = $${idx++}`);
    vals.push(updates.archived ? 1 : 0);  // column is INTEGER, not BOOLEAN
  }
  if (updates.projectId !== undefined) {
    sets.push(`project_id = $${idx++}`);
    vals.push(updates.projectId);
  }

  if (sets.length === 0) return getRoom(roomId);

  sets.push(`updated_at = NOW()`);
  vals.push(roomId);

  const { rows } = await getPgPool().query(
    `UPDATE chat_rooms SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals,
  );
  return rows.length > 0 ? rowToRoom(rows[0]) : null;
}

export async function deleteRoom(roomId: string): Promise<boolean> {
  const { rowCount } = await getPgPool().query(
    'DELETE FROM chat_rooms WHERE id = $1',
    [roomId],
  );
  return (rowCount ?? 0) > 0;
}

// ── Members ──────────────────────────────────────────────────────────

export async function addMember(
  roomId: string,
  userId: number,
  role: string = 'member',
): Promise<RoomMember> {
  assertMemberRole(role);
  const { rows } = await getPgPool().query(
    `INSERT INTO room_members (room_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [roomId, userId, role],
  );
  return await rowToMember(rows[0]);
}

export async function removeMember(roomId: string, userId: number): Promise<boolean> {
  const { rowCount } = await getPgPool().query(
    'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getMembers(roomId: string): Promise<RoomMember[]> {
  const { rows } = await getPgPool().query(
    'SELECT * FROM room_members WHERE room_id = $1 ORDER BY joined_at ASC',
    [roomId],
  );
  return await Promise.all(rows.map(rowToMember));
}

export async function updateMemberRole(
  roomId: string,
  userId: number,
  role: string,
): Promise<boolean> {
  assertMemberRole(role);
  const { rowCount } = await getPgPool().query(
    'UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3',
    [role, roomId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function updateLastRead(roomId: string, userId: number): Promise<void> {
  await getPgPool().query(
    'UPDATE room_members SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
}

export async function isMember(roomId: string, userId: number): Promise<boolean> {
  const { rows } = await getPgPool().query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return rows.length > 0;
}

export async function getMemberRole(roomId: string, userId: number): Promise<string | null> {
  const { rows } = await getPgPool().query(
    'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return rows.length > 0 ? rows[0].role : null;
}

// ── Messages ─────────────────────────────────────────────────────────

export async function sendMessage(
  roomId: string,
  senderId: number | null,
  content: string,
  msgType: string = 'human',
  metadata: Record<string, unknown> = {},
  taskId?: string,
  replyTo?: string,
): Promise<RoomMessage> {
  assertMsgType(msgType);
  const { rows } = await getPgPool().query(
    `INSERT INTO room_messages (room_id, sender_id, msg_type, content, metadata, task_id, reply_to)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING *`,
    [roomId, senderId, msgType, content, JSON.stringify(metadata), taskId ?? null, replyTo ?? null],
  );
  return await rowToMessage(rows[0]);
}

export async function getMessages(
  roomId: string,
  options: { limit?: number; before?: string; after?: string } = {},
): Promise<RoomMessage[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const conditions = ['room_id = $1', 'deleted_at IS NULL'];
  const vals: any[] = [roomId];
  let idx = 2;

  if (options.before) {
    // before = seq cursor
    conditions.push(`seq < $${idx++}`);
    vals.push(options.before);
  }
  if (options.after) {
    conditions.push(`seq > $${idx++}`);
    vals.push(options.after);
  }

  vals.push(limit);

  const { rows } = await getPgPool().query(
    `SELECT * FROM room_messages
     WHERE ${conditions.join(' AND ')}
     ORDER BY seq ASC
     LIMIT $${idx}`,
    vals,
  );
  return await Promise.all(rows.map(rowToMessage));
}

export async function editMessage(messageId: string, content: string): Promise<RoomMessage | null> {
  const { rows } = await getPgPool().query(
    `UPDATE room_messages SET content = $1, edited_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [content, messageId],
  );
  return rows.length > 0 ? await rowToMessage(rows[0]) : null;
}

export async function deleteMessage(messageId: string): Promise<boolean> {
  const { rowCount } = await getPgPool().query(
    'UPDATE room_messages SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
    [messageId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getMessage(messageId: string): Promise<RoomMessage | null> {
  const { rows } = await getPgPool().query(
    'SELECT * FROM room_messages WHERE id = $1',
    [messageId],
  );
  return rows.length > 0 ? await rowToMessage(rows[0]) : null;
}

// ── Unread Counts ────────────────────────────────────────────────────

export async function getUnreadCounts(userId: number): Promise<Map<string, number>> {
  const { rows } = await getPgPool().query(
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

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.room_id, row.unread);
  }
  return counts;
}

// ── AI Session (Persistent Channel AI) ──────────────────────────────
// Channel AI sessions live in the sessions table with label = 'channel_ai'.
// The chat_rooms table stores ai_engine_session_id as a cache for quick resume.

export interface ChannelAiSession {
  sessionId: string;          // Tower session ID (sessions table)
  engineSessionId: string | null;  // SDK session ID (for resume)
  messageCount: number;
}

/**
 * Get or create the persistent channel AI session for a room.
 * Looks up sessions table first; falls back to chat_rooms cache.
 */
export async function getOrCreateChannelAiSession(
  roomId: string,
  roomName: string,
  userId: number,
  projectId: string | null,
  engine: string,
): Promise<ChannelAiSession> {
  const pool = getPgPool();

  // 1. Look up existing channel_ai session in sessions table
  const { rows } = await pool.query(
    `SELECT id, claude_session_id, turn_count
     FROM sessions
     WHERE room_id = $1 AND label = 'channel_ai' AND (archived IS NULL OR archived = 0)
     ORDER BY updated_at DESC LIMIT 1`,
    [roomId],
  );

  if (rows.length > 0) {
    return {
      sessionId: rows[0].id,
      engineSessionId: rows[0].claude_session_id ?? null,
      messageCount: rows[0].turn_count ?? 0,
    };
  }

  // 2. No session exists — create one
  const { createSession, updateSession } = await import('./session-manager.js');
  const session = await createSession(
    `Channel AI: ${roomName}`,
    '/home/enterpriseai',  // default cwd
    userId,
    projectId,
    engine,
    roomId,
  );
  await updateSession(session.id, { label: 'channel_ai' });

  return {
    sessionId: session.id,
    engineSessionId: null,
    messageCount: 0,
  };
}

/**
 * Update channel AI session after a successful reply.
 * Syncs both sessions table and chat_rooms cache.
 */
export async function updateChannelAiSession(
  roomId: string,
  sessionId: string,
  engineSessionId: string,
): Promise<void> {
  const pool = getPgPool();

  // Update sessions table
  const { updateSession } = await import('./session-manager.js');
  await updateSession(sessionId, {
    claudeSessionId: engineSessionId,
    turnCount: undefined,  // will be incremented below
  });

  // Increment turn count
  await pool.query(
    `UPDATE sessions SET turn_count = COALESCE(turn_count, 0) + 1, updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );

  // Sync chat_rooms cache
  await pool.query(
    `UPDATE chat_rooms
     SET ai_engine_session_id = $2,
         ai_session_created_at = COALESCE(ai_session_created_at, NOW()),
         ai_session_message_count = COALESCE(ai_session_message_count, 0) + 1
     WHERE id = $1`,
    [roomId, engineSessionId],
  );
}

/**
 * Clear channel AI session (on @ai /reset).
 * Archives the session and clears the room cache.
 */
export async function clearChannelAiSession(roomId: string): Promise<void> {
  const pool = getPgPool();

  // Archive existing channel_ai session(s)
  await pool.query(
    `UPDATE sessions SET archived = 1, updated_at = NOW()
     WHERE room_id = $1 AND label = 'channel_ai' AND (archived IS NULL OR archived = 0)`,
    [roomId],
  );

  // Clear room cache
  await pool.query(
    `UPDATE chat_rooms
     SET ai_engine_session_id = NULL,
         ai_session_created_at = NULL,
         ai_session_message_count = 0
     WHERE id = $1`,
    [roomId],
  );
}

// ── AI Context ───────────────────────────────────────────────────────

export async function saveAiContext(
  roomId: string,
  content: string,
  tokenCount: number,
  sourceTaskId: string,
): Promise<string> {
  const { rows } = await getPgPool().query(
    `INSERT INTO room_ai_context (room_id, context_type, content, token_count, source_task_id)
     VALUES ($1, 'task_summary', $2, $3, $4)
     RETURNING id`,
    [roomId, content, tokenCount, sourceTaskId],
  );
  return rows[0].id;
}

export async function getAiContexts(
  roomId: string,
  limit: number = 10,
): Promise<{ id: string; content: string; tokenCount: number; sourceTaskId: string | null; createdAt: string; expiresAt: string | null }[]> {
  const { rows } = await getPgPool().query(
    `SELECT id, content, token_count, source_task_id, created_at, expires_at
     FROM room_ai_context
     WHERE room_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC
     LIMIT $2`,
    [roomId, limit],
  );
  return rows.map((r: any) => ({
    id: r.id,
    content: r.content,
    tokenCount: r.token_count,
    sourceTaskId: r.source_task_id ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    expiresAt: r.expires_at ? (r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at)) : null,
  }));
}

export async function cleanupExpiredContexts(): Promise<number> {
  const { rowCount } = await getPgPool().query(
    'DELETE FROM room_ai_context WHERE expires_at IS NOT NULL AND expires_at <= NOW()',
  );
  return rowCount ?? 0;
}

// ── Notifications ────────────────────────────────────────────────────

export async function createNotification(
  userId: number,
  roomId: string | null,
  type: string,
  title: string,
  body?: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const id = uuidv4();
  await getPgPool().query(
    `INSERT INTO notifications (id, user_id, room_id, notif_type, title, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [id, userId, roomId, type, title, body ?? null, JSON.stringify(metadata ?? {})],
  );
  return id;
}

export async function getNotifications(
  userId: number,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<any[]> {
  const limit = options.limit ?? 50;
  const conditions = ['user_id = $1'];
  const vals: any[] = [userId];

  if (options.unreadOnly) {
    conditions.push('read = 0');
  }

  vals.push(limit);

  const { rows } = await getPgPool().query(
    `SELECT * FROM notifications
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${vals.length}`,
    vals,
  );
  return rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    roomId: r.room_id,
    type: r.notif_type,
    title: r.title,
    body: r.body,
    metadata: r.metadata ?? {},
    read: !!r.read,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function markNotificationRead(notifId: string, userId?: number): Promise<boolean> {
  const sql = userId
    ? 'UPDATE notifications SET read = 1 WHERE id = $1 AND user_id = $2'
    : 'UPDATE notifications SET read = 1 WHERE id = $1';
  const params: any[] = userId ? [notifId, userId] : [notifId];
  const { rowCount } = await getPgPool().query(sql, params);
  return (rowCount ?? 0) > 0;
}

export async function markAllNotificationsRead(userId: number): Promise<number> {
  const { rowCount } = await getPgPool().query(
    'UPDATE notifications SET read = 1 WHERE user_id = $1 AND read = 0',
    [userId],
  );
  return rowCount ?? 0;
}

export async function getUnreadCount(userId: number): Promise<number> {
  const { rows } = await getPgPool().query(
    'SELECT COUNT(*)::int AS cnt FROM notifications WHERE user_id = $1 AND read = 0',
    [userId],
  );
  return rows[0].cnt;
}

// ── PgAdapter Implementation (for cross-db.ts) ──────────────────────

export function createPgAdapter(): PgAdapter {
  const pool = getPgPool();

  return {
    async getRoomMemberUserIds(roomId: string): Promise<number[]> {
      const { rows } = await pool.query(
        'SELECT user_id FROM room_members WHERE room_id = $1',
        [roomId],
      );
      return rows.map((r: any) => r.user_id);
    },

    async getAllMemberUserIds(): Promise<number[]> {
      const { rows } = await pool.query('SELECT DISTINCT user_id FROM room_members');
      return rows.map((r: any) => r.user_id);
    },

    async removeRoomMember(roomId: string, userId: number): Promise<void> {
      await pool.query(
        'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, userId],
      );
    },

    async removeUserFromAllRooms(userId: number): Promise<void> {
      await pool.query(
        'DELETE FROM room_members WHERE user_id = $1',
        [userId],
      );
    },

    async roomExists(roomId: string): Promise<boolean> {
      const { rows } = await pool.query(
        'SELECT 1 FROM chat_rooms WHERE id = $1',
        [roomId],
      );
      return rows.length > 0;
    },

    async getAllRoomIds(): Promise<string[]> {
      const { rows } = await pool.query('SELECT id FROM chat_rooms');
      return rows.map((r: any) => r.id);
    },

    async insertRoomMessage(
      roomId: string,
      msgType: string,
      content: string,
      metadata?: Record<string, unknown>,
    ): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO room_messages (room_id, sender_id, msg_type, content, metadata)
         VALUES ($1, NULL, $2, $3, $4::jsonb)
         RETURNING id`,
        [roomId, msgType, content, JSON.stringify(metadata ?? {})],
      );
      return rows[0].id;
    },

    async insertRoomAiContext(
      roomId: string,
      content: string,
      tokenCount: number,
      sourceTaskId: string,
    ): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO room_ai_context (room_id, context_type, content, token_count, source_task_id)
         VALUES ($1, 'task_summary', $2, $3, $4)
         RETURNING id`,
        [roomId, content, tokenCount, sourceTaskId],
      );
      return rows[0].id;
    },

    async getMessageById(messageId: string): Promise<{ id: string; roomId: string } | null> {
      const { rows } = await pool.query(
        'SELECT id, room_id FROM room_messages WHERE id = $1',
        [messageId],
      );
      if (rows.length === 0) return null;
      return { id: rows[0].id, roomId: rows[0].room_id };
    },

    async getTaskRefMessageIds(): Promise<{ messageId: string; taskId: string }[]> {
      const { rows } = await pool.query(
        `SELECT id AS message_id, task_id FROM room_messages
         WHERE msg_type = 'ai_task_ref' AND task_id IS NOT NULL AND deleted_at IS NULL`,
      );
      return rows.map((r: any) => ({ messageId: r.message_id, taskId: r.task_id }));
    },
  };
}
