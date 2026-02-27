import React, { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useChatStore, type ChatMessage, type PendingQuestion } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';
import { normalizeContentBlocks } from '../../utils/message-parser';
import { MessageBubble } from './MessageBubble';
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
  const pendingQuestion = useChatStore((s) => s.pendingQuestion);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
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
    const merged = mergeConsecutiveAssistant(messages);
    return merged.map((msg) =>
      msg.role === 'assistant'
        ? { ...msg, content: normalizeContentBlocks(msg.content) }
        : msg
    );
  }, [messages]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  useLayoutEffect(() => {
    if (!isNearBottom.current) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">

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

          {mergedMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onFileClick={onFileClick} onRetry={onSend} />
          ))}

          {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex gap-4 my-6">
              <div className="w-8 h-8 rounded-full bg-primary-600/20 border border-primary-500/30 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1 shadow-[0_0_15px_rgba(139,92,246,0.15)] ring-1 ring-primary-500/20 text-primary-400">
                C
              </div>
              <div className="flex items-center gap-1.5 h-10 px-4 bg-surface-900/50 rounded-2xl rounded-tl-sm border border-surface-800/50 w-fit">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator" style={{ animationDelay: '0.4s' }}></span>
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      {/* Input + Floating Question */}
      <div className="shrink-0 px-3 md:px-6 pb-2 md:pb-6">
        {floatingQuestion && (
          <FloatingQuestionCard
            question={floatingQuestion}
            onAnswer={handleAnswerFromCard}
            answered={floatingAnswered}
          />
        )}
        <InputBox onSend={onSend} onAbort={onAbort} />
      </div>
    </div>
  );
}
