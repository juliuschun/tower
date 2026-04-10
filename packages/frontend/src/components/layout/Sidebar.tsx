import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { useFileStore, type FileEntry } from '../../stores/file-store';
import { type Pin } from '../../stores/pin-store';
import { usePromptStore, type PromptItem } from '../../stores/prompt-store';
import { useProjectStore, type Project } from '../../stores/project-store';
import { useSpaceStore } from '../../stores/space-store';
import { SpaceFilter } from './SpaceFilter';
import { SessionItem } from '../sessions/SessionItem';
import { FileTree } from '../files/FileTree';
import { SelectionToolbar } from '../files/SelectionToolbar';
import { PinList } from '../pinboard/PinList';
import { PromptItem as PromptItemComponent } from '../prompts/PromptItem';
import { toastError, toastSuccess } from '../../utils/toast';
import { useRoomStore } from '../../stores/room-store';
import { RoomList } from '../rooms/RoomList';
import { HistoryPanel } from '../history/HistoryPanel';

/* ── Filter Chip ── */
function FilterChip({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
        active
          ? 'bg-primary-600/20 text-primary-400 ring-1 ring-primary-500/30'
          : 'text-surface-600 hover:text-gray-400 hover:bg-surface-800'
      }`}
      title={title}
    >
      {children}
    </button>
  );
}

function FilterMenuItem({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors ${
        active
          ? 'text-primary-400 bg-primary-500/10'
          : 'text-gray-400 hover:bg-surface-700 hover:text-gray-300'
      }`}
    >
      <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${
        active ? 'border-primary-400 bg-primary-500/20 text-primary-300' : 'border-surface-600'
      }`}>
        {active ? '✓' : ''}
      </span>
      {children}
    </button>
  );
}

/* ── Stats Bar — running / done / 7-day pace ── */
function StatsBar({ sessions }: { sessions: SessionMeta[] }) {
  const streamingSessions = useSessionStore((s) => s.streamingSessions);
  const unreadSessions = useSessionStore((s) => s.unreadSessions);

  const runningCount = streamingSessions.size;
  // Done = recently completed (unread) but NOT currently running
  const doneCount = React.useMemo(() => {
    let count = 0;
    unreadSessions.forEach(id => { if (!streamingSessions.has(id)) count++; });
    return count;
  }, [unreadSessions, streamingSessions]);

  // 7-day session count
  const weekCount = React.useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return sessions.filter(s => {
      const t = new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime();
      return t > cutoff;
    }).length;
  }, [sessions]);

  // Nothing to show? Hide entirely
  if (runningCount === 0 && doneCount === 0 && weekCount === 0) return null;

  return (
    <div className="flex items-center gap-2.5 pb-1.5 px-0.5">
      {runningCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {runningCount} running
        </span>
      )}
      {doneCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {doneCount} done
        </span>
      )}
      {weekCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-surface-600">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          {weekCount} / 7d
        </span>
      )}
    </div>
  );
}

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
  onCollapseSidebar?: () => void;
}

export function Sidebar({
  onNewSession, onSelectSession, onDeleteSession,
  onRenameSession, onToggleFavorite,
  onFileClick, onDirectoryClick, onRequestFileTree,
  onPinFile, onUnpinFile, onPinClick, onSettingsClick,
  onPromptClick, onPromptEdit, onPromptDelete, onPromptAdd,
  onNewSessionInFolder, onCollapseSidebar,
}: SidebarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sidebarTab = useSessionStore((s) => s.sidebarTab);
  const setSidebarTab = useSessionStore((s) => s.setSidebarTab);
  const searchQuery = useSessionStore((s) => s.searchQuery);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);
  // Filter chip states (persisted to localStorage)
  const [filterLabels, setFilterLabels] = useState(() => localStorage.getItem('sidebar-filter-labels') === 'true');
  const [filterMy, setFilterMy] = useState(() => localStorage.getItem('sidebar-filter-my') === 'true');
  const [filterFav, setFilterFav] = useState(() => localStorage.getItem('sidebar-filter-fav') === 'true');
  const [filterDone, setFilterDone] = useState(() => localStorage.getItem('sidebar-filter-done') === 'true');
  const [filterOpen, setFilterOpen] = useState(false);
  const unreadSessions = useSessionStore((s) => s.unreadSessions);
  const streamingSessions = useSessionStore((s) => s.streamingSessions);

  const toggleFilter = (key: string, value: boolean, setter: (v: boolean) => void) => {
    const next = !value;
    setter(next);
    localStorage.setItem(`sidebar-filter-${key}`, String(next));
  };

  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const [ungroupedExpanded, setUngroupedExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const tree = useFileStore((s) => s.tree);
  const treeRoot = useFileStore((s) => s.treeRoot);

  const prompts = usePromptStore((s) => s.prompts);

  // pgEnabled / unreadCounts moved to Header NavTabs

  const currentUsername = useMemo(() => localStorage.getItem('username') || undefined, []);

  const [fileTreeDragOver, setFileTreeDragOver] = useState(false);
  const fileTreeDragCounter = useRef(0);

  const [sharedWithMe, setSharedWithMe] = useState<{ id: string; file_path: string; owner_username: string }[]>([]);
  const [searchResults, setSearchResults] = useState<{ type: string; sessionId: string; sessionName: string; snippet: string }[] | null>(null);

  // Clear search helper — clears both query and results in one shot
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults(null);
  }, [setSearchQuery]);

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
    if (files.length === 0) return;

    // Fallback: use active session cwd or request tree root if treeRoot is empty
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    const uploadDir = treeRoot || activeSession?.cwd || '';
    if (!uploadDir) {
      toastError('Upload target not ready. Open the Files tab first, then try again.');
      return;
    }

    const formData = new FormData();
    formData.append('targetDir', uploadDir);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || `Upload failed (${res.status})`); return; }
      const ok = data.results.filter((r: { error?: string }) => !r.error);
      const fail = data.results.filter((r: { error?: string }) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} file(s) failed: ${fail.map((f: { name: string; error?: string }) => `${f.name}: ${f.error}`).join(', ')}`);
      onRequestFileTree();
    } catch (err) {
      console.error('[sidebar] File upload error:', err);
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
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
  // cwd-related display removed (CWD picker moved out of sidebar)

  const allProjects = useProjectStore((s) => s.projects);
  const collapsedProjects = useProjectStore((s) => s.collapsedProjects);
  const toggleProjectCollapsed = useProjectStore((s) => s.toggleProjectCollapsed);
  const collapsedLabels = useProjectStore((s) => s.collapsedLabels);
  const toggleLabelCollapsed = useProjectStore((s) => s.toggleLabelCollapsed);
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);

  // Filter projects by active space (for sidebar grouping)
  const projects = useMemo(() => {
    if (activeSpaceId === null) return allProjects;
    return allProjects.filter(p => p.spaceId === activeSpaceId);
  }, [allProjects, activeSpaceId]);

  // All projects — for "Move to project" context menu (no space filter)
  const allProjectsForMove = allProjects;

  // Filter and sort sessions: use FTS results when searching, otherwise favorites first + updatedAt
  const filteredSessions = useMemo(() => {
    let result: SessionMeta[];
    if (searchResults) {
      const matchedIds = new Set(searchResults.map(r => r.sessionId));
      result = sessions.filter(s => matchedIds.has(s.id));
    } else {
      result = [...sessions].sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    // Apply filter chips
    if (filterMy && currentUsername) {
      result = result.filter(s => s.ownerUsername === currentUsername);
    }
    if (filterFav) {
      result = result.filter(s => s.favorite);
    }
    if (filterDone) {
      const streaming = useSessionStore.getState().streamingSessions;
      result = result.filter(s => unreadSessions.has(s.id) && !streaming.has(s.id));
    }
    return result;
  }, [sessions, searchResults, filterMy, filterFav, filterDone, currentUsername, unreadSessions]);

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
      // Most-recently-active project first — compare as Date to handle
      // mixed timestamp formats (ISO "2026-03-09T09:25:07Z" vs SQLite "2026-03-09 10:38:33")
      const toMs = (sessions: SessionMeta[]) =>
        sessions.reduce((max, s) => {
          const t = new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime();
          return t > max ? t : max;
        }, 0);
      const aMs = a.sessions.length ? toMs(a.sessions) : 0;
      const bMs = b.sessions.length ? toMs(b.sessions) : 0;
      // Projects with sessions always before empty ones
      if (aMs && !bMs) return -1;
      if (!aMs && bMs) return 1;
      if (aMs && bMs) return bMs - aMs;
      // Both empty — fall back to sortOrder
      return a.project.sortOrder - b.project.sortOrder;
    });

    return { groups: sorted, ungrouped };
  }, [filteredSessions, projects, isSearching]);

  // Projects sorted by most-recent session activity (reused for Files tab)
  const projectsSortedByActivity = useMemo(() => {
    if (!groupedSessions) return projects;
    const orderMap = new Map<string, number>();
    groupedSessions.groups.forEach((g, i) => orderMap.set(g.project.id, i));
    return [...projects].sort((a, b) => {
      const aIdx = orderMap.get(a.id) ?? 9999;
      const bIdx = orderMap.get(b.id) ?? 9999;
      return aIdx - bIdx;
    });
  }, [projects, groupedSessions]);

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
        const data = await res.json().catch(() => ({}));
        toastError(data.error || `Failed to move session (${res.status})`);
      }
    } catch {
      toastError('Failed to move session');
    }
  };

  // tabClass removed — tabs moved to Header

  return (
    <aside className="w-full bg-surface-900 border-r border-surface-800 flex flex-col h-full shrink-0">
      {/* Sidebar header — collapse button + context label (tabs moved to Header) */}
      {(sidebarTab === 'pins' || sidebarTab === 'history') ? (
        <div className="flex items-center border-b border-surface-800/50 px-3 py-1.5 gap-2">
          <button
            onClick={() => setSidebarTab('sessions')}
            className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="text-[12px] font-semibold text-gray-300">
            {sidebarTab === 'pins' ? 'Pins' : 'History'}
          </span>
          <div className="flex-1" />
          {onCollapseSidebar && (
            <button onClick={onCollapseSidebar} className="p-1 text-surface-600 hover:text-gray-400 transition-colors" title="Hide sidebar">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      ) : sidebarTab === 'sessions' ? (
        /* ── Unified sessions toolbar: Inbox · + New · Filter · Collapse ── */
        <div className="flex items-center border-b border-surface-800/50 px-2 py-1 gap-0.5">
          {(() => {
            const doneCount = [...unreadSessions].filter(
              (id) => !streamingSessions.has(id)
            ).length;
            return (
              <button
                onClick={() => {
                  useSessionStore.getState().setActiveView('inbox');
                  if (useSessionStore.getState().isMobile) {
                    useSessionStore.getState().setSidebarOpen(false);
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-surface-850 active:bg-surface-800 transition-colors group/inbox"
                title="Inbox"
              >
                <svg className={`w-3.5 h-3.5 shrink-0 transition-colors ${doneCount > 0 ? 'text-primary-400' : 'text-surface-600 group-hover/inbox:text-surface-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
                <span className={`text-[14px] font-semibold transition-colors ${doneCount > 0 ? 'text-gray-300' : 'text-surface-500 group-hover/inbox:text-surface-400'}`}>Inbox</span>
                {doneCount > 0 && (
                  <span className="text-[14px] font-bold text-primary-400 bg-primary-500/15 rounded-full px-1.5 py-px leading-tight">
                    {doneCount}
                  </span>
                )}
              </button>
            );
          })()}
          <button
            onClick={() => onNewSession(activeSession?.projectId || undefined)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-surface-850 active:bg-surface-800 transition-colors group/new"
            title="New chat"
          >
            <svg className="w-3.5 h-3.5 text-surface-600 group-hover/new:text-surface-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-[14px] font-semibold text-surface-500 group-hover/new:text-surface-400 transition-colors">New</span>
          </button>
          <div className="flex-1" />
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`p-1.5 rounded-md transition-colors ${
                (filterMy || filterFav || filterDone || filterLabels)
                  ? 'text-primary-400 bg-primary-500/10'
                  : 'text-surface-600 hover:text-surface-400 hover:bg-surface-850'
              }`}
              title="Filters"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[140px]">
                  <FilterMenuItem active={filterMy} onClick={() => { toggleFilter('my', filterMy, setFilterMy); }}>
                    👤 My sessions
                  </FilterMenuItem>
                  <FilterMenuItem active={filterFav} onClick={() => { toggleFilter('fav', filterFav, setFilterFav); }}>
                    ⭐ Favorites
                  </FilterMenuItem>
                  <FilterMenuItem active={filterDone} onClick={() => { toggleFilter('done', filterDone, setFilterDone); }}>
                    ✓ Done
                  </FilterMenuItem>
                  <FilterMenuItem active={filterLabels} onClick={() => { toggleFilter('labels', filterLabels, setFilterLabels); }}>
                    📁 Decks
                  </FilterMenuItem>
                </div>
              </>
            )}
          </div>
          {onCollapseSidebar && (
            <button onClick={onCollapseSidebar} className="p-1.5 text-surface-600 hover:text-surface-400 hover:bg-surface-850 rounded-md transition-colors" title="Hide sidebar">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center border-b border-surface-800/50 px-3 py-1.5">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex-1">
            {sidebarTab === 'rooms' ? 'Channels' : 'Files'}
          </span>
          {onCollapseSidebar && (
            <button onClick={onCollapseSidebar} className="p-1 text-surface-600 hover:text-gray-400 transition-colors" title="Hide sidebar">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Tab content */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        onDragOver={(e) => {
          // Auto-scroll when dragging near top/bottom edges
          const container = scrollContainerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const EDGE = 40;
          const SPEED = 8;
          if (y < EDGE) {
            container.scrollTop -= SPEED;
          } else if (y > rect.height - EDGE) {
            container.scrollTop += SPEED;
          }
        }}
      >
        {sidebarTab === 'sessions' ? (
          <div>
            <div className="px-3">
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
                    currentUsername={currentUsername}
                    showLabels={filterLabels}
                    onToggleCollapsed={() => toggleProjectCollapsed(project.id)}
                    onSelectSession={onSelectSession}
                    onDeleteSession={onDeleteSession}
                    onRenameSession={onRenameSession}
                    onToggleFavorite={onToggleFavorite}
                    onNewSession={() => onNewSession(project.id)}
                    onMoveSession={handleMoveSession}
                    projects={allProjectsForMove}
                  />
                ))}
                {/* temp — ungrouped sessions as a label-like subfolder */}
                {groupedSessions.ungrouped.length > 0 && (
                  <UngroupedDropZone onMoveSession={handleMoveSession} hasGroups={groupedSessions.groups.length > 0} hasUngrouped={groupedSessions.ungrouped.length > 0}>
                    <button
                      onClick={() => setUngroupedCollapsed(!ungroupedCollapsed)}
                      className="w-full flex items-center gap-1.5 px-1 py-1 mb-0.5 group"
                    >
                      <svg className={`w-3 h-3 text-surface-600 transition-transform ${ungroupedCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <svg className="w-3 h-3 text-surface-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      <span className="text-[10px] text-surface-600 font-medium shrink-0">
                        temp
                      </span>
                      <span className="text-[9px] text-surface-700">({groupedSessions.ungrouped.length})</span>
                      <div className="flex-1" />
                    </button>
                    {!ungroupedCollapsed && (
                      <div className="space-y-0.5 pl-2">
                        {(ungroupedExpanded
                          ? groupedSessions.ungrouped
                          : groupedSessions.ungrouped.slice(0, getPreviewCount(groupedSessions.ungrouped))
                        ).map((session) => (
                          <SessionItem
                            key={session.id}
                            session={session}
                            isActive={session.id === activeSessionId}
                            currentUsername={currentUsername}
                            onSelect={onSelectSession}
                            onDelete={onDeleteSession}
                            onRename={onRenameSession}
                            onToggleFavorite={onToggleFavorite}
                            onMoveToProject={handleMoveSession}
                            projects={allProjectsForMove}
                          />
                        ))}
                        {groupedSessions.ungrouped.length > getPreviewCount(groupedSessions.ungrouped) && (
                          <button
                            onClick={() => setUngroupedExpanded(!ungroupedExpanded)}
                            className="w-full text-center py-1 text-[11px] text-surface-600 hover:text-gray-400 transition-colors"
                          >
                            {ungroupedExpanded ? 'Show less' : `Show all ${groupedSessions.ungrouped.length}`}
                          </button>
                        )}
                      </div>
                    )}
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
                {/* Flat list — group by deck when filterLabels on and not searching */}
                {(() => {
                  const applyLabel = (sessionId: string, label: string | null) => {
                    useSessionStore.getState().updateSessionMeta(sessionId, { label });
                    const token = localStorage.getItem('token');
                    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    fetch(`/api/sessions/${sessionId}`, { method: 'PATCH', headers, body: JSON.stringify({ label }) }).catch(() => {});
                  };

                  if (!isSearching && filterLabels) {
                    // Group by label
                    const labelGroups = new Map<string, SessionMeta[]>();
                    const unlabeled: SessionMeta[] = [];
                    for (const s of filteredSessions) {
                      if (s.label) {
                        const list = labelGroups.get(s.label) || [];
                        list.push(s);
                        labelGroups.set(s.label, list);
                      } else {
                        unlabeled.push(s);
                      }
                    }
                    const sortedLabels = [...labelGroups.entries()].sort((a, b) => {
                      const tA = Math.max(...a[1].map(s => new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime()));
                      const tB = Math.max(...b[1].map(s => new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime()));
                      return tB - tA;
                    });

                    if (sortedLabels.length === 0 && unlabeled.length === 0) return null;

                    return (
                      <div className="space-y-0.5">
                        {sortedLabels.map(([label, labelSessions]) => {
                          const labelKey = `flat::${label}`;
                          const isCollapsed = collapsedLabels.has(labelKey);
                          return (
                            <LabelGroup
                              key={label}
                              label={label}
                              sessions={labelSessions}
                              isCollapsed={isCollapsed}
                              onToggle={() => toggleLabelCollapsed('flat', label)}
                              onDropSession={(sessionId) => applyLabel(sessionId, label)}
                              activeSessionId={activeSessionId}
                              currentUsername={currentUsername}
                              onSelectSession={onSelectSession}
                              onDeleteSession={onDeleteSession}
                              onRenameSession={onRenameSession}
                              onToggleFavorite={onToggleFavorite}
                              onMoveSession={handleMoveSession}
                              projects={allProjectsForMove}
                            />
                          );
                        })}
                        {unlabeled.map((session) => (
                          <SessionItem
                            key={session.id}
                            session={session}
                            isActive={session.id === activeSessionId}
                            currentUsername={currentUsername}
                            onSelect={onSelectSession}
                            onDelete={onDeleteSession}
                            onRename={onRenameSession}
                            onToggleFavorite={onToggleFavorite}
                            onMoveToProject={handleMoveSession}
                            projects={allProjectsForMove}
                          />
                        ))}
                      </div>
                    );
                  }

                  // Default flat list (searching or filterLabels off)
                  return (
                    <div className="space-y-0.5">
                      {filteredSessions.map((session) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          isActive={session.id === activeSessionId}
                          currentUsername={currentUsername}
                          onSelect={isSearching ? (s: any) => { onSelectSession(s); clearSearch(); } : onSelectSession}
                          onDelete={onDeleteSession}
                          onRename={onRenameSession}
                          onToggleFavorite={onToggleFavorite}
                          onMoveToProject={handleMoveSession}
                          projects={allProjectsForMove}
                        />
                      ))}
                    </div>
                  );
                })()}
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
                        onClick={() => { onSelectSession(target); clearSearch(); }}
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
          </div>
        ) : sidebarTab === 'files' ? (
          <div className="px-2 min-h-full space-y-1 flex flex-col">
            {/* Files toolbar — New, Upload, show hidden, refresh */}
            <FilesToolbar onRefresh={onRequestFileTree} projects={projectsSortedByActivity} />
            {/* Project file sections — sorted by most recent session activity */}
            <div className="flex-1">
              {projectsSortedByActivity.filter(p => p.rootPath).map((project) => (
                <ProjectFileSection
                  key={project.id}
                  project={project}
                  onFileClick={onFileClick}
                  onPinFile={onPinFile}
                  onNewSessionInFolder={onNewSessionInFolder}
                />
              ))}

              {/* Common files (workspace root — docs/, decisions/) */}
              <ProjectFileSection
                key="__common__"
                project={{ id: '__common__', name: 'Common', rootPath: treeRoot, color: '#6b7280', sortOrder: 9999, collapsed: false, archived: false, createdAt: '' }}
                onFileClick={onFileClick}
                onPinFile={onPinFile}
                onNewSessionInFolder={onNewSessionInFolder}
              />

              {/* Shared with me */}
              {sharedWithMe.length > 0 && (
                <div className="mt-3 px-2">
                  <div className="text-[10px] text-gray-600 uppercase tracking-wide font-medium mb-1.5 px-1">
                    Shared with me
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

            {/* Multi-select toolbar */}
            <SelectionToolbar onRefresh={() => { useFileStore.getState().bumpRefreshTrigger(); onRequestFileTree(); }} />

            {/* Bottom drop zone — always visible, upload to any project */}
            <FilesDropZone projects={projects} onRefresh={onRequestFileTree} />
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
        ) : sidebarTab === 'rooms' ? (
          <RoomList onSelectRoom={(roomId) => {
            useRoomStore.getState().setActiveRoomId(roomId);
            useSessionStore.getState().setActiveView('rooms');
            // Mobile: close sidebar drawer after selecting a room
            if (useSessionStore.getState().isMobile) {
              useSessionStore.getState().setSidebarOpen(false);
            }
          }} />
        ) : sidebarTab === 'history' ? (
          <HistoryPanel />
        ) : sidebarTab === 'pins' ? (
          <PinList
            onPinClick={(pin) => onPinClick?.(pin)}
            onUnpin={(id) => onUnpinFile?.(id)}
          />
        ) : null}
      </div>

      {/* Search — pinned to bottom, always accessible */}
      {sidebarTab === 'sessions' && (
        <div className="border-t border-surface-800/50 px-3 py-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { clearSearch(); searchInputRef.current?.blur(); } }}
              className="w-full bg-surface-800 border border-surface-700 rounded-md text-[12px] text-gray-300 pl-8 pr-8 py-1.5 placeholder-surface-700 outline-none focus:border-primary-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => { clearSearch(); searchInputRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-600 hover:text-gray-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
      {/* Footer — user + version */}
      <div className="border-t border-surface-800/50">
        <div className="px-4 py-2 flex items-center justify-between">
          <CurrentUser />
          <span className="text-[10px] font-semibold text-surface-800">v0.2.0</span>
        </div>
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

/** Compact toolbar shown at top of Files tab — New, Upload, show hidden, refresh */
/** Toggle button for multi-select mode */
function SelectModeToggle() {
  const selectMode = useFileStore((s) => s.selectMode);
  const toggleSelectMode = useFileStore((s) => s.toggleSelectMode);
  return (
    <button
      onClick={() => toggleSelectMode()}
      className={`p-1 rounded transition-colors ${
        selectMode
          ? 'text-primary-400 bg-primary-600/20'
          : 'text-surface-600 hover:text-primary-400 hover:bg-surface-800'
      }`}
      title={selectMode ? 'Exit select mode' : 'Select files (Ctrl+Click)'}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    </button>
  );
}

function FilesToolbar({ onRefresh, projects }: { onRefresh: (path?: string) => void; projects: { id: string; name: string; rootPath?: string | null; color?: string }[] }) {
  const showHidden = useFileStore((s) => s.showHidden);
  const toggleShowHidden = useFileStore((s) => s.toggleShowHidden);
  const bumpRefreshTrigger = useFileStore((s) => s.bumpRefreshTrigger);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newType, setNewType] = useState<'file' | 'folder' | null>(null);
  const [targetProject, setTargetProject] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleToggleHidden = () => {
    toggleShowHidden();
    setTimeout(() => onRefresh(), 50);
  };

  // Close new-menu on outside click
  useEffect(() => {
    if (!newMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setNewMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [newMenuOpen]);

  // Auto-focus inline input
  useEffect(() => {
    if (newType) inputRef.current?.focus();
  }, [newType]);

  const projectsWithPath = projects.filter(p => p.rootPath);

  const handleNewAction = (type: 'file' | 'folder', projectRootPath: string) => {
    setNewType(type);
    setTargetProject(projectRootPath);
    setInputValue('');
    setNewMenuOpen(false);
  };

  const handleNewSubmit = async () => {
    const name = inputValue.trim();
    if (!name || !targetProject) { setNewType(null); return; }
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const fullPath = `${targetProject}/${name}`;
      const endpoint = newType === 'folder' ? '/api/files/mkdir' : '/api/files/create';
      const body = newType === 'folder' ? { path: fullPath } : { path: fullPath, content: '' };
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toastSuccess(`${name} created`);
      bumpRefreshTrigger();
    } catch (err: any) {
      toastError(err.message || 'Create failed');
    }
    setNewType(null);
    setTargetProject(null);
    setInputValue('');
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Use first project with rootPath as default target
    const uploadTarget = projectsWithPath[0]?.rootPath;
    if (!uploadTarget) { toastError('No project folder available'); return; }

    const formData = new FormData();
    formData.append('targetDir', uploadTarget);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      const fail = data.results.filter((r: any) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} failed`);
      bumpRefreshTrigger();
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
    e.target.value = '';
  };

  const iconBtnClass = 'p-1 rounded text-surface-600 hover:text-primary-400 hover:bg-surface-800 transition-colors';
  const actionBtnClass = 'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors';

  return (
    <div className="px-1 pt-1 pb-1 space-y-1">
      {/* Action buttons row */}
      <div className="flex items-center gap-1">
        {/* New button with dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setNewMenuOpen(!newMenuOpen)}
            className={`${actionBtnClass} text-gray-400 hover:text-primary-300 hover:bg-surface-800`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
          {newMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[180px]">
              {projectsWithPath.map(p => (
                <div key={p.id}>
                  <div className="px-3 py-1 text-[10px] text-gray-500 font-medium truncate">{p.name}</div>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white"
                    onClick={() => handleNewAction('file', p.rootPath!)}
                  >
                    <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    New file
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white"
                    onClick={() => handleNewAction('folder', p.rootPath!)}
                  >
                    <svg className="w-3.5 h-3.5 text-yellow-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    New folder
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload button */}
        <button
          onClick={handleUploadClick}
          className={`${actionBtnClass} text-gray-400 hover:text-green-300 hover:bg-surface-800`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Upload
        </button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileUpload} />

        <div className="flex-1" />

        {/* Show hidden toggle */}
        <button
          onClick={handleToggleHidden}
          className={`${iconBtnClass} ${showHidden ? '!text-primary-400' : ''}`}
          title={showHidden ? 'Hide dotfiles' : 'Show dotfiles (.env, .gitignore, etc.)'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {showHidden ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            )}
          </svg>
        </button>
        {/* Select mode toggle */}
        <SelectModeToggle />
        {/* Refresh */}
        <button onClick={() => onRefresh()} className={iconBtnClass} title="Refresh all">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Inline input for new file/folder (appears when creating from toolbar) */}
      {newType && targetProject && (
        <div className="flex items-center gap-1.5 px-1 py-0.5 bg-surface-850 rounded-md">
          {newType === 'folder' ? (
            <svg className="w-3.5 h-3.5 text-yellow-400/70 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-primary-400/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNewSubmit();
              if (e.key === 'Escape') { setNewType(null); setTargetProject(null); }
            }}
            onBlur={() => { setNewType(null); setTargetProject(null); }}
            placeholder={newType === 'folder' ? 'Folder name' : 'File name'}
            className="flex-1 bg-transparent border border-primary-500/50 rounded px-2 py-0.5 text-[12px] text-gray-200 outline-none placeholder-gray-600"
          />
          <span className="text-[9px] text-gray-600 truncate max-w-[80px]">
            in {targetProject.split('/').pop()}
          </span>
        </div>
      )}
    </div>
  );
}

/** Bottom drop zone for Files tab — drop files here or click to upload */
function FilesDropZone({ projects, onRefresh }: {
  projects: { id: string; name: string; rootPath?: string | null; color?: string }[];
  onRefresh: (path?: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const bumpRefreshTrigger = useFileStore((s) => s.bumpRefreshTrigger);

  const projectsWithPath = projects.filter(p => p.rootPath);

  // Close picker on outside click
  useEffect(() => {
    if (!showProjectPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
        setPendingFiles(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProjectPicker]);

  const uploadToProject = async (targetDir: string, files: FileList) => {
    const formData = new FormData();
    formData.append('targetDir', targetDir);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      const fail = data.results.filter((r: any) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} failed`);
      bumpRefreshTrigger();
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
    setShowProjectPicker(false);
    setPendingFiles(null);
  };

  const handleFilesReady = (files: FileList) => {
    if (projectsWithPath.length === 1) {
      // Only one project — upload directly
      uploadToProject(projectsWithPath[0].rootPath!, files);
    } else if (projectsWithPath.length > 1) {
      // Multiple projects — show picker
      setPendingFiles(files);
      setShowProjectPicker(true);
    } else {
      toastError('No project folder available');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.getData('application/x-attachment')) return;
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    handleFilesReady(files);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleFilesReady(files);
    e.target.value = '';
  };

  return (
    <div className="relative px-1 pb-2 pt-1 shrink-0">
      <div
        className={`border-2 border-dashed rounded-lg py-3 text-center cursor-pointer transition-all ${
          dragOver
            ? 'border-primary-500/60 bg-primary-900/10 text-primary-400'
            : 'border-surface-700/50 text-surface-600 hover:border-surface-600 hover:text-surface-500'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={handleDrop}
      >
        <svg className="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-[11px]">Drop files or click to upload</p>
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleInputChange} />

      {/* Project picker popup — shown when multiple projects exist */}
      {showProjectPicker && pendingFiles && (
        <div ref={pickerRef} className="absolute bottom-full left-1 right-1 mb-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 z-50">
          <div className="px-3 py-1.5 text-[10px] text-gray-500 font-medium">Upload to...</div>
          {projectsWithPath.map(p => (
            <button
              key={p.id}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors"
              onClick={() => uploadToProject(p.rootPath!, pendingFiles)}
            >
              <svg className="w-3.5 h-3.5 text-yellow-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** File tree toolbar: new file, new folder, upload, refresh, show hidden */
function FileTreeToolbar({ treeRoot, onRefresh }: { treeRoot: string; onRefresh: () => void }) {
  const [showInput, setShowInput] = useState<'file' | 'folder' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showHidden = useFileStore((s) => s.showHidden);
  const toggleShowHidden = useFileStore((s) => s.toggleShowHidden);

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
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || `Upload failed (${res.status})`); return; }
      const ok = data.results.filter((r: { error?: string }) => !r.error);
      const fail = data.results.filter((r: { error?: string }) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded`);
      if (fail.length > 0) toastError(`${fail.length} file(s) failed: ${fail.map((f: { name: string; error?: string }) => `${f.name}: ${f.error}`).join(', ')}`);
      onRefresh();
    } catch (err) {
      console.error('[toolbar] File upload error:', err);
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
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
        <button
          onClick={() => { toggleShowHidden(); onRefresh(); }}
          className={`${btnClass} ${showHidden ? 'text-primary-400' : ''}`}
          title={showHidden ? 'Hide dotfiles' : 'Show dotfiles (.env, etc.)'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {showHidden ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            )}
          </svg>
        </button>
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

const PROJECT_PREVIEW_MIN = 3;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Parse date string to UTC ms (cached per string to avoid repeated parsing) */
const _tsCache = new Map<string, number>();
function parseTs(dateStr: string): number {
  let v = _tsCache.get(dateStr);
  if (v !== undefined) return v;
  let d = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
  if (!d.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(d)) d += 'Z';
  v = new Date(d).getTime();
  _tsCache.set(dateStr, v);
  if (_tsCache.size > 2000) _tsCache.clear(); // prevent unbounded growth
  return v;
}

/** Preview count: at least 3, plus any sessions updated within the last 24h */
function getPreviewCount(sessions: SessionMeta[]): number {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  let count = 0;
  for (const s of sessions) {
    if (parseTs(s.updatedAt) >= cutoff) count++;
  }
  return Math.max(PROJECT_PREVIEW_MIN, count);
}

function ProjectGroup({
  project, sessions: groupSessions, collapsed, activeSessionId,
  onToggleCollapsed, onSelectSession, onDeleteSession, onRenameSession,
  onToggleFavorite, onNewSession, onMoveSession, projects, currentUsername,
  showLabels = true,
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
  currentUsername?: string;
  showLabels?: boolean;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  // Label collapse state — subscribed via hook so toggle triggers re-render immediately
  const collapsedLabels = useProjectStore((s) => s.collapsedLabels);
  const toggleLabelCollapsed = useProjectStore((s) => s.toggleLabelCollapsed);

  // Check if any session in this project is actively streaming or unread
  const streamingSessions = useSessionStore((s) => s.streamingSessions);
  const unreadSessions = useSessionStore((s) => s.unreadSessions);
  const hasActivity = groupSessions.some((s) => streamingSessions.has(s.id));
  // Count only own unread sessions (ownerUsername matches current user)
  const myUnreadCount = groupSessions.filter((s) => unreadSessions.has(s.id) && s.ownerUsername === currentUsername).length;
  const hasUnread = myUnreadCount > 0;

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
          const updated = await res.json();
          // Sync all cascaded changes (name + rootPath if folder was renamed)
          useProjectStore.getState().updateProject(project.id, updated);
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
        // Remove archived channels from room store
        const { useRoomStore } = await import('../../stores/room-store');
        const rooms = useRoomStore.getState().rooms.filter(r => r.projectId === project.id);
        for (const r of rooms) {
          useRoomStore.getState().removeRoom(r.id);
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
        onClick={() => {
          if (collapsed && groupSessions.length > 0) {
            // Expanding: auto-select most recent session
            onToggleCollapsed();
            // On mobile, don't auto-select session (it closes sidebar)
            if (!useSessionStore.getState().isMobile) {
              onSelectSession(groupSessions[0]);
            }
          } else {
            onToggleCollapsed();
          }
        }}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(project.name); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Chevron — hidden by default, shown on hover (Slack pattern) */}
        <svg className={`w-3.5 h-3.5 text-surface-600 transition-all shrink-0 opacity-0 group-hover/proj:opacity-100 ${collapsed ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {/* When chevron is hidden, show activity dot or folder icon in its place */}
        {hasActivity ? (
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shrink-0 -ml-[18px] group-hover/proj:hidden" />
        ) : (
          <svg className="w-4 h-4 text-surface-600 shrink-0 -ml-[18px] group-hover/proj:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
            <div className="flex items-center gap-1.5">
              <span className={`text-[13px] font-bold truncate ${hasUnread || hasActivity ? 'text-gray-100' : 'text-gray-300'}`}>
                {project.name}
              </span>
              {myUnreadCount > 0 ? (
                <span className="text-[9px] font-semibold text-green-400 bg-green-400/10 border border-green-400/20 rounded px-1 py-0.5 leading-none shrink-0">
                  {myUnreadCount}
                </span>
              ) : (
                <span className="text-[10px] tabular-nums shrink-0 text-surface-600">
                  {groupSessions.length}
                </span>
              )}
              {/* + New session button — always visible on mobile, hover on desktop */}
              <button
                onClick={(e) => { e.stopPropagation(); onNewSession(); }}
                className="p-0.5 rounded text-surface-600 hover:text-primary-400 hover:bg-surface-700/50 transition-all shrink-0 ml-auto max-[768px]:opacity-100 opacity-0 group-hover/proj:opacity-100"
                aria-label="New session in project"
                title="New session"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
              {/* 3-dot menu — hidden by default, shown on hover */}
              <button
                onClick={(e) => { e.stopPropagation(); setCtxMenu({ x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().bottom + 4 }); }}
                className="p-0.5 rounded text-surface-600 hover:text-gray-300 hover:bg-surface-700/50 transition-all shrink-0 opacity-0 group-hover/proj:opacity-100"
                aria-label="Project actions"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sessions inside group — sub-grouped by label */}
      {!collapsed && (() => {
        // Group sessions by label
        const labelGroups = new Map<string, SessionMeta[]>();
        const unlabeled: SessionMeta[] = [];
        for (const s of groupSessions) {
          if (s.label) {
            const list = labelGroups.get(s.label) || [];
            list.push(s);
            labelGroups.set(s.label, list);
          } else {
            unlabeled.push(s);
          }
        }

        // Sort label groups by most recent session activity
        const sortedLabels = [...labelGroups.entries()].sort((a, b) => {
          const latestA = Math.max(...a[1].map(s => new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime()));
          const latestB = Math.max(...b[1].map(s => new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime()));
          return latestB - latestA;
        });

        const hasLabels = sortedLabels.length > 0;
        const toggleLabel = toggleLabelCollapsed;

        // Helper: apply label to a session via D&D (optimistic + background persist)
        const applyLabelToSession = (sessionId: string, label: string | null) => {
          useSessionStore.getState().updateSessionMeta(sessionId, { label });
          const token = localStorage.getItem('token');
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          fetch(`/api/sessions/${sessionId}`, {
            method: 'PATCH', headers, body: JSON.stringify({ label }),
          }).catch(() => {});
        };

        // If labels toggled off or no labels, render flat
        if (!hasLabels || !showLabels) {
          const previewCount = getPreviewCount(groupSessions);
          const hasMore = groupSessions.length > previewCount;
          const visibleSessions = expanded ? groupSessions : groupSessions.slice(0, previewCount);
          return (
            <div className="ml-2.5 pl-3 border-l border-surface-800 space-y-0.5">
              {visibleSessions.map((session) => (
                <SessionItem key={session.id} session={session} isActive={session.id === activeSessionId} currentUsername={currentUsername} onSelect={onSelectSession} onDelete={onDeleteSession} onRename={onRenameSession} onToggleFavorite={onToggleFavorite} onMoveToProject={onMoveSession} projects={projects} />
              ))}
              {hasMore && (
                <button
                  onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                  className="w-full text-left text-[11px] text-surface-500 hover:text-gray-300 py-1 px-2 rounded hover:bg-surface-800/50 transition-colors"
                >
                  {expanded ? 'Show less' : `Show all ${groupSessions.length}`}
                </button>
              )}
            </div>
          );
        }

        // Render label sub-groups + unlabeled
        return (
          <div className="ml-2.5 pl-3 border-l border-surface-800 space-y-0.5">
            {sortedLabels.map(([label, sessions]) => {
              const labelKey = `${project.id}::${label}`;
              const isLabelCollapsed = collapsedLabels.has(labelKey);
              return (
                <LabelGroup
                  key={label}
                  label={label}
                  sessions={sessions}
                  isCollapsed={isLabelCollapsed}
                  onToggle={() => toggleLabel(project.id, label)}
                  onDropSession={(sessionId) => applyLabelToSession(sessionId, label)}
                  activeSessionId={activeSessionId}
                  currentUsername={currentUsername}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  onRenameSession={onRenameSession}
                  onToggleFavorite={onToggleFavorite}
                  onMoveSession={onMoveSession}
                  projects={projects}
                />
              );
            })}
            {/* Unlabeled sessions — also a drop target to remove label */}
            {unlabeled.length > 0 && (
              <UnlabeledDropZone
                sessions={unlabeled}
                expanded={expanded}
                onDropSession={(sessionId) => applyLabelToSession(sessionId, null)}
                activeSessionId={activeSessionId}
                currentUsername={currentUsername}
                onSelectSession={onSelectSession}
                onDeleteSession={onDeleteSession}
                onRenameSession={onRenameSession}
                onToggleFavorite={onToggleFavorite}
                onMoveSession={onMoveSession}
                projects={projects}
              />
            )}
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
          onNewChat={onNewSession}
          sessionCount={groupSessions.length}
          previewCount={getPreviewCount(groupSessions)}
          expanded={expanded}
          onToggleExpanded={() => setExpanded(!expanded)}
        />
      )}
    </div>
  );
}

/* ── Project Context Menu ── */

function ProjectContextMenu({ x, y, project, onRename, onDelete, onClose, onNewChat, sessionCount, previewCount, expanded, onToggleExpanded }: {
  x: number; y: number; project: Project;
  onRename: () => void; onDelete: () => void;
  onClose: () => void;
  onNewChat: () => void;
  sessionCount: number;
  previewCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([]);
  const [currentMembers, setCurrentMembers] = useState<{ userId: number; username: string; role: string }[]>([]);
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ left: x, top: y });

  // Adjust position to stay within viewport (runs once on mount, before paint)
  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    const newTop = rect.bottom > window.innerHeight - pad
      ? Math.max(pad, window.innerHeight - rect.height - pad) : y;
    const newLeft = rect.right > window.innerWidth - pad
      ? Math.max(pad, window.innerWidth - rect.width - pad) : x;
    setAdjustedPos({ left: newLeft, top: newTop });
  }, [x, y]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Fetch all users + current members when invite panel opens
  useEffect(() => {
    if (!showInvite) return;
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Fetch all users
    fetch('/api/users/search?q=', { headers })
      .then(r => r.ok ? r.json() : [])
      .then(setAllUsers)
      .catch(() => {});
    // Fetch current members
    fetch(`/api/projects/${project.id}/members`, { headers: { ...headers, 'Content-Type': 'application/json' } })
      .then(r => r.ok ? r.json() : [])
      .then(setCurrentMembers)
      .catch(() => {});
    setTimeout(() => inviteInputRef.current?.focus(), 50);
  }, [showInvite, project.id]);

  const handleInvite = async (userId: number) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/projects/${project.id}/members`, {
        method: 'POST', headers, body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        const user = allUsers.find(u => u.id === userId);
        setCurrentMembers(prev => [...prev, { userId, username: user?.username || '', role: 'member' }]);
      }
    } catch {}
  };

  const handleRemoveMember = async (userId: number) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/projects/${project.id}/members/${userId}`, {
        method: 'DELETE', headers,
      });
      if (res.ok) {
        setCurrentMembers(prev => prev.filter(m => m.userId !== userId));
      }
    } catch {}
  };

  const memberIds = currentMembers.map(m => m.userId);
  const filteredUsers = allUsers.filter(u => {
    if (memberIds.includes(u.id)) return false;
    if (!inviteQuery.trim()) return true;
    return u.username.toLowerCase().includes(inviteQuery.toLowerCase());
  });

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  if (showSettings) {
    return (
      <div ref={ref} className="fixed z-50" style={adjustedPos}>
        <ProjectSettingsPanel project={project} onClose={onClose} />
      </div>
    );
  }

  if (showInvite) {
    return (
      <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl min-w-[220px]"
        style={adjustedPos}>
        <div className="px-3 py-2 border-b border-surface-700/50 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          <input
            ref={inviteInputRef}
            value={inviteQuery}
            onChange={(e) => setInviteQuery(e.target.value)}
            placeholder="Search members..."
            className="flex-1 bg-transparent text-[12px] text-gray-200 placeholder-surface-600 outline-none"
          />
        </div>
        <div className="max-h-[200px] overflow-y-auto py-1">
          {filteredUsers.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-surface-600">
              {allUsers.length === 0 ? 'Loading...' : 'No users to invite'}
            </div>
          ) : (
            filteredUsers.map(u => (
              <button
                key={u.id}
                onClick={() => handleInvite(u.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-blue-600/20 hover:text-white transition-colors"
              >
                <span className="w-5 h-5 rounded-full bg-surface-700 flex items-center justify-center text-[9px] text-gray-400 shrink-0">
                  {u.username[0]?.toUpperCase()}
                </span>
                {u.username}
              </button>
            ))
          )}
        </div>
        {currentMembers.length > 0 && (
          <>
            <div className="px-3 py-1 border-t border-surface-700/50">
              <span className="text-[10px] text-surface-500 uppercase tracking-wider">Members ({currentMembers.length})</span>
            </div>
            <div className="max-h-[120px] overflow-y-auto py-1">
              {currentMembers.map(m => (
                <div key={m.userId} className="flex items-center gap-2 px-3 py-1 text-[12px] text-gray-400 group/member">
                  <span className="w-5 h-5 rounded-full bg-surface-700 flex items-center justify-center text-[9px] text-gray-400 shrink-0">
                    {m.username?.[0]?.toUpperCase() || '?'}
                  </span>
                  <span className="flex-1 truncate">{m.username || `User ${m.userId}`}</span>
                  <span className="text-[9px] text-surface-600">{m.role}</span>
                  {m.role !== 'owner' && (
                    <button
                      onClick={() => handleRemoveMember(m.userId)}
                      className="opacity-0 group-hover/member:opacity-100 text-red-400 hover:text-red-300 p-0.5 transition-opacity"
                      title="Remove"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={adjustedPos}>
      {/* New Chat */}
      <button className={itemClass} onClick={() => { onNewChat(); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Chat
      </button>
      {/* Show all / Show less */}
      {sessionCount > previewCount && (
        <button className={itemClass} onClick={() => { onToggleExpanded(); onClose(); }}>
          <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {expanded ? 'Show less' : `Show all ${sessionCount}`}
        </button>
      )}
      <div className="border-t border-surface-700/50 my-1" />
      {/* Invite Members */}
      <button className={itemClass} onClick={() => setShowInvite(true)}>
        <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        Invite Members
      </button>
      {/* Rename */}
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
      {/* Create Deck */}
      <CreateDeckInline projectId={project.id} onClose={onClose} />
      <div className="border-t border-surface-700/50 my-1" />
      <button className={`${itemClass} !text-red-400 hover:!bg-red-950/30`} onClick={() => {
        const msg = sessionCount > 0
          ? `Delete "${project.name}"?\n\n${sessionCount} session(s) will be moved to Ungrouped.\nChannels in this project will be archived.`
          : `Delete "${project.name}"?`;
        if (window.confirm(msg)) { onDelete(); onClose(); }
      }}>
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
  const [members, setMembers] = useState<{ userId: number; username: string; role: string }[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; username: string }[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const currentUserId = (() => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;
      return JSON.parse(atob(token.split('.')[1]))?.userId ?? null;
    } catch { return null; }
  })();

  const isAdmin = localStorage.getItem('userRole') === 'admin';

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/members`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
        setIsOwner(isAdmin || data.some((m: any) => m.userId === currentUserId && m.role === 'owner'));
      }
    } catch {}
  };

  const searchUsers = (q: string) => {
    setMemberSearch(q);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: getAuthHeaders() });
        if (res.ok) {
          const users = await res.json();
          setSearchResults(users.filter((u: any) => !members.some(m => m.userId === u.id)));
        }
      } catch {}
    }, 300);
  };

  const handleAddMember = async (userId: number) => {
    try {
      await fetch(`/api/projects/${project.id}/members`, {
        method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ userId }),
      });
      setMemberSearch(''); setSearchResults([]);
      fetchMembers();
    } catch {}
  };

  const handleRemoveMember = async (userId: number) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/members/${userId}`, {
        method: 'DELETE', headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json();
        toastError(data.error || 'Failed to remove member');
      }
      fetchMembers();
    } catch {}
  };

  const handleSave = async () => {
    setSaving(true);
    const headers = getAuthHeaders();
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

      {/* Members */}
      <div className="mb-3">
        <div className={labelClass}>Members</div>
        <div className="space-y-1 mb-2">
          {members.map(m => (
            <div key={m.userId} className="flex items-center justify-between text-[11px]">
              <span className="text-gray-300">
                {m.role === 'owner' ? '👑 ' : '👤 '}{m.username}
                {m.userId === currentUserId && <span className="text-surface-600 ml-1">(you)</span>}
              </span>
              {isOwner && m.userId !== currentUserId && (
                <button onClick={() => handleRemoveMember(m.userId)} className="text-surface-600 hover:text-red-400 transition-colors">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && <span className="text-[11px] text-surface-600">No members</span>}
        </div>

        {/* Add member search */}
        {isOwner && (
          <div className="relative">
            <input
              value={memberSearch}
              onChange={(e) => searchUsers(e.target.value)}
              placeholder="+ Add member..."
              className="w-full bg-surface-700 border border-surface-600 rounded text-[11px] text-gray-300 px-2 py-1 placeholder-surface-600 outline-none focus:border-primary-500/50"
            />
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-0.5 bg-surface-900 border border-surface-700 rounded shadow-lg z-10 max-h-[100px] overflow-y-auto">
                {searchResults.map(u => (
                  <button
                    key={u.id}
                    onClick={() => handleAddMember(u.id)}
                    className="w-full text-left px-2 py-1 text-[11px] text-gray-300 hover:bg-surface-700 transition-colors"
                  >
                    {u.username}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
        <p className="text-[9px] text-surface-600 mt-0.5">Also saved to AGENTS.md in the project folder</p>
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
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; username: string }[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<{ id: number; username: string }[]>([]);
  const [myGroups, setMyGroups] = useState<{ id: number; name: string }[]>([]);
  const [inviteGroupId, setInviteGroupId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch('/api/my/groups', { headers })
        .then(r => r.ok ? r.json() : [])
        .then(groups => setMyGroups(groups))
        .catch(() => {});
    }
  }, [creating]);

  useEffect(() => {
    if (!creating) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        resetForm();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [creating]);

  const resetForm = () => {
    setName(''); setMemberSearch(''); setSearchResults([]); setSelectedMembers([]);
    setInviteGroupId(null); setCreating(false);
  };

  const searchUsers = (q: string) => {
    setMemberSearch(q);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers });
        if (res.ok) {
          const users = await res.json();
          setSearchResults(users.filter((u: any) => !selectedMembers.some(m => m.id === u.id)));
        }
      } catch {}
    }, 300);
  };

  const addMember = (user: { id: number; username: string }) => {
    setSelectedMembers(prev => [...prev, user]);
    setMemberSearch(''); setSearchResults([]);
  };

  const removeMember = (userId: number) => {
    setSelectedMembers(prev => prev.filter(m => m.id !== userId));
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setCreating(false); return; }
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const body: any = { name: trimmed };
      if (selectedMembers.length > 0) body.memberIds = selectedMembers.map(m => m.id);
      if (inviteGroupId) body.groupId = inviteGroupId;
      const res = await fetch('/api/projects', {
        method: 'POST', headers, body: JSON.stringify(body),
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
    resetForm();
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
        <div className="absolute right-0 top-full mt-1 z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl p-2 min-w-[260px] space-y-2">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !memberSearch) handleCreate();
              if (e.key === 'Escape') resetForm();
            }}
            placeholder="Project name..."
            className="w-full bg-surface-700 border border-surface-600 rounded text-[12px] text-gray-200 px-2.5 py-1.5 placeholder-surface-600 outline-none focus:border-primary-500/50"
          />

          {/* Member invite */}
          <div className="relative">
            <input
              value={memberSearch}
              onChange={(e) => searchUsers(e.target.value)}
              placeholder="Invite members..."
              className="w-full bg-surface-700 border border-surface-600 rounded text-[11px] text-gray-300 px-2 py-1.5 placeholder-surface-600 outline-none focus:border-primary-500/50"
            />
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-0.5 bg-surface-900 border border-surface-700 rounded shadow-lg z-10 max-h-[120px] overflow-y-auto">
                {searchResults.map(u => (
                  <button
                    key={u.id}
                    onClick={() => addMember(u)}
                    className="w-full text-left px-2 py-1 text-[11px] text-gray-300 hover:bg-surface-700 transition-colors"
                  >
                    {u.username}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected members */}
          {selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedMembers.map(m => (
                <span key={m.id} className="inline-flex items-center gap-0.5 text-[10px] bg-primary-600/20 text-primary-300 border border-primary-500/30 px-1.5 py-0.5 rounded-full">
                  {m.username}
                  <button onClick={() => removeMember(m.id)} className="text-primary-400 hover:text-red-400 ml-0.5">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Group bulk invite */}
          {myGroups.length > 0 && (
            <select
              value={inviteGroupId ?? ''}
              onChange={(e) => setInviteGroupId(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full bg-surface-700 border border-surface-600 rounded text-[11px] text-gray-300 px-2 py-1.5 outline-none focus:border-primary-500/50"
            >
              <option value="">Invite group (optional)</option>
              {myGroups.map(g => <option key={g.id} value={g.id}>{g.name} (all members)</option>)}
            </select>
          )}

          <p className="text-[10px] text-surface-600 px-0.5">
            {selectedMembers.length > 0 || inviteGroupId
              ? 'Invited members will see this project'
              : 'Only you and admin can see this project'
            }
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Current User Badge (JWT에서 username 추출) ── */
function CurrentUser() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload?.username) return null;
    return (
      <span className="text-[10px] text-surface-600 ml-0.5">
        ({payload.username})
      </span>
    );
  } catch {
    return null;
  }
}

/* ── Project File Section — collapsible project header + lazy-loaded FileTree ── */

function ProjectFileSection({ project, onFileClick, onPinFile, onNewSessionInFolder }: {
  project: { id: string; name: string; rootPath?: string | null; color?: string; [key: string]: any };
  onFileClick: (path: string) => void;
  onPinFile?: (path: string) => void;
  onNewSessionInFolder?: (path: string) => void;
}) {
  // Persisted collapsed state via zustand store
  const isExpanded = useFileStore((s) => s.expandedProjects.has(project.id));
  const toggleProjectExpanded = useFileStore((s) => s.toggleProjectExpanded);
  const refreshTrigger = useFileStore((s) => s.refreshTrigger);
  const bumpRefreshTrigger = useFileStore((s) => s.bumpRefreshTrigger);
  const showHidden = useFileStore((s) => s.showHidden);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);
  const prevTrigger = useRef(refreshTrigger);

  // Quick-action state for project header buttons
  const [headerAction, setHeaderAction] = useState<'file' | 'folder' | null>(null);
  const [headerInputValue, setHeaderInputValue] = useState('');
  const headerInputRef = useRef<HTMLInputElement>(null);
  const headerUploadRef = useRef<HTMLInputElement>(null);
  const [headerDragOver, setHeaderDragOver] = useState(false);

  const rootPath = project.rootPath;

  // Debug: log mount state
  useEffect(() => {
    console.log(`[ProjectFileSection] mount: id=${project.id}, name=${project.name}, isExpanded=${isExpanded}, rootPath=${rootPath}`);
  }, []);

  const fetchDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const tk = localStorage.getItem('token');
      const hdrs: Record<string, string> = {};
      if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
      const url = `/api/files/tree?path=${encodeURIComponent(dirPath)}${showHidden ? '&showHidden=true' : ''}`;
      const res = await fetch(url, { headers: hdrs });
      if (res.ok) {
        const data = await res.json();
        return data.entries || [];
      }
    } catch {}
    return [];
  }, [showHidden]);

  const loadTree = useCallback(async (force?: boolean) => {
    if (!rootPath || (loaded.current && !force)) return;
    setLoading(true);
    const result = await fetchDir(rootPath);
    setEntries(result);
    loaded.current = true;
    setLoading(false);
  }, [rootPath, fetchDir]);

  // Stable stagger delay per project (based on project id hash)
  const staggerDelay = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < project.id.length; i++) hash = ((hash << 5) - hash + project.id.charCodeAt(i)) | 0;
    return Math.abs(hash) % 400; // 0-400ms spread
  }, [project.id]);

  // Auto-load on mount if project was previously expanded (staggered)
  useEffect(() => {
    if (isExpanded && !loaded.current) {
      const timer = setTimeout(() => loadTree(), staggerDelay);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, loadTree, staggerDelay]);

  // Auto-refresh when refreshTrigger changes (new files created/deleted)
  useEffect(() => {
    if (refreshTrigger !== prevTrigger.current) {
      prevTrigger.current = refreshTrigger;
      if (isExpanded && loaded.current && rootPath) {
        // Staggered debounce to avoid thundering herd
        const timer = setTimeout(() => {
          loadTree(true);
        }, 300 + staggerDelay);
        return () => clearTimeout(timer);
      }
    }
  }, [refreshTrigger, isExpanded, rootPath, loadTree, staggerDelay]);

  // Toggle or expand a directory within the local tree
  const handleDirectoryClick = useCallback(async (dirPath: string) => {
    const findAndToggle = (items: FileEntry[]): FileEntry[] =>
      items.map(e => {
        if (e.path === dirPath) {
          if (e.isExpanded) {
            // Collapse
            return { ...e, isExpanded: false };
          }
          // Expand — will load children
          return { ...e, isExpanded: true, isLoading: true };
        }
        if (e.children) return { ...e, children: findAndToggle(e.children) };
        return e;
      });

    setEntries(prev => findAndToggle(prev));

    // Check if already has children loaded
    const findEntry = (items: FileEntry[]): FileEntry | null => {
      for (const e of items) {
        if (e.path === dirPath) return e;
        if (e.children) { const found = findEntry(e.children); if (found) return found; }
      }
      return null;
    };
    const entry = findEntry(entries);
    if (entry?.isExpanded) {
      // Was already expanded → we just collapsed, no fetch needed
      return;
    }

    // Fetch children
    const children = await fetchDir(dirPath);
    const setChildren = (items: FileEntry[]): FileEntry[] =>
      items.map(e => {
        if (e.path === dirPath) return { ...e, children, isExpanded: true, isLoading: false };
        if (e.children) return { ...e, children: setChildren(e.children) };
        return e;
      });
    setEntries(prev => setChildren(prev));
  }, [entries, fetchDir]);

  const handleToggle = () => {
    toggleProjectExpanded(project.id);
    if (!isExpanded) loadTree(); // expanding → load
  };

  // Header quick-action: create file/folder at project root
  const handleHeaderNewSubmit = async () => {
    const name = headerInputValue.trim();
    if (!name || !rootPath) { setHeaderAction(null); return; }
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const fullPath = `${rootPath}/${name}`;
      const endpoint = headerAction === 'folder' ? '/api/files/mkdir' : '/api/files/create';
      const body = headerAction === 'folder' ? { path: fullPath } : { path: fullPath, content: '' };
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toastSuccess(`${name} created`);
      bumpRefreshTrigger();
      // Ensure project is expanded to show new item
      if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(true); }
      else { loaded.current = false; loadTree(); }
    } catch (err: any) {
      toastError(err.message || 'Create failed');
    }
    setHeaderAction(null);
    setHeaderInputValue('');
  };

  // Header upload via file input
  const handleHeaderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !rootPath) return;
    const formData = new FormData();
    formData.append('targetDir', rootPath);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const hdrs: Record<string, string> = {};
      if (token) hdrs['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers: hdrs, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      const fail = data.results.filter((r: any) => r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded to ${project.name}`);
      if (fail.length > 0) toastError(`${fail.length} failed`);
      bumpRefreshTrigger();
      if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(true); }
      else { loaded.current = false; loadTree(); }
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
    e.target.value = '';
  };

  // Header drag-and-drop upload
  const handleHeaderDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHeaderDragOver(false);
    if (e.dataTransfer.getData('application/x-attachment')) return;
    const files = e.dataTransfer.files;
    if (files.length === 0 || !rootPath) return;
    const formData = new FormData();
    formData.append('targetDir', rootPath);
    for (const file of Array.from(files)) formData.append('files', file);
    try {
      const token = localStorage.getItem('token');
      const hdrs: Record<string, string> = {};
      if (token) hdrs['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/files/upload', { method: 'POST', headers: hdrs, body: formData });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) { toastError(`Upload failed (${res.status}): server returned non-JSON response`); return; }
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Upload failed'); return; }
      const ok = data.results.filter((r: any) => !r.error);
      if (ok.length > 0) toastSuccess(`${ok.length} file(s) uploaded to ${project.name}`);
      bumpRefreshTrigger();
      if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(true); }
      else { loaded.current = false; loadTree(); }
    } catch (err) {
      toastError(`Upload failed: ${err instanceof Error ? err.message : 'Network error'}`);
    }
  };

  // Auto-focus header input
  useEffect(() => {
    if (headerAction) headerInputRef.current?.focus();
  }, [headerAction]);

  if (!rootPath) return null;

  const headerActionBtnClass = 'opacity-0 group-hover/proj:opacity-100 p-0.5 rounded text-surface-600 hover:text-primary-400 hover:bg-surface-700/50 transition-all';

  return (
    <div className="mb-1">
      <div
        className={`flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer transition-colors group/proj hover:bg-surface-850 ${headerDragOver ? 'bg-primary-900/20 ring-1 ring-primary-500/40' : ''}`}
        onClick={handleToggle}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setHeaderDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setHeaderDragOver(false); }}
        onDrop={handleHeaderDrop}
      >
        <svg className={`w-3.5 h-3.5 text-surface-600 transition-transform shrink-0 ${!isExpanded ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <svg className="w-4 h-4 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <span className="text-[13px] font-bold text-gray-300 truncate flex-1">{project.name}</span>

        {/* Quick action buttons — visible on hover */}
        <button
          className={headerActionBtnClass}
          title="New file"
          onClick={(e) => { e.stopPropagation(); setHeaderAction('file'); setHeaderInputValue(''); if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(); } }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
        <button
          className={headerActionBtnClass}
          title="New folder"
          onClick={(e) => { e.stopPropagation(); setHeaderAction('folder'); setHeaderInputValue(''); if (!isExpanded) { toggleProjectExpanded(project.id); loadTree(); } }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        </button>
        <button
          className={`${headerActionBtnClass} hover:!text-green-400`}
          title="Upload to this project"
          onClick={(e) => { e.stopPropagation(); headerUploadRef.current?.click(); }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>
        <input ref={headerUploadRef} type="file" multiple hidden onChange={handleHeaderUpload} />
      </div>

      {/* Inline input for header new file/folder action */}
      {headerAction && (
        <div className="flex items-center gap-1.5 px-2 py-1 ml-5 bg-surface-850 rounded-md mt-0.5">
          {headerAction === 'folder' ? (
            <svg className="w-3.5 h-3.5 text-yellow-400/70 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-primary-400/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          )}
          <input
            ref={headerInputRef}
            type="text"
            value={headerInputValue}
            onChange={(e) => setHeaderInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleHeaderNewSubmit();
              if (e.key === 'Escape') setHeaderAction(null);
            }}
            onBlur={() => setHeaderAction(null)}
            placeholder={headerAction === 'folder' ? 'Folder name' : 'File name'}
            className="flex-1 bg-transparent border border-primary-500/50 rounded px-2 py-0.5 text-[12px] text-gray-200 outline-none placeholder-gray-600"
          />
        </div>
      )}

      {isExpanded && (
        <div className="pl-5">
          {loading && entries.length === 0 && (
            <p className="text-[12px] text-gray-500 py-2">Loading...</p>
          )}
          {entries.length > 0 && (
            <FileTree
              entries={entries}
              onFileClick={onFileClick}
              onDirectoryClick={handleDirectoryClick}
              onPinFile={onPinFile}
              onNewSessionInFolder={onNewSessionInFolder}
              onRefreshTree={() => { loaded.current = false; loadTree(); }}
            />
          )}
          {!loading && loaded.current && entries.length === 0 && (
            <p className="text-[12px] text-surface-600 py-2">Empty</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Create Deck (inline input inside ProjectContextMenu) ── */

function CreateDeckInline({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const handleCreate = async () => {
    const label = name.trim();
    if (!label) return;
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      // 1. Create session in this project
      const res = await fetch('/api/sessions', {
        method: 'POST', headers,
        body: JSON.stringify({ projectId, name: label }),
      });
      if (!res.ok) { toastError('Failed to create deck'); onClose(); return; }
      const session = await res.json();
      // 2. Set the label (deck) on the new session
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ label }),
      });
      session.label = label;
      useSessionStore.getState().addSession(session);
      toastSuccess(`Deck "${label}" created`);
    } catch {
      toastError('Failed to create deck');
    }
    onClose();
  };

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  if (!open) {
    return (
      <button className={itemClass} onClick={() => setOpen(true)}>
        <svg className="w-3.5 h-3.5 text-primary-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
        </svg>
        Create Deck
      </button>
    );
  }

  return (
    <div className="px-2 py-1.5 flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleCreate();
          if (e.key === 'Escape') setOpen(false);
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="Deck name..."
        className="flex-1 bg-surface-700 text-[11px] text-gray-200 px-2 py-1 rounded border border-surface-600 outline-none focus:border-primary-500/50 placeholder-surface-600"
      />
      {name.trim() && (
        <button onClick={handleCreate} className="text-[10px] text-primary-400 hover:text-primary-300 font-medium px-1 shrink-0">
          Create
        </button>
      )}
    </div>
  );
}

/* ── Space Move Submenu (inside ProjectContextMenu) ── */

function SpaceMoveSubmenu({ projectId, currentSpaceId, onClose }: {
  projectId: string;
  currentSpaceId: number | null;
  onClose: () => void;
}) {
  const spaces = useSpaceStore((s) => s.spaces);
  const [open, setOpen] = useState(false);

  if (spaces.length === 0) return null;

  const handleMove = async (spaceId: number | null) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ spaceId }),
      });
      if (res.ok) {
        const updated = await res.json();
        useProjectStore.getState().updateProject(projectId, updated);
        toastSuccess(`Moved to ${spaceId === null ? '미분류' : spaces.find(s => s.id === spaceId)?.name || 'space'}`);
      }
    } catch {}
    onClose();
  };

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  return (
    <div className="relative">
      <button className={itemClass} onClick={() => setOpen(!open)}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        Space 이동
        <svg className={`w-3 h-3 ml-auto text-surface-600 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="py-1 border-t border-surface-700/30">
          {spaces.map((space) => (
            <button
              key={space.id}
              onClick={() => handleMove(space.id)}
              className={`${itemClass} pl-6 ${currentSpaceId === space.id ? '!text-primary-400' : ''}`}
              disabled={currentSpaceId === space.id}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: space.color }} />
              {space.name}
              {currentSpaceId === space.id && (
                <svg className="w-3 h-3 ml-auto text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
          <div className="border-t border-surface-700/30 my-0.5" />
          <button
            onClick={() => handleMove(null)}
            className={`${itemClass} pl-6 ${currentSpaceId === null ? '!text-primary-400' : ''}`}
            disabled={currentSpaceId === null}
          >
            <span className="w-2 h-2 rounded-full shrink-0 bg-gray-600" />
            미분류
            {currentSpaceId === null && (
              <svg className="w-3 h-3 ml-auto text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Label Group — Obsidian-style tree node (D&D drop target) ── */

const LABEL_PREVIEW_COUNT = 5;

/** Label display name mapping */
function labelDisplay(label: string): { name: string } {
  const map: Record<string, string> = {
    'channel_ai': 'Channel AI',
    'temp': 'Temp',
    'task': '⚡ Tasks',
  };
  return { name: map[label] || label };
}

/* ── Deck Context Menu ── */

function DeckContextMenu({ x, y, label, sessions, onClose }: {
  x: number; y: number; label: string; sessions: SessionMeta[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ left: x, top: y });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    const newTop = rect.bottom > window.innerHeight - pad
      ? Math.max(pad, window.innerHeight - rect.height - pad) : y;
    const newLeft = rect.right > window.innerWidth - pad
      ? Math.max(pad, window.innerWidth - rect.width - pad) : x;
    setAdjustedPos({ left: newLeft, top: newTop });
  }, [x, y]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  const patchSessions = (patch: Record<string, any>) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    for (const s of sessions) {
      useSessionStore.getState().updateSessionMeta(s.id, patch);
      fetch(`/api/sessions/${s.id}`, {
        method: 'PATCH', headers, body: JSON.stringify(patch),
      }).catch(() => {});
    }
  };

  const allProject = sessions.every(s => s.visibility === 'project');
  const hasProjectId = sessions.some(s => s.projectId);

  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[180px]"
      style={adjustedPos}>
      {/* Visibility toggle — only if sessions are in a project */}
      {hasProjectId && (
        <button className={itemClass} onClick={() => {
          const newVis = allProject ? 'private' : 'project';
          patchSessions({ visibility: newVis });
          onClose();
        }}>
          {allProject ? (
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
          {allProject ? 'Make all private' : 'Share all with project'}
        </button>
      )}
      {/* Archive all sessions in this deck */}
      <button className={itemClass} onClick={() => {
        const token = localStorage.getItem('token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        for (const s of sessions) {
          useSessionStore.getState().updateSessionMeta(s.id, { label: null });
          fetch(`/api/sessions/${s.id}`, {
            method: 'PATCH', headers, body: JSON.stringify({ label: null }),
          }).catch(() => {});
        }
        onClose();
      }}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6" />
        </svg>
        Ungroup all ({sessions.length})
      </button>
      <div className="border-t border-surface-700/50 my-1" />
      {/* Delete deck — with confirmation */}
      {!confirmDelete ? (
        <button className={`${itemClass} !text-red-400 hover:!bg-red-950/30`} onClick={() => setConfirmDelete(true)}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          Delete deck ({sessions.length} sessions)
        </button>
      ) : (
        <div className="px-2 py-1.5">
          <p className="text-[11px] text-red-400 mb-2 px-1">
            {sessions.length}개 세션이 모두 아카이브됩니다. 계속할까요?
          </p>
          <div className="flex gap-1.5">
            <button
              className="flex-1 px-2 py-1 text-[11px] bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 transition-colors border border-red-600/30"
              onClick={() => {
                const token = localStorage.getItem('token');
                const headers: Record<string, string> = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;
                for (const s of sessions) {
                  fetch(`/api/sessions/${s.id}`, { method: 'DELETE', headers }).catch(() => {});
                }
                // Remove from UI
                const store = useSessionStore.getState();
                for (const s of sessions) {
                  store.removeSession(s.id);
                }
                onClose();
              }}
            >
              Delete all
            </button>
            <button
              className="flex-1 px-2 py-1 text-[11px] bg-surface-700 text-gray-400 rounded hover:bg-surface-600 transition-colors"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LabelGroup({ label, sessions, isCollapsed, onToggle, onDropSession, activeSessionId, currentUsername, onSelectSession, onDeleteSession, onRenameSession, onToggleFavorite, onMoveSession, projects }: {
  label: string;
  sessions: SessionMeta[];
  isCollapsed: boolean;
  onToggle: () => void;
  onDropSession: (sessionId: string) => void;
  activeSessionId: string | null;
  currentUsername?: string;
  onSelectSession: (s: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleFavorite: (id: string, fav: boolean) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  projects: Project[];
}) {
  const [dragOver, setDragOver] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const hasMore = sessions.length > LABEL_PREVIEW_COUNT;
  const visibleSessions = (!isCollapsed && hasMore && !showAll) ? sessions.slice(0, LABEL_PREVIEW_COUNT) : sessions;
  const display = labelDisplay(label);

  return (
    <div className="group/label">
      {/* Label header — clean section style */}
      <div
        onClick={onToggle}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const sessionId = e.dataTransfer.getData('text/plain');
          if (sessionId) onDropSession(sessionId);
        }}
        className={`flex items-center gap-1.5 py-1 px-0.5 -ml-0.5 rounded-md cursor-pointer transition-colors select-none ${
          dragOver ? 'bg-primary-600/15' : 'hover:bg-surface-850'
        }`}
      >
        {/* Chevron */}
        <svg className={`w-3 h-3 text-surface-600 transition-transform shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {/* Label name */}
        <span className="text-[13px] font-semibold text-surface-400 truncate">{display.name}</span>
        {/* Count */}
        {hasMore ? (
          <span
            onClick={(e) => { e.stopPropagation(); setShowAll(!showAll); }}
            className="text-[10px] tabular-nums shrink-0 cursor-pointer transition-colors text-surface-600 hover:text-primary-400 ml-auto"
            title={showAll ? `${LABEL_PREVIEW_COUNT}개만 보기` : `전체 ${sessions.length}개 보기`}
          >
            {showAll ? sessions.length : `${LABEL_PREVIEW_COUNT}/${sessions.length}`}
          </span>
        ) : (
          <span className="text-[10px] tabular-nums text-surface-600 shrink-0 ml-auto">{sessions.length}</span>
        )}
      </div>
      {/* Sessions — indented under label like tree children */}
      {!isCollapsed && (
        <div className="ml-2 pl-2.5 border-l border-surface-800/60 space-y-0.5">
          {visibleSessions.map((session) => (
            <SessionItem key={session.id} session={session} isActive={session.id === activeSessionId} currentUsername={currentUsername} onSelect={onSelectSession} onDelete={onDeleteSession} onRename={onRenameSession} onToggleFavorite={onToggleFavorite} onMoveToProject={onMoveSession} projects={projects} />
          ))}
        </div>
      )}
      {/* Deck context menu */}
      {ctxMenu && (
        <DeckContextMenu x={ctxMenu.x} y={ctxMenu.y} label={label} sessions={sessions} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}

/* ── Unlabeled Sessions (drop here to remove label) ── */

function UnlabeledDropZone({ sessions, expanded, onDropSession, activeSessionId, currentUsername, onSelectSession, onDeleteSession, onRenameSession, onToggleFavorite, onMoveSession, projects }: {
  sessions: SessionMeta[];
  expanded: boolean;
  onDropSession: (sessionId: string) => void;
  activeSessionId: string | null;
  currentUsername?: string;
  onSelectSession: (s: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleFavorite: (id: string, fav: boolean) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  projects: Project[];
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`rounded transition-colors ${dragOver ? 'bg-surface-800/60 ring-1 ring-surface-600/30' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const sessionId = e.dataTransfer.getData('text/plain');
        if (sessionId) onDropSession(sessionId);
      }}
    >
      <div className="space-y-0.5">
        {(expanded ? sessions : sessions.slice(0, getPreviewCount(sessions))).map((session) => (
          <SessionItem key={session.id} session={session} isActive={session.id === activeSessionId} currentUsername={currentUsername} onSelect={onSelectSession} onDelete={onDeleteSession} onRename={onRenameSession} onToggleFavorite={onToggleFavorite} onMoveToProject={onMoveSession} projects={projects} />
        ))}
      </div>
    </div>
  );
}
