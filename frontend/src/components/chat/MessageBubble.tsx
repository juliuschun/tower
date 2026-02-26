import React, { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ToolUseCard, ToolChip } from './ToolUseCard';
import { ThinkingChip, ThinkingContent } from './ThinkingBlock';
import { MermaidBlock } from './MermaidBlock';
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
}

export function MessageBubble({ message, onFileClick, onRetry }: MessageBubbleProps) {
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

  // Memoize ReactMarkdown components to prevent MermaidBlock unmount/remount loop
  const mdComponents = useMemo(() => ({
    code({ children, className, ...props }: Record<string, any>) {
      const isInline = !className;
      const text = String(children).trim();

      // Inline code — file path click
      if (isInline && text.startsWith('/') && onFileClick) {
        return (
          <code
            {...props}
            className="cursor-pointer hover:text-primary-400 transition-colors"
            onClick={() => onFileClick(text)}
          >
            {children}
          </code>
        );
      }

      // Block code — with copy button
      if (!isInline) {
        return (
          <code className={className} {...props}>{children}</code>
        );
      }

      return <code className={className} {...props}>{children}</code>;
    },
    pre({ children }: { children?: React.ReactNode }) {
      // Extract text from the code child for copying
      const codeText = extractCodeText(children);
      return (
        <pre className="relative group/code">
          {children}
          {codeText && (
            <CopyButton
              text={codeText}
              className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100"
            />
          )}
        </pre>
      );
    },
  }), [onFileClick]);

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
                className="absolute top-2 right-2 opacity-0 group-hover/message:opacity-100"
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
              className="absolute -top-1 -right-1 opacity-0 group-hover/message:opacity-100 z-10"
            />
            {groups.map((group, gi) => {
              // Tool use blocks — chip layout (single or multiple)
              if (group.type === 'tool_use') {
                return (
                  <ToolChipGroup
                    key={gi}
                    blocks={group.blocks}
                    onFileClick={onFileClick}
                  />
                );
              }

              // Thinking — chip row (same layout as tool chips)
              if (group.type === 'thinking') {
                return (
                  <ThinkingChipGroup key={gi} blocks={group.blocks} />
                );
              }

              // Text — extract mermaid blocks and render them outside prose
              if (group.type === 'text') {
                return group.blocks.map((block, bi) => {
                  if (!block.text) return null;
                  const segments = splitMermaidBlocks(block.text);
                  return segments.map((seg, si) => {
                    if (seg.type === 'mermaid') {
                      return <MermaidBlock key={`${gi}-${bi}-m${si}`} code={seg.content} />;
                    }
                    return (
                      <div key={`${gi}-${bi}-t${si}`} className="prose prose-invert prose-sm max-w-none overflow-hidden">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                          components={mdComponents}
                        >
                          {seg.content}
                        </ReactMarkdown>
                      </div>
                    );
                  });
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

/** Extract text content from <pre> children (the inner <code> element) */
function extractCodeText(children: React.ReactNode): string {
  let text = '';
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.props) {
      const props = child.props as Record<string, unknown>;
      if (props.children) {
        text += String(props.children);
      }
    }
  });
  return text.trim();
}

/** Split markdown text into regular text and mermaid code blocks */
function splitMermaidBlocks(text: string): Array<{ type: 'text' | 'mermaid'; content: string }> {
  const segments: Array<{ type: 'text' | 'mermaid'; content: string }> = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
    }
    segments.push({ type: 'mermaid', content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex).trim();
    if (rest) segments.push({ type: 'text', content: rest });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
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
