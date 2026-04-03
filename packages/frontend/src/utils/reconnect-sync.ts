export interface ReconnectSyncInput {
  sessionId: string | null;
  claudeSessionId: string | null;
  activeRoomId: string | null;
  refreshRooms: boolean;
}

export interface ReconnectSyncPlan {
  wsMessages: Array<Record<string, unknown>>;
  refetchSessions: boolean;
  refetchRooms: boolean;
  refetchActiveSessionMessages: string | null;
  refetchActiveRoomMessages: string | null;
  refetchActiveRoomDetails: string | null;
}

export function buildReconnectSyncPlan(input: ReconnectSyncInput): ReconnectSyncPlan {
  const wsMessages: Array<Record<string, unknown>> = [];

  if (input.sessionId) {
    wsMessages.push({
      type: 'reconnect',
      sessionId: input.sessionId,
      claudeSessionId: input.claudeSessionId || undefined,
    });
  }

  if (input.activeRoomId) {
    wsMessages.push({ type: 'room_join', roomId: input.activeRoomId });
    wsMessages.push({ type: 'room_read', roomId: input.activeRoomId });
  }

  wsMessages.push({ type: 'task_list' });

  return {
    wsMessages,
    refetchSessions: true,
    refetchRooms: input.refreshRooms,
    refetchActiveSessionMessages: input.sessionId,
    refetchActiveRoomMessages: input.activeRoomId,
    refetchActiveRoomDetails: input.activeRoomId,
  };
}
