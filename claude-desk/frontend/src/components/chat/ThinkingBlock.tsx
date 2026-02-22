import React, { useState } from 'react';

interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="thinking-indicator">thinking</span>
        <span className="text-gray-700">{text.length.toLocaleString()}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2.5 text-[12px] text-gray-500 bg-surface-900/40 border border-surface-800/40 rounded-lg mt-1 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}
