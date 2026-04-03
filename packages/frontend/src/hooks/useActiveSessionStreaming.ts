import { useChatStore } from '../stores/chat-store';
import { useSessionStore } from '../stores/session-store';

/**
 * Authoritative streaming flag for the session currently shown in ChatPanel.
 * Sidebar/session badges use session_status events; chat UI should use the same source
 * instead of the global chat-store flag, which can lag during session switches.
 */
export function useActiveSessionStreaming(): boolean {
  const sessionId = useChatStore((s) => s.sessionId);
  return useSessionStore((s) => (sessionId ? s.streamingSessions.has(sessionId) : false));
}
