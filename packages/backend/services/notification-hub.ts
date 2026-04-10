/**
 * Notification Hub — Central place for creating notifications + pushing via WS.
 *
 * Connects the existing room-manager notification CRUD with WS broadcast.
 * All notification creation should flow through this module.
 */

import { createNotification, createNotificationsBatch } from './room-manager.js';
import { isPgEnabled } from '../db/pg.js';

export type BroadcastFn = (type: string, data: any) => void;

let broadcastFn: BroadcastFn | null = null;

/**
 * Initialize the hub with a broadcast function from ws-handler.
 */
export function initNotificationHub(broadcast: BroadcastFn): void {
  broadcastFn = broadcast;
}

/**
 * Create a notification and push it to the user via WebSocket in real-time.
 */
export async function notify(
  userId: number,
  roomId: string | null,
  type: string,
  title: string,
  body?: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  // 1. Persist to DB (only if PG is available)
  let notifId: string;
  if (isPgEnabled()) {
    notifId = await createNotification(userId, roomId, type, title, body, metadata);
  } else {
    notifId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // 2. Push via WS (real-time)
  const notification = {
    id: notifId,
    userId,
    roomId,
    type,
    title,
    body: body ?? null,
    metadata: metadata ?? {},
    read: false,
    createdAt: new Date().toISOString(),
  };

  broadcastFn?.('notification', { targetUserId: userId, notification });

  return notifId;
}

/**
 * Notify a batch of users with the same title/body but distinct user IDs.
 * Does a single INSERT round-trip (batch) and then fans out WS messages.
 *
 * Added 2026-04-10: previously `notifyRoomMembers` did N sequential awaits.
 */
export async function notifyMany(
  userIds: number[],
  roomId: string | null,
  type: string,
  title: string,
  body?: string,
  metadata?: Record<string, unknown>,
): Promise<string[]> {
  if (userIds.length === 0) return [];

  let ids: Array<{ userId: number; notifId: string }>;
  if (isPgEnabled()) {
    ids = await createNotificationsBatch(
      userIds.map(userId => ({ userId, roomId, type, title, body, metadata })),
    );
  } else {
    ids = userIds.map(userId => ({
      userId,
      notifId: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
  }

  const createdAt = new Date().toISOString();
  for (const { userId, notifId } of ids) {
    broadcastFn?.('notification', {
      targetUserId: userId,
      notification: {
        id: notifId,
        userId,
        roomId,
        type,
        title,
        body: body ?? null,
        metadata: metadata ?? {},
        read: false,
        createdAt,
      },
    });
  }

  return ids.map(x => x.notifId);
}

/**
 * Notify all members of a room.
 * Optionally exclude a user (e.g. the sender).
 */
export async function notifyRoomMembers(
  roomId: string,
  type: string,
  title: string,
  body?: string,
  metadata?: Record<string, unknown>,
  excludeUserId?: number,
): Promise<void> {
  const { getMembers } = await import('./room-manager.js');
  const members = await getMembers(roomId);

  const targets = members
    .filter(m => m.userId !== excludeUserId)
    .map(m => m.userId);

  await notifyMany(targets, roomId, type, title, body, metadata);
}
