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
      <div className="flex justify-center my-2">
        <div className="bg-red-900/30 border border-red-800/50 text-red-300 text-sm px-4 py-2 rounded-lg max-w-lg">
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
    <div className={`flex gap-4 my-6 ${isUser ? 'justify-end' : 'justify-start'} group/message`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary-600/20 border border-primary-500/30 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1 shadow-[0_0_15px_rgba(139,92,246,0.15)] ring-1 ring-primary-500/20 text-primary-400 select-none">
          C
        </div>
      )}

      <div className={`max-w-[85%] ${isUser ? 'order-first' : ''}`}>
        {isUser ? (
          <div className="bg-surface-800/80 backdrop-blur-sm border border-surface-700/50 rounded-2xl rounded-tr-sm px-5 py-3.5 text-[15px] leading-relaxed shadow-sm">
            {message.content.map((block, i) => (
              <span key={i}>{block.text}</span>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
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
        <div className="w-8 h-8 rounded-full bg-surface-800 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1 ring-1 ring-surface-700/50 text-surface-400 select-none">
          U
        </div>
      )}
    </div>
  );
}

function ToolChipGroup({ blocks, onFileClick }: { blocks: ContentBlock[]; onFileClick?: (path: string) => void }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <div>
      {/* Chip row */}
      <div className="flex flex-wrap gap-1.5">
        {blocks.map((block, i) => (
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
      {activeIndex !== null && blocks[activeIndex] && (
        <div className="mt-2">
          <ToolUseCard
            name={blocks[activeIndex].toolUse!.name}
            input={blocks[activeIndex].toolUse!.input}
            result={blocks[activeIndex].toolUse!.result}
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
