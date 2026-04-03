import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ToolUseCard, ToolChip } from './ToolUseCard';
import { ThinkingChip, ThinkingContent } from './ThinkingBlock';
import { RichContent } from '../shared/RichContent';
import { splitDynamicBlocks } from '../shared/split-dynamic-blocks';
// getToolLabel / getToolSummary used by ToolUseCard.tsx
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

function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (isToday) return time;
  if (isYesterday) return `어제 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
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
    // Compact marker — show as a divider line
    const isCompactMarker = message.id.startsWith('compact-');
    if (isCompactMarker) {
      return (
        <div className="flex items-center gap-3 py-5 px-2">
          <div className="flex-1 h-px bg-surface-700/50" />
          <span className="text-[11px] text-gray-600 whitespace-nowrap select-none">
            ✂️ Compacted
          </span>
          <div className="flex-1 h-px bg-surface-700/50" />
        </div>
      );
    }
    return (
      <div className="flex justify-center py-3">
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
    <div className={`flex gap-3 py-5 ${isUser ? 'justify-end' : 'justify-start'} group/message`}>
      {!isUser && (
        <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
          <div className="w-7 h-7 rounded-full bg-primary-600/15 border border-primary-500/25 flex items-center justify-center text-[9px] font-bold text-primary-400 select-none">
            C
          </div>
          {message.timestamp && (
            <span className="text-[10px] text-gray-600 select-none whitespace-nowrap">{formatMessageTime(message.timestamp)}</span>
          )}
          {(() => {
            const inputT = message.inputTokens || 0;
            const label = fmtContextLabel(inputT);
            if (!label) return null;
            const ctxMax = useChatStore.getState().cost.contextWindowSize || CONTEXT_MAX_FALLBACK;
            const pct = Math.round((inputT / ctxMax) * 100);
            const color = pct > 90 ? 'text-red-400' : pct > 70 ? 'text-amber-400' : 'text-gray-700';
            return (
              <span className={`text-[9px] ${color} select-none whitespace-nowrap tabular-nums`} title={`Context: ${fmtTokens(inputT)} / ${fmtTokens(ctxMax)} (${pct}%) · Output: ${fmtTokens(message.outputTokens || 0)}`}>
                {label}
              </span>
            );
          })()}
        </div>
      )}

      <div className={`min-w-0 ${isUser ? 'max-w-[88%] order-first' : 'flex-1'}`}>
        {isUser ? (
          <div>
            {/* Username + timestamp meta line */}
            <div className="flex items-center justify-end gap-1.5 mb-1 px-1">
              {message.username && (
                <span className="text-[11px] font-medium text-gray-400">{message.username}</span>
              )}
              {message.timestamp && (
                <span className="text-[11px] text-gray-500">{formatMessageTime(message.timestamp)}</span>
              )}
            </div>
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
          <MessageBody
            groups={groups}
            message={message}
            onFileClick={onFileClick}
            isLastAssistant={isLastAssistant}
            showMetrics={showMetrics}
          />
        )}
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-surface-850 flex items-center justify-center text-[9px] font-bold shrink-0 mt-5 ring-1 ring-surface-700/40 text-surface-300 select-none" title={message.username || 'User'}>
          {(message.username || 'U').charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function ToolChipGroup({ blocks, onFileClick }: { blocks: ContentBlock[]; onFileClick?: (path: string) => void }) {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Filter out blocks without valid toolUse data
  const validBlocks = blocks.filter((b) => b.toolUse?.name);

  if (validBlocks.length === 0) return null;

  const total = validBlocks.length;
  const completed = validBlocks.filter((b) => b.toolUse!.result).length;
  const running = isStreaming && completed < total;

  // Build tool type summary (e.g. "Bash ×3, Read ×2, Edit ×1")
  const typeCounts = validBlocks.reduce<Record<string, number>>((acc, b) => {
    const name = b.toolUse!.name;
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});
  const typeLabels = Object.entries(typeCounts).map(([name, count]) =>
    count > 1 ? `${name} ×${count}` : name
  );

  // Find last tool summary for streaming display
  const lastBlock = validBlocks[validBlocks.length - 1];
  const lastTool = lastBlock?.toolUse;
  const lastToolSummary = (() => {
    if (!lastTool) return '';
    const n = lastTool.name;
    if (n === 'Read' || n === 'Write' || n === 'Edit') {
      const fp = lastTool.input?.file_path || lastTool.input?.path || '';
      return fp.split('/').pop() || n;
    } else if (n === 'Bash') {
      return (lastTool.input?.command || '').slice(0, 40) || 'command';
    } else if (n === 'Grep' || n === 'Glob') {
      return lastTool.input?.pattern?.slice(0, 30) || n;
    } else if (n === 'Agent' || n === 'Task') {
      return lastTool.input?.description?.slice(0, 30) || n;
    }
    return n;
  })();

  // Collapsed summary bar — unified with AgentCard line-2 style
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        data-tool-text={`Tools ×${total}: ${typeLabels.join(', ')}`}
        className="group/tool-bar inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-surface-700/30 bg-surface-800/20 hover:bg-surface-800/40 hover:border-surface-600/40 transition-all duration-150 cursor-pointer max-w-full align-middle"
      >
        {/* Wrench icon */}
        <svg className="w-3.5 h-3.5 text-surface-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>

        {/* Count + separator + context — matches AgentCard line-2 format */}
        <span className="text-[10px] text-surface-500 tabular-nums shrink-0">{total} tools</span>
        <span className="text-surface-700 text-[10px]">·</span>

        {/* Streaming: show last active tool / Done: show type summary */}
        {running ? (
          <span className="flex items-center gap-1 min-w-0">
            <span className="w-1 h-1 rounded-full bg-primary-400/60 animate-pulse shrink-0" />
            <span className="text-[10px] text-surface-400 truncate">{lastToolSummary}</span>
          </span>
        ) : (
          <span className="text-[10px] text-surface-500 truncate">{typeLabels.join(', ')}</span>
        )}

        {/* All done check */}
        {!running && completed === total && (
          <svg className="w-3 h-3 text-emerald-500/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )}

        {/* Expand arrow */}
        <svg className="w-3 h-3 text-surface-600 group-hover/tool-bar:text-surface-500 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  // Expanded: chip row + detail card
  return (
    <div className="rounded-lg border border-surface-700/30 bg-surface-800/10 overflow-hidden">
      {/* Header bar — click to collapse */}
      <button
        onClick={() => { setExpanded(false); setActiveIndex(null); }}
        className="group/tool-bar flex items-center gap-2 px-3 py-1.5 w-full hover:bg-surface-800/30 transition-colors"
      >
        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>
        <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{total}</span>
        <span className="text-[11px] text-gray-500 truncate flex-1 text-left">{typeLabels.join(', ')}</span>
        <svg className="w-3 h-3 text-gray-500 rotate-180 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Chip row */}
      <div className="px-3 pb-2 pt-1 flex flex-wrap gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-2">
        {validBlocks.map((block, i) => (
          <ToolChip
            key={i}
            name={block.toolUse!.name}
            input={block.toolUse!.input}
            result={block.toolUse!.result}
            isActive={activeIndex === i}
            isLast={i === validBlocks.length - 1}
            onClick={() => setActiveIndex(activeIndex === i ? null : i)}
          />
        ))}
      </div>

      {/* Expanded detail card below */}
      {activeIndex !== null && validBlocks[activeIndex] && (
        <div className="px-3 pb-3">
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

function ThinkingChipGroup({ blocks, inlineToolBlocks, onFileClick }: {
  blocks: ContentBlock[];
  inlineToolBlocks?: ContentBlock[];
  onFileClick?: (path: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-start gap-1.5">
        {blocks.map((block, i) => (
          <ThinkingChip
            key={i}
            text={block.thinking!.text}
            title={block.thinking?.title}
            isActive={activeIndex === i}
            onClick={() => setActiveIndex(activeIndex === i ? null : i)}
          />
        ))}
        {inlineToolBlocks && inlineToolBlocks.length > 0 && (
          <ToolChipGroup blocks={inlineToolBlocks} onFileClick={onFileClick} />
        )}
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

/* ── MessageBody — clipboard-aware wrapper with inline tool chips ── */

function MessageBody({ groups, message, onFileClick, isLastAssistant, showMetrics }: {
  groups: BlockGroup[];
  message: ChatMessage;
  onFileClick?: (path: string) => void;
  isLastAssistant?: boolean;
  showMetrics?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Clipboard handler: on copy, produce clean text-only version
  const handleCopy = useCallback((e: ClipboardEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    // Get selected range
    const range = sel.getRangeAt(0);
    if (!bodyRef.current?.contains(range.commonAncestorContainer)) return;

    // Build clean text: walk selected nodes, skip tool chips that have data-tool-text
    const fragment = range.cloneContents();
    const cleanText = extractCleanText(fragment);
    if (cleanText) {
      e.clipboardData?.setData('text/plain', cleanText);
      // Also set HTML for rich paste
      e.clipboardData?.setData('text/html', `<div>${cleanText.replace(/\n/g, '<br>')}</div>`);
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.addEventListener('copy', handleCopy);
    return () => el.removeEventListener('copy', handleCopy);
  }, [handleCopy]);

  return (
    <div ref={bodyRef} className="relative space-y-2">
      <CopyButton
        text={getMessageText(message.content)}
        className="absolute -top-1 -right-1 opacity-40 hover:opacity-100 transition-opacity z-10"
      />
      {groups.flatMap((group, gi) => {
        const previousGroup = groups[gi - 1];
        const nextGroup = groups[gi + 1];

        // Tool use blocks already rendered inline with the preceding thinking group
        if (group.type === 'tool_use' && previousGroup?.type === 'thinking') {
          return [];
        }

        // Tool use blocks — split into agents, todos, and regular tools
        if (group.type === 'tool_use') {
          const agentBlocks = group.blocks.filter(b => isAgentTool(b.toolUse?.name));
          const todoBlocks = group.blocks.filter(b => b.toolUse?.name === 'TodoWrite');
          const regularBlocks = group.blocks.filter(b => !isAgentTool(b.toolUse?.name) && b.toolUse?.name !== 'TodoWrite');
          return [
            <React.Fragment key={gi}>
              {/* Regular tools — inline collapsible bar */}
              {regularBlocks.length > 0 && (
                <ToolChipGroup blocks={regularBlocks} onFileClick={onFileClick} />
              )}
              {/* Agent cards — grouped under a single left accent border */}
              {agentBlocks.length > 0 && (
                <div className="pl-2 border-l-2 border-surface-700/30 space-y-1">
                  {agentBlocks.map((block, ai) => (
                    <AgentCard key={`agent-${gi}-${ai}`} block={block} />
                  ))}
                </div>
              )}
              {/* TodoWrite — inline checklist */}
              {todoBlocks.map((block, ti) => {
                const isLastTodo = !!isLastAssistant && gi === groups.length - 1 && ti === todoBlocks.length - 1;
                return (
                  <TodoInlineCard
                    key={`todo-${gi}-${ti}`}
                    input={block.toolUse!.input}
                    isLive={isLastTodo}
                  />
                );
              })}
            </React.Fragment>,
          ];
        }

        // Thinking — show title chip and keep adjacent regular tools on the same line
        if (group.type === 'thinking') {
          const inlineToolGroup = nextGroup?.type === 'tool_use' ? nextGroup : null;
          const inlineToolGroupIndex = inlineToolGroup ? gi + 1 : gi;
          const inlineRegularBlocks = inlineToolGroup
            ? inlineToolGroup.blocks.filter(b => !isAgentTool(b.toolUse?.name) && b.toolUse?.name !== 'TodoWrite')
            : [];
          const inlineAgentBlocks = inlineToolGroup
            ? inlineToolGroup.blocks.filter(b => isAgentTool(b.toolUse?.name))
            : [];
          const inlineTodoBlocks = inlineToolGroup
            ? inlineToolGroup.blocks.filter(b => b.toolUse?.name === 'TodoWrite')
            : [];

          return [
            <React.Fragment key={gi}>
              <ThinkingChipGroup
                blocks={group.blocks}
                inlineToolBlocks={inlineRegularBlocks}
                onFileClick={onFileClick}
              />
              {inlineAgentBlocks.length > 0 && (
                <div className="pl-2 border-l-2 border-surface-700/30 space-y-1">
                  {inlineAgentBlocks.map((block, ai) => (
                    <AgentCard key={`agent-inline-${gi}-${ai}`} block={block} />
                  ))}
                </div>
              )}
              {inlineTodoBlocks.map((block, ti) => {
                const isLastTodo = !!isLastAssistant && inlineToolGroupIndex === groups.length - 1 && ti === inlineTodoBlocks.length - 1;
                return (
                  <TodoInlineCard
                    key={`todo-inline-${gi}-${ti}`}
                    input={block.toolUse!.input}
                    isLive={isLastTodo}
                  />
                );
              })}
            </React.Fragment>,
          ];
        }

        // Text — render with RichContent
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

        // Tool results — minimal inline display
        if (group.type === 'tool_result') {
          return [
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
            </div>,
          ];
        }

        console.warn('[MessageBubble] unknown block group type:', group.type);
        return [];
      })}
      {showMetrics && <TurnMetricsBar message={message} isLast={!!isLastAssistant} />}
    </div>
  );
}

/** Check if a tool name is an agent/subagent tool */
function isAgentTool(name?: string): boolean {
  if (!name) return false;
  const n = name.charAt(0).toUpperCase() + name.slice(1);
  return n === 'Task' || n === 'Agent';
}

/** Extract clean text from a DOM fragment, skipping tool chip decorations */
function extractCleanText(fragment: DocumentFragment): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    // Tool summary bars: emit their data-tool-text as a short notation
    const toolText = el.getAttribute('data-tool-text');
    if (toolText) {
      parts.push(`[${toolText}]`);
      return;
    }

    // Agent cards: emit their data-agent-text
    const agentText = el.getAttribute('data-agent-text');
    if (agentText) {
      parts.push(`[Agent: ${agentText}]`);
      return;
    }

    // Skip SVGs and buttons within tool UI
    if (el.tagName === 'SVG' || el.tagName === 'svg') return;

    // Block-level elements add newlines
    const display = getComputedStyle(el).display;
    const isBlock = display === 'block' || display === 'flex' || display === 'grid';

    if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }

    if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }
  };

  for (const child of Array.from(fragment.childNodes)) {
    walk(child);
  }

  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── AgentCard — individual agent/subagent display ── */

/** Extract sub-tool stats for an agent from sibling messages */
function useAgentToolStats(toolId: string) {
  const messages = useChatStore((s) => s.messages);
  return useMemo(() => {
    let toolCount = 0;
    let lastToolName = '';
    let lastToolSummary = '';
    const typeCounts: Record<string, number> = {};
    for (const msg of messages) {
      if (msg.parentToolUseId !== toolId) continue;
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.toolUse) {
          toolCount++;
          const t = block.toolUse;
          lastToolName = t.name;
          typeCounts[t.name] = (typeCounts[t.name] || 0) + 1;
          // Build a short summary for the latest tool
          const n = t.name.charAt(0).toUpperCase() + t.name.slice(1);
          if (n === 'Read' || n === 'Write' || n === 'Edit') {
            const fp = t.input.file_path || t.input.path || '';
            lastToolSummary = fp.split('/').pop() || n;
          } else if (n === 'Bash') {
            const cmd = (t.input.command || '').slice(0, 40);
            lastToolSummary = cmd || 'command';
          } else if (n === 'Grep' || n === 'Glob') {
            lastToolSummary = t.input.pattern?.slice(0, 30) || n;
          } else if (n === 'Task' || n === 'Agent') {
            lastToolSummary = t.input.description?.slice(0, 30) || n;
          } else {
            lastToolSummary = n;
          }
        }
      }
    }
    const typeLabels = Object.entries(typeCounts).map(([name, count]) =>
      count > 1 ? `${name} ×${count}` : name
    );
    return { toolCount, lastToolName, lastToolSummary, typeLabels };
  }, [messages, toolId]);
}

function AgentCard({ block }: { block: ContentBlock }) {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [expanded, setExpanded] = useState(false);
  const tool = block.toolUse!;
  const isRunning = !tool.result && isStreaming;
  const description = tool.input.description || 'Agent';
  const subagentType = tool.input.subagent_type || '';
  const { toolCount, lastToolName, lastToolSummary, typeLabels } = useAgentToolStats(tool.id);

  // Collapsed: compact 2-line card with status + tool stats
  if (!expanded) {
    return (
      <div data-agent-text={description}>
        <button
          onClick={() => setExpanded(true)}
          className="group/agent-bar flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border border-surface-600/40 bg-surface-800/40 hover:bg-surface-800/60 hover:border-surface-500/50 transition-all duration-150 cursor-pointer max-w-sm"
        >
          {/* Line 1: icon + description + type + status + expand */}
          <div className="flex items-center gap-1.5 min-w-0 w-full">
            {/* Chip icon */}
            <svg className="w-3.5 h-3.5 text-surface-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="7" y="7" width="10" height="10" rx="1.5" strokeWidth={1.5} />
              <path strokeLinecap="round" strokeWidth={1.5} d="M9 3v4M12 3v4M15 3v4M9 17v4M12 17v4M15 17v4M3 9h4M3 12h4M3 15h4M17 9h4M17 12h4M17 15h4" />
            </svg>

            {/* Description */}
            <span className="text-[11px] font-semibold text-surface-300 truncate">{description}</span>

            {/* Subagent type tag */}
            {subagentType && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-800/40 border border-surface-700/30 text-surface-500 shrink-0">{subagentType}</span>
            )}

            <span className="flex-1" />

            {/* Status label */}
            {isRunning ? (
              <span className="flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
                <span className="text-[10px] text-primary-400 font-medium">Running</span>
              </span>
            ) : tool.result ? (
              <span className="flex items-center gap-1 shrink-0">
                <svg className="w-3 h-3 text-emerald-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-[10px] text-emerald-500/60 font-medium">Done</span>
              </span>
            ) : null}

            {/* Expand arrow */}
            <svg className="w-3 h-3 text-surface-600 group-hover/agent-bar:text-surface-500 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {/* Line 2: tool count + type summary (done) or last active tool (streaming) */}
          {toolCount > 0 && (
            <div className="flex items-center gap-1.5 pl-5 min-w-0">
              <span className="text-[10px] text-surface-500 tabular-nums shrink-0">{toolCount} tools</span>
              <span className="text-surface-700 text-[10px]">·</span>
              {isRunning && lastToolName ? (
                <span className="flex items-center gap-1 min-w-0">
                  <span className="w-1 h-1 rounded-full bg-primary-400/60 animate-pulse shrink-0" />
                  <span className="text-[10px] text-surface-400 truncate">{lastToolSummary}</span>
                </span>
              ) : (
                <span className="text-[10px] text-surface-500 truncate">{typeLabels.join(', ')}</span>
              )}
            </div>
          )}
        </button>
      </div>
    );
  }

  // Expanded: detail view with left accent border
  return (
    <div className="pl-2 border-l-2 border-surface-700/30" data-agent-text={description}>
      <div className="rounded-lg border border-surface-700/30 bg-surface-800/10 overflow-hidden">
        {/* Header bar — click to collapse */}
        <button
          onClick={() => setExpanded(false)}
          className="group/agent-bar flex flex-col gap-0.5 px-3 py-1.5 w-full hover:bg-surface-800/30 transition-colors"
        >
          <div className="flex items-center gap-2 w-full">
            <svg className="w-3.5 h-3.5 text-surface-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="7" y="7" width="10" height="10" rx="1.5" strokeWidth={1.5} />
              <path strokeLinecap="round" strokeWidth={1.5} d="M9 3v4M12 3v4M15 3v4M9 17v4M12 17v4M15 17v4M3 9h4M3 12h4M3 15h4M17 9h4M17 12h4M17 15h4" />
            </svg>
            <span className="text-[11px] font-semibold text-surface-300">{description}</span>
            {subagentType && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-800/40 border border-surface-700/30 text-surface-500">{subagentType}</span>
            )}
            <span className="flex-1" />
            {/* Status in expanded header */}
            {isRunning ? (
              <span className="flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
                <span className="text-[10px] text-primary-400 font-medium">Running</span>
              </span>
            ) : tool.result ? (
              <span className="flex items-center gap-1 shrink-0">
                <svg className="w-3 h-3 text-emerald-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-[10px] text-emerald-500/60 font-medium">Done</span>
              </span>
            ) : null}
            {toolCount > 0 && (
              <span className="text-[10px] text-surface-500 tabular-nums shrink-0">{toolCount} tools</span>
            )}
            <svg className="w-3 h-3 text-surface-500 rotate-180 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {/* Line 2: last tool activity */}
          {toolCount > 0 && isRunning && lastToolName && (
            <div className="flex items-center gap-1.5 pl-5">
              <span className="w-1 h-1 rounded-full bg-primary-400/60 animate-pulse shrink-0" />
              <span className="text-[10px] text-surface-400 truncate">{lastToolSummary}</span>
            </div>
          )}
        </button>

        {/* Detail content */}
        <div className="border-t border-surface-700/20 px-3 py-2.5 space-y-2">
          {tool.input.prompt && (
            <div className="bg-surface-950/60 rounded-lg p-3 text-[11px] text-surface-500 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
              {tool.input.prompt.slice(0, 500)}{tool.input.prompt.length > 500 ? '...' : ''}
            </div>
          )}
          {tool.result && (
            <AgentResultSection result={tool.result} />
          )}
        </div>
      </div>
    </div>
  );
}

function AgentResultSection({ result }: { result: string }) {
  const [showResult, setShowResult] = useState(false);
  return (
    <div>
      <button
        onClick={() => setShowResult(!showResult)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${showResult ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Result
        <span className="text-gray-600">({result.length.toLocaleString()} chars)</span>
      </button>
      {showResult && (
        <div className="mt-1.5 bg-surface-950/60 rounded-lg p-3 font-mono text-[11px] text-gray-300 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
          {result.slice(0, 2000)}{result.length > 2000 ? '\n\n... (truncated)' : ''}
        </div>
      )}
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
  return `${(n / 1000).toFixed(1)}k`;
}

function getStopReasonLabel(reason?: string): string | null {
  switch (reason) {
    case 'length':
      return '출력 상한에서 종료';
    case 'toolUse':
      return '도구 호출로 종료';
    case 'error':
      return '오류로 종료';
    case 'aborted':
      return '중단됨';
    default:
      return null;
  }
}

/** Context usage label for avatar area — shows inputTokens as context size */
function fmtContextLabel(input: number): string | null {
  if (input <= 0) return null;
  return fmtTokens(input);
}

const CONTEXT_MAX_FALLBACK = 200_000;

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
    ? {
        durationMs: message.durationMs,
        inputTokens: message.inputTokens || 0,
        outputTokens: message.outputTokens || 0,
        stopReason: message.stopReason,
      }
    : null;

  // Fallback to lastTurnMetrics for the last assistant message
  const metrics = msgMetrics || (isLast ? lastTurnMetrics : null);

  if (metrics) {
    const totalTokens = metrics.inputTokens + metrics.outputTokens;
    const stopReasonLabel = getStopReasonLabel(metrics.stopReason);
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px] text-gray-500 tabular-nums font-medium">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {fmtDuration(metrics.durationMs)}
        <span className="text-gray-600">·</span>
        {fmtTokens(totalTokens)} tokens
        {stopReasonLabel && (
          <>
            <span className="text-gray-600">·</span>
            <span className={`px-1.5 py-0.5 rounded border ${metrics.stopReason === 'length' ? 'border-amber-500/30 text-amber-300 bg-amber-500/10' : metrics.stopReason === 'error' ? 'border-rose-500/30 text-rose-300 bg-rose-500/10' : 'border-gray-700 text-gray-400 bg-surface-900/60'}`}>
              {stopReasonLabel}
            </span>
          </>
        )}
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
