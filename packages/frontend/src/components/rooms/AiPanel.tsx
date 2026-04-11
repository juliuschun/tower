import { useEffect, useRef, useState, useCallback } from 'react';
import { useAiPanelStore, fetchPanelThreads, createPanelThread, fetchThreadMessages } from '../../stores/ai-panel-store';
import { useRoomStore } from '../../stores/room-store';
import { useSessionStore } from '../../stores/session-store';
import type { ChatMessage, ContentBlock } from '../../stores/chat-store';
import { extractThinkingTitle, normalizeContentBlocks } from '../../utils/message-parser';
import { safeStr } from '../shared/parse-loose-json';
import { normalizePendingQuestion } from '../../utils/pending-question';
import { generateUUID } from '../../utils/uuid';
import { RichContent } from '../shared/RichContent';
import { FloatingQuestionCard } from '../chat/FloatingQuestionCard';

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

// ── Thread List ──

function ThreadList({ onSelectThread, onNewThread }: {
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}) {
  const threads = useAiPanelStore((s) => s.threads);
  const activeThreadId = useAiPanelStore((s) => s.activeThreadId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-800">
        <span className="text-[12px] font-medium text-gray-400">Threads</span>
        <button
          onClick={onNewThread}
          className="p-1 hover:bg-surface-700 rounded transition-colors text-gray-400 hover:text-gray-200"
          title="New thread"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-[12px] text-gray-600">No threads yet</p>
          </div>
        ) : (
          threads.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelectThread(t.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-surface-800/50 transition-colors ${
                activeThreadId === t.id
                  ? 'bg-surface-700/60 text-gray-200'
                  : 'text-gray-400 hover:bg-surface-800/60 hover:text-gray-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium truncate">{t.name}</span>
                <span className="text-[10px] text-gray-600 shrink-0">{formatRelativeTime(t.updatedAt)}</span>
              </div>
              <div className="text-[10px] text-gray-600 mt-0.5">
                {t.turnCount ? `${t.turnCount} turns` : 'Empty'}
                {t.engine && t.engine !== 'claude' ? ` · ${t.engine}` : ''}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Message Bubble (lightweight) ──

function PanelMessage({ message, onShare }: { message: ChatMessage; onShare?: (content: string) => void }) {
  const isUser = message.role === 'user';

  // Extract text content for sharing
  const textContent = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n');

  return (
    <div className={`px-3 py-2 ${isUser ? 'bg-surface-800/30' : ''}`}>
      <div className="flex items-start gap-2">
        <div className={`text-[10px] font-medium mt-0.5 shrink-0 ${isUser ? 'text-blue-400' : 'text-emerald-400'}`}>
          {isUser ? 'You' : 'AI'}
        </div>
        <div className="flex-1 min-w-0 text-[13px] text-gray-200 leading-relaxed">
          {message.content.map((block, i) => {
            if (block.type === 'text' && block.text) {
              return <RichContent key={i} text={block.text} />;
            }
            if (block.type === 'tool_use' && block.toolUse) {
              return (
                <div key={i} className="my-1 px-2 py-1 bg-surface-800 rounded text-[11px] text-gray-500 font-mono">
                  {safeStr(block.toolUse.name)}
                </div>
              );
            }
            if (block.type === 'thinking' && block.thinking) {
              const title = block.thinking.title || extractThinkingTitle(block.thinking.text) || 'Thinking';
              return (
                <details key={i} className="my-1">
                  <summary className="text-[11px] text-gray-500 cursor-pointer truncate">{title}</summary>
                  <div className="text-[11px] text-gray-600 mt-1">{block.thinking.text?.slice(0, 300)}</div>
                </details>
              );
            }
            return null;
          })}
        </div>
        {!isUser && onShare && textContent && (
          <button
            onClick={() => onShare(textContent)}
            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-surface-700 rounded transition-all text-gray-500 hover:text-gray-300 shrink-0"
            title="Share to channel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Thread View ──

function ThreadView({ onBack, onShare }: {
  onBack: () => void;
  onShare?: (content: string, messageId: string) => void;
}) {
  const messages = useAiPanelStore((s) => s.messages);
  const isStreaming = useAiPanelStore((s) => s.isStreaming);
  const pendingQuestion = useAiPanelStore((s) => s.pendingQuestion);
  const activeThreadId = useAiPanelStore((s) => s.activeThreadId);
  const threads = useAiPanelStore((s) => s.threads);
  const contextType = useAiPanelStore((s) => s.contextType);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages.length, pendingQuestion?.questionId]);

  const handleAnswerQuestion = useCallback((questionId: string, answer: string) => {
    const ws = (window as any).__claudeWs;
    if (!ws || ws.readyState !== WebSocket.OPEN || !activeThreadId) return;
    ws.send(JSON.stringify({
      type: 'answer_question',
      sessionId: activeThreadId,
      questionId,
      answer,
    }));
    useAiPanelStore.getState().setPendingQuestion(null);
  }, [activeThreadId]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !activeThreadId || isStreaming) return;

    const ws = (window as any).__claudeWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const msgId = generateUUID();

    // Add user message to panel store immediately
    useAiPanelStore.getState().addMessage({
      id: msgId,
      role: 'user',
      content: [{ type: 'text', text: input.trim() }],
      timestamp: Date.now(),
    });

    // Send via WS chat (reuses existing handleChat flow)
    // panelChat flag prevents backend from overwriting client's main sessionId
    ws.send(JSON.stringify({
      type: 'chat',
      message: input.trim(),
      messageId: msgId,
      sessionId: activeThreadId,
      panelChat: true,
    }));

    useAiPanelStore.getState().setStreaming(true);
    setInput('');
    inputRef.current?.focus();
  }, [input, activeThreadId, isStreaming]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const emptyMessage = contextType === 'session'
    ? 'Ask AI anything about this session'
    : 'Ask AI anything about this channel';

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-800 shrink-0">
        <button
          onClick={onBack}
          className="p-1 hover:bg-surface-700 rounded transition-colors text-gray-400 hover:text-gray-200"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-[12px] font-medium text-gray-300 truncate flex-1">
          {activeThread?.name || 'Thread'}
        </span>
        {isStreaming && (
          <span className="text-[10px] text-emerald-400 animate-pulse">streaming...</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-[12px] text-gray-600">{emptyMessage}</p>
          </div>
        ) : (
          <div className="py-1">
            {messages.map((msg) => (
              <div key={msg.id} className="group">
                <PanelMessage
                  message={msg}
                  onShare={msg.role === 'assistant' && onShare ? (content) => onShare(content, msg.id) : undefined}
                />
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-surface-800 px-3 py-2 shrink-0">
        {pendingQuestion && (
          <FloatingQuestionCard
            question={pendingQuestion}
            onAnswer={handleAnswerQuestion}
            onDismiss={() => useAiPanelStore.getState().setPendingQuestion(null)}
          />
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI..."
            rows={1}
            className="flex-1 px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-[12px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-primary-500/50 transition-colors resize-none"
            style={{ minHeight: '32px', maxHeight: '80px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="p-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main AI Panel ──

export function AiPanel() {
  const open = useAiPanelStore((s) => s.open);
  const contextType = useAiPanelStore((s) => s.contextType);
  const contextId = useAiPanelStore((s) => s.contextId);
  const activeThreadId = useAiPanelStore((s) => s.activeThreadId);
  const loading = useAiPanelStore((s) => s.loading);
  const activeRoomId = useRoomStore((s) => s.activeRoomId);
  const isMobile = useSessionStore((s) => s.isMobile);

  // Sync context with active room (only when in room mode)
  useEffect(() => {
    if (contextType === 'room' && activeRoomId && activeRoomId !== contextId) {
      useAiPanelStore.getState().setContext('room', activeRoomId);
      useAiPanelStore.getState().setActiveThreadId(null);
      useAiPanelStore.getState().setMessages([]);
      useAiPanelStore.getState().setPendingQuestion(null);
    }
  }, [activeRoomId, contextId, contextType]);

  // Fetch threads when panel opens
  useEffect(() => {
    if (!open || !contextId) return;
    useAiPanelStore.getState().setLoading(true);
    fetchPanelThreads(contextType, contextId)
      .then((threads) => useAiPanelStore.getState().setThreads(threads))
      .catch(() => {})
      .finally(() => useAiPanelStore.getState().setLoading(false));
  }, [open, contextType, contextId]);

  // Load messages when thread is selected
  useEffect(() => {
    if (!activeThreadId) return;
    useAiPanelStore.getState().setLoading(true);
    fetchThreadMessages(activeThreadId)
      .then((msgs) => useAiPanelStore.getState().setMessages(msgs))
      .catch(() => {})
      .finally(() => useAiPanelStore.getState().setLoading(false));
  }, [activeThreadId]);

  // Listen to WS messages for panel session streaming
  useEffect(() => {
    if (!open) return;

    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const store = useAiPanelStore.getState();
        if (!store.activeThreadId) return;

        // Only process messages for the active panel thread
        if (data.sessionId && data.sessionId !== store.activeThreadId) return;

        if (data.type === 'sdk_message' && data.data?.type === 'assistant') {
          const content: ContentBlock[] = normalizeContentBlocks(data.data.message.content);
          const msgId = data.data.uuid;

          // Update existing or add new
          const existing = store.messages.find((m) => m.id === msgId);
          if (existing) {
            store.updateAssistantById(msgId, content);
          } else {
            store.addMessage({
              id: msgId,
              role: 'assistant',
              content,
              timestamp: Date.now(),
              parentToolUseId: data.data.parent_tool_use_id,
            });
          }
        }

        if (data.type === 'ask_user' && data.sessionId === store.activeThreadId) {
          const normalizedPendingQuestion = normalizePendingQuestion({
            questionId: data.questionId,
            sessionId: data.sessionId,
            questions: data.questions,
          });
          store.setPendingQuestion(normalizedPendingQuestion);
        }

        if (data.type === 'ask_user_timeout') {
          const pq = store.pendingQuestion;
          if (pq && pq.questionId === data.questionId) {
            store.setPendingQuestion(null);
          }
        }

        if (data.type === 'sdk_done' && data.sessionId === store.activeThreadId) {
          store.setStreaming(false);
          store.setPendingQuestion(null);
        }

        if (data.type === 'session_status' && data.sessionId === store.activeThreadId) {
          store.setStreaming(data.status === 'streaming');
          if (data.status !== 'streaming') {
            store.setPendingQuestion(null);
          }
        }
      } catch {}
    };

    const ws = (window as any).__claudeWs;
    if (ws) ws.addEventListener('message', handler);
    return () => { if (ws) ws.removeEventListener('message', handler); };
  }, [open]);

  if (!open) return null;

  const handleNewThread = async () => {
    if (!contextId) return;
    try {
      const thread = await createPanelThread(contextType, contextId);
      useAiPanelStore.getState().addThread(thread);
      useAiPanelStore.getState().setActiveThreadId(thread.id);
      useAiPanelStore.getState().setMessages([]);
      useAiPanelStore.getState().setPendingQuestion(null);
    } catch (err) {
      console.error('[AiPanel] Failed to create thread:', err);
    }
  };

  const handleSelectThread = (id: string) => {
    useAiPanelStore.getState().setActiveThreadId(id);
  };

  const handleBack = () => {
    useAiPanelStore.getState().setActiveThreadId(null);
    useAiPanelStore.getState().setMessages([]);
    useAiPanelStore.getState().setStreaming(false);
    useAiPanelStore.getState().setPendingQuestion(null);
  };

  // Share to channel (only available in room mode)
  const handleShare = contextType === 'room' ? (content: string, messageId: string) => {
    if (!contextId) return;
    const ws = (window as any).__claudeWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const store = useAiPanelStore.getState();
    ws.send(JSON.stringify({
      type: 'share_to_channel',
      roomId: contextId,
      sessionId: store.activeThreadId,
      messageId,
      content,
    }));
  } : undefined;

  const panelTitle = contextType === 'session' ? 'Session AI' : 'AI Panel';

  return (
    <div className={
      isMobile
        ? 'fixed inset-0 z-50 bg-surface-900 flex flex-col h-full'
        : 'w-[360px] border-l border-surface-800 bg-surface-900 flex flex-col h-full shrink-0'
    }>
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-800 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className="text-[13px] font-semibold text-gray-200">{panelTitle}</span>
        </div>
        <button
          onClick={() => useAiPanelStore.getState().setOpen(false)}
          className="p-1 hover:bg-surface-700 rounded transition-colors text-gray-500 hover:text-gray-300"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-[12px] text-gray-500">Loading...</span>
          </div>
        ) : activeThreadId ? (
          <ThreadView onBack={handleBack} onShare={handleShare} />
        ) : (
          <ThreadList onSelectThread={handleSelectThread} onNewThread={handleNewThread} />
        )}
      </div>
    </div>
  );
}
