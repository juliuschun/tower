import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  onUserDisabled,
  onRoomDeleted,
  writeTaskCompletion,
  runConsistencyCheck,
  type SqliteAdapter,
  type PgAdapter,
  type TaskCompletionWrite,
} from './cross-db';

// ── Mock Factories ────────────────────────────────────────────────

function mockSqlite(overrides: Partial<SqliteAdapter> = {}): SqliteAdapter {
  return {
    getUser: vi.fn(() => ({ id: 1, username: 'testuser', disabled: 0 })),
    getActiveUsers: vi.fn(() => []),
    getTasksByRoomId: vi.fn(() => []),
    updateTaskStatus: vi.fn(),
    getTaskById: vi.fn(() => null),
    ...overrides,
  };
}

function mockPg(overrides: Partial<PgAdapter> = {}): PgAdapter {
  return {
    getRoomMemberUserIds: vi.fn(async () => []),
    getAllMemberUserIds: vi.fn(async () => []),
    removeRoomMember: vi.fn(async () => {}),
    removeUserFromAllRooms: vi.fn(async () => {}),
    roomExists: vi.fn(async () => true),
    getAllRoomIds: vi.fn(async () => []),
    insertRoomMessage: vi.fn(async () => 'msg-001'),
    insertRoomAiContext: vi.fn(async () => 'ctx-001'),
    getMessageById: vi.fn(async () => null),
    getTaskRefMessageIds: vi.fn(async () => []),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Contract 1: User Disabled → Room Membership Cleanup
// ═══════════════════════════════════════════════════════════════════

describe('Contract 1: onUserDisabled', () => {
  it('removes disabled user from all rooms in PG', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 1, username: '홍길동', disabled: 1 })),
    });
    const pg = mockPg({
      getAllRoomIds: vi.fn(async () => ['r1', 'r2', 'r3']),
      getRoomMemberUserIds: vi.fn(async (roomId) => {
        if (roomId === 'r1' || roomId === 'r3') return [1, 2, 3];
        return [2, 3]; // user 1 is NOT in r2
      }),
    });

    const result = await onUserDisabled(1, sqlite, pg);

    expect(pg.removeUserFromAllRooms).toHaveBeenCalledWith(1);
    expect(result.roomsAffected).toBe(2); // r1, r3
    expect(result.errors).toHaveLength(0);
  });

  it('sends system message to each affected room', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 1, username: '홍길동', disabled: 1 })),
    });
    const pg = mockPg({
      getAllRoomIds: vi.fn(async () => ['r1', 'r2']),
      getRoomMemberUserIds: vi.fn(async () => [1, 2]),
    });

    const result = await onUserDisabled(1, sqlite, pg);

    expect(result.systemMessagesSent).toBe(2);
    expect(pg.insertRoomMessage).toHaveBeenCalledTimes(2);

    // Check message content includes username
    const firstCall = (pg.insertRoomMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toBe('r1');                      // roomId
    expect(firstCall[1]).toBe('system');                   // msgType
    expect(firstCall[2]).toContain('홍길동');               // content
    expect(firstCall[3]).toEqual(expect.objectContaining({ // metadata
      event: 'member_disabled',
      targetUserId: 1,
    }));
  });

  it('handles non-existent user gracefully', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => null),
    });
    const pg = mockPg();

    const result = await onUserDisabled(999, sqlite, pg);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('not found');
    expect(pg.removeUserFromAllRooms).not.toHaveBeenCalled();
  });

  it('continues if system message fails for one room', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 1, username: '홍길동', disabled: 1 })),
    });

    let callCount = 0;
    const pg = mockPg({
      getAllRoomIds: vi.fn(async () => ['r1', 'r2']),
      getRoomMemberUserIds: vi.fn(async () => [1]),
      insertRoomMessage: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('PG connection lost');
        return 'msg-002';
      }),
    });

    const result = await onUserDisabled(1, sqlite, pg);

    expect(result.roomsAffected).toBe(2);            // both rooms cleaned
    expect(result.systemMessagesSent).toBe(1);        // only 2nd succeeded
    expect(result.errors).toHaveLength(1);            // 1st failure logged
    expect(result.errors[0]).toContain('r1');
  });

  it('handles PG connection failure gracefully', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 1, username: '홍길동', disabled: 1 })),
    });
    const pg = mockPg({
      getAllRoomIds: vi.fn(async () => { throw new Error('PG down'); }),
    });

    const result = await onUserDisabled(1, sqlite, pg);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('PG cleanup failed');
    expect(result.roomsAffected).toBe(0);
  });

  it('does nothing when user has no room memberships', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 1, username: '홍길동', disabled: 1 })),
    });
    const pg = mockPg({
      getAllRoomIds: vi.fn(async () => ['r1', 'r2']),
      getRoomMemberUserIds: vi.fn(async () => [2, 3]), // user 1 not in any room
    });

    const result = await onUserDisabled(1, sqlite, pg);

    expect(result.roomsAffected).toBe(0);
    expect(result.systemMessagesSent).toBe(0);
    expect(pg.removeUserFromAllRooms).toHaveBeenCalledWith(1); // still called (idempotent)
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contract 2: Room Deleted → Task Orphan Handling
// ═══════════════════════════════════════════════════════════════════

describe('Contract 2: onRoomDeleted', () => {
  const mockAbort = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels todo tasks in the deleted room', async () => {
    const sqlite = mockSqlite({
      getTasksByRoomId: vi.fn(() => [
        { id: 't1', status: 'todo', roomId: 'r1' },
        { id: 't2', status: 'todo', roomId: 'r1' },
      ]),
    });

    const result = await onRoomDeleted('r1', sqlite, mockAbort);

    expect(result.tasksCancelled).toBe(2);
    expect(sqlite.updateTaskStatus).toHaveBeenCalledWith('t1', 'cancelled');
    expect(sqlite.updateTaskStatus).toHaveBeenCalledWith('t2', 'cancelled');
    expect(mockAbort).not.toHaveBeenCalled(); // no in_progress tasks
  });

  it('aborts in_progress tasks before cancelling', async () => {
    const sqlite = mockSqlite({
      getTasksByRoomId: vi.fn(() => [
        { id: 't1', status: 'in_progress', roomId: 'r1' },
      ]),
    });

    const result = await onRoomDeleted('r1', sqlite, mockAbort);

    expect(mockAbort).toHaveBeenCalledWith('t1');
    expect(result.tasksAborted).toEqual(['t1']);
    expect(sqlite.updateTaskStatus).toHaveBeenCalledWith('t1', 'cancelled');
    expect(result.tasksCancelled).toBe(1);
  });

  it('leaves done/failed tasks untouched (history preservation)', async () => {
    const sqlite = mockSqlite({
      getTasksByRoomId: vi.fn(() => [
        { id: 't1', status: 'done', roomId: 'r1' },
        { id: 't2', status: 'failed', roomId: 'r1' },
        { id: 't3', status: 'todo', roomId: 'r1' },
      ]),
    });

    const result = await onRoomDeleted('r1', sqlite, mockAbort);

    expect(result.tasksCancelled).toBe(1); // only t3
    // done/failed should NOT be updated
    const updateCalls = (sqlite.updateTaskStatus as ReturnType<typeof vi.fn>).mock.calls;
    const updatedIds = updateCalls.map((c: unknown[]) => c[0]);
    expect(updatedIds).not.toContain('t1');
    expect(updatedIds).not.toContain('t2');
    expect(updatedIds).toContain('t3');
  });

  it('handles abort failure gracefully', async () => {
    const sqlite = mockSqlite({
      getTasksByRoomId: vi.fn(() => [
        { id: 't1', status: 'in_progress', roomId: 'r1' },
        { id: 't2', status: 'todo', roomId: 'r1' },
      ]),
    });
    const failingAbort = vi.fn(async () => { throw new Error('process not found'); });

    const result = await onRoomDeleted('r1', sqlite, failingAbort);

    // t1 abort failed, but t2 should still be cancelled
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('t1');
    expect(result.tasksCancelled).toBe(1); // t2 cancelled
  });

  it('returns empty result for room with no tasks', async () => {
    const sqlite = mockSqlite({
      getTasksByRoomId: vi.fn(() => []),
    });

    const result = await onRoomDeleted('r1', sqlite, mockAbort);

    expect(result.tasksCancelled).toBe(0);
    expect(result.tasksAborted).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles mixed task statuses correctly', async () => {
    const sqlite = mockSqlite({
      getTasksByRoomId: vi.fn(() => [
        { id: 't1', status: 'in_progress', roomId: 'r1' },
        { id: 't2', status: 'todo', roomId: 'r1' },
        { id: 't3', status: 'done', roomId: 'r1' },
        { id: 't4', status: 'failed', roomId: 'r1' },
        { id: 't5', status: 'in_progress', roomId: 'r1' },
      ]),
    });

    const result = await onRoomDeleted('r1', sqlite, mockAbort);

    expect(result.tasksAborted).toEqual(['t1', 't5']);
    expect(result.tasksCancelled).toBe(3); // t1, t2, t5
    expect(mockAbort).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contract 3: PG Write Failure → SQLite Rollback Strategy
// ═══════════════════════════════════════════════════════════════════

describe('Contract 3: writeTaskCompletion', () => {
  const baseWrite: TaskCompletionWrite = {
    taskId: 't-247',
    roomId: 'r1',
    summary: '삼성전자 노출 고객 1,240명, 총 890억',
    contextContent: '{"task_id":"t-247","question":"삼성전자 노출","answer":"1,240명"}',
    contextTokenCount: 80,
  };

  it('writes PG first, then SQLite on success', async () => {
    const sqlite = mockSqlite();
    const pg = mockPg({
      insertRoomMessage: vi.fn(async () => 'msg-001'),
      insertRoomAiContext: vi.fn(async () => 'ctx-001'),
    });

    const result = await writeTaskCompletion(baseWrite, sqlite, pg);

    expect(result.success).toBe(true);
    expect(result.pgMessageId).toBe('msg-001');
    expect(result.pgContextId).toBe('ctx-001');

    // Verify order: PG calls first, SQLite last
    expect(pg.insertRoomMessage).toHaveBeenCalledBefore(sqlite.updateTaskStatus as ReturnType<typeof vi.fn>);
    expect(pg.insertRoomAiContext).toHaveBeenCalledBefore(sqlite.updateTaskStatus as ReturnType<typeof vi.fn>);
    expect(sqlite.updateTaskStatus).toHaveBeenCalledWith('t-247', 'done');
  });

  it('does NOT update SQLite when PG room_messages write fails', async () => {
    const sqlite = mockSqlite();
    const pg = mockPg({
      insertRoomMessage: vi.fn(async () => { throw new Error('PG connection refused'); }),
    });

    const result = await writeTaskCompletion(baseWrite, sqlite, pg);

    expect(result.success).toBe(false);
    expect(result.error).toContain('room_messages write failed');
    // CRITICAL: SQLite must NOT be updated
    expect(sqlite.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('reports partial failure when PG context write fails (message was sent)', async () => {
    const sqlite = mockSqlite();
    const pg = mockPg({
      insertRoomMessage: vi.fn(async () => 'msg-001'),
      insertRoomAiContext: vi.fn(async () => { throw new Error('PG timeout'); }),
    });

    const result = await writeTaskCompletion(baseWrite, sqlite, pg);

    expect(result.success).toBe(false);
    expect(result.pgMessageId).toBe('msg-001');    // message was written
    expect(result.pgContextId).toBeUndefined();     // context was NOT
    expect(result.error).toContain('room_ai_context write failed');
    // SQLite should NOT be updated (partial PG failure)
    expect(sqlite.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('reports critical inconsistency when SQLite fails after PG succeeds', async () => {
    const sqlite = mockSqlite({
      updateTaskStatus: vi.fn(() => { throw new Error('SQLite disk full'); }),
    });
    const pg = mockPg({
      insertRoomMessage: vi.fn(async () => 'msg-001'),
      insertRoomAiContext: vi.fn(async () => 'ctx-001'),
    });

    const result = await writeTaskCompletion(baseWrite, sqlite, pg);

    expect(result.success).toBe(false);
    expect(result.pgMessageId).toBe('msg-001');
    expect(result.pgContextId).toBe('ctx-001');
    expect(result.error).toContain('SQLite task update failed after PG writes succeeded');
    expect(result.error).toContain('Manual cleanup needed');
  });

  it('passes correct data to PG insertRoomMessage', async () => {
    const sqlite = mockSqlite();
    const pg = mockPg();

    await writeTaskCompletion(baseWrite, sqlite, pg);

    expect(pg.insertRoomMessage).toHaveBeenCalledWith(
      'r1',
      'ai_summary',
      '삼성전자 노출 고객 1,240명, 총 890억',
      { task_id: 't-247' },
    );
  });

  it('passes correct data to PG insertRoomAiContext', async () => {
    const sqlite = mockSqlite();
    const pg = mockPg();

    await writeTaskCompletion(baseWrite, sqlite, pg);

    expect(pg.insertRoomAiContext).toHaveBeenCalledWith(
      'r1',
      baseWrite.contextContent,
      80,
      't-247',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contract 4: Periodic Consistency Check
// ═══════════════════════════════════════════════════════════════════

describe('Contract 4: runConsistencyCheck', () => {
  it('detects ghost members (disabled user still in PG rooms)', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn((id: number) => {
        if (id === 1) return { id: 1, username: '활성유저', disabled: 0 };
        if (id === 2) return { id: 2, username: '비활성유저', disabled: 1 };
        return null;
      }),
    });
    const pg = mockPg({
      getAllMemberUserIds: vi.fn(async () => [1, 2]),
    });

    const result = await runConsistencyCheck(sqlite, pg, false);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('ghost_member');
    expect(result.issues[0].ids.userId).toBe(2);
    expect(result.issues[0].description).toContain('비활성유저');
  });

  it('detects ghost members (user deleted from SQLite)', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn((id: number) => {
        if (id === 1) return { id: 1, username: '존재', disabled: 0 };
        return null; // user 999 doesn't exist
      }),
    });
    const pg = mockPg({
      getAllMemberUserIds: vi.fn(async () => [1, 999]),
    });

    const result = await runConsistencyCheck(sqlite, pg, false);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('ghost_member');
    expect(result.issues[0].ids.userId).toBe(999);
    expect(result.issues[0].description).toContain('not found in SQLite');
  });

  it('auto-fixes ghost members when autoFix=true', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 2, username: '비활성', disabled: 1 })),
    });
    const pg = mockPg({
      getAllMemberUserIds: vi.fn(async () => [2]),
    });

    const result = await runConsistencyCheck(sqlite, pg, true);

    expect(result.autoFixed).toBe(1);
    expect(pg.removeUserFromAllRooms).toHaveBeenCalledWith(2);
  });

  it('does NOT auto-fix when autoFix=false', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 2, username: '비활성', disabled: 1 })),
    });
    const pg = mockPg({
      getAllMemberUserIds: vi.fn(async () => [2]),
    });

    const result = await runConsistencyCheck(sqlite, pg, false);

    expect(result.autoFixed).toBe(0);
    expect(pg.removeUserFromAllRooms).not.toHaveBeenCalled();
    expect(result.issues).toHaveLength(1); // still detected
  });

  it('detects missing task refs (PG message references non-existent SQLite task)', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 1, username: 'user', disabled: 0 })),
      getTaskById: vi.fn((id: string) => {
        if (id === 't-247') return { id: 't-247', status: 'done', roomId: 'r1', roomMessageId: 'msg-1' };
        return null; // t-999 doesn't exist
      }),
    });
    const pg = mockPg({
      getAllMemberUserIds: vi.fn(async () => []),
      getTaskRefMessageIds: vi.fn(async () => [
        { messageId: 'msg-1', taskId: 't-247' },   // exists
        { messageId: 'msg-2', taskId: 't-999' },   // missing!
      ]),
    });

    const result = await runConsistencyCheck(sqlite, pg, false);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('missing_task_ref');
    expect(result.issues[0].ids.taskId).toBe('t-999');
    expect(result.issues[0].ids.messageId).toBe('msg-2');
  });

  it('returns clean result when everything is consistent', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn(() => ({ id: 1, username: 'user', disabled: 0 })),
      getTaskById: vi.fn(() => ({ id: 't-1', status: 'done', roomId: 'r1', roomMessageId: null })),
    });
    const pg = mockPg({
      getAllMemberUserIds: vi.fn(async () => [1]),
      getTaskRefMessageIds: vi.fn(async () => [
        { messageId: 'msg-1', taskId: 't-1' },
      ]),
    });

    const result = await runConsistencyCheck(sqlite, pg, false);

    expect(result.issues).toHaveLength(0);
    expect(result.autoFixed).toBe(0);
    expect(result.checkedAt).toBeTruthy();
  });

  it('handles multiple issues simultaneously', async () => {
    const sqlite = mockSqlite({
      getUser: vi.fn((id: number) => {
        if (id === 1) return { id: 1, username: '정상', disabled: 0 };
        if (id === 2) return { id: 2, username: '비활성', disabled: 1 };
        return null; // 3 doesn't exist
      }),
      getTaskById: vi.fn((id: string) => {
        if (id === 't-1') return { id: 't-1', status: 'done', roomId: 'r1', roomMessageId: null };
        return null;
      }),
    });
    const pg = mockPg({
      getAllMemberUserIds: vi.fn(async () => [1, 2, 3]),     // 2=disabled, 3=missing
      getTaskRefMessageIds: vi.fn(async () => [
        { messageId: 'msg-1', taskId: 't-1' },              // OK
        { messageId: 'msg-2', taskId: 't-999' },            // missing task
      ]),
    });

    const result = await runConsistencyCheck(sqlite, pg, false);

    expect(result.issues).toHaveLength(3); // 2 ghost members + 1 missing task ref
    const types = result.issues.map(i => i.type);
    expect(types.filter(t => t === 'ghost_member')).toHaveLength(2);
    expect(types.filter(t => t === 'missing_task_ref')).toHaveLength(1);
  });
});
