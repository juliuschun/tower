/**
 * Pure functions extracted from ws-handler.ts for session isolation logic.
 * These have no side effects and are directly unit-testable.
 */

export interface SessionClient {
  id: string;
  sessionId?: string;
  activeQueryEpoch: number;
}

/**
 * Check if the client's epoch has advanced past myEpoch,
 * meaning the query loop is stale and should stop.
 */
export function isEpochStale(client: SessionClient, myEpoch: number): boolean {
  return client.activeQueryEpoch !== myEpoch;
}

/**
 * Resolve the active client for a given sessionId.
 * Returns the client if the mapping is valid, otherwise cleans up stale entries.
 */
export function resolveSessionClient<T extends SessionClient>(
  sessionClients: Map<string, string>,
  clients: Map<string, T>,
  sessionId: string,
): T | undefined {
  const clientId = sessionClients.get(sessionId);
  if (!clientId) return undefined;

  const client = clients.get(clientId);
  if (!client) {
    // Client disconnected — clean up stale mapping
    sessionClients.delete(sessionId);
    return undefined;
  }

  // Client switched to a different session — stale mapping
  if (client.sessionId !== sessionId) {
    sessionClients.delete(sessionId);
    return undefined;
  }

  return client;
}

/**
 * Handle session switch: clean up old session mapping, bump epoch, set new session.
 * Returns the new epoch value.
 */
export function switchSession(
  client: SessionClient,
  sessionClients: Map<string, string>,
  oldSessionId: string | undefined,
  newSessionId: string,
): number {
  // Remove stale mapping for old session
  if (oldSessionId && oldSessionId !== newSessionId) {
    if (sessionClients.get(oldSessionId) === client.id) {
      sessionClients.delete(oldSessionId);
    }
  }

  // Invalidate any running query loop
  client.activeQueryEpoch++;

  // Update client to new session
  client.sessionId = newSessionId;
  sessionClients.set(newSessionId, client.id);

  return client.activeQueryEpoch;
}

/**
 * Handle abort cleanup: bump epoch and remove session routing.
 * Returns the new epoch value.
 */
export function abortCleanup(
  client: SessionClient,
  sessionClients: Map<string, string>,
  sessionId: string,
): number {
  client.activeQueryEpoch++;

  if (sessionClients.get(sessionId) === client.id) {
    sessionClients.delete(sessionId);
  }

  return client.activeQueryEpoch;
}
