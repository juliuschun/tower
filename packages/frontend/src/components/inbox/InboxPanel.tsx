import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useProjectStore } from '../../stores/project-store';
import { useChatStore } from '../../stores/chat-store';
import { RichContent } from '../shared/RichContent';
import type { SessionMeta } from '@tower/shared';

const RECENT_IDLE_LIMIT = 10;

interface LastMessage {
  sessionId: string;
  content: string;
  role: 'user' | 'assistant';
  loadedAt: number;
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

  const [lastMessages, setLastMessages] = useState<Record<string, LastMessage>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [sentSessions, setSentSessions] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set()); // mark-as-read → disappear
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentUsername = useMemo(() => localStorage.getItem('username') || '', []);

  // ── Two sections ──
  const unreads = useMemo(() =>
    sessions
      .filter((s) => unreadSessions.has(s.id) && !streamingSessions.has(s.id) && s.ownerUsername === currentUsername && !dismissedIds.has(s.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), // newest first (inbox style)
    [sessions, unreadSessions, streamingSessions, currentUsername, dismissedIds]
  );

  const recentIdle = useMemo(() =>
    sessions
      .filter((s) => !unreadSessions.has(s.id) && !streamingSessions.has(s.id) && s.ownerUsername === currentUsername && !dismissedIds.has(s.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) // newest first
      .slice(0, RECENT_IDLE_LIMIT), // take first N (most recent)
    [sessions, unreadSessions, streamingSessions, currentUsername]
  );

  const allVisibleIds = useMemo(() => {
    const ids = new Set<string>();
    unreads.forEach((s) => ids.add(s.id));
    recentIdle.forEach((s) => ids.add(s.id));
    return ids;
  }, [unreads, recentIdle]);

  // Load last AI turn — everything after the last user message
  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    allVisibleIds.forEach(async (sessionId) => {
      if (lastMessages[sessionId]) return;
      try {
        // Fetch enough messages to get the full last turn
        // (last user msg + all subsequent assistant msgs, tool uses, tool results, etc.)
        const res = await fetch(`/api/sessions/${sessionId}/messages?limit=50`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        const msgs: any[] = data.messages ?? data;
        if (msgs.length === 0) return;

        // Find the index of the last user message
        let lastUserIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') { lastUserIdx = i; break; }
        }

        // Take everything after the last user message (= full last AI turn)
        const lastTurnMsgs = lastUserIdx >= 0 ? msgs.slice(lastUserIdx + 1) : msgs;
        if (lastTurnMsgs.length === 0) return;

        // Concatenate all text blocks from the AI turn
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
          [sessionId]: { sessionId, content: text, role: 'assistant', loadedAt: Date.now() },
        }));
      } catch {}
    });
  }, [[...allVisibleIds].join(',')]);

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
      // Show user's message in the card
      setLastMessages((prev) => ({
        ...prev,
        [session.id]: { sessionId: session.id, content: text, role: 'user', loadedAt: Date.now() },
      }));
      setSentSessions((prev) => new Set(prev).add(session.id));
      setReplies((prev) => ({ ...prev, [session.id]: '' }));
    }
  }, [markSessionRead]);

  const isEmpty = unreads.length === 0 && recentIdle.length === 0;

  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-surface-500">
        <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162" />
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
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface-900/80 backdrop-blur-sm px-4 py-3 border-b border-surface-800/50">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-gray-200">Inbox</h2>
          {unreads.length > 0 && (
            <span className="text-[11px] font-semibold bg-primary-500/20 text-primary-300 rounded-full px-2 py-0.5 leading-none">
              {unreads.length} unread
            </span>
          )}
          <span className="text-[11px] text-surface-500">
            {allCards.length} sessions
          </span>
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

          return (
            <InboxCard
              key={session.id}
              session={session}
              projectName={project?.name}
              lastMessage={msg}
              replyText={replyText}
              isUnread={isUnread}
              isStreaming={isStreaming}
              wasSent={wasSent}
              onReplyChange={(text) => setReplies((prev) => ({ ...prev, [session.id]: text }))}
              onOpenSession={() => openSession(session)}
              onMarkRead={() => { markSessionRead(session.id); setDismissedIds((prev) => new Set(prev).add(session.id)); }}
              onArchive={() => handleArchive(session.id)}
              onSendReply={(text) => handleSendReply(session, text)}
            />
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
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
  const diff = Date.now() - new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
