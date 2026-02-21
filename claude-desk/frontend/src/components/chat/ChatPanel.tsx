import React, { useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chat-store';
import { MessageBubble } from './MessageBubble';
import { InputBox } from './InputBox';

interface ChatPanelProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  onFileClick?: (path: string) => void;
}

export function ChatPanel({ onSend, onAbort, onFileClick }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center mt-20">
            <div className="w-20 h-20 rounded-full bg-surface-900 border border-surface-800 shadow-2xl flex items-center justify-center mb-6 relative group">
              <div className="absolute inset-0 rounded-full bg-primary-500/20 blur-xl group-hover:bg-primary-500/30 transition-colors"></div>
              <span className="text-4xl relative z-10">✨</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-100 mb-3 tracking-tight">Claude Desk</h2>
            <p className="text-[15px] text-gray-400 max-w-md leading-relaxed">
              Claude와 대화하며 리서치하고, 파일을 편집하고, 코드를 실행하세요.
              <br />
              <span className="text-surface-700 mt-2 block font-medium">/ 를 입력하면 명령어를 사용할 수 있습니다.</span>
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onFileClick={onFileClick} />
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

      {/* Input */}
      <div className="absolute bottom-6 left-0 right-0 px-4">
        <InputBox onSend={onSend} onAbort={onAbort} />
      </div>
    </div>
  );
}
