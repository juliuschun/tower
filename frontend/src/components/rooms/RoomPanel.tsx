import { useEffect, useRef, useState, useCallback } from 'react';
import { useRoomStore } from '../../stores/room-store';
import { RoomMessageBubble } from './RoomMessageBubble';
import { RoomList } from './RoomList';
import { RoomMembersPanel } from './RoomMembersPanel';
import { getTokenUserId } from '../../utils/session-restore';

const EMPTY_TYPING: { userId: number; username: string; timestamp: number }[] = [];

function TypingIndicator({ roomId }: { roomId: string }) {
  const typingUsers = useRoomStore((s) => s.typingByRoom[roomId] ?? EMPTY_TYPING);

  // Clean up stale typing indicators (older than 5s)
  const active = typingUsers.filter((u) => Date.now() - u.timestamp < 5000);
  if (active.length === 0) return null;

  const names = active.map((u) => u.username).join(', ');
  return (
    <div className="px-4 py-1.5">
      <span className="text-[11px] text-gray-500 italic">
        {names} {active.length === 1 ? 'is' : 'are'} typing...
      </span>
    </div>
  );
}

const EMPTY_MESSAGES: ReturnType<typeof useRoomStore.getState>['messagesByRoom'][string] = [];
const EMPTY_MEMBERS: ReturnType<typeof useRoomStore.getState>['membersByRoom'][string] = [];

export function RoomPanel() {
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
  const [showAiHint, setShowAiHint] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const joinedRoomRef = useRef<string | null>(null);

  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  const currentUserId = parseInt(localStorage.getItem('userId') || '0', 10) || getTokenUserId(localStorage.getItem('token'));

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Check @ai hint
  useEffect(() => {
    setShowAiHint(input.startsWith('@ai '));
  }, [input]);

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

  const handleSelectRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
  }, [setActiveRoomId]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !activeRoomId) return;

    const ws = (window as any).__claudeWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'room_message',
        roomId: activeRoomId,
        content: input.trim(),
      }));
    }
    setInput('');
    inputRef.current?.focus();
  }, [input, activeRoomId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Send typing indicator
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
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

  // No active room — show room list
  if (!activeRoomId || !activeRoom) {
    return (
      <div className="flex h-full">
        <div className="w-full max-w-md mx-auto">
          <RoomList onSelectRoom={handleSelectRoom} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: room list */}
      <div className="w-64 shrink-0 border-r border-surface-800 hidden lg:block">
        <RoomList onSelectRoom={handleSelectRoom} />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
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
            onClick={() => setShowMembers(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-800 rounded-lg transition-colors group"
            title="Manage members"
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
              <span className="text-[12px] text-gray-500">Loading messages...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-[13px] text-gray-400">No messages yet</p>
                <p className="text-[11px] text-gray-600 mt-1">Start the conversation</p>
              </div>
            </div>
          ) : (
            <div className="py-3">
              {messages.map((msg) => (
                <RoomMessageBubble
                  key={msg.id}
                  message={msg}
                  isOwnMessage={msg.senderId === currentUserId}
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
        <div className="border-t border-surface-800 px-4 py-3">
          {showAiHint && (
            <div className="mb-2 px-3 py-1.5 bg-primary-950/30 border border-primary-900/30 rounded-lg">
              <span className="text-[11px] text-primary-400">AI task will be created from this message</span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
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
    </div>
  );
}
