import React from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useRoomStore } from '../../stores/room-store';
import { ModelSelector } from './ModelSelector';
import { useModelStore } from '../../stores/model-store';
import { GitPanel } from '../git/GitPanel';
import { NotificationBell } from './NotificationBell';
import { useProjectStore } from '../../stores/project-store';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
  onNewSession?: () => void;
  onAdminClick?: () => void;
  onPublishClick?: () => void;
  onViewDiff?: (diff: string) => void;
  onLogout?: () => void;
  onSettingsClick?: () => void;
  onPinsClick?: () => void;
  onHistoryClick?: () => void;
  onRequestFileTree?: () => void;
  username?: string;
  userRole?: string;
  sidebarOpen?: boolean;
}

/* ─── Nav Switch (segmented toggle) ─── */
function NavTabs({ onRequestFileTree }: { onRequestFileTree?: () => void }) {
  const sidebarTab = useSessionStore((s) => s.sidebarTab);
  const setSidebarTab = useSessionStore((s) => s.setSidebarTab);
  const activeView = useSessionStore((s) => s.activeView);
  const setActiveView = useSessionStore((s) => s.setActiveView);
  const pgEnabled = useRoomStore((s) => s.pgEnabled);
  const unreadCounts = useRoomStore((s) => s.unreadCounts);
  const totalRoomUnread = React.useMemo(
    () => Object.values(unreadCounts).reduce((s, c) => s + c, 0),
    [unreadCounts],
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState({ left: 0, width: 0 });

  // Build tab definitions
  const tabs = React.useMemo(() => {
    const list: { key: string; label: string; badge?: number }[] = [
      { key: 'ai', label: 'AI' },
    ];
    if (pgEnabled) list.push({ key: 'channel', label: 'Channel', badge: totalRoomUnread });
    list.push({ key: 'files', label: 'Files' });
    list.push({ key: 'task', label: 'Task' });
    return list;
  }, [pgEnabled, totalRoomUnread]);

  // Determine active key
  const activeKey = activeView === 'kanban' ? 'task'
    : activeView === 'rooms' ? 'channel'
    : activeView === 'files' ? 'files'
    : 'ai';

  // Update sliding indicator position
  React.useEffect(() => {
    if (!containerRef.current) return;
    const idx = tabs.findIndex(t => t.key === activeKey);
    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>('[data-nav-tab]');
    const btn = buttons[idx];
    if (btn) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicator({ left: btnRect.left - containerRect.left, width: btnRect.width });
    }
  }, [activeKey, tabs]);

  const handleClick = (key: string) => {
    const store = useSessionStore.getState();
    switch (key) {
      case 'ai':
        setSidebarTab('sessions'); setActiveView('chat'); store.setSidebarOpen(true);
        break;
      case 'channel':
        setSidebarTab('rooms'); setActiveView('rooms'); store.setSidebarOpen(true);
        break;
      case 'files':
        setSidebarTab('files'); setActiveView('files'); store.setSidebarOpen(true); onRequestFileTree?.();
        break;
      case 'task':
        if (activeView === 'kanban') {
          setActiveView('chat'); store.setSidebarOpen(true);
        } else {
          setActiveView('kanban'); store.setSidebarOpen(false);
        }
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex items-center bg-surface-850 rounded-lg p-0.5"
    >
      {/* Sliding indicator */}
      <div
        className="absolute top-0.5 bottom-0.5 rounded-md bg-surface-700/80 transition-all duration-200 ease-out pointer-events-none"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {tabs.map(({ key, label, badge }) => (
        <button
          key={key}
          data-nav-tab
          onClick={() => handleClick(key)}
          className={`relative z-10 px-3 py-1 text-[11px] font-semibold tracking-wide rounded-md transition-colors ${
            activeKey === key
              ? 'text-primary-400'
              : 'text-surface-500 hover:text-gray-300'
          }`}
        >
          {label}
          {badge != null && badge > 0 && activeKey !== key && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center bg-red-500 text-[8px] font-bold text-white rounded-full leading-none">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ─── Light / Dark Toggle ─── */
function ThemeToggle() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const isLight = theme === 'light';

  return (
    <button
      onClick={() => setTheme(isLight ? 'dark' : 'light')}
      className="p-2 hover:bg-surface-800 rounded-lg transition-all active:scale-95 text-gray-400 hover:text-gray-200"
      title={isLight ? 'Dark mode' : 'Light mode'}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {isLight ? (
        /* Moon icon */
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        /* Sun icon */
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  );
}

/* ─── Inline Model Selector (for hamburger menu) ─── */
function ModelSelectorInline({ onClose }: { onClose: () => void }) {
  const { availableModels, piModels, selectedModel, setSelectedModel } = useModelStore();
  const [expanded, setExpanded] = React.useState(false);
  const allModels = [...availableModels, ...piModels];
  const current = allModels.find((m) => m.id === selectedModel)
    || availableModels[0]
    || { id: selectedModel, name: selectedModel.replace(/^pi:.*\//, '').replace(/-/g, ' '), badge: '' };

  if (!current) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-[12px] font-medium text-gray-300 bg-surface-800/80 border border-surface-700/50 px-2.5 py-1.5 rounded-lg hover:bg-surface-800 transition-all"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
        <span className="flex-1 text-left truncate">{current.name}</span>
        {current.badge && (
          <span className={`text-[9px] font-bold px-1 py-px rounded ${
            current.badge === 'OR'
              ? 'text-violet-300 bg-violet-500/20 border border-violet-500/30'
              : current.badge === 'AZ'
              ? 'text-sky-300 bg-sky-500/20 border border-sky-500/30'
              : 'text-purple-300 bg-purple-500/20 border border-purple-500/30'
          }`}>
            {current.badge}
          </span>
        )}
        <svg className={`w-3 h-3 text-surface-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-lg border border-surface-700/50 bg-surface-850 overflow-hidden">
          {availableModels.map((model) => (
            <button
              key={model.id}
              onClick={() => { setSelectedModel(model.id); setExpanded(false); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                model.id === selectedModel
                  ? 'bg-primary-600/15 text-primary-300'
                  : 'text-gray-400 hover:bg-surface-800 hover:text-gray-200'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${model.id === selectedModel ? 'bg-primary-400' : 'bg-surface-700'}`} />
              <span className="flex-1 text-left truncate">{model.name}</span>
              {model.badge && (
                <span className={`text-[9px] font-bold px-1 py-px rounded shrink-0 ${
                  model.badge === 'OR'
                    ? 'text-violet-300 bg-violet-500/20 border border-violet-500/30'
                    : model.badge === 'AZ'
                    ? 'text-sky-300 bg-sky-500/20 border border-sky-500/30'
                    : 'text-purple-300 bg-purple-500/20 border border-purple-500/30'
                }`}>
                  {model.badge}
                </span>
              )}
            </button>
          ))}
          {piModels.length > 0 && (
            <>
              <div className="border-t border-surface-700/50 mx-2 my-0.5" />
              <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-semibold text-violet-400/70 uppercase tracking-wider">Pi Agent</div>
              {piModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => { setSelectedModel(model.id); setExpanded(false); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                    model.id === selectedModel
                      ? 'bg-primary-600/15 text-primary-300'
                      : 'text-gray-400 hover:bg-surface-800 hover:text-gray-200'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${model.id === selectedModel ? 'bg-primary-400' : 'bg-surface-700'}`} />
                  <span className="flex-1 text-left truncate">{model.name}</span>
                  {model.badge && (
                    <span className={`text-[9px] font-bold px-1 py-px rounded shrink-0 ${
                      model.badge === 'OR'
                        ? 'text-violet-300 bg-violet-500/20 border border-violet-500/30'
                        : model.badge === 'AZ'
                        ? 'text-sky-300 bg-sky-500/20 border border-sky-500/30'
                        : 'text-purple-300 bg-purple-500/20 border border-purple-500/30'
                    }`}>
                      {model.badge}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── App Menu (☰) ─── */
function AppMenu({
  username, userRole, onAdminClick, onPublishClick, onViewDiff,
  onLogout, onSettingsClick, onPinsClick, onHistoryClick, isMobile,
}: {
  username?: string;
  userRole?: string;
  onAdminClick?: () => void;
  onPublishClick?: () => void;
  onViewDiff?: (diff: string) => void;
  onLogout?: () => void;
  onSettingsClick?: () => void;
  onPinsClick?: () => void;
  onHistoryClick?: () => void;
  isMobile?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [gitOpen, setGitOpen] = React.useState(false);
  const [themeOpen, setThemeOpen] = React.useState(false);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);
  const [npName, setNpName] = React.useState('');
  const npInputRef = React.useRef<HTMLInputElement>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setSkillsBrowserOpen = useSettingsStore((s) => s.setSkillsBrowserOpen);

  // Reset sub-panels when menu closes
  React.useEffect(() => {
    if (!open) {
      setGitOpen(false);
      setThemeOpen(false);
      setNewProjectOpen(false);
      setNpName('');
    }
  }, [open]);

  // Auto-focus project name input
  React.useEffect(() => {
    if (newProjectOpen) npInputRef.current?.focus();
  }, [newProjectOpen]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const initial = (username || '?')[0].toUpperCase();

  const handleCreateProject = async () => {
    const trimmed = npName.trim();
    if (!trimmed) { setNewProjectOpen(false); return; }
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', headers, body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const project = await res.json();
        useProjectStore.getState().addProject(project);
      }
    } catch {}
    setNpName('');
    setNewProjectOpen(false);
    setOpen(false);
  };

  const MenuItem = ({ icon, label, onClick, danger, shortcut, keepOpen }: {
    icon: React.ReactNode; label: string; onClick?: () => void; danger?: boolean; shortcut?: string; keepOpen?: boolean;
  }) => (
    <button
      onClick={() => { onClick?.(); if (!keepOpen) setOpen(false); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-950/30 hover:text-red-300'
          : 'text-gray-400 hover:bg-surface-800 hover:text-gray-200'
      }`}
    >
      <span className="w-4 h-4 shrink-0 flex items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-surface-600 font-mono">{shortcut}</span>}
    </button>
  );

  const Divider = () => <div className="border-t border-surface-800 my-1" />;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`p-2 hover:bg-surface-800 rounded-lg transition-all active:scale-95 ${
          open ? 'bg-surface-800 text-gray-200' : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Menu"
        aria-label="Menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open && !gitOpen && !themeOpen && !newProjectOpen && (
        <div className="absolute left-0 top-full mt-2 w-56 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-[100]">
          {/* User info header */}
          <div className="px-3 py-2.5 border-b border-surface-800 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-primary-600/30 border border-primary-500/40 flex items-center justify-center shrink-0">
              <span className="text-[12px] font-bold text-primary-400">{initial}</span>
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-gray-200 truncate">{username || 'User'}</div>
              {userRole && <div className="text-[10px] text-gray-500 capitalize">{userRole}</div>}
            </div>
          </div>

          {/* ── Model Selector (inline) ── */}
          <div className="px-3 py-2 border-b border-surface-800">
            <div className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1.5">Model</div>
            <ModelSelectorInline onClose={() => setOpen(false)} />
          </div>

          <div className="py-1">
            {/* ── Shortcuts ── */}
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>}
              label="Pins"
              onClick={onPinsClick}
            />
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              label="History"
              onClick={onHistoryClick}
            />
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>}
              label="New Project"
              onClick={() => { setNewProjectOpen(true); }}
              keepOpen
            />

            <Divider />

            {/* ── Settings & Admin ── */}
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
              label="Settings"
              onClick={onSettingsClick}
            />
            {onAdminClick && (
              <MenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
                label="Admin Panel"
                onClick={onAdminClick}
              />
            )}

            <Divider />

            {/* ── Skills & Appearance ── */}
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
              label="Skills Market"
              onClick={() => { setSkillsBrowserOpen(true); }}
            />
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>}
              label="Appearance"
              onClick={() => { setThemeOpen(true); }}
              keepOpen
            />

            <Divider />

            {/* ── Tools ── */}
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
              label="Version History"
              onClick={() => { setGitOpen(true); }}
              keepOpen
            />
            {onPublishClick && (
              <MenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                label="Publishing Hub"
                onClick={onPublishClick}
              />
            )}

            <Divider />

            {/* ── Help ── */}
            <MenuItem
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={1.5} /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" strokeWidth={2} strokeLinecap="round" /></svg>}
              label="Help"
              onClick={() => useSettingsStore.getState().setHelpOpen(true)}
            />

            <Divider />

            {/* ── Logout ── */}
            {onLogout && (
              <MenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>}
                label="Logout"
                onClick={onLogout}
                danger
              />
            )}
          </div>
        </div>
      )}

      {/* New Project sub-panel */}
      {open && newProjectOpen && (
        <div className="absolute left-0 top-full mt-2 w-64 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-[100]">
          <div className="px-3 py-2.5 border-b border-surface-800 flex items-center gap-2">
            <button
              onClick={() => setNewProjectOpen(false)}
              className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-[13px] font-semibold text-gray-200">New Project</span>
          </div>
          <div className="p-3">
            <input
              ref={npInputRef}
              value={npName}
              onChange={(e) => setNpName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateProject();
                if (e.key === 'Escape') { setNewProjectOpen(false); setNpName(''); }
              }}
              placeholder="Project name..."
              className="w-full bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 px-3 py-2 placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors"
            />
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => { setNewProjectOpen(false); setNpName(''); }}
                className="flex-1 text-[12px] text-gray-400 hover:text-gray-200 py-1.5 rounded-md hover:bg-surface-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!npName.trim()}
                className="flex-1 text-[12px] font-medium text-primary-400 py-1.5 rounded-md bg-primary-600/15 hover:bg-primary-600/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History sub-panel */}
      {open && gitOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 md:w-96 max-h-[70vh] bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-[100] flex flex-col">
          <div className="px-3 py-2.5 border-b border-surface-800 flex items-center gap-2">
            <button
              onClick={() => setGitOpen(false)}
              className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[12px] font-semibold text-gray-300 flex-1">Version History</span>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors text-gray-500 hover:text-gray-300 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <GitPanel onViewDiff={(diff) => { onViewDiff?.(diff); setOpen(false); setGitOpen(false); }} />
          </div>
        </div>
      )}

      {/* Appearance sub-panel */}
      {open && themeOpen && (
        <div className="absolute left-0 top-full mt-2 w-64 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-[100]">
          <div className="px-3 py-2.5 border-b border-surface-800 flex items-center gap-2">
            <button
              onClick={() => setThemeOpen(false)}
              className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <span className="text-[12px] font-semibold text-gray-300 flex-1">Appearance</span>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors text-gray-500 hover:text-gray-300 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-5 gap-1.5">
              {([
                { id: 'dark' as const,   label: 'Dark',   colors: ['#0b0d12', '#242832', '#f59e0b', '#f59e0b'] },
                { id: 'light' as const,  label: 'Light',  colors: ['#ffffff', '#f3f4f6', '#f59e0b', '#f59e0b'] },
                { id: 'ocean' as const,  label: 'Ocean',  colors: ['#060a14', '#18223a', '#00d4ff', '#c4a0f0'] },
                { id: 'forest' as const, label: 'Forest', colors: ['#080c08', '#1c2c20', '#d4b840', '#d8a070'] },
                { id: 'aurora' as const, label: 'Aurora', colors: ['#08060e', '#221e34', '#30e890', '#f0a0d0'] },
              ]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col items-center gap-1.5 py-2 rounded-lg border transition-all ${
                    theme === t.id
                      ? 'bg-surface-800 border-primary-500'
                      : 'bg-surface-900 border-surface-700 hover:border-surface-600'
                  }`}
                >
                  <div className="flex gap-0.5">
                    {t.colors.map((c, i) => (
                      <span key={i} className="w-2.5 h-2.5 rounded-full border border-white/10" style={{ background: c }} />
                    ))}
                  </div>
                  <span className={`text-[9px] font-medium ${theme === t.id ? 'text-primary-400' : 'text-surface-500'}`}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({
  connected, onNewSession, onAdminClick, onPublishClick,
  onViewDiff, onLogout, onSettingsClick, onPinsClick, onHistoryClick,
  onRequestFileTree, username, userRole,
}: HeaderProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isMobile = useSessionStore((s) => s.isMobile);

  return (
    <header className="h-12 bg-surface-900/80 backdrop-blur-md border-b border-surface-800 flex items-center px-3 md:px-4 gap-2 md:gap-3 shrink-0 z-50">
      {/* ☰ App Menu */}
      <AppMenu
        username={username}
        userRole={userRole}
        onAdminClick={onAdminClick}
        onPublishClick={onPublishClick}
        onViewDiff={onViewDiff}
        onLogout={onLogout}
        onSettingsClick={onSettingsClick}
        onPinsClick={onPinsClick}
        onHistoryClick={onHistoryClick}
        isMobile={isMobile}
      />

      {/* Nav tabs — app-level navigation */}
      {!isMobile && <NavTabs onRequestFileTree={onRequestFileTree} />}

      {/* Active session name */}
      {activeSession && (
        <>
          {!isMobile && <span className="text-surface-700 shrink-0">/</span>}
          <div className={`text-[12px] font-medium text-gray-500 px-1.5 py-0.5 rounded bg-surface-800/30 truncate min-w-0 ${
            isMobile ? 'max-w-[140px]' : 'max-w-[180px]'
          }`}>
            {activeSession.name}
          </div>
        </>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
        {/* Logo — right side */}
        <div className="flex items-center gap-1.5 mr-1">
          <div className="w-5 h-5 rounded bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
            <span className="text-primary-400 font-bold text-[10px] uppercase tracking-wider">T</span>
          </div>
          {!isMobile && <span className="text-gray-100 font-bold text-[14px] tracking-tight">Tower</span>}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-surface-800 shrink-0" />

        {/* Light/Dark toggle */}
        <ThemeToggle />

        <NotificationBell />

        {/* Connection indicator */}
        <div className={`w-2 h-2 rounded-full ring-2 ring-surface-900 ring-offset-1 ring-offset-transparent ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      </div>
    </header>
  );
}
