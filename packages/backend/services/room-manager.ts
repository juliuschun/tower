/**
 * Room Manager — Business logic for rooms, members, messages, notifications.
 *
 * All raw SQL queries have been extracted to room-repo.ts.
 * This module handles: validation, authorization, caching, broadcasting,
 * cross-service orchestration, and domain mapping.
 */

import { v4 as uuidv4 } from 'uuid';
import { queryOne } from '../db/pg-repo.js';
import { getAccessibleProjectIds } from './group-manager.js';
import * as roomRepo from './room-repo.js';
import type { PgAdapter } from './cross-db.js';
import type { Room, RoomMember, RoomMessage } from '@tower/shared';

export type { Room, RoomMember, RoomMessage };

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

// ── Room Members Cache (TTL) ─────────────────────────────────────────
//
// Room message handling calls getMembers() on every single inbound message
// (for fan-out + @mention notifications). With 50 concurrent users this
// trampled the PG pool. Memoize the result for a short TTL (5s) and
// invalidate whenever members change.

const MEMBER_CACHE_TTL_MS = 5_000;
const memberCache = new Map<string, { expires: number; members: RoomMember[] }>();

function invalidateMemberCache(roomId?: string): void {
  if (roomId === undefined) {
    memberCache.clear();
  } else {
    memberCache.delete(roomId);
  }
}

/** Exported for callers that mutate members outside this module. */
export { invalidateMemberCache };

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

  const row = await roomRepo.insertRoom(name, description, roomType, projectId ?? null, createdBy);
  const room = rowToRoom(row);

  // Auto-add creator as owner
  await roomRepo.insertMemberIfNotExists(room.id, createdBy, 'owner');
  invalidateMemberCache(room.id);

  // Auto-add fellow group members (from SQLite groups)
  try {
    const { getUserGroups } = await import('./group-manager.js');
    const creatorGroups = await getUserGroups(createdBy);
    if (creatorGroups.length > 0) {
      const groupIds = creatorGroups.map((g: any) => g.id);
      const fellowMembers = await roomRepo.findFellowGroupMembers(groupIds, createdBy);

      for (const member of fellowMembers) {
        await roomRepo.insertMemberIfNotExists(room.id, member.id, 'member');
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
        await roomRepo.insertMemberIfNotExists(room.id, m.userId, 'member');
      }
    } catch (err: any) {
      console.error(`[room-manager] Failed to auto-add project members:`, err.message);
    }
  }

  // Ensure cache reflects the final member roster for the new room.
  invalidateMemberCache(room.id);

  return room;
}

export async function getRoom(roomId: string): Promise<Room | null> {
  const row = await roomRepo.findRoomById(roomId);
  return row ? rowToRoom(row) : null;
}

export async function listRooms(userId: number, role?: string): Promise<Room[]> {
  const userRole = role || (await roomRepo.findUserRole(userId)) || 'member';
  const isAdmin = userRole === 'admin';

  // 2026-04-10 (100-user scale): this function used to do N+1 queries per
  // sidebar load (one INSERT per room for auto-join, plus one SELECT per
  // non-project room for membership). Rewritten to use batched multi-row
  // INSERT + single batched SELECT below.

  const allRooms = await roomRepo.findAllActiveRooms();

  // Admin: see all rooms, auto-join as admin
  if (isAdmin) {
    if (allRooms.length === 0) return [];

    // Batch INSERT — one round-trip for all rooms.
    const entries = allRooms.map(room => ({ roomId: room.id, userId, role: 'admin' }));
    const insertedRoomIds = await roomRepo.batchInsertMembersIfNotExists(entries);
    // Invalidate cache only for rooms we actually inserted into.
    for (const roomId of insertedRoomIds) {
      invalidateMemberCache(roomId);
    }

    return allRooms.map(rowToRoom);
  }

  // Non-admin: rooms where user is a member OR room belongs to an accessible project
  const accessibleIds = await getAccessibleProjectIds(userId, userRole);

  const visible = allRooms.filter(r => {
    // Room without project: must be explicit member (checked below)
    if (!r.project_id) return true;
    // Room with project: visible if user has project access
    if (accessibleIds === null) return true; // admin fallback
    return accessibleIds.includes(r.project_id);
  });

  if (visible.length === 0) return [];

  // Auto-join all project rooms the user can see — single batched INSERT.
  const projectRooms = visible.filter(r => !!r.project_id);
  if (projectRooms.length > 0) {
    const entries = projectRooms.map(room => ({ roomId: room.id, userId, role: 'member' }));
    const insertedRoomIds = await roomRepo.batchInsertMembersIfNotExists(entries);
    for (const roomId of insertedRoomIds) {
      invalidateMemberCache(roomId);
    }
  }

  // For non-project rooms, check membership for ALL of them in a single query.
  const nonProjectRoomIds = visible.filter(r => !r.project_id).map(r => r.id);
  const memberSet = await roomRepo.findMemberRoomIds(userId, nonProjectRoomIds);

  // Preserve original updated_at DESC order from the initial SELECT.
  const result: Room[] = [];
  for (const room of visible) {
    if (room.project_id || memberSet.has(room.id)) {
      result.push(rowToRoom(room));
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

  const row = await roomRepo.updateRoomFields(roomId, sets, vals, idx);
  return row ? rowToRoom(row) : null;
}

export async function deleteRoom(roomId: string): Promise<boolean> {
  const changes = await roomRepo.deleteRoomById(roomId);
  invalidateMemberCache(roomId);
  return changes > 0;
}

// ── Members ──────────────────────────────────────────────────────────

export async function addMember(
  roomId: string,
  userId: number,
  role: string = 'member',
): Promise<RoomMember> {
  assertMemberRole(role);
  const row = await roomRepo.upsertMember(roomId, userId, role);
  invalidateMemberCache(roomId);
  return await rowToMember(row);
}

export async function removeMember(roomId: string, userId: number): Promise<boolean> {
  const changes = await roomRepo.deleteMember(roomId, userId);
  invalidateMemberCache(roomId);
  return changes > 0;
}

export async function getMembers(roomId: string): Promise<RoomMember[]> {
  const now = Date.now();
  const cached = memberCache.get(roomId);
  if (cached && cached.expires > now) {
    return cached.members;
  }

  const rows = await roomRepo.findMembersByRoom(roomId);
  const members = await Promise.all(rows.map(rowToMember));
  memberCache.set(roomId, { expires: now + MEMBER_CACHE_TTL_MS, members });
  return members;
}

export async function updateMemberRole(
  roomId: string,
  userId: number,
  role: string,
): Promise<boolean> {
  assertMemberRole(role);
  const changes = await roomRepo.updateMemberRoleRow(roomId, userId, role);
  invalidateMemberCache(roomId);
  return changes > 0;
}

export async function updateLastRead(roomId: string, userId: number): Promise<void> {
  await roomRepo.updateLastReadAt(roomId, userId);
}

export async function isMember(roomId: string, userId: number): Promise<boolean> {
  const { exists } = await roomRepo.findMembership(roomId, userId);
  return exists;
}

export async function getMemberRole(roomId: string, userId: number): Promise<string | null> {
  return roomRepo.findMemberRole(roomId, userId);
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
  const row = await roomRepo.insertMessage(
    roomId, senderId, msgType, content,
    JSON.stringify(metadata), taskId ?? null, replyTo ?? null,
  );
  return await rowToMessage(row);
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
    conditions.push(`seq < $${idx++}`);
    vals.push(options.before);
  }
  if (options.after) {
    conditions.push(`seq > $${idx++}`);
    vals.push(options.after);
  }

  vals.push(limit);

  const rows = await roomRepo.findMessages(roomId, conditions, vals, idx);
  return await Promise.all(rows.map(rowToMessage));
}

export async function editMessage(messageId: string, content: string): Promise<RoomMessage | null> {
  const row = await roomRepo.updateMessageContent(messageId, content);
  return row ? await rowToMessage(row) : null;
}

export async function deleteMessage(messageId: string): Promise<boolean> {
  const changes = await roomRepo.softDeleteMessage(messageId);
  return changes > 0;
}

export async function getMessage(messageId: string): Promise<RoomMessage | null> {
  const row = await roomRepo.findMessageById(messageId);
  return row ? await rowToMessage(row) : null;
}

// ── Unread Counts ────────────────────────────────────────────────────

export async function getUnreadCounts(userId: number): Promise<Map<string, number>> {
  const rows = await roomRepo.findUnreadCounts(userId);
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
  // 1. Look up existing channel_ai session in sessions table
  const existing = await roomRepo.findChannelAiSession(roomId);

  if (existing) {
    return {
      sessionId: existing.id,
      engineSessionId: existing.claude_session_id ?? null,
      messageCount: existing.turn_count ?? 0,
    };
  }

  // 2. No session exists — create one
  // Owner is null (system-owned) — channel AI is a shared team resource, not owned by any individual.
  // Visibility is 'project' so all project members can see it.
  const { createSession, updateSession } = await import('./session-manager.js');
  const session = await createSession(
    `🤖 ${roomName}`,
    '/home/enterpriseai',  // default cwd
    undefined,             // system-owned (no individual owner)
    projectId,
    engine,
    roomId,
  );
  await updateSession(session.id, { label: 'channel_ai', visibility: 'project' });

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
  // Update sessions table
  const { updateSession } = await import('./session-manager.js');
  await updateSession(sessionId, {
    claudeSessionId: engineSessionId,
    turnCount: undefined,  // will be incremented below
  });

  // Increment turn count
  await roomRepo.incrementSessionTurnCount(sessionId);

  // Sync chat_rooms cache
  await roomRepo.syncRoomAiSession(roomId, engineSessionId);
}

/**
 * Clear channel AI session (on @ai /reset).
 * Archives the session and clears the room cache.
 */
export async function clearChannelAiSession(roomId: string): Promise<void> {
  // Archive existing channel_ai session(s)
  await roomRepo.archiveChannelAiSessions(roomId);

  // Clear room cache
  await roomRepo.clearRoomAiSessionCache(roomId);
}

// ── AI Context ───────────────────────────────────────────────────────

export async function saveAiContext(
  roomId: string,
  content: string,
  tokenCount: number,
  sourceTaskId: string,
): Promise<string> {
  return roomRepo.insertAiContext(roomId, content, tokenCount, sourceTaskId);
}

export async function getAiContexts(
  roomId: string,
  limit: number = 10,
): Promise<{ id: string; content: string; tokenCount: number; sourceTaskId: string | null; createdAt: string; expiresAt: string | null }[]> {
  const rows = await roomRepo.findAiContexts(roomId, limit);
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
  return roomRepo.deleteExpiredContexts();
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
  await roomRepo.insertNotification(
    id, userId, roomId, type, title,
    body ?? null, JSON.stringify(metadata ?? {}),
  );
  return id;
}

/**
 * Batch notification insert — one round-trip for N recipients.
 * Returns array of { userId, notifId } in the same order as the input.
 *
 * Added 2026-04-10: previously, notifying N room members did N sequential
 * INSERTs. At 50 members this serialized into a multi-second critical path.
 */
export async function createNotificationsBatch(
  recipients: Array<{
    userId: number;
    roomId: string | null;
    type: string;
    title: string;
    body?: string;
    metadata?: Record<string, unknown>;
  }>,
): Promise<Array<{ userId: number; notifId: string }>> {
  if (recipients.length === 0) return [];

  const sqlRows: string[] = [];
  const vals: any[] = [];
  const result: Array<{ userId: number; notifId: string }> = [];
  let i = 1;
  for (const r of recipients) {
    const id = uuidv4();
    result.push({ userId: r.userId, notifId: id });
    sqlRows.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}::jsonb)`);
    vals.push(
      id,
      r.userId,
      r.roomId,
      r.type,
      r.title,
      r.body ?? null,
      JSON.stringify(r.metadata ?? {}),
    );
  }

  await roomRepo.batchInsertNotifications(sqlRows, vals);
  return result;
}

export async function getNotifications(
  userId: number,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<any[]> {
  const limit = options.limit ?? 50;
  const rows = await roomRepo.findNotifications(userId, !!options.unreadOnly, limit);
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
  const changes = await roomRepo.markNotificationReadById(notifId, userId);
  return changes > 0;
}

export async function markAllNotificationsRead(userId: number): Promise<number> {
  return roomRepo.markAllNotificationsReadForUser(userId);
}

export async function getUnreadCount(userId: number): Promise<number> {
  return roomRepo.countUnreadNotifications(userId);
}

// ── PgAdapter Implementation (for cross-db.ts) ──────────────────────

export function createPgAdapter(): PgAdapter {
  return {
    async getRoomMemberUserIds(roomId: string): Promise<number[]> {
      return roomRepo.findUserIdsByRoom(roomId);
    },

    async getAllMemberUserIds(): Promise<number[]> {
      return roomRepo.findAllDistinctMemberUserIds();
    },

    async removeRoomMember(roomId: string, userId: number): Promise<void> {
      await roomRepo.deleteMember(roomId, userId);
    },

    async removeUserFromAllRooms(userId: number): Promise<void> {
      await roomRepo.deleteAllMembershipsForUser(userId);
    },

    async roomExists(roomId: string): Promise<boolean> {
      return roomRepo.roomExistsById(roomId);
    },

    async getAllRoomIds(): Promise<string[]> {
      return roomRepo.findAllRoomIds();
    },

    async insertRoomMessage(
      roomId: string,
      msgType: string,
      content: string,
      metadata?: Record<string, unknown>,
    ): Promise<string> {
      return roomRepo.insertSystemMessage(
        roomId, msgType, content, JSON.stringify(metadata ?? {}),
      );
    },

    async insertRoomAiContext(
      roomId: string,
      content: string,
      tokenCount: number,
      sourceTaskId: string,
    ): Promise<string> {
      return roomRepo.insertAiContext(roomId, content, tokenCount, sourceTaskId);
    },

    async getMessageById(messageId: string): Promise<{ id: string; roomId: string } | null> {
      const row = await roomRepo.findMessageRef(messageId);
      if (!row) return null;
      return { id: row.id, roomId: row.room_id };
    },

    async getTaskRefMessageIds(): Promise<{ messageId: string; taskId: string }[]> {
      return roomRepo.findTaskRefMessageIds();
    },
  };
}
