import { describe, it, expect } from 'vitest';
import { buildReconnectSyncPlan } from './reconnect-sync';

describe('buildReconnectSyncPlan', () => {
  it('includes session reconnect, room resubscribe, and authoritative refetches', () => {
    const plan = buildReconnectSyncPlan({
      sessionId: 's1',
      claudeSessionId: 'c1',
      activeRoomId: 'r1',
      refreshRooms: true,
    });

    expect(plan.wsMessages).toEqual([
      { type: 'reconnect', sessionId: 's1', claudeSessionId: 'c1' },
      { type: 'room_join', roomId: 'r1' },
      { type: 'room_read', roomId: 'r1' },
      { type: 'task_list' },
    ]);
    expect(plan.refetchSessions).toBe(true);
    expect(plan.refetchRooms).toBe(true);
    expect(plan.refetchActiveSessionMessages).toBe('s1');
    expect(plan.refetchActiveRoomMessages).toBe('r1');
    expect(plan.refetchActiveRoomDetails).toBe('r1');
  });

  it('omits optional actions when there is no active session or room', () => {
    const plan = buildReconnectSyncPlan({
      sessionId: null,
      claudeSessionId: null,
      activeRoomId: null,
      refreshRooms: false,
    });

    expect(plan.wsMessages).toEqual([{ type: 'task_list' }]);
    expect(plan.refetchSessions).toBe(true);
    expect(plan.refetchRooms).toBe(false);
    expect(plan.refetchActiveSessionMessages).toBeNull();
    expect(plan.refetchActiveRoomMessages).toBeNull();
    expect(plan.refetchActiveRoomDetails).toBeNull();
  });
});
