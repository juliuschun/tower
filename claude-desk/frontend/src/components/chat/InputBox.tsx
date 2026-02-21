import React, { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chat-store';

interface InputBoxProps {
  onSend: (message: string) => void;
  onAbort: () => void;
}

export function InputBox({ onSend, onAbort }: InputBoxProps) {
  const [input, setInput] = useState('');
  const [queued, setQueued] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const slashCommands = useChatStore((s) => s.slashCommands);

  const filteredCommands = input.startsWith('/')
    ? slashCommands.filter((cmd) => cmd.toLowerCase().includes(input.slice(1).toLowerCase()))
    : [];

  useEffect(() => {
    setShowCommands(input.startsWith('/') && input.length > 0 && !input.includes(' ') && filteredCommands.length > 0);
  }, [input, filteredCommands.length]);

  // Auto-send queued message when streaming stops
  useEffect(() => {
    if (!isStreaming && queued) {
      onSend(queued);
      setQueued(null);
    }
  }, [isStreaming, queued, onSend]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (isStreaming) {
      // Queue the message — it will be sent when current turn finishes
      setQueued(trimmed);
    } else {
      onSend(trimmed);
    }

    setInput('');
    setShowCommands(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleCancelQueue = () => {
    setQueued(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      if (queued) {
        handleCancelQueue();
      } else if (showCommands) {
        setShowCommands(false);
      }
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const selectCommand = (cmd: string) => {
    setInput(`/${cmd} `);
    setShowCommands(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="max-w-3xl mx-auto relative">
      {/* Queued message indicator */}
      {queued && (
        <div className="mb-2 flex items-center gap-2 px-4 py-2 bg-primary-900/20 border border-primary-500/20 rounded-xl text-[13px] text-primary-300 backdrop-blur-sm">
          <div className="w-4 h-4 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin shrink-0" />
          <span className="truncate flex-1">대기 중: {queued}</span>
          <button
            onClick={handleCancelQueue}
            className="text-primary-400/60 hover:text-primary-300 p-0.5 transition-colors shrink-0"
            title="대기 취소 (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="rounded-2xl shadow-2xl shadow-black/40 ring-1 ring-white/10 bg-surface-800/80 backdrop-blur-2xl">
        {/* Slash command picker */}
        {showCommands && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface-800/90 backdrop-blur-xl border border-surface-700/50 rounded-xl max-h-40 overflow-y-auto shadow-xl">
            {filteredCommands.map((cmd) => (
              <button
                key={cmd}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-surface-700/50 hover:text-white transition-colors flex items-center gap-2 group"
                onClick={() => selectCommand(cmd)}
              >
                <span className="text-primary-500/70 group-hover:text-primary-400 font-mono">/</span>
                <span>{cmd}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 p-2 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              queued
                ? '추가 메시지를 대기열에 넣을 수 있습니다...'
                : isStreaming
                  ? '메시지를 입력하면 다음 턴에 전송됩니다...'
                  : '메시지를 입력하세요...'
            }
            rows={1}
            className="flex-1 bg-transparent border-none px-4 py-3 text-[15px] text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:ring-0 min-h-[48px] max-h-[200px]"
          />

          <div className="absolute top-3 right-[60px] text-[11px] text-surface-700 font-medium pointer-events-none tracking-wide select-none">
            {input.length === 0 && !isStreaming ? '(/로 명령어)' : ''}
          </div>

          {isStreaming && !input.trim() ? (
            <button
              onClick={onAbort}
              className="p-2 m-1 bg-surface-700 hover:bg-surface-600 rounded-xl transition-all shrink-0 text-red-400 hover:shadow-lg shadow-surface-900"
              title="중단"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className={`p-2 m-1 rounded-xl transition-all disabled:cursor-not-allowed shrink-0 active:scale-95 group ${
                isStreaming && input.trim()
                  ? 'bg-primary-900/40 hover:bg-primary-800/50 text-primary-300 border border-primary-500/30 shadow-lg shadow-primary-900/10'
                  : 'bg-primary-600 hover:bg-primary-500 disabled:bg-surface-700 disabled:text-surface-600 disabled:shadow-none text-white shadow-lg shadow-primary-900/20'
              }`}
              title={isStreaming ? '대기열에 추가' : '전송'}
            >
              {isStreaming && input.trim() ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              ) : (
                <svg className="w-5 h-5 transform group-active:translate-y-[-1px] group-hover:translate-x-[1px] group-hover:translate-y-[-1px] transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m-7 7l7-7 7 7" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
