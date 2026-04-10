import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoomStore, type RoomMessage } from '../../stores/room-store';
import { RoomMessageBubble } from './RoomMessageBubble';
import { RoomMembersPanel } from './RoomMembersPanel';
import { AiPanel } from './AiPanel';
import { useAiPanelStore } from '../../stores/ai-panel-store';
import { getTokenUserId } from '../../utils/session-restore';

const EMPTY_TYPING: { userId: number; username: string; timestamp: number }[] = [];

/** Mention autocomplete dropdown */
function MentionDropdown({
  members,
  query,
  selectedIndex,
  onSelect,
}: {
  members: { userId: number; username: string }[];
  query: string;
  selectedIndex: number;
  onSelect: (username: string) => void;
}) {
  const filtered = members.filter((m) =>
    m.username.toLowerCase().startsWith(query.toLowerCase())
  );
  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-56 max-h-40 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-xl z-50">
      {filtered.slice(0, 8).map((m, i) => (
        <button
          key={m.userId}
          onClick={() => onSelect(m.username)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
            i === selectedIndex
              ? 'bg-primary-600/30 text-gray-100'
              : 'text-gray-300 hover:bg-surface-700'
          }`}
        >
          <div className="w-5 h-5 rounded-full bg-surface-600 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-gray-300">{m.username[0].toUpperCase()}</span>
          </div>
          <span className="text-[12px] font-medium truncate">{m.username}</span>
        </button>
      ))}
    </div>
  );
}

function TypingIndicator({ roomId }: { roomId: string }) {
  const { t } = useTranslation('rooms');
  const typingUsers = useRoomStore((s) => s.typingByRoom[roomId] ?? EMPTY_TYPING);

  // Clean up stale typing indicators (older than 5s)
  const active = typingUsers.filter((u) => Date.now() - u.timestamp < 5000);
  if (active.length === 0) return null;

  const names = active.map((u) => u.username).join(', ');
  return (
    <div className="px-4 py-1.5">
      <span className="text-[11px] text-gray-500 italic">
        {names} {active.length === 1 ? t('isTyping') : t('areTyping')}
      </span>
    </div>
  );
}

const EMPTY_MESSAGES: ReturnType<typeof useRoomStore.getState>['messagesByRoom'][string] = [];
const EMPTY_MEMBERS: ReturnType<typeof useRoomStore.getState>['membersByRoom'][string] = [];

export function RoomPanel() {
  const { t } = useTranslation('rooms');
  const rooms = useRoomStore((s) => s.rooms);
  const activeRoomId = useRoomStore((s) => s.activeRoomId);
  const setActiveRoomId = useRoomStore((s) => s.setActiveRoomId);
  const messagesByRoom = useRoomStore((s) => s.messagesByRoom);
  const membersByRoom = useRoomStore((s) => s.membersByRoom);
  const messages = activeRoomId ? (messagesByRoom[activeRoomId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES;
  const members = activeRoomId ? (membersByRoom[activeRoomId] ?? EMPTY_MEMBERS) : EMPTY_MEMBERS;
  const messagesLoading = useRoomStore((s) => s.messagesLoading);
  const clearUnread = useRoomStore((s) => s.clearUnread);

  const [input, setInput] = useState('');
  const [hintType, setHintType] = useState<'ai' | 'task' | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const joinedRoomRef = useRef<string | null>(null);

  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  const currentUserId = parseInt(localStorage.getItem('userId') || '0', 10) || getTokenUserId(localStorage.getItem('token'));

  // Build a map of messageId → message for parent lookups
  const messageMap = useMemo(() => {
    const map = new Map<string, RoomMessage>();
    for (const msg of messages) map.set(msg.id, msg);
    return map;
  }, [messages]);

  // Auto-scroll to bottom on new messages and after loading completes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages.length, messagesLoading]);

  // Check @ai / @task hint
  useEffect(() => {
    if (/^\s*@task\b/i.test(input)) setHintType('task');
    else if (/^\s*@ai\b/i.test(input)) setHintType('ai');
    else setHintType(null);
  }, [input]);

  // Clear reply when switching rooms
  useEffect(() => {
    setReplyTo(null);
  }, [activeRoomId]);

  // Join/leave room via WS and fetch messages on room change
  useEffect(() => {
    if (!activeRoomId) return;

    // Leave previous room
    if (joinedRoomRef.current && joinedRoomRef.current !== activeRoomId) {
      const ws = (window as any).__claudeWs;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'room_leave', roomId: joinedRoomRef.current }));
      }
    }

    // Join new room
    const ws = (window as any).__claudeWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'room_join', roomId: activeRoomId }));
    }
    joinedRoomRef.current = activeRoomId;

    // Clear unread + mark as read on server
    clearUnread(activeRoomId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'room_read', roomId: activeRoomId }));
    }

    // Fetch messages via REST
    useRoomStore.getState().setMessagesLoading(true);
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = {};
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    fetch(`/api/rooms/${activeRoomId}/messages`, { headers: hdrs })
      .then((r) => r.ok ? r.json() : { messages: [] })
      .then((data) => {
        useRoomStore.getState().setMessages(activeRoomId, data.messages || []);
      })
      .catch(() => {})
      .finally(() => {
        useRoomStore.getState().setMessagesLoading(false);
      });

    // Also fetch members (included in room detail endpoint)
    fetch(`/api/rooms/${activeRoomId}`, { headers: hdrs })
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => {
        if (data?.members) {
          useRoomStore.getState().setMembers(activeRoomId, data.members);
        }
      })
      .catch(() => {});

    return () => {
      // Cleanup: leave room on unmount
      const ws2 = (window as any).__claudeWs;
      if (ws2?.readyState === WebSocket.OPEN && joinedRoomRef.current) {
        ws2.send(JSON.stringify({ type: 'room_leave', roomId: joinedRoomRef.current }));
        joinedRoomRef.current = null;
      }
    };
  }, [activeRoomId, clearUnread]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !activeRoomId) return;

    const content = input.trim();
    const clientMsgId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const currentUsername = localStorage.getItem('username') || 'You';

    // Optimistic: add message to store immediately
    const optimisticMsg = {
      id: clientMsgId,
      roomId: activeRoomId,
      senderId: currentUserId,
      senderName: currentUsername,
      seq: 0,
      msgType: 'human' as const,
      content,
      metadata: {},
      taskId: null,
      replyTo: replyTo?.id || null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      pending: true,
      clientMsgId,
    };
    useRoomStore.getState().addMessage(activeRoomId, optimisticMsg);

    // Extract @mentions from content
    const mentionMatches = content.match(/@(\w+)/g);
    const mentions = mentionMatches
      ? [...new Set(mentionMatches.map((m: string) => m.slice(1).toLowerCase()))]
      : [];

    // Send via WebSocket
    const ws = (window as any).__claudeWs;
    if (ws?.readyState === WebSocket.OPEN) {
      const payload: any = {
        type: 'room_message',
        roomId: activeRoomId,
        content,
        clientMsgId,
        ...(mentions.length > 0 ? { mentions } : {}),
      };
      if (replyTo) {
        payload.replyTo = replyTo.id;
      }
      ws.send(JSON.stringify(payload));
    } else {
      // WebSocket not open — mark as failed immediately
      useRoomStore.getState().markMessageFailed(activeRoomId, clientMsgId);
    }

    // Timeout: if no ACK within 5s, mark as failed
    const roomId = activeRoomId;
    setTimeout(() => {
      const msgs = useRoomStore.getState().messagesByRoom[roomId] ?? [];
      const still = msgs.find((m) => m.clientMsgId === clientMsgId && m.pending);
      if (still) {
        useRoomStore.getState().markMessageFailed(roomId, clientMsgId);
      }
    }, 5000);

    setInput('');
    setReplyTo(null);
    inputRef.current?.focus();
  }, [input, activeRoomId, replyTo, currentUserId]);

  // Insert mention from autocomplete
  const handleMentionSelect = useCallback((username: string) => {
    const before = input.slice(0, mentionStartPos);
    const after = input.slice(inputRef.current?.selectionStart ?? input.length);
    // Replace @query with @username + space
    const newInput = before + '@' + username + ' ' + after;
    setInput(newInput);
    setMentionQuery(null);
    setMentionIndex(0);
    inputRef.current?.focus();
  }, [input, mentionStartPos]);

  // Get filtered members for mention dropdown
  const mentionFiltered = useMemo(() => {
    if (mentionQuery === null) return [];
    return members.filter((m) =>
      m.username.toLowerCase().startsWith(mentionQuery.toLowerCase())
    ).slice(0, 8);
  }, [mentionQuery, members]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Block Enter during IME composition (Korean, Japanese, Chinese input)
    if (e.nativeEvent.isComposing) return;

    // Mention autocomplete keyboard navigation
    if (mentionQuery !== null && mentionFiltered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionFiltered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionFiltered.length) % mentionFiltered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleMentionSelect(mentionFiltered[mentionIndex].username);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Escape clears reply
    if (e.key === 'Escape' && replyTo) {
      setReplyTo(null);
    }
  }, [handleSend, replyTo, mentionQuery, mentionFiltered, mentionIndex, handleMentionSelect]);

  const handleReply = useCallback((msg: RoomMessage) => {
    setReplyTo(msg);
    inputRef.current?.focus();
  }, []);

  const handleOpenThread = useCallback(async (msg: RoomMessage) => {
    const activeRoom = useRoomStore.getState().rooms.find(r => r.id === activeRoomId);
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({
          name: `Thread: ${msg.content.slice(0, 40)}...`,
          projectId: activeRoom?.projectId || undefined,
          roomId: activeRoomId,
          sourceMessageId: msg.id,
        }),
      });
      if (res.ok) {
        const session = await res.json();
        // Import session store and navigate to the new session
        const { useSessionStore } = await import('../../stores/session-store');
        useSessionStore.getState().addSession(session);
        useSessionStore.getState().setActiveSessionId(session.id);
        useSessionStore.getState().setSidebarTab('sessions');
        useSessionStore.getState().setActiveView('chat');
      }
    } catch {}
  }, [activeRoomId]);

  // Send typing indicator
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Detect @mention query from cursor position
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionStartPos(cursorPos - atMatch[0].length);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }

    if (!activeRoomId) return;
    // Throttle typing events
    if (!typingTimeoutRef.current) {
      const ws = (window as any).__claudeWs;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'room_typing', roomId: activeRoomId }));
      }
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null;
      }, 2000);
    }
  }, [activeRoomId]);

  // No active room — prompt to select from sidebar
  if (!activeRoomId || !activeRoom) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-[15px] text-gray-400">{t('selectRoom')}</p>
          <p className="text-[12px] text-gray-600 mt-1">{t('orCreateNew')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: 0 }}>
        {/* Top bar */}
        <div className="h-12 border-b border-surface-800 flex items-center px-4 gap-3 shrink-0">
          {/* Back button on small screens */}
          <button
            onClick={() => setActiveRoomId(null)}
            className="lg:hidden p-1 hover:bg-surface-800 rounded transition-colors text-gray-400 hover:text-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-gray-200 truncate">{activeRoom.name}</h2>
          </div>
          <button
            onClick={() => {
              const store = useAiPanelStore.getState();
              if (store.open && store.contextType === 'room') {
                store.setOpen(false);
              } else {
                if (activeRoomId) store.setContext('room', activeRoomId);
                store.setActiveThreadId(null);
                store.setMessages([]);
                store.setOpen(true);
              }
            }}
            className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors group"
            title={t('aiPanel')}
          >
            <svg className="w-4 h-4 text-gray-500 group-hover:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </button>
          <button
            onClick={() => setShowMembers(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-800 rounded-lg transition-colors group"
            title={t('manageMembers')}
          >
            <svg className="w-4 h-4 text-gray-500 group-hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="text-[11px] text-gray-500 group-hover:text-gray-300">{members.length}</span>
          </button>
        </div>

        {/* Messages area */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto"
        >
          {messagesLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-[12px] text-gray-500">{t('loadingMessages')}</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-[13px] text-gray-400">{t('noMessagesYet')}</p>
                <p className="text-[11px] text-gray-600 mt-1">{t('startConversation')}</p>
              </div>
            </div>
          ) : (
            <div className="py-3">
              {messages.map((msg) => (
                <RoomMessageBubble
                  key={msg.id}
                  message={msg}
                  isOwnMessage={msg.senderId === currentUserId}
                  parentMessage={msg.replyTo ? messageMap.get(msg.replyTo) ?? null : null}
                  onReply={handleReply}
                  onOpenThread={handleOpenThread}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Members panel modal */}
        {showMembers && activeRoomId && (
          <RoomMembersPanel roomId={activeRoomId} onClose={() => setShowMembers(false)} />
        )}

        {/* Typing indicator */}
        <TypingIndicator roomId={activeRoomId} />

        {/* Input area */}
        <div className="border-t border-surface-800 px-4 py-3 relative">
          {/* Reply preview bar */}
          {replyTo && (
            <div className="mb-2 flex items-center gap-2 px-3 py-1.5 bg-surface-800/60 border border-surface-700 rounded-lg">
              <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v3M3 10l6-6M3 10l6 6" />
              </svg>
              <span className="text-[11px] text-gray-400 truncate flex-1">
                <span className="font-semibold text-gray-300">
                  {replyTo.senderName || (replyTo.msgType === 'ai_reply' || replyTo.msgType === 'ai_summary' ? 'AI' : 'Unknown')}
                </span>
                {' '}{replyTo.content.slice(0, 60)}{replyTo.content.length > 60 ? '...' : ''}
              </span>
              {(replyTo.msgType === 'ai_reply' || replyTo.msgType === 'ai_summary') && (
                <span className="text-[10px] text-blue-400/70 shrink-0">{t('atAiToReply')}</span>
              )}
              <button
                onClick={() => setReplyTo(null)}
                className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors shrink-0"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {hintType && (
            <div className={`mb-2 px-3 py-1.5 rounded-lg border ${
              hintType === 'task'
                ? 'bg-primary-950/30 border-primary-900/30'
                : 'bg-blue-950/30 border-blue-900/30'
            }`}>
              <span className={`text-[11px] ${hintType === 'task' ? 'text-primary-400' : 'text-blue-400'}`}>
                {hintType === 'task' ? t('taskWillBeCreated') : t('aiWillReply')}
              </span>
            </div>
          )}
          {/* Mention autocomplete */}
          {mentionQuery !== null && mentionFiltered.length > 0 && (
            <MentionDropdown
              members={mentionFiltered}
              query={mentionQuery}
              selectedIndex={mentionIndex}
              onSelect={handleMentionSelect}
            />
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={replyTo ? t('replyPlaceholder') : t('typeMessagePlaceholder')}
              rows={1}
              className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-primary-500/50 transition-colors resize-none max-h-32"
              style={{ minHeight: '38px' }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors shrink-0"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* AI Side Panel */}
      <AiPanel />
    </div>
  );
}
