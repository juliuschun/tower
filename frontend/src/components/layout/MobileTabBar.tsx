import React from 'react';
import { useSessionStore, type MobileTab } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';

const tabs: { id: MobileTab | 'settings'; label: string; icon: JSX.Element }[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    id: 'files',
    label: 'Files',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
  {
    id: 'edit',
    label: 'Edit',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    id: 'pins',
    label: 'Pins',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
  },
  {
    id: 'board',
    label: 'Board',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export function MobileTabBar() {
  const mobileTab = useSessionStore((s) => s.mobileTab);
  const setMobileTab = useSessionStore((s) => s.setMobileTab);
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);
  const setSidebarTab = useSessionStore((s) => s.setSidebarTab);
  const setMobileContextOpen = useSessionStore((s) => s.setMobileContextOpen);
  const openSettings = useSettingsStore((s) => s.setOpen);
  const setActiveView = useSessionStore((s) => s.setActiveView);
  const activeView = useSessionStore((s) => s.activeView);

  const handleTabClick = (tab: MobileTab | 'settings') => {
    if (tab === 'settings') {
      openSettings(true);
      return;
    }
    setMobileTab(tab);
    if (tab === 'sessions') {
      setSidebarOpen(true);
      setSidebarTab('sessions');
      setMobileContextOpen(false);
    } else if (tab === 'chat') {
      setSidebarOpen(false);
      setMobileContextOpen(false);
      setActiveView('chat');
    } else if (tab === 'files') {
      setSidebarOpen(true);
      setSidebarTab('files');
      setMobileContextOpen(false);
    } else if (tab === 'edit') {
      setSidebarOpen(false);
      // Edit 탭은 직접 탭 선택이라 이전 탭 기억 불필요 — 단순 열기
      setMobileContextOpen(true);
    } else if (tab === 'pins') {
      setSidebarOpen(true);
      setSidebarTab('pins');
      setMobileContextOpen(false);
    } else if (tab === 'board') {
      setSidebarOpen(false);
      setMobileContextOpen(false);
      setActiveView('kanban');
    }
  };

  return (
    <nav className="bg-surface-900 border-t border-surface-800 shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="h-12 flex items-stretch">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => handleTabClick(tab.id)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            tab.id !== 'settings' && mobileTab === tab.id
              ? 'text-primary-400'
              : 'text-gray-500 active:text-gray-300'
          }`}
        >
          {tab.icon}
          <span className="text-[10px] font-medium">{tab.label}</span>
        </button>
      ))}
      </div>
    </nav>
  );
}
