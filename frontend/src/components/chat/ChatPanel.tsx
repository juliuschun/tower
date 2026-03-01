import React, { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useChatStore, type ChatMessage, type PendingQuestion } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';
import { normalizeContentBlocks } from '../../utils/message-parser';
import { MessageBubble, TurnMetricsBar } from './MessageBubble';
import { InputBox } from './InputBox';
import { FloatingQuestionCard } from './FloatingQuestionCard';

/**
 * Merge consecutive assistant messages into one visual message.
 * Preserves the original SDK block order (text → tool → text → tool).
 */
function mergeConsecutiveAssistant(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === 'assistant' && msg.role === 'assistant') {
      result[result.length - 1] = {
        ...last,
        content: [...last.content, ...msg.content],
      };
    } else {
      result.push({ ...msg, content: [...msg.content] });
    }
  }

  return result;
}

interface ChatPanelProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  onFileClick?: (path: string) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
}

export function ChatPanel({ onSend, onAbort, onFileClick, onAnswerQuestion }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const compactingSessionId = useChatStore((s) => s.compactingSessionId);
  const pendingQuestion = useChatStore((s) => s.pendingQuestion);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isCompacting = compactingSessionId !== null && compactingSessionId === activeSessionId;
  const sessions = useSessionStore((s) => s.sessions);
  const isMobile = useSessionStore((s) => s.isMobile);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Track answered state: keep question data + answer briefly after answering
  const [answeredState, setAnsweredState] = useState<{
    question: PendingQuestion;
    answer: string;
  } | null>(null);

  // Clear answered state after brief display
  useEffect(() => {
    if (answeredState) {
      const timer = setTimeout(() => setAnsweredState(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [answeredState]);

  // Clear answered state when a new pendingQuestion arrives (new question from SDK)
  useEffect(() => {
    if (pendingQuestion) {
      setAnsweredState(null);
    }
  }, [pendingQuestion]);

  const handleAnswerFromCard = useCallback((questionId: string, answer: string) => {
    const currentQ = useChatStore.getState().pendingQuestion;
    if (currentQ) {
      setAnsweredState({ question: currentQ, answer });
    }
    onAnswerQuestion?.(questionId, answer);
  }, [onAnswerQuestion]);

  // Show floating card: live pending > recently answered (brief)
  const floatingQuestion = pendingQuestion || answeredState?.question || null;
  const floatingAnswered = (answeredState && !pendingQuestion)
    ? { questionId: answeredState.question.questionId, answer: answeredState.answer }
    : null;

  const mergedMessages = useMemo(() => {
    // Filter BEFORE merge: remove user tool_result messages first,
    // so consecutive assistant messages can merge properly.
    // (user tool_result messages between assistant messages break the merge chain)
    const visible = messages.filter((msg) => {
      if (msg.role !== 'user') return true;
      if (msg.content.length > 0 && msg.content.every((b) => b.type === 'tool_result')) {
        return false;
      }
      // Hide SDK-injected system messages that appear as user messages
      const firstText = msg.content.find((b) => b.type === 'text')?.text || '';
      if (firstText.startsWith('Base directory for this skill:')) return false;
      if (firstText.startsWith('<session-start-hook>')) return false;
      return true;
    });
    const merged = mergeConsecutiveAssistant(visible);
    return merged.map((msg) =>
      msg.role === 'assistant'
        ? { ...msg, content: normalizeContentBlocks(msg.content) }
        : msg
    );
  }, [messages]);

  // Find the last assistant message index for metrics display
  const lastAssistantIndex = useMemo(() => {
    for (let i = mergedMessages.length - 1; i >= 0; i--) {
      if (mergedMessages[i].role === 'assistant') return i;
    }
    return -1;
  }, [mergedMessages]);

  // Detect "waiting for first assistant content" — streaming started but no assistant msg yet
  const isWaitingForAssistant = isStreaming && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant';
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);

  // Reset scroll-to-bottom on session switch so new session always starts at bottom
  useEffect(() => {
    isNearBottom.current = true;
  }, [activeSessionId]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  }, []);

  // Snap to bottom when new messages arrive (if user is near bottom)
  useLayoutEffect(() => {
    if (!isNearBottom.current) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Auto-scroll during streaming / typewriter animation.
  // The typewriter reveals text gradually inside the same message,
  // so the messages dependency above won't fire — poll via rAF instead.
  // NOTE: 'smooth' behavior was removed — on mobile it fights with
  //       virtual-keyboard viewport changes, causing visible jitter.
  useEffect(() => {
    if (!isStreaming) return;
    let raf: number;
    const tick = () => {
      if (isNearBottom.current) {
        const el = scrollContainerRef.current;
        if (el) {
          const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (gap > 4) {
            el.scrollTop = el.scrollHeight;          // instant — no smooth
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isStreaming]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0" style={{ willChange: 'scroll-position', WebkitOverflowScrolling: 'touch' }}>

        <div className="px-3 md:px-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center mt-20">
              <div className="w-20 h-20 rounded-full bg-surface-900 border border-surface-800 shadow-2xl flex items-center justify-center mb-6 relative group">
                <div className="absolute inset-0 rounded-full bg-primary-500/20 blur-xl group-hover:bg-primary-500/30 transition-colors"></div>
                <span className="text-4xl relative z-10">✨</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-100 mb-3 tracking-tight">Tower</h2>
              <p className="text-[15px] text-gray-400 max-w-md leading-relaxed">
                Chat with Claude to research, edit files, and run code.
                <br />
                <span className="text-surface-700 mt-2 block font-medium">Type / to use commands.</span>
              </p>
            </div>
          )}

          {mergedMessages.map((msg, idx) => (
            <MessageBubble key={msg.id} message={msg} onFileClick={onFileClick} onRetry={onSend} showMetrics={idx === lastAssistantIndex && !isWaitingForAssistant} />
          ))}

          {isWaitingForAssistant && (
            <div className="flex gap-3 my-5">
              <div className="w-7 h-7 rounded-full bg-primary-600/15 border border-primary-500/25 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 text-primary-400 select-none">
                C
              </div>
              <div>
                <div className="flex items-center gap-1.5 h-10 px-4 bg-surface-900/50 rounded-2xl rounded-tl-sm border border-surface-800/50 w-fit">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator" style={{ animationDelay: '0.2s' }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator" style={{ animationDelay: '0.4s' }}></span>
                </div>
                <TurnMetricsBar />
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      {/* Autocompact banner */}
      {isCompacting && (
        <div className="shrink-0 mx-3 md:mx-6 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/80 border border-surface-700/50 text-[12px] text-gray-400">
          <svg className="w-3.5 h-3.5 shrink-0 animate-spin text-primary-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span>컨텍스트 압축 중… 잠시만 기다려 주세요.</span>
        </div>
      )}

      {/* Input + Floating Question */}
      <div className="shrink-0 px-3 md:px-6 pb-2 md:pb-6">
        {floatingQuestion && (
          <FloatingQuestionCard
            question={floatingQuestion}
            onAnswer={handleAnswerFromCard}
            answered={floatingAnswered}
            onDismiss={() => useChatStore.getState().setPendingQuestion(null)}
          />
        )}
        <InputBox onSend={onSend} onAbort={onAbort} />
      </div>
    </div>
  );
}
