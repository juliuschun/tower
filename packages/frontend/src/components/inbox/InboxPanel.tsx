import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useProjectStore } from '../../stores/project-store';
import { useKanbanStore } from '../../stores/kanban-store';
import { useChatStore } from '../../stores/chat-store';
import { RichContent } from '../shared/RichContent';
import type { SessionMeta } from '@tower/shared';

const RECENT_IDLE_LIMIT = 10;

interface LastMessage {
  sessionId: string;
  content: string;
  role: 'user' | 'assistant';
  loadedAt: number;
  /** The session.updatedAt value this cache entry was built from.
   *  Used to invalidate when a new completion lands on the same session. */
  sourceUpdatedAt: string;
}

/* ── Send message directly via global WebSocket ── */
function sendToSession(sessionId: string, message: string) {
  const ws = (window as any).__claudeWs as WebSocket | undefined;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[inbox] WebSocket not available');
    return false;
  }
  const messageId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Mark session as streaming immediately
  useSessionStore.getState().setSessionStreaming(sessionId, true);
  useSessionStore.getState().updateSessionMeta(sessionId, { updatedAt: new Date().toISOString() });

  ws.send(JSON.stringify({
    type: 'chat',
    message,
    messageId,
    sessionId,
    model: localStorage.getItem('selectedModel') || undefined,
  }));
  return true;
}

interface InboxPanelProps {
  onSelectSession?: (session: SessionMeta) => void;
}

export function InboxPanel({ onSelectSession }: InboxPanelProps = {}) {
  const sessions = useSessionStore((s) => s.sessions);
  const unreadSessions = useSessionStore((s) => s.unreadSessions);
  const streamingSessions = useSessionStore((s) => s.streamingSessions);
  const markSessionRead = useSessionStore((s) => s.markSessionRead);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const setActiveView = useSessionStore((s) => s.setActiveView);
  const projects = useProjectStore((s) => s.projects);
  const tasks = useKanbanStore((s) => s.tasks);
  const taskSessionIds = useMemo(() => new Set(tasks.filter(t => t.sessionId).map(t => t.sessionId!)), [tasks]);

  const [lastMessages, setLastMessages] = useState<Record<string, LastMessage>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [sentSessions, setSentSessions] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set()); // mark-as-read → disappear
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set()); // animating out
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentUsername = useMemo(() => localStorage.getItem('username') || '', []);

  // Animate-then-dismiss helper
  const animateDismiss = useCallback((sessionId: string) => {
    setExitingIds((prev) => new Set(prev).add(sessionId));
    setTimeout(() => {
      setDismissedIds((prev) => new Set(prev).add(sessionId));
      setExitingIds((prev) => { const next = new Set(prev); next.delete(sessionId); return next; });
    }, 350); // match animation duration
  }, []);

  // ── Two sections ──
  const unreads = useMemo(() =>
    sessions
      .filter((s) => unreadSessions.has(s.id) && (!streamingSessions.has(s.id) || exitingIds.has(s.id)) && s.ownerUsername === currentUsername && !dismissedIds.has(s.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), // newest first (inbox style)
    [sessions, unreadSessions, streamingSessions, currentUsername, dismissedIds, exitingIds]
  );

  const recentIdle = useMemo(() =>
    sessions
      .filter((s) => !unreadSessions.has(s.id) && (!streamingSessions.has(s.id) || exitingIds.has(s.id)) && s.ownerUsername === currentUsername && !dismissedIds.has(s.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) // newest first
      .slice(0, RECENT_IDLE_LIMIT), // take first N (most recent)
    [sessions, unreadSessions, streamingSessions, currentUsername, dismissedIds, exitingIds]
  );

  const allVisibleIds = useMemo(() => {
    const ids = new Set<string>();
    unreads.forEach((s) => ids.add(s.id));
    recentIdle.forEach((s) => ids.add(s.id));
    return ids;
  }, [unreads, recentIdle]);

  // (sessionId, updatedAt) pairs for visible cards. updatedAt is the cache key —
  // when a session re-completes, updatedAt bumps and we refetch the last turn.
  const visibleSessionStamps = useMemo(() => {
    const stamps: Array<[string, string]> = [];
    for (const s of sessions) {
      if (allVisibleIds.has(s.id)) stamps.push([s.id, s.updatedAt]);
    }
    return stamps;
  }, [sessions, allVisibleIds]);

  // Stable dependency key: "id:updatedAt,id:updatedAt,..."
  // Re-fires the effect on either a new id OR an existing id with a newer updatedAt.
  const visibleStampsKey = useMemo(
    () => visibleSessionStamps.map(([id, u]) => `${id}:${u}`).join(','),
    [visibleSessionStamps]
  );

  // Dedupe in-flight fetches across renders so we never fire twice for the same
  // (sessionId, updatedAt). This is what frees us from having to put lastMessages
  // in the effect deps (which would cause re-fires on every setLastMessages).
  const inflightRef = useRef<Set<string>>(new Set());

  // Load last AI turn — everything after the last user message
  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    visibleSessionStamps.forEach(async ([sessionId, updatedAt]) => {
      // Cache hit: we already have the turn for this exact updatedAt.
      // Read via functional check on the store? No — lastMessages is local state.
      // The inflightRef below protects against duplicate fetches even with stale closures.
      const cached = lastMessages[sessionId];
      if (cached && cached.sourceUpdatedAt === updatedAt) return;

      const inflightKey = `${sessionId}:${updatedAt}`;
      if (inflightRef.current.has(inflightKey)) return;
      inflightRef.current.add(inflightKey);

      try {
        // Task sessions can have hundreds of messages (tool cycles);
        // fetch more to capture the full AI output after the initial user prompt.
        const isTask = taskSessionIds.has(sessionId);
        const limit = isTask ? 500 : 50;
        const res = await fetch(`/api/sessions/${sessionId}/messages?limit=${limit}`, { headers });
        if (!res.ok) {
          console.warn(`[inbox] failed to load messages for ${sessionId}: ${res.status}`);
          return;
        }
        const data = await res.json();
        const msgs: any[] = data.messages ?? data;
        if (msgs.length === 0) return;

        // Distinguish real user messages from tool_result messages (both have role: 'user').
        // tool_result messages have content like [{type: "tool_result", ...}] or a parent_tool_use_id.
        const isRealUserMsg = (m: any) => {
          if (m.role !== 'user') return false;
          if (m.parent_tool_use_id) return false; // DB-stored tool_result
          if (Array.isArray(m.content)) {
            // If every block is tool_result → not a real user message
            const hasToolResult = m.content.some((b: any) => b.type === 'tool_result');
            const hasText = m.content.some((b: any) => b.type === 'text' && b.text?.trim());
            if (hasToolResult && !hasText) return false;
          }
          return true;
        };

        // Find the last REAL user message (not tool_result)
        let lastUserIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (isRealUserMsg(msgs[i])) { lastUserIdx = i; break; }
        }

        // Take everything after the last real user message (= full AI turn including tool cycles)
        const lastTurnMsgs = lastUserIdx >= 0 ? msgs.slice(lastUserIdx + 1) : msgs;
        if (lastTurnMsgs.length === 0) return;

        // Concatenate all text blocks from assistant messages in the turn
        const text = lastTurnMsgs
          .filter((m: any) => m.role === 'assistant')
          .map((m: any) => {
            if (typeof m.content === 'string') return m.content;
            if (Array.isArray(m.content)) {
              return m.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('');
            }
            return '';
          })
          .filter(Boolean)
          .join('\n\n');

        if (!text) return;

        setLastMessages((prev) => ({
          ...prev,
          [sessionId]: {
            sessionId,
            content: text,
            role: 'assistant',
            loadedAt: Date.now(),
            sourceUpdatedAt: updatedAt,
          },
        }));
      } catch (err) {
        console.warn(`[inbox] error loading messages for ${sessionId}:`, err);
      } finally {
        inflightRef.current.delete(inflightKey);
      }
    });
    // lastMessages is intentionally omitted from deps — inflightRef handles dedupe,
    // and including it would re-fire the effect on every setLastMessages call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleStampsKey, taskSessionIds]);

  // Newest first → no auto-scroll needed (already at top)

  const handleArchive = useCallback(async (sessionId: string) => {
    const token = localStorage.getItem('token') || '';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE', headers });
      if (res.ok) {
        removeSession(sessionId);
        markSessionRead(sessionId);
      }
    } catch {}
  }, [removeSession, markSessionRead]);

  const openSession = useCallback((session: SessionMeta) => {
    markSessionRead(session.id);
    // Use the App-level handleSelectSession which properly loads messages,
    // handles cache, claudeSessionId, etc.
    if (onSelectSession) {
      onSelectSession(session);
    } else {
      // Fallback: manual navigation (shouldn't happen if prop is wired)
      useChatStore.getState().setSessionId(session.id);
      useChatStore.getState().setStreaming(false);
      setActiveSessionId(session.id);
    }
    setActiveView('chat');
    // Persist last-viewed session
    const userId = localStorage.getItem('token') ? JSON.parse(atob(localStorage.getItem('token')!.split('.')[1])).userId : null;
    if (userId) localStorage.setItem(`tower:lastViewed:${userId}`, session.id);
  }, [markSessionRead, setActiveSessionId, setActiveView, onSelectSession]);

  const handleSendReply = useCallback((session: SessionMeta, text: string) => {
    const ok = sendToSession(session.id, text);
    if (ok) {
      markSessionRead(session.id);
      // Show user's message in the card briefly, then animate out
      setLastMessages((prev) => ({
        ...prev,
        [session.id]: {
          sessionId: session.id,
          content: text,
          role: 'user',
          loadedAt: Date.now(),
          // Sentinel: empty string never matches a real updatedAt, so the next
          // completion will be fetched fresh instead of reusing this reply stub.
          sourceUpdatedAt: '',
        },
      }));
      setSentSessions((prev) => new Set(prev).add(session.id));
      setReplies((prev) => ({ ...prev, [session.id]: '' }));
      // Animate dismiss after a brief moment so user sees "Sent" state
      setTimeout(() => animateDismiss(session.id), 400);
    }
  }, [markSessionRead, animateDismiss]);

  const isEmpty = unreads.length === 0 && recentIdle.length === 0;

  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-surface-500">
        <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
        </svg>
        <p className="text-[14px]">All caught up</p>
      </div>
    );
  }

  // Merge both sections into a single stream, sorted by updatedAt (oldest first → newest at bottom)
  const allCards: Array<{ session: SessionMeta; isUnread: boolean }> = [
    ...recentIdle.map((s) => ({ session: s, isUnread: false })),
    ...unreads.map((s) => ({ session: s, isUnread: true })),
  ].sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime()); // newest first

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto relative z-10">
      {/* Hero header — 존재감 있는 상단 영역 */}
      <div className="px-5 pt-8 pb-5">
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-9 h-9 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
            </svg>
          </div>
          <div>
            <h2 className="text-[18px] font-bold text-gray-100 leading-tight">Inbox</h2>
            <p className="text-[12px] text-surface-500 leading-tight">
              {unreads.length > 0
                ? `${unreads.length} unread · ${allCards.length} sessions`
                : `${allCards.length} sessions`}
            </p>
          </div>
          {unreads.length > 0 && (
            <span className="ml-auto text-[11px] font-semibold bg-primary-500/20 text-primary-300 rounded-full px-2.5 py-1 leading-none">
              {unreads.length} new
            </span>
          )}
        </div>
      </div>

      {/* Cards stream — most recent at bottom */}
      <div className="p-4 space-y-4">
        {allCards.map(({ session, isUnread }) => {
          const project = projects.find((p) => p.id === session.projectId);
          const msg = lastMessages[session.id];
          const replyText = replies[session.id] ?? '';
          const isStreaming = streamingSessions.has(session.id);
          const wasSent = sentSessions.has(session.id);

          const isExiting = exitingIds.has(session.id);

          return (
            <div key={session.id} className={isExiting ? 'inbox-card-exit' : ''}>
              <InboxCard
                session={session}
                projectName={project?.name}
                lastMessage={msg}
                replyText={replyText}
                isUnread={isUnread}
                isStreaming={isStreaming}
                wasSent={wasSent}
                onReplyChange={(text) => setReplies((prev) => ({ ...prev, [session.id]: text }))}
                onOpenSession={() => openSession(session)}
                onMarkRead={() => { markSessionRead(session.id); animateDismiss(session.id); }}
                onArchive={() => handleArchive(session.id)}
                onSendReply={(text) => handleSendReply(session, text)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Inbox Card — shows full last message ── */

function InboxCard({
  session,
  projectName,
  lastMessage,
  replyText,
  isUnread,
  isStreaming,
  wasSent,
  onReplyChange,
  onOpenSession,
  onMarkRead,
  onArchive,
  onSendReply,
}: {
  session: SessionMeta;
  projectName?: string;
  lastMessage?: LastMessage;
  replyText: string;
  isUnread: boolean;
  isStreaming: boolean;
  wasSent: boolean;
  onReplyChange: (t: string) => void;
  onOpenSession: () => void;
  onMarkRead: () => void;
  onArchive: () => void;
  onSendReply: (t: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && replyText.trim()) {
      e.preventDefault();
      onSendReply(replyText.trim());
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onReplyChange(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  };

  return (
    <div className={`rounded-xl overflow-hidden transition-all ${
      isUnread
        ? 'bg-surface-850 border border-primary-500/30 hover:border-primary-500/50'
        : 'bg-surface-850/50 border border-surface-800/50 hover:border-surface-700'
    }`}>
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 group">
        {isUnread && <div className="w-2 h-2 rounded-full bg-primary-400 shrink-0" />}
        {isStreaming && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[13px] truncate ${isUnread ? 'font-bold text-gray-100' : 'font-medium text-gray-300'}`}>
              {session.name}
            </span>
            {projectName && (
              <span className="text-[10px] text-surface-600 shrink-0">
                {projectName}
              </span>
            )}
          </div>
        </div>
        <span className="text-[11px] text-surface-500 shrink-0">
          {relativeTime(session.updatedAt)}
        </span>
        {/* Hover actions */}
        <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {isUnread && (
            <button onClick={onMarkRead} className="p-1 text-surface-500 hover:text-gray-300 rounded hover:bg-surface-700/50 transition-colors" title="Mark read">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          )}
          <button onClick={onArchive} className="p-1 text-surface-500 hover:text-yellow-400 rounded hover:bg-surface-700/50 transition-colors" title="Archive">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </button>
        </div>
        <button
          onClick={onOpenSession}
          className="text-[11px] text-primary-400 hover:text-primary-300 transition-colors shrink-0 ml-1"
        >
          Open →
        </button>
      </div>

      {/* ── Last message — FULL rich content ── */}
      <div className="px-4 pb-3">
        {lastMessage ? (
          <div>
            {/* Role indicator */}
            <span className={`text-[10px] uppercase tracking-wider mb-1 block ${
              lastMessage.role === 'user' ? 'text-blue-400/60' : 'text-surface-500'
            }`}>
              {lastMessage.role === 'user' ? 'You' : 'AI'}
            </span>
            {lastMessage.role === 'user' ? (
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-blue-300/80">
                {lastMessage.content}
              </div>
            ) : (
              <div className="prose prose-invert prose-sm max-w-none text-gray-400 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                <RichContent text={lastMessage.content} />
              </div>
            )}
          </div>
        ) : (
          <div className="h-12 flex items-center">
            <div className="w-4 h-4 border-2 border-surface-600 border-t-surface-400 rounded-full animate-spin" />
          </div>
        )}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 mt-2 text-[11px] text-green-400/70">
            <div className="w-3 h-3 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
            Processing...
          </div>
        )}

        {/* Sent confirmation */}
        {wasSent && !isStreaming && lastMessage?.role === 'user' && (
          <div className="text-[11px] text-surface-500 mt-1">
            Sent — waiting for response...
          </div>
        )}
      </div>

      {/* ── Reply input — always visible ── */}
      {!isStreaming && (
        <div className="px-4 py-2 border-t border-surface-800/30 flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Reply... (Enter to send)"
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-gray-300 placeholder-surface-600 resize-none outline-none py-1 leading-relaxed"
            style={{ maxHeight: '120px' }}
          />
          {replyText.trim() && (
            <button
              onClick={() => onSendReply(replyText.trim())}
              className="shrink-0 text-[12px] text-primary-400 hover:text-primary-300 font-medium pb-1 transition-colors"
            >
              Send
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Relative time helper ── */

function relativeTime(dateStr: string): string {
  let normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
  if (!normalized.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(normalized)) normalized += 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  if (isNaN(diff)) return '';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
