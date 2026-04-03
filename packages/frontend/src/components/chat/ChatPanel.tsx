import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChatStore, type ChatMessage, type PendingQuestion } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';
import { useActiveSessionStreaming } from '../../hooks/useActiveSessionStreaming';
import { useAiPanelStore } from '../../stores/ai-panel-store';
import { normalizeContentBlocks } from '../../utils/message-parser';
import { MessageBubble, TurnMetricsBar } from './MessageBubble';
import { InputBox } from './InputBox';
import { FloatingQuestionCard } from './FloatingQuestionCard';
import { AiPanel } from '../rooms/AiPanel';

/* Snapshot system removed — always start at bottom on session switch.
 * Virtuoso's restoreStateFrom was unreliable across session switches
 * (stale heights, race conditions with debounced saves, message count drift).
 * Simple "always bottom" is correct 99% of the time and never breaks. */

/**
 * Merge consecutive assistant messages into one visual message.
 * Preserves the original SDK block order (text → tool → text → tool).
 */
function mergeConsecutiveAssistant(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    const last = result[result.length - 1];
    // Only merge consecutive assistant messages that share the same parentToolUseId
    // (i.e. both top-level, or both belonging to the same sub-agent)
    if (
      last && last.role === 'assistant' && msg.role === 'assistant' &&
      (last.parentToolUseId ?? null) === (msg.parentToolUseId ?? null)
    ) {
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
  onLoadMore?: (sessionId: string) => Promise<void>;
}

export function ChatPanel({ onSend, onAbort, onFileClick, onAnswerQuestion, onLoadMore }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useActiveSessionStreaming();
  const compactingSessionId = useChatStore((s) => s.compactingSessionId);
  const pendingQuestion = useChatStore((s) => s.pendingQuestion);
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const loadingMoreMessages = useChatStore((s) => s.loadingMoreMessages);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isCompacting = compactingSessionId !== null && compactingSessionId === activeSessionId;
  const _sessions = useSessionStore((s) => s.sessions); // keep subscription for sidebar reactivity

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isAtBottom = useRef(true);

  // Track answered state: keep question data + answer briefly after answering
  const [answeredState, setAnsweredState] = useState<{
    question: PendingQuestion;
    answer: string;
  } | null>(null);

  useEffect(() => {
    if (answeredState) {
      const timer = setTimeout(() => setAnsweredState(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [answeredState]);

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

  const floatingQuestion = pendingQuestion || answeredState?.question || null;
  const floatingAnswered = (answeredState && !pendingQuestion)
    ? { questionId: answeredState.question.questionId, answer: answeredState.answer }
    : null;

  const mergedMessages = useMemo(() => {
    const visible = messages.filter((msg) => {
      // Hide sub-agent messages (they're shown inside AgentCard stats)
      if (msg.parentToolUseId) return false;
      if (msg.role !== 'user') return true;
      if (msg.content.length > 0 && msg.content.every((b) => b.type === 'tool_result')) {
        return false;
      }
      const firstText = msg.content.find((b) => b.type === 'text')?.text || '';
      if (firstText.startsWith('Base directory for this skill:')) return false;
      if (firstText.startsWith('<session-start-hook>')) return false;
      return true;
    });
    return mergeConsecutiveAssistant(visible);
  }, [messages]);

  // ── Scroll: always start at bottom ──
  //
  // Root cause of scroll drift: defaultItemHeight (estimated) vs real height mismatch.
  // Virtuoso estimates total scroll height = itemCount × defaultItemHeight.
  // Real messages (code blocks, tool results) are 300-500px+, not 80px.
  // After items render and measure taller, total height grows but scroll position
  // stays at the old estimated offset → lands in the middle.
  //
  // Fix:
  // 1. Use realistic defaultItemHeight (200px) — closer to actual average.
  // 2. Imperative scrollToBottom with retries after items measure.
  // 3. Suppress isAtBottom=false during settle period (height measurement drift).

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: mergedMessages.length - 1,
      align: 'end',
      behavior: 'auto',
    });
  }, [mergedMessages.length]);

  // Settle period: suppress atBottomStateChange(false) caused by height drift.
  // Without this, Virtuoso fires atBottom=false as items re-measure,
  // then followOutput stops auto-scrolling → stuck in the middle.
  const settleUntil = useRef(0);

  // On session switch: force bottom with retries (items need time to measure)
  useEffect(() => {
    if (!activeSessionId || mergedMessages.length === 0) return;
    isAtBottom.current = true;
    settleUntil.current = Date.now() + 1000; // suppress false-negatives for 1s
    scrollToBottom();
    const t1 = setTimeout(scrollToBottom, 100);
    const t2 = setTimeout(scrollToBottom, 300);
    const t3 = setTimeout(scrollToBottom, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cache-miss: messages arrive after empty mount → scroll to bottom
  const hadMessages = useRef(false);
  useEffect(() => {
    if (activeSessionId) hadMessages.current = false;
  }, [activeSessionId]);
  useEffect(() => {
    const has = mergedMessages.length > 0;
    if (has && !hadMessages.current) {
      isAtBottom.current = true;
      settleUntil.current = Date.now() + 1000;
      scrollToBottom();
      const t1 = setTimeout(scrollToBottom, 100);
      const t2 = setTimeout(scrollToBottom, 300);
      hadMessages.current = true;
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    hadMessages.current = has;
  }, [mergedMessages.length, scrollToBottom]);

  // When streaming starts → always scroll to bottom
  const prevStreaming = useRef(isStreaming);
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) {
      isAtBottom.current = true;
      scrollToBottom();
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, scrollToBottom]);

  // When compact finishes → force scroll to bottom
  const prevCompacting = useRef(isCompacting);
  useEffect(() => {
    if (prevCompacting.current && !isCompacting) {
      isAtBottom.current = true;
      settleUntil.current = Date.now() + 500;
      scrollToBottom();
      const t = setTimeout(scrollToBottom, 200);
      return () => clearTimeout(t);
    }
    prevCompacting.current = isCompacting;
  }, [isCompacting, scrollToBottom]);

  // Background refresh: only scroll if user was already at bottom
  const scrollGen = useChatStore((s) => s.scrollGeneration);
  const prevScrollGen = useRef(scrollGen);
  useEffect(() => {
    if (scrollGen !== prevScrollGen.current) {
      prevScrollGen.current = scrollGen;
      if (isAtBottom.current) scrollToBottom();
    }
  }, [scrollGen, scrollToBottom]);

  const lastAssistantIndex = useMemo(() => {
    for (let i = mergedMessages.length - 1; i >= 0; i--) {
      if (mergedMessages[i].role === 'assistant') return i;
    }
    return -1;
  }, [mergedMessages]);

  const isWaitingForAssistant = isStreaming && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant';

  // ── Load More: triggered when user scrolls to top ──
  const handleStartReached = useCallback(() => {
    if (!activeSessionId || !onLoadMore || loadingMoreMessages || !hasMoreMessages) return;
    onLoadMore(activeSessionId);
  }, [activeSessionId, onLoadMore, loadingMoreMessages, hasMoreMessages]);

  // ── Virtuoso: followOutput keeps scroll at bottom during streaming ──
  // During streaming/compacting, always follow (compact can push isAtBottom false).
  // Otherwise, only follow if user is already at bottom.
  const followOutput = useCallback((isAtBottomNow: boolean) => {
    if (isAtBottomNow || isAtBottom.current) return 'auto';
    return false;
  }, []);

  const aiPanelOpen = useAiPanelStore((s) => s.open);
  const aiPanelContextType = useAiPanelStore((s) => s.contextType);

  const handleToggleAiPanel = useCallback(() => {
    const store = useAiPanelStore.getState();
    if (store.open && store.contextType === 'session') {
      store.setOpen(false);
    } else {
      if (activeSessionId) {
        store.setContext('session', activeSessionId);
        store.setActiveThreadId(null);
        store.setMessages([]);
        store.setOpen(true);
      }
    }
  }, [activeSessionId]);

  useEffect(() => {
    const store = useAiPanelStore.getState();
    if (store.open && store.contextType === 'session' && activeSessionId && store.contextId !== activeSessionId) {
      store.setContext('session', activeSessionId);
      store.setActiveThreadId(null);
      store.setMessages([]);
    }
  }, [activeSessionId]);

  const showSessionAiPanel = aiPanelOpen && aiPanelContextType === 'session';

  // ── Render a single message row for Virtuoso ──
  // normalizeContentBlocks is applied lazily here — only for ~20 visible messages,
  // not 500 upfront. This cuts initial load from seconds to instant.
  const renderMessage = useCallback((index: number) => {
    const raw = mergedMessages[index];
    if (!raw) return null;
    const msg = raw.role === 'assistant'
      ? { ...raw, content: normalizeContentBlocks(raw.content) }
      : raw;
    return (
      <div className="px-3 md:px-6 py-0.5">
        <MessageBubble
          key={msg.id}
          message={msg}
          onFileClick={onFileClick}
          onRetry={onSend}
          showMetrics={msg.role === 'assistant' && (msg.durationMs != null || (index === lastAssistantIndex && !isWaitingForAssistant))}
          isLastAssistant={index === lastAssistantIndex}
        />
      </div>
    );
  }, [mergedMessages, lastAssistantIndex, isWaitingForAssistant, onFileClick, onSend]);

  // ── Header: "Load More" indicator ──
  const headerComponent = useMemo(() => {
    if (!hasMoreMessages) return undefined;
    return (
      <div className="flex justify-center py-3 px-3 md:px-6">
        {loadingMoreMessages ? (
          <div className="flex items-center gap-2 text-[13px] text-gray-500">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>불러오는 중...</span>
          </div>
        ) : (
          <div className="text-[11px] text-gray-600">↑ 스크롤하면 이전 메시지를 불러옵니다</div>
        )}
      </div>
    );
  }, [hasMoreMessages, loadingMoreMessages]);

  // ── Footer: thinking indicator ──
  const footerComponent = useMemo(() => {
    if (!isWaitingForAssistant) return undefined;
    return (
      <div className="px-3 md:px-6">
        <div className="flex gap-3 py-5">
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
      </div>
    );
  }, [isWaitingForAssistant]);

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Messages area */}
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex-1 overflow-y-auto px-3 md:px-6">
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
          </div>
        ) : (
          /* Virtualized message list */
          <Virtuoso
            key={activeSessionId}
            ref={virtuosoRef}
            className="flex-1 min-h-0"
            style={{ willChange: 'transform' }}
            data={mergedMessages}
            initialTopMostItemIndex={mergedMessages.length - 1}
            alignToBottom={true}
            itemContent={renderMessage}
            components={{
              Header: headerComponent ? () => headerComponent : undefined,
              Footer: footerComponent ? () => footerComponent : undefined,
            }}
            followOutput={followOutput}
            atBottomStateChange={(atBottom) => {
              // During settle period, ignore false signals caused by height re-measurement.
              // Only accept true (confirms we're at bottom) or false after settle.
              if (!atBottom && Date.now() < settleUntil.current) return;
              isAtBottom.current = atBottom;
            }}
            atBottomThreshold={150}
            startReached={handleStartReached}
            increaseViewportBy={{ top: 400, bottom: 100 }}
            defaultItemHeight={200}
          />
        )}

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
          <CumulativeTokenBar />
          <InputBox onSend={onSend} onAbort={onAbort} />
        </div>

        {/* Session AI Panel toggle — floating button */}
        {activeSessionId && messages.length > 0 && (
          <button
            onClick={handleToggleAiPanel}
            className={`absolute top-3 right-3 p-1.5 rounded-lg transition-all z-10 group ${
              showSessionAiPanel
                ? 'bg-primary-600/20 text-primary-400'
                : 'hover:bg-surface-800 text-gray-500 hover:text-primary-400'
            }`}
            title="Session AI Panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </button>
        )}
      </div>

      {/* Session AI Side Panel */}
      {showSessionAiPanel && <AiPanel />}
    </div>
  );
}

/* ── Context Window Usage Bar ── */

const FALLBACK_MAX_TOKENS = 200_000;

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

/**
 * Shows current context window usage based on last iteration's tokens.
 * "Context used" = last iteration's (input + output) → predicts next turn's input size.
 * "Max" = model's context_window_size from SDK (fallback 200K).
 */
function CumulativeTokenBar() {
  const messages = useChatStore((s) => s.messages);
  const cost = useChatStore((s) => s.cost);

  let contextInput = cost.contextInputTokens || 0;
  let contextOutput = cost.contextOutputTokens || 0;
  let maxTokens = cost.contextWindowSize || 0;
  let turnCount = cost.turnCount || 0;

  // Fallback: after session reload, cost is zeroed — read from last message's stored metrics
  if (contextInput === 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.inputTokens && m.inputTokens > 0) {
        contextInput = m.inputTokens;
        contextOutput = m.outputTokens || 0;
        break;
      }
    }
  }
  if (turnCount === 0) {
    for (const m of messages) {
      if (m.role === 'assistant' && m.inputTokens && m.inputTokens > 0) turnCount++;
    }
  }

  if (contextInput <= 0 && messages.length === 0) return null;

  if (maxTokens === 0) maxTokens = FALLBACK_MAX_TOKENS;

  // Safety: context can't exceed window size (catches stale cumulative values from old DB entries)
  if (contextInput > maxTokens) contextInput = maxTokens;

  const contextUsed = contextInput + contextOutput;
  const pct = Math.min((contextUsed / maxTokens) * 100, 100);
  const isHigh = pct > 70;
  const isCritical = pct > 90;

  return (
    <div className="flex items-center gap-2 mb-1.5 px-1">
      <span className={`text-[10px] tabular-nums font-medium whitespace-nowrap ${
        isCritical ? 'text-red-400' : isHigh ? 'text-amber-400' : 'text-gray-500'
      }`} title={`Context: ${fmtTokensShort(contextInput)} in + ${fmtTokensShort(contextOutput)} out (last API call)\nCumulative: ${fmtTokensShort(cost.cumulativeInputTokens)} in + ${fmtTokensShort(cost.cumulativeOutputTokens)} out (all calls)`}>
        {fmtTokensShort(contextUsed)} / {fmtTokensShort(maxTokens)}
      </span>
      <div className="flex-1 h-1 bg-surface-800/60 rounded-full overflow-hidden max-w-[120px]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isCritical ? 'bg-red-500' : isHigh ? 'bg-amber-500' : 'bg-primary-500/60'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {turnCount > 0 && (
        <span className="text-[10px] text-gray-600 tabular-nums">
          {turnCount} turns
        </span>
      )}
    </div>
  );
}
