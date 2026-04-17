import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChatStore, type ChatMessage, type ContentBlock, type PendingQuestion, type TurnPhase } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';
import { useAiPanelStore } from '../../stores/ai-panel-store';
import { useSessionAwareModel, type ModelOption, getEngineFromModel } from '../../stores/model-store';
import { normalizeContentBlocks } from '../../utils/message-parser';
import { MessageBubble, TurnMetricsBar } from './MessageBubble';
import { InputBox } from './InputBox';
import { FloatingQuestionCard } from './FloatingQuestionCard';
import { AiPanel } from '../rooms/AiPanel';
import { useActiveSessionTurnState } from '../../hooks/useActiveSessionTurnState';

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

/**
 * PlainMessageList: renders ALL messages in a simple scrollable div.
 * Used for conversations with ≤80 messages. Zero virtualization = zero flicker.
 * Automatically scrolls to bottom on mount and when new messages arrive.
 */
function PlainMessageList({
  messages,
  renderMessage,
  headerComponent,
  footerComponent,
  scrollWrapRef,
  isStreaming,
  isAtBottomRef,
  userScrolledUpRef,
  showJumpToLatest,
  onJumpToLatest,
  onStartReached,
}: {
  messages: ChatMessage[];
  renderMessage: (index: number) => React.ReactNode;
  headerComponent: React.ReactNode;
  footerComponent: React.ReactNode;
  scrollWrapRef: React.RefObject<HTMLDivElement | null>;
  isStreaming: boolean;
  isAtBottomRef: React.MutableRefObject<boolean>;
  userScrolledUpRef: React.MutableRefObject<boolean>;
  showJumpToLatest: boolean;
  onJumpToLatest: () => void;
  onStartReached: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(messages.length);

  // Scroll to bottom helper
  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
  }, []);

  // On mount: jump to bottom. Retry via rAF because messages may not be fully
  // painted yet — scrollHeight grows as React renders child components.
  useEffect(() => {
    scrollToEnd();
    let frame = 0;
    const retry = () => {
      scrollToEnd();
      frame++;
      if (frame < 10) requestAnimationFrame(retry); // ~160ms of retries
    };
    const raf = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On new messages: scroll to bottom if user is at bottom
  useEffect(() => {
    if (messages.length > prevLen.current && !userScrolledUpRef.current) {
      requestAnimationFrame(scrollToEnd);
    }
    prevLen.current = messages.length;
  }, [messages.length, scrollToEnd, userScrolledUpRef]);

  // During streaming: keep at bottom
  useEffect(() => {
    if (!isStreaming || userScrolledUpRef.current) return;
    const id = setInterval(() => {
      if (!userScrolledUpRef.current) scrollToEnd();
    }, 100);
    return () => clearInterval(id);
  }, [isStreaming, scrollToEnd, userScrolledUpRef]);

  // Scroll event: detect scroll-up + trigger loadMore at top
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottomRef.current = atBottom;
    if (!atBottom && !userScrolledUpRef.current) {
      userScrolledUpRef.current = true;   // user scrolled up — stop auto-scroll
    }
    if (atBottom && userScrolledUpRef.current) {
      userScrolledUpRef.current = false;
    }
    // Trigger loadMore when near top
    if (el.scrollTop < 200) {
      onStartReached();
    }
  }, [isAtBottomRef, userScrolledUpRef, onStartReached]);

  return (
    <div ref={scrollWrapRef} className="flex-1 min-h-0 relative">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        style={{ overscrollBehavior: 'contain' }}
        onScroll={handleScroll}
      >
        {/* Spacer pushes content to bottom when messages don't fill the view */}
        <div className="min-h-full flex flex-col justify-end">
          {headerComponent}
          {messages.map((_, i) => (
            <div key={messages[i].id}>{renderMessage(i)}</div>
          ))}
          {footerComponent}
        </div>
      </div>
      {showJumpToLatest && (
        <button
          onClick={onJumpToLatest}
          className="absolute bottom-4 right-4 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-primary-600 hover:bg-primary-500 text-white shadow-lg border border-primary-400/40 transition-colors"
          title="최신 메시지로 이동"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
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
  const sessionLoading = useChatStore((s) => s.sessionLoading);
  // NOTE: scroll logic needs chat-store's isStreaming (synced with message arrival).
  // useActiveSessionStreaming (session-store) has timing mismatch that causes scroll drift.
  const isStreaming = useChatStore((s) => s.isStreaming);
  const compactingSessionId = useChatStore((s) => s.compactingSessionId);
  const pendingQuestion = useChatStore((s) => s.pendingQuestion);
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const loadingMoreMessages = useChatStore((s) => s.loadingMoreMessages);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeTurn = useActiveSessionTurnState();
  const isCompacting = compactingSessionId !== null && compactingSessionId === activeSessionId;
  const _sessions = useSessionStore((s) => s.sessions); // keep subscription for sidebar reactivity

  // Consume pending reply from Inbox (already sent over WS by InboxPanel.sendToSession).
  // Render an optimistic bubble so the user sees their text immediately on open;
  // the real message arrives via the server's `user_message` broadcast and is
  // de-duped by id in mergeMessagesFromDb / addMessage.
  // ⚠️ DO NOT call onSend(pending) here — that would send the chat a SECOND time.
  useEffect(() => {
    if (!activeSessionId) return;
    const pending = useSessionStore.getState().pendingReplies[activeSessionId];
    if (!pending) return;
    useSessionStore.getState().clearPendingReply(activeSessionId);

    // Skip optimistic render if a user message with the same body is already in store
    // (covers the case where user_message broadcast or DB merge already populated it).
    const already = useChatStore.getState().messages.some((m) => {
      if (m.role !== 'user') return false;
      const body = m.content.find((b) => b.type === 'text')?.text?.trim();
      return body === pending.trim();
    });
    if (already) return;

    useChatStore.getState().addMessage({
      id: `inbox-pending-${activeSessionId}-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: pending }],
      timestamp: Date.now(),
      username: localStorage.getItem('username') || undefined,
      sendStatus: 'delivered',
    });
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isAtBottom = useRef(true);
  // User-initiated scroll-up detection: when true, followOutput stops auto-scrolling
  // and the settle period stops re-snapping to bottom. Cleared when user returns
  // to bottom (via the jump button or by scrolling down themselves).
  const userScrolledUp = useRef(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

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

  // Dynamic defaultItemHeight: estimate average height from message content types.
  // Static 200px caused big mismatches — short msgs are 60px, code blocks 400px+.
  // This weighted estimate reduces jerk when Virtuoso measures real heights.
  const estimatedItemHeight = useMemo(() => {
    if (mergedMessages.length === 0) return 300;
    let totalEst = 0;
    const sample = mergedMessages.slice(-30); // sample last 30 for perf
    for (const msg of sample) {
      let h = 60; // base: avatar + padding
      for (const block of msg.content) {
        if (block.type === 'text') h += Math.min(200, (block.text?.length ?? 0) * 0.15 + 40);
        else if (block.type === 'tool_use') h += 100;
        else if (block.type === 'tool_result') h += 120;
        else h += 80; // thinking, image, etc.
      }
      totalEst += h;
    }
    // Clamp between 150-500 to avoid extremes
    return Math.max(150, Math.min(500, Math.round(totalEst / sample.length)));
  }, [mergedMessages]);

  // Per-message normalize cache keyed by message ID + content length + last-block snapshot.
  // WeakMap<content array> doesn't work because content is a new array every time
  // (Zustand immutable update). Instead use a Map<string, {contentRef, result}>.
  const normalizeCache = useRef(new Map<string, { contentRef: ContentBlock[]; result: ChatMessage }>());
  const getNormalized = useCallback((msg: ChatMessage): ChatMessage => {
    if (msg.role !== 'assistant') return msg;
    const cache = normalizeCache.current;
    const entry = cache.get(msg.id);
    // Same content array reference → cache hit (fast path for non-streaming messages)
    if (entry && entry.contentRef === msg.content) return entry.result;
    // Content changed: re-normalize
    const normalized = { ...msg, content: normalizeContentBlocks(msg.content) };
    cache.set(msg.id, { contentRef: msg.content, result: normalized });
    return normalized;
  }, []);

  // ── Scroll: always start at bottom ──
  //
  // Root cause of scroll drift: defaultItemHeight (estimated) vs real height mismatch.
  // Virtuoso estimates total scroll height = itemCount × defaultItemHeight.
  // Real messages vary 60-600px. After items render and measure, total height changes
  // but scroll position stays at the old offset → lands in the middle.
  //
  // Fix: rAF-based settle loop. Instead of 4+ fixed setTimeout retries (each causing
  // a visible jerk), we scroll once per animation frame and stop when the position
  // stabilizes. This produces at most 1-2 corrections instead of 6+.

  const scrollToBottom = useCallback(() => {
    if (userScrolledUp.current) return; // honor user intent
    virtuosoRef.current?.scrollToIndex({
      index: mergedMessages.length - 1,
      align: 'end',
      behavior: 'auto',
    });
  }, [mergedMessages.length]);

  const scrollToBottomRef = useRef(scrollToBottom);
  useEffect(() => { scrollToBottomRef.current = scrollToBottom; }, [scrollToBottom]);

  // Settle period: suppress atBottomStateChange(false) caused by height drift.
  const settleUntil = useRef(0);
  const switchSettleUntil = useRef(0);

  // rAF-based settle: scroll to bottom repeatedly until position stabilizes.
  // Stops after position unchanged for 2 consecutive frames, or 2s max.
  const settleRafRef = useRef(0);
  const startSettleLoop = useCallback((duration: number) => {
    cancelAnimationFrame(settleRafRef.current);
    const deadline = Date.now() + duration;
    let prevScrollTop = -1;
    let stableFrames = 0;
    const tick = () => {
      if (userScrolledUp.current || Date.now() > deadline) return;
      scrollToBottomRef.current();
      // Check stability: if scrollTop unchanged for 3 frames (~50ms), position settled.
      const el = document.querySelector('[data-virtuoso-scroller]') as HTMLElement | null;
      const currentTop = el?.scrollTop ?? -2;
      if (currentTop === prevScrollTop) {
        stableFrames++;
        if (stableFrames >= 3) return; // 3 stable frames → done
      } else {
        stableFrames = 0;
      }
      prevScrollTop = currentTop;
      settleRafRef.current = requestAnimationFrame(tick);
    };
    // Start after a microtask to let React flush
    settleRafRef.current = requestAnimationFrame(tick);
  }, []);

  // On session switch: start settle loop
  useEffect(() => {
    if (!activeSessionId || mergedMessages.length === 0) return;
    isAtBottom.current = true;
    userScrolledUp.current = false;
    const now = Date.now();
    settleUntil.current = now + 1500;
    switchSettleUntil.current = now + 3500;
    scrollToBottom();
    startSettleLoop(2000); // 2s max settle
    return () => cancelAnimationFrame(settleRafRef.current);
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
      settleUntil.current = Date.now() + 1500;
      scrollToBottom();
      startSettleLoop(1500);
      hadMessages.current = true;
      return () => cancelAnimationFrame(settleRafRef.current);
    }
    hadMessages.current = has;
  }, [mergedMessages.length, scrollToBottom, startSettleLoop]);

  // When streaming starts → scroll to bottom only if user hasn't scrolled up
  const prevStreaming = useRef(isStreaming);
  useEffect(() => {
    if (isStreaming && !prevStreaming.current && !userScrolledUp.current) {
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
      startSettleLoop(800);
    }
    prevCompacting.current = isCompacting;
  }, [isCompacting, scrollToBottom, startSettleLoop]);

  // Background refresh: scroll if user was at bottom OR still within switch settle period.
  const scrollGen = useChatStore((s) => s.scrollGeneration);
  const prevScrollGen = useRef(scrollGen);
  useEffect(() => {
    if (scrollGen !== prevScrollGen.current) {
      prevScrollGen.current = scrollGen;
      if (isAtBottom.current || Date.now() < switchSettleUntil.current) {
        isAtBottom.current = true;
        settleUntil.current = Math.max(settleUntil.current, Date.now() + 800);
        scrollToBottom();
        startSettleLoop(1000);
      }
    }
  }, [scrollGen, scrollToBottom, startSettleLoop]);

  const lastAssistantIndex = useMemo(() => {
    for (let i = mergedMessages.length - 1; i >= 0; i--) {
      if (mergedMessages[i].role === 'assistant') return i;
    }
    return -1;
  }, [mergedMessages]);

  // preparing: 사용자가 메시지 보낸 직후 ~ 첫 콘텐츠 도착 전 구간.
  // 이 구간에 아바타 + 점 3개 플레이스홀더를 보여주면 "AI가 듣고 있다"는
  // 느낌을 준다. Pi/Claude 모두 동일. 첫 콘텐츠(thinking 또는 text)가
  // 도착하면 phase가 streaming으로 바뀌어 자동으로 사라진다.
  const isWaitingForAssistant = activeTurn.phase === 'preparing' || activeTurn.phase === 'awaiting_user';
  const showAssistantPlaceholder = activeTurn.phase === 'preparing';

  // ── Load More: triggered when user scrolls to top ──
  // Anchor-based scroll restoration: remember the top visible message before prepend,
  // then scroll back to it after new items render. Prevents flicker/jump.
  const topVisibleItemId = useRef<string | null>(null);
  const pendingAnchor = useRef<string | null>(null);

  const handleStartReached = useCallback(async () => {
    if (!activeSessionId || !onLoadMore || loadingMoreMessages || !hasMoreMessages) return;
    // Save anchor before loading
    pendingAnchor.current = topVisibleItemId.current;
    await onLoadMore(activeSessionId);
  }, [activeSessionId, onLoadMore, loadingMoreMessages, hasMoreMessages]);

  // After prepend completes, scroll back to the anchor message
  useEffect(() => {
    if (!pendingAnchor.current) return;
    const anchorId = pendingAnchor.current;
    const anchorIndex = mergedMessages.findIndex((m) => m.id === anchorId);
    if (anchorIndex >= 0) {
      // Use rAF to ensure DOM is updated with new items before scrolling
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: anchorIndex,
          align: 'start',
          behavior: 'auto',
        });
      });
    }
    pendingAnchor.current = null;
  }, [mergedMessages]);

  // ── Virtuoso: followOutput keeps scroll at bottom during streaming ──
  // Honors user scroll intent: if the user dragged/wheeled upward,
  // we stop following until they return to the bottom.
  const followOutput = useCallback((isAtBottomNow: boolean) => {
    if (userScrolledUp.current) return false;
    if (isAtBottomNow || isAtBottom.current) return 'auto';
    return false;
  }, []);

  // ── Detect explicit user scroll intent on the Virtuoso scroller ──
  // We listen for upward wheel ticks and touchmove deltas. The Virtuoso
  // scroller is the first scrollable child of the wrapper div.
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = scrollWrapRef.current;
    if (!wrap) return;
    const scroller = wrap.querySelector('[data-testid="virtuoso-scroller"]') as HTMLElement | null
      || wrap.querySelector('div[style*="overflow"]') as HTMLElement | null;
    if (!scroller) return;

    const markScrolledUp = () => {
      if (!userScrolledUp.current) {
        userScrolledUp.current = true;
        setShowJumpToLatest(true);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) markScrolledUp();
    };
    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y - touchStartY > 24) markScrolledUp(); // finger moving down = content moving up (24px threshold for mobile)
    };
    // Keyboard scroll-up
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PageUp' || e.key === 'ArrowUp' || (e.key === 'Home')) markScrolledUp();
    };

    scroller.addEventListener('wheel', onWheel, { passive: true });
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: true });
    scroller.addEventListener('keydown', onKeyDown);
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('keydown', onKeyDown);
    };
  }, [activeSessionId, mergedMessages.length > 0]);

  // Reset scroll-up flag when session changes
  useEffect(() => {
    userScrolledUp.current = false;
    setShowJumpToLatest(false);
  }, [activeSessionId]);

  const jumpToLatest = useCallback(() => {
    userScrolledUp.current = false;
    setShowJumpToLatest(false);
    isAtBottom.current = true;
    scrollToBottom();
  }, [scrollToBottom]);

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
  // normalizeContentBlocks runs once per message via getNormalized cache —
  // not on every Virtuoso re-render. This was the dominant per-token cost.
  const renderMessage = useCallback((index: number) => {
    const raw = mergedMessages[index];
    if (!raw) return null;
    const msg = getNormalized(raw);
    return (
      <div className="px-3 md:px-6 py-0.5" style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}>
        <MessageBubble
          key={msg.id}
          message={msg}
          onFileClick={onFileClick}
          onRetry={onSend}
          onCancelQueued={(messageId) => {
            const text = useChatStore.getState().cancelQueuedMessage(messageId);
            if (text) {
              window.dispatchEvent(new CustomEvent('restore-input-text', { detail: text }));
            }
          }}
          showMetrics={msg.role === 'assistant' && (msg.durationMs != null || (index === lastAssistantIndex && !isWaitingForAssistant))}
          isLastAssistant={index === lastAssistantIndex}
        />
      </div>
    );
  }, [mergedMessages, lastAssistantIndex, isWaitingForAssistant, onFileClick, onSend, getNormalized]);

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
    if (!showAssistantPlaceholder) return undefined;
    return (
      <div className="px-3 md:px-6">
        <AssistantPlaceholder phase={activeTurn.phase} />
      </div>
    );
  }, [showAssistantPlaceholder, activeTurn.phase]);

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Messages area */}
        {messages.length === 0 && sessionLoading ? (
          /* Loading skeleton while switching sessions */
          <div className="flex-1 overflow-y-auto px-3 md:px-6">
            <div className="max-w-3xl mx-auto pt-8 space-y-6 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-surface-800 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-surface-800 rounded w-1/3" />
                    <div className="h-3 bg-surface-800/60 rounded w-2/3" />
                    <div className="h-3 bg-surface-800/40 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : messages.length === 0 ? (
          /* Genuinely empty session — show model picker */
          <EmptyStateWithModelPicker />
        ) : mergedMessages.length <= 80 ? (
          /* Plain scroll for small conversations — no virtualization = no mount/unmount flash.
           * Messages ≤80 render all DOM nodes; layout cost is trivial on modern devices.
           * Eliminates the "flicker/afterimage" caused by Virtuoso's DOM recycling. */
          <PlainMessageList
            key={activeSessionId}
            messages={mergedMessages}
            renderMessage={renderMessage}
            headerComponent={headerComponent}
            footerComponent={footerComponent}
            scrollWrapRef={scrollWrapRef}
            isStreaming={isStreaming}
            isAtBottomRef={isAtBottom}
            userScrolledUpRef={userScrolledUp}
            showJumpToLatest={showJumpToLatest}
            onJumpToLatest={jumpToLatest}
            onStartReached={handleStartReached}
          />
        ) : (
          /* Virtualized list for large conversations (80+ messages) */
          <div ref={scrollWrapRef} className="flex-1 min-h-0 relative">
          <Virtuoso
            key={activeSessionId}
            ref={virtuosoRef}
            className="h-full"
            style={{ overscrollBehavior: 'contain', willChange: 'transform' }}
            data={mergedMessages}
            computeItemKey={(_idx, item) => item.id}
            initialTopMostItemIndex={mergedMessages.length - 1}
            alignToBottom={true}
            itemContent={renderMessage}
            components={{
              Header: headerComponent ? () => headerComponent : undefined,
              Footer: footerComponent ? () => footerComponent : undefined,
            }}
            rangeChanged={({ startIndex }) => {
              topVisibleItemId.current = mergedMessages[startIndex]?.id ?? null;
            }}
            followOutput={followOutput}
            atBottomStateChange={(atBottom) => {
              if (userScrolledUp.current) {
                isAtBottom.current = false;
                if (atBottom) {
                  userScrolledUp.current = false;
                  setShowJumpToLatest(false);
                  isAtBottom.current = true;
                }
                return;
              }
              const now = Date.now();
              if (!atBottom && (now < settleUntil.current || now < switchSettleUntil.current)) {
                scrollToBottom();
                return;
              }
              isAtBottom.current = atBottom;
            }}
            atBottomThreshold={80}
            startReached={handleStartReached}
            increaseViewportBy={{ top: 800, bottom: 200 }}
            defaultItemHeight={estimatedItemHeight}
          />
          {showJumpToLatest && (
            <button
              onClick={jumpToLatest}
              className="absolute bottom-4 right-4 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-primary-600 hover:bg-primary-500 text-white shadow-lg border border-primary-400/40 transition-colors"
              title="최신 메시지로 이동"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          )}
          </div>
        )}

        {/* Autocompact banner removed: compacting status is already shown above the input box. */}

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
function phaseLabel(phase: TurnPhase): string {
  switch (phase) {
    case 'queued': return '대기열에 추가됨…';
    case 'preparing': return '응답 준비 중…';
    case 'streaming': return '답변 작성 중…';
    case 'tool_running': return '도구 실행 중…';
    case 'awaiting_user': return '응답을 기다리는 중…';
    case 'compacting': return '컨텍스트 정리 중…';
    case 'done': return '완료됨';
    case 'stopped': return '사용자가 중단함';
    case 'error': return '오류가 발생했습니다 — 메시지를 다시 보내보세요';
    default: return '작업 중…';
  }
}

function AssistantPlaceholder({ phase }: { phase: TurnPhase }) {
  return (
    <div className="flex gap-3 py-5">
      <div className="w-7 h-7 rounded-full bg-primary-600/15 border border-primary-500/25 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 text-primary-400 select-none">
        C
      </div>
      <div>
        <div className="flex items-center gap-2 h-10 px-4 bg-surface-900/50 rounded-2xl rounded-tl-sm border border-surface-800/50 w-fit text-[13px] text-gray-300">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator"></span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator" style={{ animationDelay: '0.2s' }}></span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 thinking-indicator" style={{ animationDelay: '0.4s' }}></span>
          <span>{phaseLabel(phase)}</span>
        </div>
        <TurnMetricsBar />
      </div>
    </div>
  );
}

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

/* ── Empty State with Model Picker ── */

/** Engine group metadata */
const ENGINE_META: Record<string, { label: string; icon: string; color: string; activeRing: string; activeBg: string; desc: string }> = {
  claude: {
    label: 'Claude Code',
    icon: '🟣',
    color: 'text-purple-300',
    activeRing: 'ring-purple-500/60',
    activeBg: 'bg-purple-500/10',
    desc: 'Research, code, files',
  },
  pi: {
    label: 'Pi Agent',
    icon: '🔵',
    color: 'text-sky-300',
    activeRing: 'ring-sky-500/60',
    activeBg: 'bg-sky-500/10',
    desc: 'GPT, OpenRouter models',
  },
  local: {
    label: 'Local LLM',
    icon: '🟢',
    color: 'text-emerald-300',
    activeRing: 'ring-emerald-500/60',
    activeBg: 'bg-emerald-500/10',
    desc: 'Self-hosted models',
  },
};

function EmptyStateWithModelPicker() {
  const {
    effectiveSelected,
    visibleClaudeModels,
    visiblePiModels,
    visibleLocalModels,
    pick,
  } = useSessionAwareModel();

  const selectedEngine = getEngineFromModel(effectiveSelected);

  // Build engine groups (only show groups that have models)
  const groups: { engine: string; models: ModelOption[] }[] = [];
  if (visibleClaudeModels.length > 0) groups.push({ engine: 'claude', models: visibleClaudeModels });
  if (visiblePiModels.length > 0) groups.push({ engine: 'pi', models: visiblePiModels });
  if (visibleLocalModels.length > 0) groups.push({ engine: 'local', models: visibleLocalModels });

  return (
    <div className="flex-1 overflow-y-auto px-3 md:px-6">
      <div className="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto">
        {/* Logo + Title */}
        <div className="w-16 h-16 rounded-full bg-surface-900 border border-surface-800 shadow-2xl flex items-center justify-center mb-4 relative group">
          <div className="absolute inset-0 rounded-full bg-primary-500/20 blur-xl group-hover:bg-primary-500/30 transition-colors" />
          <span className="text-3xl relative z-10">✨</span>
        </div>
        <h2 className="text-xl font-bold text-gray-100 mb-1 tracking-tight">Tower</h2>
        <p className="text-[13px] text-gray-500 mb-6">모델을 선택하고 대화를 시작하세요</p>

        {/* Model Picker Cards */}
        <div className="w-full space-y-3">
          {groups.map(({ engine, models }) => {
            const meta = ENGINE_META[engine];
            if (!meta) return null;
            const isActiveEngine = selectedEngine === engine;
            return (
              <div
                key={engine}
                className={`rounded-xl border transition-all duration-200 ${
                  isActiveEngine
                    ? `${meta.activeBg} ${meta.activeRing} ring-1 border-transparent`
                    : 'border-surface-700/50 bg-surface-900/40 hover:bg-surface-900/70'
                }`}
              >
                {/* Engine header */}
                <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
                  <span className="text-sm">{meta.icon}</span>
                  <span className={`text-[12px] font-semibold ${isActiveEngine ? meta.color : 'text-gray-400'}`}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-gray-600 ml-auto">{meta.desc}</span>
                </div>
                {/* Model buttons */}
                <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                  {models.map((model) => {
                    const isSelected = model.id === effectiveSelected;
                    return (
                      <button
                        key={model.id}
                        onClick={() => pick(model.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                          isSelected
                            ? 'bg-white/10 text-white ring-1 ring-white/20 shadow-sm'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-primary-400' : 'bg-surface-600'}`} />
                        <span>{model.name}</span>
                        {model.badge && (
                          <span className={`text-[9px] font-bold px-1 py-px rounded ${
                            model.badge === 'OR'
                              ? 'text-violet-400 bg-violet-500/15'
                              : model.badge === 'AZ'
                              ? 'text-sky-400 bg-sky-500/15'
                              : model.badge === 'LOCAL'
                              ? 'text-emerald-400 bg-emerald-500/15'
                              : 'text-purple-400 bg-purple-500/15'
                          }`}>
                            {model.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-surface-600 mt-4">
          <span className="text-surface-700">/ </span>for commands
        </p>
      </div>
    </div>
  );
}
