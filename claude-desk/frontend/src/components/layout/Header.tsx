import React from 'react';
import { useChatStore } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
}

export function Header({ connected, onToggleSidebar }: HeaderProps) {
  const model = useChatStore((s) => s.model);
  const cost = useChatStore((s) => s.cost);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <header className="h-14 bg-surface-900/80 backdrop-blur-md border-b border-surface-800 flex items-center px-5 gap-4 shrink-0 sticky top-0 z-50">
      <button
        onClick={onToggleSidebar}
        className="p-2 hover:bg-surface-800 rounded-lg transition-all active:scale-95 text-gray-400 hover:text-gray-200"
        title="사이드바 토글"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
          <span className="text-primary-400 font-bold text-xs uppercase tracking-wider">C</span>
        </div>
        <span className="text-gray-100 font-bold text-[15px] tracking-tight">Claude Desk</span>
      </div>

      {activeSession && (
        <>
          <span className="text-surface-700 -mx-1">/</span>
          <div className="text-[13px] font-medium text-gray-400 px-2 py-1 rounded bg-surface-800/50">
            {activeSession.name}
          </div>
        </>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {model && (
          <span className="text-[11px] font-medium text-gray-400 bg-surface-800/80 border border-surface-700/50 px-2.5 py-1 rounded-md shadow-sm">
            {model}
          </span>
        )}

        {cost.totalCost > 0 && (
          <span className="text-[11px] font-semibold text-primary-300 bg-primary-900/10 border border-primary-800/30 px-2.5 py-1 rounded-md shadow-sm">
            ${cost.totalCost.toFixed(4)}
          </span>
        )}

        <div className={`w-2 h-2 rounded-full ring-2 ring-surface-900 ring-offset-1 ring-offset-transparent ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'}`}
          title={connected ? '연결됨' : '연결 끊김'}
        />
      </div>
    </header>
  );
}
