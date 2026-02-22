import React from 'react';
import { useChatStore } from '../../stores/chat-store';

interface ThinkingChipProps {
  text: string;
  isActive: boolean;
  onClick: () => void;
}

export function ThinkingChip({ text, isActive, onClick }: ThinkingChipProps) {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isPending = !text && isStreaming;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border cursor-pointer transition-all duration-150 text-[11px] ${
        isActive
          ? 'bg-violet-500/10 border-violet-500/20'
          : 'bg-transparent border-surface-700/40 hover:border-surface-600/60 hover:bg-surface-800/40'
      }`}
    >
      {/* Brain icon */}
      <svg
        className={`w-3 h-3 shrink-0 opacity-80 ${isActive ? 'text-violet-400' : 'text-gray-400'}`}
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
      <span className={`${isActive ? 'text-violet-400 thinking-indicator' : 'text-gray-400'}`}>thinking</span>
      {text.length > 0 && (
        <span className={isActive ? 'text-violet-300/70' : 'text-gray-500'}>{text.length.toLocaleString()}</span>
      )}
      {isPending && (
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
      )}
    </button>
  );
}

interface ThinkingContentProps {
  text: string;
}

export function ThinkingContent({ text }: ThinkingContentProps) {
  return (
    <div className="px-3 py-2.5 text-[12px] text-gray-400 bg-surface-900/40 border border-surface-800/40 rounded-lg whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
      {text}
    </div>
  );
}
