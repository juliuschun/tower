import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { useFileStore } from '../../stores/file-store';
import { usePinStore, type Pin } from '../../stores/pin-store';
import { usePromptStore, type PromptItem } from '../../stores/prompt-store';
import { SessionItem } from '../sessions/SessionItem';
import { FileTree } from '../files/FileTree';
import { PinList } from '../pinboard/PinList';
import { GitPanel } from '../git/GitPanel';
import { PromptItem as PromptItemComponent } from '../prompts/PromptItem';
import { toastError } from '../../utils/toast';

interface SidebarProps {
  onNewSession: () => void;
  onSelectSession: (session: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onFileClick: (path: string) => void;
  onDirectoryClick: (path: string) => void;
  onRequestFileTree: (path?: string) => void;
  onPinFile?: (path: string) => void;
  onUnpinFile?: (id: number) => void;
  onPinClick?: (pin: Pin) => void;
  onSettingsClick?: () => void;
  onPromptClick?: (prompt: PromptItem) => void;
  onPromptEdit?: (prompt: PromptItem) => void;
  onPromptDelete?: (id: number | string) => void;
  onPromptAdd?: () => void;
  onPromptInsert?: (prompt: PromptItem) => void;
  onViewDiff?: (diff: string) => void;
  onNewSessionInFolder?: (path: string) => void;
}

export function Sidebar({
  onNewSession, onSelectSession, onDeleteSession,
  onRenameSession, onToggleFavorite,
  onFileClick, onDirectoryClick, onRequestFileTree,
  onPinFile, onUnpinFile, onPinClick, onSettingsClick,
  onPromptClick, onPromptEdit, onPromptDelete, onPromptAdd,
  onViewDiff, onNewSessionInFolder,
}: SidebarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sidebarTab = useSessionStore((s) => s.sidebarTab);
  const setSidebarTab = useSessionStore((s) => s.setSidebarTab);
  const searchQuery = useSessionStore((s) => s.searchQuery);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);

  const tree = useFileStore((s) => s.tree);
  const treeRoot = useFileStore((s) => s.treeRoot);

  const prompts = usePromptStore((s) => s.prompts);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const cwd = activeSession?.cwd || '';
  const projectName = cwd ? cwd.split('/').filter(Boolean).pop() || '/' : '';
  const displayPath = cwd.replace(/^\/home\/[^/]+/, '~');

  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);

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

  const tabClass = (tab: string) =>
    `flex-1 py-2 text-[11px] font-semibold tracking-wide transition-colors ${
      sidebarTab === tab
        ? 'text-primary-400 border-b-2 border-primary-500'
        : 'text-surface-700 hover:text-surface-600'
    }`;

  return (
    <aside className="w-full md:w-[260px] bg-surface-900 border-r border-surface-800 flex flex-col h-full shrink-0">
      {/* Project header */}
      {cwd && (
        <div className="px-4 pt-3 pb-2 border-b border-surface-800/50 relative">
          <button
            onClick={() => setCwdPickerOpen(!cwdPickerOpen)}
            className="w-full text-left group"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-yellow-500/70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <span className="text-[13px] font-bold text-gray-200 truncate group-hover:text-primary-300 transition-colors">
                {projectName}
              </span>
              <svg className={`w-3 h-3 text-surface-600 ml-auto shrink-0 transition-transform ${cwdPickerOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <p className="text-[10px] text-surface-600 mt-0.5 truncate pl-6">{displayPath}</p>
          </button>
          {cwdPickerOpen && activeSessionId && (
            <SidebarCwdPicker
              currentCwd={cwd}
              sessionId={activeSessionId}
              onClose={() => setCwdPickerOpen(false)}
              onRequestFileTree={onRequestFileTree}
            />
          )}
        </div>
      )}

      {/* New session button */}
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

      {/* Tab switcher — 5 tabs */}
      <div className="flex border-b border-surface-800/50">
        <button onClick={() => setSidebarTab('sessions')} className={tabClass('sessions')}>세션</button>
        <button onClick={() => { setSidebarTab('files'); if (tree.length === 0) onRequestFileTree(); }} className={tabClass('files')}>파일</button>
        <button onClick={() => setSidebarTab('prompts')} className={tabClass('prompts')}>프롬프트</button>
        <button onClick={() => setSidebarTab('pins')} className={tabClass('pins')}>핀보드</button>
        <button onClick={() => setSidebarTab('git')} className={tabClass('git')}>버전</button>
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
        ) : sidebarTab === 'files' ? (
          <div className="px-2">
            <Breadcrumb treeRoot={treeRoot} onNavigate={onRequestFileTree} />
            {tree.length === 0 ? (
              <p className="text-[13px] text-surface-700 px-2 py-6 text-center">파일 트리 로딩 중...</p>
            ) : (
              <FileTree
                entries={tree}
                onFileClick={onFileClick}
                onDirectoryClick={onDirectoryClick}
                onPinFile={onPinFile}
                onNewSessionInFolder={onNewSessionInFolder}
              />
            )}
          </div>
        ) : sidebarTab === 'prompts' ? (
          <div className="px-3">
            {onPromptAdd && (
              <button
                onClick={onPromptAdd}
                className="w-full flex items-center justify-center gap-1.5 py-2 mb-2 rounded-md border border-dashed border-surface-700 text-[11px] text-surface-600 hover:text-primary-400 hover:border-primary-500/50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                프롬프트 추가
              </button>
            )}
            {prompts.length === 0 ? (
              <p className="text-[12px] text-surface-700 px-2 py-6 text-center">
                저장된 프롬프트가 없습니다
              </p>
            ) : (
              <div className="space-y-0.5">
                {prompts.map((prompt) => (
                  <PromptItemComponent
                    key={prompt.id}
                    prompt={prompt}
                    onClick={(p) => onPromptClick?.(p)}
                    onEdit={(p) => onPromptEdit?.(p)}
                    onDelete={(id) => onPromptDelete?.(id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : sidebarTab === 'pins' ? (
          <PinList
            onPinClick={(pin) => onPinClick?.(pin)}
            onUnpin={(id) => onUnpinFile?.(id)}
          />
        ) : (
          <GitPanel onViewDiff={onViewDiff} />
        )}
      </div>

      <div className="p-4 border-t border-surface-800/50 flex items-center justify-between">
        <button
          onClick={onSettingsClick}
          className="flex items-center gap-2 text-surface-700 hover:text-surface-500 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <span className="text-[11px] font-medium">Settings</span>
        </button>
        <span className="text-[10px] font-semibold text-surface-800">v0.1.0</span>
      </div>
    </aside>
  );
}

/** Breadcrumb navigation for file tree root */
function Breadcrumb({ treeRoot, onNavigate }: { treeRoot: string; onNavigate: (path?: string) => void }) {
  if (!treeRoot) return null;

  // Replace /home/<user> with ~
  const display = treeRoot.replace(/^\/home\/[^/]+/, '~');
  const segments = display.split('/').filter(Boolean);

  // Build absolute path for each segment click
  const buildPath = (index: number): string => {
    // Reconstruct from original treeRoot segments
    const originalSegments = treeRoot.split('/').filter(Boolean);
    // If display starts with ~, first segment maps to /home/<user>
    if (display.startsWith('~')) {
      // index 0 = ~ = /home/<user>
      if (index === 0) {
        const homeMatch = treeRoot.match(/^\/home\/[^/]+/);
        return homeMatch ? homeMatch[0] : '/';
      }
      // index 1+ maps to originalSegments after the home dir parts
      const homeMatch = treeRoot.match(/^\/home\/[^/]+/);
      const homePrefix = homeMatch ? homeMatch[0] : '';
      const rest = treeRoot.slice(homePrefix.length).split('/').filter(Boolean);
      return homePrefix + '/' + rest.slice(0, index).join('/');
    }
    return '/' + originalSegments.slice(0, index + 1).join('/');
  };

  const parentPath = treeRoot.replace(/\/[^/]+\/?$/, '') || '/';

  return (
    <div className="flex items-center gap-0.5 px-1 py-1.5 mb-1 text-[11px] font-mono overflow-x-auto scrollbar-none">
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-surface-700 mx-0.5">/</span>}
          {i < segments.length - 1 ? (
            <button
              onClick={() => onNavigate(buildPath(i))}
              className="text-surface-600 hover:text-primary-400 transition-colors truncate max-w-[80px] shrink-0"
              title={buildPath(i)}
            >
              {seg}
            </button>
          ) : (
            <span className="text-gray-300 truncate max-w-[100px]">{seg}</span>
          )}
        </React.Fragment>
      ))}
      <button
        onClick={() => onNavigate(parentPath)}
        disabled={treeRoot === '/'}
        className="ml-1 p-0.5 rounded text-surface-600 hover:text-primary-400 hover:bg-surface-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        title="상위 디렉토리"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      </button>
    </div>
  );
}

/** Inline CWD picker for the project header */
function SidebarCwdPicker({ currentCwd, sessionId, onClose, onRequestFileTree }: {
  currentCwd: string;
  sessionId: string;
  onClose: () => void;
  onRequestFileTree: (path?: string) => void;
}) {
  const [browsePath, setBrowsePath] = useState(currentCwd);
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [inputValue, setInputValue] = useState(currentCwd);
  const [loading, setLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const sessions = useSessionStore((s) => s.sessions);

  const recentCwds = Array.from(new Set(sessions.map((s) => s.cwd).filter(Boolean)))
    .filter((c) => c !== currentCwd)
    .slice(0, 5);

  useEffect(() => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/api/directories?path=${encodeURIComponent(browsePath)}`, { headers })
      .then((r) => r.ok ? r.json() : { entries: [] })
      .then((data) => setDirs(data.entries || []))
      .catch(() => setDirs([]))
      .finally(() => setLoading(false));
  }, [browsePath]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const selectCwd = async (newCwd: string) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ cwd: newCwd }),
      });
      if (res.ok) {
        useSessionStore.getState().updateSessionMeta(sessionId, { cwd: newCwd });
        onRequestFileTree();
        onClose();
      } else {
        const err = await res.json();
        toastError(err.error || 'CWD 변경 실패');
      }
    } catch {
      toastError('CWD 변경 실패');
    }
  };

  const goUp = () => {
    const parent = browsePath.replace(/\/[^/]+\/?$/, '') || '/';
    setBrowsePath(parent);
    setInputValue(parent);
  };

  const handleInputSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      selectCwd(inputValue.trim());
    }
  };

  return (
    <div ref={pickerRef} className="absolute top-full left-0 right-0 mt-1 mx-2 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl z-50 overflow-hidden">
      {/* Manual input */}
      <div className="p-2 border-b border-surface-800">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputSubmit}
          className="w-full bg-surface-950 border border-surface-700 rounded-md px-3 py-1.5 text-[12px] text-gray-200 font-mono focus:outline-none focus:border-primary-500/50"
          placeholder="경로 입력 후 Enter"
        />
      </div>

      {/* Recent cwds */}
      {recentCwds.length > 0 && (
        <div className="px-2 py-1.5 border-b border-surface-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 px-1">최근</div>
          {recentCwds.map((c) => (
            <button
              key={c}
              onClick={() => selectCwd(c)}
              className="w-full text-left px-2 py-1 rounded text-[11px] text-gray-400 hover:bg-surface-800 hover:text-gray-200 truncate font-mono"
            >
              {c.replace(/^\/home\/[^/]+/, '~')}
            </button>
          ))}
        </div>
      )}

      {/* Directory browser */}
      <div className="max-h-48 overflow-y-auto">
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface-800">
          <button
            onClick={goUp}
            disabled={browsePath === '/'}
            className="p-1 rounded hover:bg-surface-800 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            title="상위 디렉토리"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </button>
          <span className="text-[11px] text-gray-500 font-mono truncate flex-1">{browsePath.replace(/^\/home\/[^/]+/, '~')}</span>
          <button
            onClick={() => selectCwd(browsePath)}
            className="text-[10px] px-2 py-0.5 rounded bg-primary-600/20 border border-primary-500/30 text-primary-300 hover:bg-primary-600/30"
          >
            선택
          </button>
        </div>
        {loading ? (
          <div className="py-4 text-center text-[11px] text-gray-500">로딩 중...</div>
        ) : dirs.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-gray-500">하위 디렉토리 없음</div>
        ) : (
          dirs.map((d) => (
            <button
              key={d.path}
              onClick={() => { setBrowsePath(d.path); setInputValue(d.path); }}
              onDoubleClick={() => selectCwd(d.path)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-800/60 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-yellow-500/60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
              <span className="text-[11px] text-gray-300 truncate">{d.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
