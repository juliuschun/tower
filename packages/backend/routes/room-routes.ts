import { Router } from 'express';
import { authMiddleware } from '../services/auth.js';
import { canAccessRoom, canCreateInProject } from '../services/project-access.js';
import { query } from '../db/pg-repo.js';
import { broadcastToUser } from './ws-handler.js';

const router = Router();

// ── Chat Rooms (PG) ──────────────────────────────────────────────────

router.get('/rooms', authMiddleware, async (req, res) => {
  try {
    const { isPgEnabled } = await import('../db/pg.js');
    if (!isPgEnabled()) return res.json({ rooms: [], pgEnabled: false, unreadCounts: {} });
    const { listRooms, getUnreadCounts } = await import('../services/room-manager.js');
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;
    const [rooms, unreadMap] = await Promise.all([
      listRooms(userId, userRole),
      getUnreadCounts(userId),
    ]);
    // Convert Map to plain object for JSON serialization
    const unreadCounts: Record<string, number> = {};
    for (const [roomId, count] of unreadMap) {
      if (count > 0) unreadCounts[roomId] = count;
    }
    res.json({ rooms, pgEnabled: true, unreadCounts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/rooms', authMiddleware, async (req, res) => {
  try {
    const { isPgEnabled } = await import('../db/pg.js');
    if (!isPgEnabled()) return res.status(503).json({ error: 'Chat rooms require PostgreSQL' });
    const { createRoom, getMembers } = await import('../services/room-manager.js');
    const { name, description, roomType, projectId } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    // Project access check for room creation
    const userId = (req as any).user.userId;
    const role = (req as any).user.role;
    if (projectId) {
      const access = await canCreateInProject(projectId, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const room = await createRoom(name, description ?? null, roomType || 'team', userId, projectId);
    res.json(room);

    // Realtime: createRoom already auto-adds project/group members. Fetch the
    // final roster and push the new room to each so their sidebar updates.
    try {
      const members = await getMembers(room.id);
      const payload = { type: 'room_created', room };
      const seen = new Set<number>();
      for (const m of members) {
        if (seen.has(m.userId)) continue;
        seen.add(m.userId);
        broadcastToUser(m.userId, payload);
      }
      if (!seen.has(userId)) broadcastToUser(userId, payload);
    } catch { /* best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const { getRoom, getMembers, isMember } = await import('../services/room-manager.js');
    const room = await getRoom(req.params.id as string);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const userId = (req as any).user.userId;
    if (!(await isMember(req.params.id as string, userId))) return res.status(403).json({ error: 'Not a member' });
    const members = await getMembers(req.params.id as string);
    res.json({ ...room, members });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.id as string;
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessRoom(roomId, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { updateRoom, getMembers } = await import('../services/room-manager.js');
    const room = await updateRoom(roomId, req.body);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);

    // Realtime: send updated room metadata to every member (sidebar + header)
    try {
      const members = await getMembers(roomId);
      const payload = { type: 'room_updated', room };
      const seen = new Set<number>();
      for (const m of members) {
        if (seen.has(m.userId)) continue;
        seen.add(m.userId);
        broadcastToUser(m.userId, payload);
      }
    } catch { /* best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.id as string;
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessRoom(roomId, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { deleteRoom, getMembers } = await import('../services/room-manager.js');

    // Snapshot members BEFORE deletion so we can notify them.
    let formerMemberIds: number[] = [];
    try {
      const members = await getMembers(roomId);
      formerMemberIds = Array.from(new Set(members.map(m => m.userId)));
    } catch { /* best-effort */ }

    const ok = await deleteRoom(roomId);
    if (!ok) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true });

    // Realtime: drop the room from every former member's sidebar.
    const payload = { type: 'room_deleted', roomId };
    for (const uid of formerMemberIds) broadcastToUser(uid, payload);
    if (userId && !formerMemberIds.includes(userId)) broadcastToUser(userId, payload);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id/invitable-users', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (userId) {
      const access = await canAccessRoom(req.params.id as string, userId, role);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { getMembers } = await import('../services/room-manager.js');
    const members = await getMembers(req.params.id as string);
    const memberUserIds = new Set(members.map(m => m.userId));

    // Get all active users, exclude current members
    const allUsers = await query<{ id: number; username: string; role: string }>(
      'SELECT id, username, role FROM users WHERE disabled = 0 ORDER BY username'
    );

    const invitable = allUsers
      .filter(u => !memberUserIds.has(u.id))
      .map(u => ({ id: u.id, username: u.username, role: u.role }));

    res.json({ users: invitable });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/rooms/:id/members', authMiddleware, async (req, res) => {
  try {
    const reqUserId = (req as any).user?.userId;
    const reqRole = (req as any).user?.role;
    if (reqUserId) {
      const access = await canAccessRoom(req.params.id as string, reqUserId, reqRole);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { addMember, getRoom } = await import('../services/room-manager.js');
    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const member = await addMember(req.params.id as string, userId, role);
    res.json(member);

    // Notify room members about new member (real-time update)
    try {
      const { broadcastToRoom, broadcastToUser } = await import('./ws-handler.js');
      broadcastToRoom(req.params.id as string, {
        type: 'room_member_added',
        roomId: req.params.id as string,
        member,
      });

      // Notify the invited user so they see the room in their list
      const room = await getRoom(req.params.id as string);
      if (room) {
        broadcastToUser(userId, {
          type: 'room_added',
          room,
        });
      }
    } catch { /* WS notification is best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/rooms/:id/members/:userId', authMiddleware, async (req, res) => {
  try {
    const reqUserId = (req as any).user?.userId;
    const reqRole = (req as any).user?.role;
    if (reqUserId) {
      const access = await canAccessRoom(req.params.id as string, reqUserId, reqRole);
      if (!access.allowed) return res.status(access.status).json({ error: access.message });
    }
    const { removeMember } = await import('../services/room-manager.js');
    const removedUserId = parseInt(req.params.userId as string);
    const ok = await removeMember(req.params.id as string, removedUserId);
    if (!ok) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true });

    // Notify room members about removed member
    try {
      const { broadcastToRoom, broadcastToUser } = await import('./ws-handler.js');
      broadcastToRoom(req.params.id as string, {
        type: 'room_member_removed',
        roomId: req.params.id as string,
        userId: removedUserId,
      });
      // Notify the removed user
      broadcastToUser(removedUserId, {
        type: 'room_removed',
        roomId: req.params.id as string,
      });
    } catch { /* WS notification is best-effort */ }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { getMessages: getRoomMessages, isMember } = await import('../services/room-manager.js');
    const userId = (req as any).user.userId;
    if (!(await isMember(req.params.id as string, userId))) return res.status(403).json({ error: 'Not a member' });
    const messages = await getRoomMessages(req.params.id as string, {
      limit: parseInt(req.query.limit as string) || 50,
      before: req.query.before as string,
      after: req.query.after as string,
    });
    res.json({ messages });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Notifications ─────────────────────────────────────────────────────

router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const { isPgEnabled } = await import('../db/pg.js');
    if (!isPgEnabled()) return res.json({ notifications: [], unreadCount: 0 });
    const { getNotifications, getUnreadCount } = await import('../services/room-manager.js');
    const userId = (req as any).user.userId;
    const unreadOnly = req.query.unreadOnly === 'true';
    const notifications = await getNotifications(userId, { unreadOnly });
    const unreadCount = await getUnreadCount(userId);
    res.json({ notifications, unreadCount });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const notifId = req.params.id as string;
    const { markNotificationRead, getUnreadCount } = await import('../services/room-manager.js');
    await markNotificationRead(notifId, userId);
    res.json({ success: true });

    // Realtime: sync read state across this user's tabs/devices.
    // Include the fresh unreadCount so each tab can update its badge directly.
    if (userId) {
      try {
        const unreadCount = await getUnreadCount(userId);
        broadcastToUser(userId, {
          type: 'notification_read',
          notificationId: notifId,
          unreadCount,
        });
      } catch { /* best-effort */ }
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { markAllNotificationsRead } = await import('../services/room-manager.js');
    const count = await markAllNotificationsRead(userId);
    res.json({ success: true, count });

    // Realtime: sync read-all state across this user's tabs/devices.
    broadcastToUser(userId, {
      type: 'notification_read_all',
      unreadCount: 0,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
