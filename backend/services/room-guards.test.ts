import { describe, it, expect } from 'vitest';
import {
  addRoomClient,
  removeRoomClient,
  removeClientFromAllRooms,
  getRoomClientIds,
  isClientInRoom,
  type RoomClient,
} from './room-guards';

function makeClient(id = 'c1'): RoomClient {
  return { id, joinedRooms: new Set() };
}

// ── addRoomClient / removeRoomClient ──────────────────────────────

describe('addRoomClient / removeRoomClient', () => {
  it('adds client to a new room set', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    addRoomClient(rc, client, 'r1');

    expect(rc.get('r1')?.has('c1')).toBe(true);
    expect(client.joinedRooms.has('r1')).toBe(true);
  });

  it('adds multiple clients to the same room', () => {
    const rc = new Map<string, Set<string>>();
    const c1 = makeClient('c1');
    const c2 = makeClient('c2');
    addRoomClient(rc, c1, 'r1');
    addRoomClient(rc, c2, 'r1');

    expect(rc.get('r1')?.size).toBe(2);
  });

  it('allows one client to join multiple rooms (non-exclusive)', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    addRoomClient(rc, client, 'r1');
    addRoomClient(rc, client, 'r2');
    addRoomClient(rc, client, 'r3');

    expect(client.joinedRooms.size).toBe(3);
    expect(rc.get('r1')?.has('c1')).toBe(true);
    expect(rc.get('r2')?.has('c1')).toBe(true);
    expect(rc.get('r3')?.has('c1')).toBe(true);
  });

  it('is idempotent — adding same client to same room twice is safe', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    addRoomClient(rc, client, 'r1');
    addRoomClient(rc, client, 'r1');

    expect(rc.get('r1')?.size).toBe(1);
    expect(client.joinedRooms.size).toBe(1);
  });

  it('removes client and cleans up empty set', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    addRoomClient(rc, client, 'r1');
    removeRoomClient(rc, client, 'r1');

    expect(rc.has('r1')).toBe(false);
    expect(client.joinedRooms.has('r1')).toBe(false);
  });

  it('keeps set when other clients remain', () => {
    const rc = new Map<string, Set<string>>();
    const c1 = makeClient('c1');
    const c2 = makeClient('c2');
    addRoomClient(rc, c1, 'r1');
    addRoomClient(rc, c2, 'r1');
    removeRoomClient(rc, c1, 'r1');

    expect(rc.get('r1')?.size).toBe(1);
    expect(rc.get('r1')?.has('c2')).toBe(true);
  });

  it('removing from non-existent room is safe', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    // should not throw
    removeRoomClient(rc, client, 'nonexistent');
    expect(client.joinedRooms.size).toBe(0);
  });
});

// ── removeClientFromAllRooms ──────────────────────────────────────

describe('removeClientFromAllRooms', () => {
  it('removes client from all joined rooms at once', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    addRoomClient(rc, client, 'r1');
    addRoomClient(rc, client, 'r2');
    addRoomClient(rc, client, 'r3');

    removeClientFromAllRooms(rc, client);

    expect(client.joinedRooms.size).toBe(0);
    expect(rc.has('r1')).toBe(false);
    expect(rc.has('r2')).toBe(false);
    expect(rc.has('r3')).toBe(false);
  });

  it('preserves other clients in rooms', () => {
    const rc = new Map<string, Set<string>>();
    const c1 = makeClient('c1');
    const c2 = makeClient('c2');
    addRoomClient(rc, c1, 'r1');
    addRoomClient(rc, c2, 'r1');
    addRoomClient(rc, c1, 'r2');

    removeClientFromAllRooms(rc, c1);

    expect(rc.get('r1')?.has('c2')).toBe(true);
    expect(rc.get('r1')?.size).toBe(1);
    expect(rc.has('r2')).toBe(false); // c1 was the only one
  });

  it('is safe on client with no rooms', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    // should not throw
    removeClientFromAllRooms(rc, client);
    expect(client.joinedRooms.size).toBe(0);
  });
});

// ── getRoomClientIds ──────────────────────────────────────────────

describe('getRoomClientIds', () => {
  it('returns client IDs for a room', () => {
    const rc = new Map<string, Set<string>>();
    const c1 = makeClient('c1');
    const c2 = makeClient('c2');
    addRoomClient(rc, c1, 'r1');
    addRoomClient(rc, c2, 'r1');

    const ids = getRoomClientIds(rc, 'r1');
    expect(ids.size).toBe(2);
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(true);
  });

  it('returns empty set for non-existent room', () => {
    const rc = new Map<string, Set<string>>();
    const ids = getRoomClientIds(rc, 'nonexistent');
    expect(ids.size).toBe(0);
  });
});

// ── isClientInRoom ────────────────────────────────────────────────

describe('isClientInRoom', () => {
  it('returns true when client is in room', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    addRoomClient(rc, client, 'r1');

    expect(isClientInRoom(client, 'r1')).toBe(true);
  });

  it('returns false when client is not in room', () => {
    const client = makeClient();
    expect(isClientInRoom(client, 'r1')).toBe(false);
  });

  it('returns false after client leaves room', () => {
    const rc = new Map<string, Set<string>>();
    const client = makeClient();
    addRoomClient(rc, client, 'r1');
    removeRoomClient(rc, client, 'r1');

    expect(isClientInRoom(client, 'r1')).toBe(false);
  });
});
