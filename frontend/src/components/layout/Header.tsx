import React from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useModelStore } from '../../stores/model-store';
import { ModelSelector } from './ModelSelector';
import { GitPanel } from '../git/GitPanel';
import { useRoomStore } from '../../stores/room-store';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
  onNewSession?: () => void;
  onAdminClick?: () => void;
  onPublishClick?: () => void;
  onViewDiff?: (diff: string) => void;
  onLogout?: () => void;
  username?: string;
  userRole?: string;
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

function ViewToggle() {
  const activeView = useSessionStore((s) => s.activeView);
  const setActiveView = useSessionStore((s) => s.setActiveView);
  const pgEnabled = useRoomStore((s) => s.pgEnabled);
  const unreadCounts = useRoomStore((s) => s.unreadCounts);

  // Total unread messages across all rooms
  const totalUnread = Object.values(unreadCounts).reduce((sum, c) => sum + c, 0);

  const tabs: { id: 'chat' | 'kanban' | 'history' | 'rooms'; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    ...(pgEnabled ? [{ id: 'rooms' as const, label: 'Rooms' }] : []),
    { id: 'kanban', label: 'Board' },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="flex items-center gap-0.5 bg-surface-800/60 rounded-lg p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveView(tab.id)}
          className={`relative px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
            activeView === tab.id
              ? 'bg-surface-700 text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {tab.label}
          {tab.id === 'rooms' && totalUnread > 0 && activeView !== 'rooms' && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-[9px] font-bold text-white rounded-full leading-none">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function VersionHistoryButton({ onViewDiff }: { onViewDiff?: (diff: string) => void }) {
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
        className={`p-2 hover:bg-surface-800 rounded-lg transition-all text-gray-400 hover:text-gray-200 ${open ? 'bg-surface-800 text-gray-200' : ''}`}
        title="Version history"
        aria-label="Version history"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 md:w-96 max-h-[70vh] bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-[100] flex flex-col">
          <div className="px-3 py-2 border-b border-surface-800 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[12px] font-semibold text-gray-300">Version History</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <GitPanel onViewDiff={(diff) => { onViewDiff?.(diff); setOpen(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu({ username, userRole, onAdminClick, onLogout }: {
  username?: string;
  userRole?: string;
  onAdminClick?: () => void;
  onLogout?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initial = (username || '?')[0].toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-surface-800 transition-colors"
        aria-label="User menu"
      >
        <div className="w-6 h-6 rounded-full bg-primary-600/30 border border-primary-500/40 flex items-center justify-center">
          <span className="text-[11px] font-bold text-primary-400">{initial}</span>
        </div>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-[100]">
          {/* User info */}
          <div className="px-3 py-2.5 border-b border-surface-800">
            <div className="text-[13px] font-medium text-gray-200">{username || 'User'}</div>
            {userRole && (
              <div className="text-[11px] text-gray-500 mt-0.5 capitalize">{userRole}</div>
            )}
          </div>
          {/* Actions */}
          <div className="py-1">
            <button
              onClick={() => { useSettingsStore.getState().setOpen(true); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-gray-400 hover:bg-surface-800 hover:text-gray-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
            {onAdminClick && (
              <button
                onClick={() => { onAdminClick(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-gray-400 hover:bg-surface-800 hover:text-gray-200 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Admin Panel
              </button>
            )}
          </div>
          {/* Logout */}
          {onLogout && (
            <>
              <div className="border-t border-surface-800" />
              <div className="py-1">
                <button
                  onClick={() => { onLogout(); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-400 hover:bg-red-950/30 hover:text-red-300 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ connected, onToggleSidebar, onNewSession, onAdminClick, onPublishClick, onViewDiff, onLogout, username, userRole }: HeaderProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isMobile = useSessionStore((s) => s.isMobile);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const { availableModels, selectedModel, setSelectedModel } = useModelStore();
  const currentModel = availableModels.find((m) => m.id === selectedModel) || availableModels[0];

  return (
    <header className="h-14 bg-surface-900/80 backdrop-blur-md border-b border-surface-800 flex items-center px-3 md:px-5 gap-2 md:gap-4 shrink-0 z-50">
      <button
        onClick={onToggleSidebar}
        className="p-2 hover:bg-surface-800 rounded-lg transition-all active:scale-95 text-gray-400 hover:text-gray-200"
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div
        className="flex items-center gap-2"
      >
        <div className="w-6 h-6 rounded bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
          <span className="text-primary-400 font-bold text-xs uppercase tracking-wider">T</span>
        </div>
        {!isMobile && <span className="text-gray-100 font-bold text-[15px] tracking-tight">Tower</span>}
      </div>

      {/* Chat / Board / History view toggle */}
      <ViewToggle />

      {activeSession && (
        <>
          <span className="text-surface-700 -mx-1 shrink-0">/</span>
          <div className={`text-[13px] font-medium text-gray-400 px-2 py-1 rounded bg-surface-800/50 truncate min-w-0 ${isMobile ? 'max-w-[120px]' : ''}`}>
            {activeSession.name}
          </div>
        </>
      )}

      <div className="flex-1" />

      {isMobile && onNewSession && (
        <button
          onClick={onNewSession}
          className="p-2 hover:bg-surface-800 rounded-lg transition-all active:scale-95 text-primary-400 hover:text-primary-300"
          title="New chat"
          aria-label="New chat"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
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

        {!isMobile && <VersionHistoryButton onViewDiff={onViewDiff} />}

        {!isMobile && onPublishClick && (
          <button
            onClick={onPublishClick}
            className="p-2 hover:bg-surface-800 rounded-lg transition-all text-gray-400 hover:text-amber-400"
            title="Publishing Hub"
            aria-label="Publishing Hub"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        )}

        {/* User menu — replaces standalone admin button */}
        {!isMobile && (
          <UserMenu
            username={username}
            userRole={userRole}
            onAdminClick={onAdminClick}
            onLogout={onLogout}
          />
        )}

        {/* Theme toggle: desktop only — mobile uses Settings tab in MobileTabBar */}
        {!isMobile && (
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 hover:bg-surface-800 rounded-lg transition-all text-gray-400 hover:text-gray-200"
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
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
        )}

        <div className={`w-2 h-2 rounded-full ring-2 ring-surface-900 ring-offset-1 ring-offset-transparent ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      </div>
    </header>
  );
}
