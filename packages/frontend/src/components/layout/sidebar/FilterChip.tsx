import React from 'react';

/* ── Filter Chip ── */
export function FilterChip({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
        active
          ? 'bg-primary-600/20 text-primary-400 ring-1 ring-primary-500/30'
          : 'text-surface-600 hover:text-gray-400 hover:bg-surface-800'
      }`}
      title={title}
    >
      {children}
    </button>
  );
}

export function FilterMenuItem({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors ${
        active
          ? 'text-primary-400 bg-primary-500/10'
          : 'text-gray-400 hover:bg-surface-700 hover:text-gray-300'
      }`}
    >
      <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${
        active ? 'border-primary-400 bg-primary-500/20 text-primary-300' : 'border-surface-600'
      }`}>
        {active ? '✓' : ''}
      </span>
      {children}
    </button>
  );
}
