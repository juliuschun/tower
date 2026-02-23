import React from 'react';
import { useChatStore } from '../../stores/chat-store';
import { useSessionStore } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useModelStore } from '../../stores/model-store';
import { ModelSelector } from './ModelSelector';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
  onNewSession?: () => void;
}

/** Abbreviate model name for mobile: "Sonnet 4.6" → "S4.6", "Opus 4.6" → "O4.6", etc. */
function shortModelName(name: string): string {
  const m = name.match(/^(Sonnet|Opus|Haiku)\s*([\d.]+)/i);
  if (m) return `${m[1][0].toUpperCase()}${m[2]}`;
  // Fallback: first 6 chars
  return name.slice(0, 6);
}

import type { ModelOption } from '../../stores/model-store';

function MobileModelSelector({ currentModel, availableModels, selectedModel, onSelect }: {
  currentModel: ModelOption;
  availableModels: ModelOption[];
  selectedModel: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 bg-surface-800/80 border border-surface-700/50 px-2 py-1 rounded-md shadow-sm active:scale-95 transition-all"
      >
        <span>{shortModelName(currentModel.name)}</span>
        <svg className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl shadow-black/40 overflow-hidden z-[100]">
          {availableModels.map((model) => (
            <button
              key={model.id}
              onClick={() => { onSelect(model.id); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                model.id === selectedModel
                  ? 'bg-primary-600/15 text-primary-300'
                  : 'text-gray-400 hover:bg-surface-800 hover:text-gray-200'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${model.id === selectedModel ? 'bg-primary-400' : 'bg-surface-700'}`} />
              <span className="text-[12px] font-medium">{model.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header({ connected, onToggleSidebar, onNewSession }: HeaderProps) {
  const cost = useChatStore((s) => s.cost);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isMobile = useSessionStore((s) => s.isMobile);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const { availableModels, selectedModel, setSelectedModel } = useModelStore();
  const currentModel = availableModels.find((m) => m.id === selectedModel) || availableModels[0];

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

      <div
        className="flex items-center gap-2"
        onClick={() => {
          const now = Date.now();
          const last = (window as any).__lastLogoTap || 0;
          (window as any).__lastLogoTap = now;
          if (now - last < 400) {
            // Unregister service workers then hard reload
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.getRegistrations().then((regs) => {
                regs.forEach((r) => r.unregister());
              });
              caches.keys().then((keys) => {
                keys.forEach((k) => caches.delete(k));
              });
            }
            setTimeout(() => location.reload(), 100);
          }
        }}
      >
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

      {isMobile && onNewSession && (
        <button
          onClick={onNewSession}
          className="p-2 hover:bg-surface-800 rounded-lg transition-all active:scale-95 text-primary-400 hover:text-primary-300"
          title="새 채팅"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      <div className="flex items-center gap-2 md:gap-3">
        {isMobile ? (
          currentModel && <MobileModelSelector
            currentModel={currentModel}
            availableModels={availableModels}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
          />
        ) : (
          <ModelSelector />
        )}

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

        {cost.totalCost > 0 && (
          <span className={`font-semibold text-primary-300 bg-primary-900/10 border border-primary-800/30 rounded-md shadow-sm ${
            isMobile ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2.5 py-1'
          }`}>
            ${isMobile ? cost.totalCost.toFixed(2) : cost.totalCost.toFixed(4)}
          </span>
        )}

        <div className={`w-2 h-2 rounded-full ring-2 ring-surface-900 ring-offset-1 ring-offset-transparent ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'}`}
          title={connected ? '연결됨' : '연결 끊김'}
        />
      </div>
    </header>
  );
}
