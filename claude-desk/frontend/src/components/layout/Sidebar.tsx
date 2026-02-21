import React, { useMemo } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { useFileStore } from '../../stores/file-store';
import { SessionItem } from '../sessions/SessionItem';
import { FileTree } from '../files/FileTree';

interface SidebarProps {
  onNewSession: () => void;
  onSelectSession: (session: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onFileClick: (path: string) => void;
  onDirectoryClick: (path: string) => void;
  onRequestFileTree: () => void;
}

export function Sidebar({
  onNewSession, onSelectSession, onDeleteSession,
  onRenameSession, onToggleFavorite,
  onFileClick, onDirectoryClick, onRequestFileTree,
}: SidebarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sidebarTab = useSessionStore((s) => s.sidebarTab);
  const setSidebarTab = useSessionStore((s) => s.setSidebarTab);
  const searchQuery = useSessionStore((s) => s.searchQuery);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);

  const tree = useFileStore((s) => s.tree);

  // Filter and sort sessions: favorites first, then by updatedAt
  const filteredSessions = useMemo(() => {
    let list = sessions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [sessions, searchQuery]);

  return (
    <aside className="w-[260px] bg-surface-900 border-r border-surface-800 flex flex-col h-full shrink-0">
      {/* New session button — always visible */}
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

      {/* Tab switcher */}
      <div className="flex border-b border-surface-800/50">
        <button
          onClick={() => setSidebarTab('sessions')}
          className={`flex-1 py-2 text-[12px] font-semibold tracking-wide transition-colors ${
            sidebarTab === 'sessions'
              ? 'text-primary-400 border-b-2 border-primary-500'
              : 'text-surface-700 hover:text-surface-600'
          }`}
        >
          세션
        </button>
        <button
          onClick={() => { setSidebarTab('files'); if (tree.length === 0) onRequestFileTree(); }}
          className={`flex-1 py-2 text-[12px] font-semibold tracking-wide transition-colors ${
            sidebarTab === 'files'
              ? 'text-primary-400 border-b-2 border-primary-500'
              : 'text-surface-700 hover:text-surface-600'
          }`}
        >
          파일
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pt-2">
        {sidebarTab === 'sessions' ? (
          <div className="px-3">
            {/* Search input */}
            <div className="relative mb-2">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded-md text-[12px] text-gray-300 pl-8 pr-3 py-1.5 placeholder-surface-700 outline-none focus:border-primary-500/50 transition-colors"
              />
            </div>

            {filteredSessions.length === 0 && (
              <p className="text-[13px] text-surface-700 px-2 py-6 text-center">
                {searchQuery ? '검색 결과 없음' : '아직 세션이 없습니다'}
              </p>
            )}
            <div className="space-y-0.5">
              {filteredSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={onSelectSession}
                  onDelete={onDeleteSession}
                  onRename={onRenameSession}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="px-2">
            {tree.length === 0 ? (
              <p className="text-[13px] text-surface-700 px-2 py-6 text-center">파일 트리 로딩 중...</p>
            ) : (
              <FileTree
                entries={tree}
                onFileClick={onFileClick}
                onDirectoryClick={onDirectoryClick}
              />
            )}
          </div>
        )}
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
