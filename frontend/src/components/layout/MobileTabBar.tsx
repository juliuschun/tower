import React from 'react';
import { useSessionStore, type MobileTab } from '../../stores/session-store';

const tabs: { id: MobileTab; label: string; icon: JSX.Element }[] = [
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
];

export function MobileTabBar() {
  const mobileTab = useSessionStore((s) => s.mobileTab);
  const setMobileTab = useSessionStore((s) => s.setMobileTab);
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);
  const setSidebarTab = useSessionStore((s) => s.setSidebarTab);
  const setMobileContextOpen = useSessionStore((s) => s.setMobileContextOpen);

  const handleTabClick = (tab: MobileTab) => {
    setMobileTab(tab);
    if (tab === 'sessions') {
      setSidebarOpen(true);
      setSidebarTab('sessions');
      setMobileContextOpen(false);
    } else if (tab === 'chat') {
      setSidebarOpen(false);
      setMobileContextOpen(false);
    } else if (tab === 'files') {
      setSidebarOpen(true);
      setSidebarTab('files');
      setMobileContextOpen(false);
    } else if (tab === 'edit') {
      setSidebarOpen(false);
      setMobileContextOpen(true);
    } else if (tab === 'pins') {
      setSidebarOpen(true);
      setSidebarTab('pins');
      setMobileContextOpen(false);
    }
  };

  return (
    <nav className="h-14 bg-surface-900 border-t border-surface-800 flex items-stretch shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => handleTabClick(tab.id)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            mobileTab === tab.id
              ? 'text-primary-400'
              : 'text-gray-500 active:text-gray-300'
          }`}
        >
          {tab.icon}
          <span className="text-[10px] font-medium">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
