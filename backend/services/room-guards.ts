/**
 * Pure functions for room membership management.
 * Parallel to session-guards.ts but for chat rooms.
 *
 * Key difference from sessions:
 * - Sessions are exclusive (client views 1 session at a time)
 * - Rooms are non-exclusive (client can join multiple rooms simultaneously)
 */

export interface RoomClient {
  id: string;
  joinedRooms: Set<string>;
}

/** Add a client to a room's member set. Also tracks room on the client. */
export function addRoomClient(
  roomClients: Map<string, Set<string>>,
  client: RoomClient,
  roomId: string,
): void {
  let set = roomClients.get(roomId);
  if (!set) {
    set = new Set();
    roomClients.set(roomId, set);
  }
  set.add(client.id);
  client.joinedRooms.add(roomId);
}

/** Remove a client from a room's member set. Cleans up empty sets. */
export function removeRoomClient(
  roomClients: Map<string, Set<string>>,
  client: RoomClient,
  roomId: string,
): void {
  const set = roomClients.get(roomId);
  if (set) {
    set.delete(client.id);
    if (set.size === 0) roomClients.delete(roomId);
  }
  client.joinedRooms.delete(roomId);
}

/** Remove a client from ALL rooms. Used on WS close cleanup. */
export function removeClientFromAllRooms(
  roomClients: Map<string, Set<string>>,
  client: RoomClient,
): void {
  for (const roomId of client.joinedRooms) {
    const set = roomClients.get(roomId);
    if (set) {
      set.delete(client.id);
      if (set.size === 0) roomClients.delete(roomId);
    }
  }
  client.joinedRooms.clear();
}

/** Get all client IDs in a room. Returns empty set if room has no live clients. */
export function getRoomClientIds(
  roomClients: Map<string, Set<string>>,
  roomId: string,
): Set<string> {
  return roomClients.get(roomId) ?? new Set();
}

/** Check if a client is in a specific room. */
export function isClientInRoom(
  client: RoomClient,
  roomId: string,
): boolean {
  return client.joinedRooms.has(roomId);
}
