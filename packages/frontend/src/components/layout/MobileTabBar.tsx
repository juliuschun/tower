import React from 'react';
import { useSessionStore, type MobileTab } from '../../stores/session-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useRoomStore } from '../../stores/room-store';

const tabs: { id: MobileTab | 'settings'; label: string; icon: React.ReactNode }[] = [
  {
    id: 'chat',
    label: 'AI',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    id: 'channel',
    label: 'Channel',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
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
    id: 'board',
    label: 'Task',
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
  const pgEnabled = useRoomStore((s) => s.pgEnabled);

  // Filter out channel tab when pgEnabled is false
  const visibleTabs = pgEnabled ? tabs : tabs.filter((t) => t.id !== 'channel');

  const handleTabClick = (tab: MobileTab | 'settings') => {
    if (tab === 'settings') {
      openSettings(true);
      return;
    }
    setMobileTab(tab);
    if (tab === 'chat') {
      setSidebarOpen(true);
      setSidebarTab('sessions');
      setMobileContextOpen(false);
      setActiveView('chat');
    } else if (tab === 'channel') {
      setSidebarOpen(true);
      setSidebarTab('rooms');
      setMobileContextOpen(false);
      setActiveView('rooms');
    } else if (tab === 'files') {
      setSidebarOpen(true);
      setSidebarTab('files');
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
      {visibleTabs.map((tab) => (
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
