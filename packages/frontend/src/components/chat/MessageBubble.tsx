import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ToolUseCard, ToolChip } from './ToolUseCard';
import { ThinkingChip, ThinkingContent } from './ThinkingBlock';
import { RichContent } from '../shared/RichContent';
import { splitDynamicBlocks } from '../shared/split-dynamic-blocks';
import { toastSuccess } from '../../utils/toast';
import { useChatStore, type ChatMessage, type ContentBlock } from '../../stores/chat-store';

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    toastSuccess('Copied');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded-md bg-surface-800/80 border border-surface-700/50 text-gray-400 hover:text-gray-200 hover:bg-surface-700/80 transition-all ${className}`}
      title="Copy"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

function getMessageText(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

interface MessageBubbleProps {
  message: ChatMessage;
  onFileClick?: (path: string) => void;
  onRetry?: (text: string) => void;
  showMetrics?: boolean;
  isLastAssistant?: boolean;
}

export function MessageBubble({ message, onFileClick, onRetry, showMetrics, isLastAssistant }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <div className="bg-surface-900/60 border border-surface-700/40 text-gray-500 text-[13px] px-4 py-1.5 rounded-full max-w-lg">
          {message.content.map((b, i) => (
            <span key={i}>{b.text}</span>
          ))}
        </div>
      </div>
    );
  }

  // Group content blocks: consecutive tool_use blocks become a group
  const groups = useMemo(() => groupContentBlocks(message.content), [message.content]);

  // Find the last text segment key — only that one gets typewriter animation.
  // During streaming, new content appends to the end, so earlier segments are
  // already complete and should render instantly (no parallel animations).
  const lastTextSegKey = useMemo(() => {
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      if (groups[gi].type !== 'text') continue;
      const blocks = groups[gi].blocks;
      for (let bi = blocks.length - 1; bi >= 0; bi--) {
        if (!blocks[bi].text) continue;
        const segs = splitDynamicBlocks(blocks[bi].text!);
        for (let si = segs.length - 1; si >= 0; si--) {
          if (segs[si].type === 'text') return `${gi}-${bi}-t${si}`;
        }
      }
    }
    return '';
  }, [groups]);

  return (
    <div className={`flex gap-3 my-5 ${isUser ? 'justify-end' : 'justify-start'} group/message`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary-600/15 border border-primary-500/25 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 text-primary-400 select-none">
          C
        </div>
      )}

      <div className={`min-w-0 ${isUser ? 'max-w-[88%] order-first' : 'flex-1'}`}>
        {isUser ? (
          <div>
            <div className={`relative bg-surface-800/70 border rounded-2xl rounded-tr-sm px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap ${
              message.sendStatus === 'failed'
                ? 'border-red-500/40 bg-red-950/20'
                : 'border-surface-700/40'
            }`}>
              {message.content.map((block, i) => (
                <span key={i}>{block.text}</span>
              ))}
              <CopyButton
                text={getMessageText(message.content)}
                className="absolute top-2 right-2 opacity-60 hover:opacity-100 transition-opacity"
              />
            </div>
            {message.sendStatus === 'failed' && (
              <div className="flex items-center gap-2 mt-1.5 text-[12px] text-red-400/80">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span>Failed to send</span>
                {onRetry && (
                  <button
                    onClick={() => {
                      const text = useChatStore.getState().retryMessage(message.id);
                      if (text) onRetry(text);
                    }}
                    className="text-primary-400 hover:text-primary-300 underline underline-offset-2 transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="relative space-y-2.5">
            <CopyButton
              text={getMessageText(message.content)}
              className="absolute -top-1 -right-1 opacity-40 hover:opacity-100 transition-opacity z-10"
            />
            {groups.map((group, gi) => {
              // Tool use blocks — chip layout (single or multiple)
              // TodoWrite gets special inline checklist rendering
              if (group.type === 'tool_use') {
                const todoBlocks = group.blocks.filter(b => b.toolUse?.name === 'TodoWrite');
                const otherBlocks = group.blocks.filter(b => b.toolUse?.name !== 'TodoWrite');
                return (
                  <React.Fragment key={gi}>
                    {otherBlocks.length > 0 && (
                      <ToolChipGroup
                        blocks={otherBlocks}
                        onFileClick={onFileClick}
                      />
                    )}
                    {todoBlocks.map((block, ti) => {
                      // Only the very last TodoWrite in the last assistant message gets "live" treatment
                      const isLastTodo = !!isLastAssistant && gi === groups.length - 1 && ti === todoBlocks.length - 1;
                      return (
                        <TodoInlineCard
                          key={`todo-${gi}-${ti}`}
                          input={block.toolUse!.input}
                          isLive={isLastTodo}
                        />
                      );
                    })}
                  </React.Fragment>
                );
              }

              // Thinking — chip row (same layout as tool chips)
              if (group.type === 'thinking') {
                return (
                  <ThinkingChipGroup key={gi} blocks={group.blocks} />
                );
              }

              // Text — render with RichContent (markdown + mermaid + chart + …)
              if (group.type === 'text') {
                return group.blocks.map((block, bi) => {
                  if (!block.text) return null;
                  return (
                    <RichContent
                      key={`${gi}-${bi}`}
                      text={block.text}
                      onFileClick={onFileClick}
                    />
                  );
                });
              }

              // Tool results — usually already merged into tool_use via attachToolResult
              // Standalone tool_result blocks get a minimal inline display
              if (group.type === 'tool_result') {
                return (
                  <div key={gi} className="flex flex-wrap gap-1.5">
                    {group.blocks.map((block, bi) => {
                      const resultText = block.toolUse?.result;
                      if (!resultText) return null;
                      return (
                        <span
                          key={bi}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-800/50 border border-surface-700/30 text-[11px] text-gray-500 max-w-[300px] truncate"
                        >
                          <svg className="w-3 h-3 text-emerald-500/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Result
                        </span>
                      );
                    })}
                  </div>
                );
              }

              // Unknown block type — warn and skip
              console.warn('[MessageBubble] unknown block group type:', group.type);
              return null;
            })}
            {showMetrics && <TurnMetricsBar message={message} isLast={!!isLastAssistant} />}
          </div>
        )}
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-surface-850 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 ring-1 ring-surface-700/40 text-surface-300 select-none">
          U
        </div>
      )}
    </div>
  );
}

function ToolChipGroup({ blocks, onFileClick }: { blocks: ContentBlock[]; onFileClick?: (path: string) => void }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Filter out blocks without valid toolUse data
  const validBlocks = blocks.filter((b) => b.toolUse?.name);

  if (validBlocks.length === 0) return null;

  return (
    <div>
      {/* Chip row — horizontal scroll on mobile */}
      <div className="flex flex-wrap gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-1">
        {validBlocks.map((block, i) => (
          <ToolChip
            key={i}
            name={block.toolUse!.name}
            input={block.toolUse!.input}
            result={block.toolUse!.result}
            isActive={activeIndex === i}
            onClick={() => setActiveIndex(activeIndex === i ? null : i)}
          />
        ))}
      </div>
      {/* Expanded detail card below */}
      {activeIndex !== null && validBlocks[activeIndex] && (
        <div className="mt-2">
          <ToolUseCard
            name={validBlocks[activeIndex].toolUse!.name}
            input={validBlocks[activeIndex].toolUse!.input}
            result={validBlocks[activeIndex].toolUse!.result}
            onFileClick={onFileClick}
            defaultExpanded={true}
          />
        </div>
      )}
    </div>
  );
}

function ThinkingChipGroup({ blocks }: { blocks: ContentBlock[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {blocks.map((block, i) => (
          <ThinkingChip
            key={i}
            text={block.thinking!.text}
            isActive={activeIndex === i}
            onClick={() => setActiveIndex(activeIndex === i ? null : i)}
          />
        ))}
      </div>
      {activeIndex !== null && blocks[activeIndex] && (
        <div className="mt-2">
          <ThinkingContent text={blocks[activeIndex].thinking!.text} />
        </div>
      )}
    </div>
  );
}

/* ── TodoWrite Inline Card ── */

interface TodoInlineItem {
  content: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

function TodoInlineCard({ input, isLive }: { input: Record<string, any>; isLive?: boolean }) {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const todos: TodoInlineItem[] = input.todos || [];
  if (todos.length === 0) return null;

  const total = todos.length;
  const completed = todos.filter(t => t.status === 'completed').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = completed === total;
  // Only show spinners/active state when streaming AND this is the latest card
  const showLive = !!isLive && isStreaming && !allDone;

  return (
    <div className={`rounded-xl border ${
      allDone
        ? 'border-emerald-500/20 bg-emerald-500/5'
        : showLive
          ? 'border-lime-500/20 bg-lime-500/5'
          : 'border-surface-700/30 bg-surface-800/30'
    } p-3 space-y-2`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg className={`w-4 h-4 ${allDone ? 'text-emerald-400' : showLive ? 'text-lime-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        <span className={`text-[11px] font-mono tabular-nums ${allDone ? 'text-emerald-400/70' : showLive ? 'text-lime-400/60' : 'text-gray-500'}`}>
          {completed}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-800/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: allDone
              ? 'linear-gradient(90deg, #22c55e, #4ade80)'
              : showLive
                ? 'linear-gradient(90deg, #84cc16, #a3e635)'
                : '#6b7280',
          }}
        />
      </div>

      {/* Items */}
      <div className="space-y-0.5">
        {todos.map((todo, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 px-1.5 py-1 rounded-md transition-colors ${
              showLive && todo.status === 'in_progress' ? 'bg-lime-500/5' : ''
            }`}
          >
            {todo.status === 'completed' ? (
              <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : todo.status === 'in_progress' && showLive ? (
              <div className="w-3.5 h-3.5 shrink-0 mt-0.5 flex items-center justify-center">
                <div className="w-3 h-3 border-[1.5px] border-lime-500/30 border-t-lime-400 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="w-3.5 h-3.5 shrink-0 mt-0.5 flex items-center justify-center">
                <div className={`w-2.5 h-2.5 rounded-full border-[1.5px] ${
                  todo.status === 'in_progress' ? 'border-gray-500 bg-gray-500/20' : 'border-gray-600'
                }`} />
              </div>
            )}
            <span className={`text-[12px] leading-relaxed ${
              todo.status === 'completed'
                ? 'text-gray-500 line-through'
                : todo.status === 'in_progress' && showLive
                  ? 'text-lime-300 font-medium'
                  : todo.status === 'in_progress'
                    ? 'text-gray-400'
                    : 'text-gray-500'
            }`}>
              {todo.status === 'in_progress' && showLive && todo.activeForm
                ? todo.activeForm
                : todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return '0.0s';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function TurnMetricsBar({ message, isLast }: { message?: ChatMessage; isLast?: boolean }) {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const turnStartTime = useChatStore((s) => s.turnStartTime);
  const lastTurnMetrics = useChatStore((s) => s.lastTurnMetrics);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming || !turnStartTime || !isLast) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - turnStartTime);
    const iv = setInterval(() => setElapsed(Date.now() - turnStartTime), 100);
    return () => clearInterval(iv);
  }, [isStreaming, turnStartTime, isLast]);

  // Streaming: live timer (only for the last assistant message)
  if (isLast && isStreaming && elapsed > 0) {
    return (
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-primary-400/80 tabular-nums font-medium">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {fmtDuration(elapsed)}
      </div>
    );
  }

  // Per-message metrics (from DB or live result event)
  const msgMetrics = message?.durationMs != null
    ? { durationMs: message.durationMs, inputTokens: message.inputTokens || 0, outputTokens: message.outputTokens || 0 }
    : null;

  // Fallback to lastTurnMetrics for the last assistant message
  const metrics = msgMetrics || (isLast ? lastTurnMetrics : null);

  if (metrics) {
    const totalTokens = metrics.inputTokens + metrics.outputTokens;
    return (
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-500 tabular-nums font-medium">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {fmtDuration(metrics.durationMs)}
        <span className="text-gray-600">·</span>
        {fmtTokens(totalTokens)} tokens
      </div>
    );
  }

  return null;
}

/** Group consecutive blocks of the same type together */
interface BlockGroup {
  type: string;
  blocks: ContentBlock[];
}

function groupContentBlocks(blocks: ContentBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];

  for (const block of blocks) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.type === block.type) {
      lastGroup.blocks.push(block);
    } else {
      groups.push({ type: block.type, blocks: [block] });
    }
  }

  return groups;
}
