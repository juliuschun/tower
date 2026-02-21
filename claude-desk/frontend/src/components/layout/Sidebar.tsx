import React from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { useChatStore } from '../../stores/chat-store';

interface SidebarProps {
  onNewSession: () => void;
  onSelectSession: (session: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
}

export function Sidebar({ onNewSession, onSelectSession, onDeleteSession }: SidebarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  return (
    <aside className="w-[260px] bg-surface-900 border-r border-surface-800 flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-surface-800/50">
        <button
          onClick={onNewSession}
          className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-500 rounded-lg text-[13px] font-semibold text-white shadow-sm shadow-primary-900/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 ring-1 ring-white/10"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          새 대화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pt-2">
        <div className="px-3">
          <h3 className="text-[11px] font-medium text-surface-700 uppercase tracking-widest px-2 pb-2 pt-1">세션 히스토리</h3>
          {sessions.length === 0 && (
            <p className="text-[13px] text-surface-700 px-2 py-6 text-center">아직 세션이 없습니다</p>
          )}
          <div className="space-y-0.5">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer text-[13px] transition-all duration-200 ${session.id === activeSessionId
                    ? 'bg-surface-800 text-gray-100 shadow-sm ring-1 ring-surface-700/50'
                    : 'text-gray-400 hover:bg-surface-850 hover:text-gray-200'
                  }`}
                onClick={() => onSelectSession(session)}
              >
                <svg className={`w-4 h-4 shrink-0 transition-colors ${session.id === activeSessionId ? 'text-primary-500' : 'text-surface-700 group-hover:text-surface-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="truncate flex-1 font-medium">{session.name}</span>
                {session.totalCost > 0 && (
                  <span className="text-[10px] tabular-nums font-semibold text-surface-700/80 group-hover:text-surface-600 transition-colors bg-surface-800/30 px-1.5 py-0.5 rounded">${session.totalCost.toFixed(2)}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 hover:bg-red-950/30 rounded transition-all text-surface-700"
                  title="삭제"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-surface-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2 text-surface-700 hover:text-surface-600 transition-colors cursor-default">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <span className="text-[11px] font-medium">Settings</span>
        </div>
        <span className="text-[10px] font-semibold text-surface-800">v0.1.0</span>
      </div>
    </aside>
  );
}
