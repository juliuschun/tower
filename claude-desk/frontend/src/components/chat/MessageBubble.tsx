import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ToolUseCard, ToolChip } from './ToolUseCard';
import { ThinkingBlock } from './ThinkingBlock';
import type { ChatMessage, ContentBlock } from '../../stores/chat-store';

interface MessageBubbleProps {
  message: ChatMessage;
  onFileClick?: (path: string) => void;
}

export function MessageBubble({ message, onFileClick }: MessageBubbleProps) {
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
  const groups = groupContentBlocks(message.content);

  return (
    <div className={`flex gap-3 my-5 ${isUser ? 'justify-end' : 'justify-start'} group/message`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary-600/15 border border-primary-500/25 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 text-primary-400 select-none">
          C
        </div>
      )}

      <div className={`max-w-[88%] min-w-0 ${isUser ? 'order-first' : ''}`}>
        {isUser ? (
          <div className="bg-surface-800/70 border border-surface-700/40 rounded-2xl rounded-tr-sm px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
            {message.content.map((block, i) => (
              <span key={i}>{block.text}</span>
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
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

              // Thinking
              if (group.type === 'thinking') {
                return group.blocks.map((block, bi) => (
                  <ThinkingBlock key={`${gi}-${bi}`} text={block.thinking!.text} />
                ));
              }

              // Text
              if (group.type === 'text') {
                return group.blocks.map((block, bi) => (
                  block.text ? (
                    <div key={`${gi}-${bi}`} className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{
                          code({ children, className, ...props }) {
                            const isInline = !className;
                            const text = String(children).trim();
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
                            return <code className={className} {...props}>{children}</code>;
                          },
                        }}
                      >
                        {block.text}
                      </ReactMarkdown>
                    </div>
                  ) : null
                ));
              }

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
      {/* Chip row */}
      <div className="flex flex-wrap gap-1.5">
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
