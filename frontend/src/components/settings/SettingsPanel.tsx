import React from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { useSessionStore } from '../../stores/session-store';

interface SettingsPanelProps {
  onLogout: () => void;
  onBrowserOpen?: () => void;
}

export function SettingsPanel({ onLogout, onBrowserOpen }: SettingsPanelProps) {
  const isOpen = useSettingsStore((s) => s.isOpen);
  const setOpen = useSettingsStore((s) => s.setOpen);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const isMobile = useSessionStore((s) => s.isMobile);
  const activeView = useSessionStore((s) => s.activeView);
  const setActiveView = useSessionStore((s) => s.setActiveView);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[calc(100vw-32px)] max-w-[360px] max-h-[80vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800">
          <h2 className="text-[15px] font-bold text-gray-100">Settings</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* View mode — mobile only (desktop has header toggle) */}
          {isMobile && (
            <section>
              <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">View</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveView('chat')}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                    activeView === 'chat'
                      ? 'bg-surface-800 border-primary-500 text-primary-400'
                      : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveView('kanban')}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                    activeView === 'kanban'
                      ? 'bg-surface-800 border-primary-500 text-primary-400'
                      : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                  }`}
                >
                  Board
                </button>
              </div>
            </section>
          )}

          {/* Theme */}
          <section>
            <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">Appearance</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme('dark')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                  theme === 'dark'
                    ? 'bg-surface-800 border-primary-500 text-primary-400'
                    : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                }`}
              >
                Dark
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                  theme === 'light'
                    ? 'bg-surface-800 border-primary-500 text-primary-400'
                    : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                }`}
              >
                Light
              </button>
            </div>
          </section>

          {/* Dev Tools */}
          {onBrowserOpen && (
            <section>
              <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">Dev Tools</h3>
              <button
                onClick={() => {
                  setOpen(false);
                  onBrowserOpen();
                }}
                className="w-full py-2.5 text-xs font-semibold text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded-lg transition-all"
              >
                Browser Panel
              </button>
            </section>
          )}

          {/* Logout */}
          <section>
            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="w-full py-2.5 text-xs font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-all"
            >
              Logout
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
