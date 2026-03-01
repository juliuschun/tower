/**
 * Pure predicate functions for session isolation on the frontend.
 * Extracted from useClaudeChat.ts and InputBox.tsx for testability.
 */

/**
 * Should we drop an incoming SDK message because it belongs to a different session?
 * Returns true if the message should be dropped.
 */
export function shouldDropSessionMessage(
  currentSessionId: string | null,
  incomingSessionId: string | undefined,
): boolean {
  // No current session (first connection) — accept everything
  if (!currentSessionId) return false;
  // Session matches — accept
  if (currentSessionId === incomingSessionId) return false;
  // Mismatch — drop
  return true;
}

/**
 * Should the assistant ref be reset because the session changed?
 * Returns true if the incoming session differs from the ref's tracked session.
 */
export function shouldResetAssistantRef(
  refSessionId: string | null,
  incomingSessionId: string,
): boolean {
  if (!refSessionId) return false;
  return refSessionId !== incomingSessionId;
}

/**
 * Should a queued message be auto-sent?
 * Returns false if streaming is still active or if the queued session doesn't match the current.
 * An empty queuedSessionId (from new-session first turn) always matches.
 */
export function shouldAutoSendQueue(
  isStreaming: boolean,
  queuedSessionId: string,
  currentSessionId: string | null,
): boolean {
  if (isStreaming) return false;
  // Empty queued session = queued during first turn before session was assigned → allow
  if (!queuedSessionId) return true;
  return currentSessionId === queuedSessionId;
}
