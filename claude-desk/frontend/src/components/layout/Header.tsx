import React from 'react';
import { useChatStore } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';
import { ModelSelector } from './ModelSelector';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
}

export function Header({ connected, onToggleSidebar }: HeaderProps) {
  const cost = useChatStore((s) => s.cost);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isMobile = useSessionStore((s) => s.isMobile);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <header className="h-14 bg-surface-900/80 backdrop-blur-md border-b border-surface-800 flex items-center px-3 md:px-5 gap-2 md:gap-4 shrink-0 sticky top-0 z-50">
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
        {!isMobile && <span className="text-gray-100 font-bold text-[15px] tracking-tight">Claude Desk</span>}
      </div>

      {activeSession && (
        <>
          <span className="text-surface-700 -mx-1">/</span>
          <div className={`text-[13px] font-medium text-gray-400 px-2 py-1 rounded bg-surface-800/50 truncate ${isMobile ? 'max-w-[120px]' : ''}`}>
            {activeSession.name}
          </div>
        </>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2 md:gap-3">
        {!isMobile && <ModelSelector />}

        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 hover:bg-surface-800 rounded-lg transition-all text-gray-400 hover:text-gray-200"
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {!isMobile && cost.totalCost > 0 && (
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
