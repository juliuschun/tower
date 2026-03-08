import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { useFileStore } from '../../stores/file-store';
import { usePinStore, type Pin } from '../../stores/pin-store';
import { usePromptStore, type PromptItem } from '../../stores/prompt-store';
import { useProjectStore, type Project } from '../../stores/project-store';
import { SessionItem } from '../sessions/SessionItem';
import { FileTree } from '../files/FileTree';
import { PinList } from '../pinboard/PinList';
import { PromptItem as PromptItemComponent } from '../prompts/PromptItem';
import { toastError, toastSuccess } from '../../utils/toast';

interface SidebarProps {
  onNewSession: (projectId?: string) => void;
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
  onNewSessionInFolder?: (path: string) => void;
}

export function Sidebar({
  onNewSession, onSelectSession, onDeleteSession,
  onRenameSession, onToggleFavorite,
  onFileClick, onDirectoryClick, onRequestFileTree,
  onPinFile, onUnpinFile, onPinClick, onSettingsClick,
  onPromptClick, onPromptEdit, onPromptDelete, onPromptAdd,
  onNewSessionInFolder,
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

  const [fileTreeDragOver, setFileTreeDragOver] = useState(false);
  const fileTreeDragCounter = useRef(0);

  const [sharedWithMe, setSharedWithMe] = useState<{ id: string; file_path: string; owner_username: string }[]>([]);
  const [searchResults, setSearchResults] = useState<{ type: string; sessionId: string; sessionName: string; snippet: string }[] | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/shares/with-me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSharedWithMe(data); })
      .catch(() => {});
  }, []);

  // Debounced server-side FTS5 search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const tk = localStorage.getItem('token');
      const hdrs: Record<string, string> = {};
      if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, { headers: hdrs });
        if (res.ok) setSearchResults(await res.json());
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleFileTreeDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fileTreeDragCounter.current = 0;
    setFileTreeDragOver(false);
    if (e.dataTransfer.getData('application/x-attachment')) return;
    const files = e.dataTransfer.files;
    if (files.length === 0 || !treeRoot) return;
    const formData = new FormData();
    formData.append('targetDir', treeRoot);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: { error?: string }) => !r.error);
      const fail = data.results.filter((r: { error?: string }) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} file(s) failed`);
      onRequestFileTree();
    } catch {
      toastError('Upload failed');
    }
  };

  useEffect(() => {
    // Only request from server when tree is empty (skip if already loaded)
    if (sidebarTab === 'files' && tree.length === 0) {
      onRequestFileTree();
    }
  }, [sidebarTab]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const cwd = activeSession?.cwd || '';
  const projectName = cwd ? cwd.split('/').filter(Boolean).pop() || '/' : '';
  const displayPath = cwd.replace(/^\/home\/[^/]+/, '~');

  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);

  const projects = useProjectStore((s) => s.projects);
  const collapsedProjects = useProjectStore((s) => s.collapsedProjects);
  const toggleProjectCollapsed = useProjectStore((s) => s.toggleProjectCollapsed);

  // Filter and sort sessions: use FTS results when searching, otherwise favorites first + updatedAt
  const filteredSessions = useMemo(() => {
    if (searchResults) {
      const matchedIds = new Set(searchResults.map(r => r.sessionId));
      return sessions.filter(s => matchedIds.has(s.id));
    }
    return [...sessions].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [sessions, searchResults]);

  // Group sessions by project (only when not searching)
  const isSearching = !!searchResults || (searchQuery.trim().length >= 2);
  const groupedSessions = useMemo(() => {
    if (isSearching) return null; // flat list during search
    const projectGroups = new Map<string, { project: Project; sessions: SessionMeta[] }>();
    const ungrouped: SessionMeta[] = [];

    // Initialize ALL projects (even empty ones) so they always appear
    for (const proj of projects) {
      projectGroups.set(proj.id, { project: proj, sessions: [] });
    }

    for (const session of filteredSessions) {
      if (session.projectId) {
        const group = projectGroups.get(session.projectId);
        if (group) {
          group.sessions.push(session);
        } else {
          // Project was deleted but session still references it — treat as ungrouped
          ungrouped.push(session);
        }
      } else {
        ungrouped.push(session);
      }
    }

    const sorted = [...projectGroups.values()].sort((a, b) => {
      if (a.project.sortOrder !== b.project.sortOrder) return a.project.sortOrder - b.project.sortOrder;
      const aLatest = a.sessions[0]?.updatedAt || '';
      const bLatest = b.sessions[0]?.updatedAt || '';
      return bLatest.localeCompare(aLatest);
    });

    return { groups: sorted, ungrouped };
  }, [filteredSessions, projects, isSearching]);

  const handleMoveSession = async (sessionId: string, projectId: string | null) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/move`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        useSessionStore.getState().updateSessionMeta(sessionId, { projectId });
      } else {
        toastError('Failed to move session');
      }
    } catch {
      toastError('Failed to move session');
    }
  };

  const tabClass = (tab: string) =>
    `flex-1 py-2 text-[11px] font-semibold tracking-wide transition-colors ${
      sidebarTab === tab
        ? 'text-primary-400 border-b-2 border-primary-500'
        : 'text-gray-500 hover:text-gray-300'
    }`;

  return (
    <aside className="w-full bg-surface-900 border-r border-surface-800 flex flex-col h-full shrink-0">
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
          onClick={() => onNewSession()}
          className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-500 rounded-lg text-[13px] font-semibold text-white shadow-sm shadow-primary-900/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 ring-1 ring-white/10"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Tab switcher — 4 tabs */}
      <div className="flex border-b border-surface-800/50">
        <button onClick={() => setSidebarTab('sessions')} className={tabClass('sessions')}>Sessions</button>
        <button onClick={() => { setSidebarTab('files'); if (tree.length === 0) onRequestFileTree(); }} className={tabClass('files')}>Files</button>
        <button onClick={() => setSidebarTab('prompts')} className={tabClass('prompts')}>Prompts</button>
        <button onClick={() => setSidebarTab('pins')} className={tabClass('pins')}>Pins</button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pt-2">
        {sidebarTab === 'sessions' ? (
          <div className="px-3">
            {/* Search + New Project */}
            <div className="flex items-center gap-1.5 mb-2">
              <div className="relative flex-1">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-800 border border-surface-700 rounded-md text-[12px] text-gray-300 pl-8 pr-3 py-1.5 placeholder-surface-700 outline-none focus:border-primary-500/50 transition-colors"
                />
              </div>
              <NewProjectButton />
            </div>

            {/* Grouped or flat session list */}
            {groupedSessions && !isSearching ? (
              <>
                {/* Project groups */}
                {groupedSessions.groups.map(({ project, sessions: groupSessions }) => (
                  <ProjectGroup
                    key={project.id}
                    project={project}
                    sessions={groupSessions}
                    collapsed={collapsedProjects.has(project.id)}
                    activeSessionId={activeSessionId}
                    onToggleCollapsed={() => toggleProjectCollapsed(project.id)}
                    onSelectSession={onSelectSession}
                    onDeleteSession={onDeleteSession}
                    onRenameSession={onRenameSession}
                    onToggleFavorite={onToggleFavorite}
                    onNewSession={() => onNewSession(project.id)}
                    onMoveSession={handleMoveSession}
                    projects={projects}
                  />
                ))}
                {/* Ungrouped sessions — also a drop zone to remove from project */}
                {(groupedSessions.ungrouped.length > 0 || groupedSessions.groups.length > 0) && (
                  <UngroupedDropZone onMoveSession={handleMoveSession} hasGroups={groupedSessions.groups.length > 0} hasUngrouped={groupedSessions.ungrouped.length > 0}>
                    {groupedSessions.groups.length > 0 && (
                      <div className="flex items-center gap-2 px-1 py-1 mb-1">
                        <div className="flex-1 h-px bg-surface-800" />
                        <span className="text-[10px] text-surface-600 uppercase tracking-wider font-medium shrink-0">Ungrouped</span>
                        <div className="flex-1 h-px bg-surface-800" />
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {groupedSessions.ungrouped.map((session) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          isActive={session.id === activeSessionId}
                          onSelect={onSelectSession}
                          onDelete={onDeleteSession}
                          onRename={onRenameSession}
                          onToggleFavorite={onToggleFavorite}
                          onMoveToProject={handleMoveSession}
                          projects={projects}
                        />
                      ))}
                    </div>
                  </UngroupedDropZone>
                )}
                {filteredSessions.length === 0 && (
                  <p className="text-[13px] text-surface-700 px-2 py-6 text-center">No sessions yet</p>
                )}
              </>
            ) : (
              <>
                {filteredSessions.length === 0 && (
                  <p className="text-[13px] text-surface-700 px-2 py-6 text-center">
                    {searchQuery ? 'No results found' : 'No sessions yet'}
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
                      onMoveToProject={handleMoveSession}
                      projects={projects}
                    />
                  ))}
                </div>
              </>
            )}
            {/* Message search snippets */}
            {searchResults && searchResults.filter(r => r.type === 'message').length > 0 && (
              <div className="mt-2 border-t border-surface-800/50 pt-2">
                <div className="text-[10px] text-surface-600 uppercase tracking-wider font-medium mb-1 px-1">Messages</div>
                <div className="space-y-0.5">
                  {searchResults.filter(r => r.type === 'message').map((r, i) => {
                    const target = sessions.find(s => s.id === r.sessionId);
                    if (!target) return null;
                    return (
                      <button
                        key={i}
                        onClick={() => onSelectSession(target)}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-800/60 transition-colors"
                      >
                        <span className="text-[11px] text-gray-400">{r.sessionName}</span>
                        <p className="text-[10px] text-surface-600 truncate mt-0.5">{r.snippet}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : sidebarTab === 'files' ? (
          <div
            className={`px-2 min-h-full ${fileTreeDragOver ? 'bg-primary-900/10 ring-1 ring-inset ring-primary-500/30 rounded' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); fileTreeDragCounter.current++; if (fileTreeDragCounter.current === 1) setFileTreeDragOver(true); }}
            onDragLeave={(e) => { e.stopPropagation(); fileTreeDragCounter.current--; if (fileTreeDragCounter.current === 0) setFileTreeDragOver(false); }}
            onDrop={handleFileTreeDrop}
          >
            <FileTreeToolbar treeRoot={treeRoot} onRefresh={() => onRequestFileTree()} />
            <Breadcrumb treeRoot={treeRoot} onNavigate={onRequestFileTree} />
            {fileTreeDragOver && (
              <div className="flex items-center justify-center py-4 text-[12px] text-primary-400 gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload to {treeRoot ? treeRoot.replace(/^\/home\/[^/]+/, '~') : 'root'}
              </div>
            )}
            {!fileTreeDragOver && tree.length === 0 && (
              <p className="text-[13px] text-gray-500 px-2 py-6 text-center">Loading file tree...</p>
            )}
            {!fileTreeDragOver && tree.length > 0 && (
              <FileTree
                entries={tree}
                onFileClick={onFileClick}
                onDirectoryClick={onDirectoryClick}
                onPinFile={onPinFile}
                onNewSessionInFolder={onNewSessionInFolder}
                onRefreshTree={() => onRequestFileTree()}
              />
            )}
            {sharedWithMe.length > 0 && (
              <div className="mt-3 px-2">
                <div className="text-[10px] text-gray-600 uppercase tracking-wide font-medium mb-1.5 px-1">
                  나와 공유됨
                </div>
                <div className="space-y-0.5">
                  {sharedWithMe.map(s => (
                    <button
                      key={s.id}
                      onClick={() => onFileClick(s.file_path)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-gray-400 hover:text-white hover:bg-surface-700/50 transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 text-green-500/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      <span className="truncate flex-1">{s.file_path.split('/').pop()}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">@{s.owner_username}</span>
                    </button>
                  ))}
                </div>
              </div>
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
                Add Prompt
              </button>
            )}
            {prompts.length === 0 ? (
              <p className="text-[12px] text-surface-700 px-2 py-6 text-center">
                No saved prompts
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
        ) : (
          <PinList
            onPinClick={(pin) => onPinClick?.(pin)}
            onUnpin={(id) => onUnpinFile?.(id)}
          />
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
        title="Parent directory"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      </button>
    </div>
  );
}

/** File tree toolbar: new file, new folder, upload, refresh */
function FileTreeToolbar({ treeRoot, onRefresh }: { treeRoot: string; onRefresh: () => void }) {
  const [showInput, setShowInput] = useState<'file' | 'folder' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput) inputRef.current?.focus();
  }, [showInput]);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const handleSubmit = async (value: string) => {
    if (!value.trim()) { setShowInput(null); return; }
    const endpoint = showInput === 'folder' ? '/api/files/mkdir' : '/api/files/create';
    const fullPath = `${treeRoot}/${value.trim()}`;
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ path: fullPath }) });
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Creation failed'); return; }
      toastSuccess(`${value.trim()} created`);
      onRefresh();
    } catch { toastError('Creation failed'); }
    setShowInput(null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const formData = new FormData();
    formData.append('targetDir', treeRoot);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: { error?: string }) => !r.error);
      const fail = data.results.filter((r: { error?: string }) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} file(s) failed`);
      onRefresh();
    } catch { toastError('Upload failed'); }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!treeRoot) return null;

  const btnClass = 'p-1 rounded text-surface-600 hover:text-primary-400 hover:bg-surface-800 transition-colors';

  return (
    <div className="px-1 pt-1">
      <div className="flex items-center gap-0.5">
        <button onClick={() => setShowInput(showInput === 'file' ? null : 'file')} className={btnClass} title="New file">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
        <button onClick={() => setShowInput(showInput === 'folder' ? null : 'folder')} className={btnClass} title="New folder">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        </button>
        <button onClick={() => fileInputRef.current?.click()} className={btnClass} title="Upload files">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
        <div className="flex-1" />
        <button onClick={onRefresh} className={btnClass} title="Refresh">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      {showInput && (
        <div className="mt-1 px-0.5">
          <input
            ref={inputRef}
            type="text"
            placeholder={showInput === 'file' ? 'Enter file name...' : 'Enter folder name...'}
            className="w-full bg-surface-950 border border-primary-500/50 rounded px-2 py-1 text-[11px] text-gray-200 outline-none placeholder-surface-700"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setShowInput(null);
            }}
            onBlur={() => setShowInput(null)}
          />
        </div>
      )}
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
        toastError(err.error || 'Failed to change CWD');
      }
    } catch {
      toastError('Failed to change CWD');
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
          placeholder="Enter path and press Enter"
        />
      </div>

      {/* Recent cwds */}
      {recentCwds.length > 0 && (
        <div className="px-2 py-1.5 border-b border-surface-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 px-1">Recent</div>
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
            title="Parent directory"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </button>
          <span className="text-[11px] text-gray-500 font-mono truncate flex-1">{browsePath.replace(/^\/home\/[^/]+/, '~')}</span>
          <button
            onClick={() => selectCwd(browsePath)}
            className="text-[10px] px-2 py-0.5 rounded bg-primary-600/20 border border-primary-500/30 text-primary-300 hover:bg-primary-600/30"
          >
            Select
          </button>
        </div>
        {loading ? (
          <div className="py-4 text-center text-[11px] text-gray-500">Loading...</div>
        ) : dirs.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-gray-500">No subdirectories</div>
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

/* ── Ungrouped Drop Zone ── */

function UngroupedDropZone({ children, onMoveSession, hasGroups, hasUngrouped }: {
  children: React.ReactNode;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  hasGroups: boolean;
  hasUngrouped: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`mt-2 rounded-md transition-colors ${dragOver ? 'bg-surface-800/50 ring-1 ring-surface-700/50' : ''} ${!hasUngrouped && hasGroups ? 'min-h-[40px] flex items-center justify-center' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const sessionId = e.dataTransfer.getData('text/plain');
        if (sessionId) onMoveSession(sessionId, null);
      }}
    >
      {!hasUngrouped && dragOver && (
        <span className="text-[10px] text-surface-500">Drop here to remove from project</span>
      )}
      {children}
    </div>
  );
}

/* ── Project Group ── */

const PROJECT_PREVIEW_COUNT = 5;

function ProjectGroup({
  project, sessions: groupSessions, collapsed, activeSessionId,
  onToggleCollapsed, onSelectSession, onDeleteSession, onRenameSession,
  onToggleFavorite, onNewSession, onMoveSession, projects,
}: {
  project: Project;
  sessions: SessionMeta[];
  collapsed: boolean;
  activeSessionId: string | null;
  onToggleCollapsed: () => void;
  onSelectSession: (s: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleFavorite: (id: string, fav: boolean) => void;
  onNewSession: () => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  projects: Project[];
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  // Check if any session in this project is actively streaming or unread
  const streamingSessions = useSessionStore((s) => s.streamingSessions);
  const unreadSessions = useSessionStore((s) => s.unreadSessions);
  const hasActivity = groupSessions.some((s) => streamingSessions.has(s.id));
  const hasUnread = groupSessions.some((s) => unreadSessions.has(s.id));

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const sessionId = e.dataTransfer.getData('text/plain');
    if (sessionId) onMoveSession(sessionId, project.id);
  };

  const commitRename = async () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.name) {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH', headers, body: JSON.stringify({ name: trimmed }),
        });
        if (res.ok) {
          useProjectStore.getState().updateProject(project.id, { name: trimmed });
        }
      } catch {}
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE', headers });
      if (res.ok) {
        useProjectStore.getState().removeProject(project.id);
        // Locally clear projectId on affected sessions
        for (const s of groupSessions) {
          useSessionStore.getState().updateSessionMeta(s.id, { projectId: null });
        }
        toastSuccess(`Project "${project.name}" deleted`);
      }
    } catch {}
  };


  return (
    <div className="mb-1">
      {/* Group header — also a drop zone */}
      <div
        className={`flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer transition-colors group/proj ${
          dragOver ? 'bg-primary-600/20 ring-1 ring-primary-500/40' : 'hover:bg-surface-850'
        }`}
        onClick={onToggleCollapsed}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(project.name); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <svg className={`w-3.5 h-3.5 text-surface-600 transition-transform shrink-0 ${collapsed ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {hasActivity ? (
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shrink-0" />
        ) : (
          <svg className="w-4 h-4 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        )}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={editRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-[22px] bg-surface-700 text-gray-100 text-[13px] px-1 rounded border border-surface-600 outline-none focus:border-primary-500"
            />
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className={`text-[13px] font-bold truncate ${hasUnread || hasActivity ? 'text-gray-100' : 'text-gray-300'}`}>
                  {project.name}
                </span>
                <span className={`text-[10px] tabular-nums shrink-0 ${hasUnread ? 'text-primary-400 font-semibold' : 'text-surface-600'}`}>
                  {groupSessions.length}
                </span>
              </div>
              {/* Subline: New Chat + N more */}
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); onNewSession(); }}
                  className="text-[10px] text-primary-400 hover:text-primary-300 transition-colors font-medium"
                  title="New Chat in project"
                >
                  + New Chat
                </button>
                {groupSessions.length > PROJECT_PREVIEW_COUNT && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    className="text-[10px] text-surface-600 hover:text-primary-400 transition-colors"
                  >
                    {expanded ? 'show less' : `${groupSessions.length - PROJECT_PREVIEW_COUNT} more`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sessions inside group */}
      {!collapsed && (() => {
        const visibleSessions = expanded ? groupSessions : groupSessions.slice(0, PROJECT_PREVIEW_COUNT);
        return (
          <div className="pl-5 space-y-0.5">
            {visibleSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={onSelectSession}
                onDelete={onDeleteSession}
                onRename={onRenameSession}
                onToggleFavorite={onToggleFavorite}
                onMoveToProject={onMoveSession}
                projects={projects}
              />
            ))}
          </div>
        );
      })()}

      {/* Context menu */}
      {ctxMenu && (
        <ProjectContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          project={project}
          onRename={() => { setEditing(true); setEditName(project.name); }}
          onDelete={handleDelete}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

/* ── Project Context Menu ── */

function ProjectContextMenu({ x, y, project, onRename, onDelete, onClose }: {
  x: number; y: number; project: Project;
  onRename: () => void; onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  if (showSettings) {
    return (
      <div ref={ref} className="fixed z-50" style={{ left: x, top: y }}>
        <ProjectSettingsPanel project={project} onClose={onClose} />
      </div>
    );
  }

  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: x, top: y }}>
      <button className={itemClass} onClick={() => { onRename(); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Rename
      </button>
      {/* Settings */}
      <button className={itemClass} onClick={() => setShowSettings(true)}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Settings
      </button>
      <div className="border-t border-surface-700/50 my-1" />
      <button className={`${itemClass} !text-red-400 hover:!bg-red-950/30`} onClick={() => { onDelete(); onClose(); }}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete Project
      </button>
    </div>
  );
}

/* ── Project Settings Panel ── */

function ProjectSettingsPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const [description, setDescription] = useState(project.description || '');
  const [rootPath, setRootPath] = useState(project.rootPath || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const body: Record<string, any> = {};
      if (description !== (project.description || '')) body.description = description || null;
      if (rootPath !== (project.rootPath || '')) body.rootPath = rootPath || null;
      if (Object.keys(body).length > 0) {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH', headers, body: JSON.stringify(body),
        });
        if (res.ok) {
          const updated = await res.json();
          useProjectStore.getState().updateProject(project.id, updated);
          toastSuccess('Project updated');
        } else {
          toastError('Failed to update project');
        }
      }
    } catch {
      toastError('Failed to update project');
    }
    setSaving(false);
    onClose();
  };

  const labelClass = "text-[10px] text-surface-500 uppercase tracking-wider font-medium mb-1";
  const inputClass = "w-full bg-surface-700 border border-surface-600 rounded text-[12px] text-gray-200 px-2.5 py-1.5 placeholder-surface-600 outline-none focus:border-primary-500/50";

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg shadow-xl p-3 min-w-[280px] max-w-[320px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-gray-200">{project.name}</h3>
        <button onClick={onClose} className="text-surface-600 hover:text-gray-300 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Description */}
      <div className="mb-3">
        <div className={labelClass}>Description</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project about?"
          rows={2}
          className={`${inputClass} resize-none`}
        />
        <p className="text-[9px] text-surface-600 mt-0.5">Also saved to CLAUDE.md in the project folder</p>
      </div>

      {/* Root Path */}
      <div className="mb-3">
        <div className={labelClass}>Project Folder</div>
        <input
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
          placeholder="Auto-created in workspace/projects/"
          className={inputClass}
        />
        <p className="text-[9px] text-surface-600 mt-0.5">New chats will work in this folder. Leave empty for default.</p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1 text-[11px] text-surface-500 hover:text-gray-300 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 rounded text-[11px] font-medium text-white transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ── New Project Button ── */

function NewProjectButton() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (!creating) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setName(''); setCreating(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [creating]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setCreating(false); return; }
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
        toastSuccess(`Project "${trimmed}" created`);
      } else {
        toastError('Failed to create project');
      }
    } catch {
      toastError('Failed to create project');
    }
    setName('');
    setCreating(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setCreating(!creating)}
        className="p-1.5 rounded-md text-surface-600 hover:text-primary-400 hover:bg-surface-800 transition-colors shrink-0"
        title="New Project"
        aria-label="New Project"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
      </button>
      {creating && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl p-2 min-w-[200px]">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setName(''); setCreating(false); }
            }}
            placeholder="Project name..."
            className="w-full bg-surface-700 border border-surface-600 rounded text-[12px] text-gray-200 px-2.5 py-1.5 placeholder-surface-600 outline-none focus:border-primary-500/50"
          />
          <p className="text-[10px] text-surface-600 mt-1.5 px-0.5">Creates a folder with CLAUDE.md for project context</p>
        </div>
      )}
    </div>
  );
}
