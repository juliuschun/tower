import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { useFileStore } from '../../stores/file-store';
import { type Pin } from '../../stores/pin-store';
import { usePromptStore, type PromptItem } from '../../stores/prompt-store';
import { useProjectStore, type Project } from '../../stores/project-store';
import { useSpaceStore } from '../../stores/space-store';
import { SpaceFilter } from './SpaceFilter';
import { SessionItem } from '../sessions/SessionItem';
import { SelectionToolbar } from '../files/SelectionToolbar';
import { PinList } from '../pinboard/PinList';
import { PromptItem as PromptItemComponent } from '../prompts/PromptItem';
import { toastError, toastSuccess } from '../../utils/toast';
import { useRoomStore } from '../../stores/room-store';
import { RoomList } from '../rooms/RoomList';
import { HistoryPanel } from '../history/HistoryPanel';
import { useTranslation } from 'react-i18next';

/* ── Extracted sub-components ── */
import { FilterChip, FilterMenuItem } from './sidebar/FilterChip';
import { StatsBar } from './sidebar/StatsBar';
import { CurrentUser } from './sidebar/CurrentUser';
import { UngroupedDropZone } from './sidebar/UngroupedDropZone';
import { ProjectGroup } from './sidebar/ProjectGroup';
import { LabelGroup } from './sidebar/LabelGroup';
import { ProjectFileSection } from './sidebar/ProjectFileSection';
import { FilesToolbar } from './sidebar/FilesToolbar';
import { FilesDropZone } from './sidebar/FilesDropZone';
import { getPreviewCount } from './sidebar/utils';
import type { SidebarProps } from './sidebar/types';

export function Sidebar({
  onNewSession, onSelectSession, onDeleteSession,
  onRenameSession, onToggleFavorite,
  onFileClick, onDirectoryClick, onRequestFileTree,
  onPinFile, onUnpinFile, onPinClick, onSettingsClick,
  onPromptClick, onPromptEdit, onPromptDelete, onPromptAdd,
  onNewSessionInFolder, onCollapseSidebar,
}: SidebarProps) {
  const { t } = useTranslation('layout');
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

  const currentUsername = useMemo(() => localStorage.getItem('username') || undefined, []);

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
    if (e.dataTransfer.getData('application/x-attachment')) return;
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

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
    if (sidebarTab === 'files' && tree.length === 0) {
      onRequestFileTree();
    }
  }, [sidebarTab]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const allProjects = useProjectStore((s) => s.projects);
  const collapsedProjects = useProjectStore((s) => s.collapsedProjects);
  const toggleProjectCollapsed = useProjectStore((s) => s.toggleProjectCollapsed);
  const collapsedLabels = useProjectStore((s) => s.collapsedLabels);
  const toggleLabelCollapsed = useProjectStore((s) => s.toggleLabelCollapsed);
  const hiddenLabels = useProjectStore((s) => s.hiddenLabels);
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);

  const projects = useMemo(() => {
    if (activeSpaceId === null) return allProjects;
    return allProjects.filter(p => p.spaceId === activeSpaceId);
  }, [allProjects, activeSpaceId]);

  const allProjectsForMove = allProjects;

  // Filter and sort sessions
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

  const isSearching = !!searchResults || (searchQuery.trim().length >= 2);
  const groupedSessions = useMemo(() => {
    if (isSearching) return null;
    const projectGroups = new Map<string, { project: Project; sessions: SessionMeta[] }>();
    const ungrouped: SessionMeta[] = [];

    for (const proj of projects) {
      projectGroups.set(proj.id, { project: proj, sessions: [] });
    }

    for (const session of filteredSessions) {
      if (session.projectId) {
        const group = projectGroups.get(session.projectId);
        if (group) {
          group.sessions.push(session);
        } else {
          ungrouped.push(session);
        }
      } else {
        ungrouped.push(session);
      }
    }

    const sorted = [...projectGroups.values()].sort((a, b) => {
      const toMs = (sessions: SessionMeta[]) =>
        sessions.reduce((max, s) => {
          const t = new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime();
          return t > max ? t : max;
        }, 0);
      const aMs = a.sessions.length ? toMs(a.sessions) : 0;
      const bMs = b.sessions.length ? toMs(b.sessions) : 0;
      if (aMs && !bMs) return -1;
      if (!aMs && bMs) return 1;
      if (aMs && bMs) return bMs - aMs;
      return a.project.sortOrder - b.project.sortOrder;
    });

    return { groups: sorted, ungrouped };
  }, [filteredSessions, projects, isSearching]);

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
            {t('back')}
          </button>
          <span className="text-[12px] font-semibold text-gray-300">
            {sidebarTab === 'pins' ? t('pins') : t('history')}
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
                className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-surface-850 active:bg-surface-800 transition-colors group/inbox"
                title={t('inboxTitle')}
              >
                <svg className={`w-3.5 h-3.5 shrink-0 transition-colors ${doneCount > 0 ? 'text-primary-400' : 'text-surface-600 group-hover/inbox:text-surface-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
                <span className={`text-[12px] font-medium transition-colors ${doneCount > 0 ? 'text-gray-300' : 'text-surface-500 group-hover/inbox:text-surface-400'}`}>{t('inbox')}</span>
                {doneCount > 0 && (
                  <span className="text-[11px] font-bold text-primary-400 bg-primary-500/15 rounded-full px-1.5 py-px leading-tight">
                    {doneCount}
                  </span>
                )}
              </button>
            );
          })()}
          <button
            onClick={() => onNewSession(activeSession?.projectId || undefined)}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-850 active:bg-surface-800 transition-colors group/new"
            title={t('newChatTitle')}
          >
            <svg className="w-3.5 h-3.5 text-surface-600 group-hover/new:text-surface-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-[12px] font-medium text-surface-500 group-hover/new:text-surface-400 transition-colors">{t('new')}</span>
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
              title={t('filters')}
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
                    👤 {t('mySessions')}
                  </FilterMenuItem>
                  <FilterMenuItem active={filterFav} onClick={() => { toggleFilter('fav', filterFav, setFilterFav); }}>
                    ⭐ {t('favorites')}
                  </FilterMenuItem>
                  <FilterMenuItem active={filterDone} onClick={() => { toggleFilter('done', filterDone, setFilterDone); }}>
                    ✓ {t('done')}
                  </FilterMenuItem>
                  <FilterMenuItem active={filterLabels} onClick={() => { toggleFilter('labels', filterLabels, setFilterLabels); }}>
                    📁 {t('decks')}
                  </FilterMenuItem>
                </div>
              </>
            )}
          </div>
          {onCollapseSidebar && (
            <button onClick={onCollapseSidebar} className="p-1.5 text-surface-600 hover:text-surface-400 hover:bg-surface-850 rounded-md transition-colors" title={t('hideSidebar')}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center border-b border-surface-800/50 px-3 py-1.5">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex-1">
            {sidebarTab === 'rooms' ? t('channels') : t('files')}
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
                        {t('temp')}
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
                            {ungroupedExpanded ? t('showLess') : t('showAll', { count: groupedSessions.ungrouped.length })}
                          </button>
                        )}
                      </div>
                    )}
                  </UngroupedDropZone>
                )}
                {filteredSessions.length === 0 && (
                  <p className="text-[13px] text-surface-700 px-2 py-6 text-center">{t('noSessionsYet')}</p>
                )}
              </>
            ) : (
              <>
                {filteredSessions.length === 0 && (
                  <p className="text-[13px] text-surface-700 px-2 py-6 text-center">
                    {searchQuery ? t('noResults') : t('noSessionsYet')}
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
                        {sortedLabels
                          .filter(([label]) => !hiddenLabels.has(`flat::${label}`))
                          .map(([label, labelSessions]) => {
                          const labelKey = `flat::${label}`;
                          const isCollapsed = collapsedLabels.has(labelKey);
                          return (
                            <LabelGroup
                              key={label}
                              label={label}
                              sessions={labelSessions}
                              projectId="flat"
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
                <div className="text-[10px] text-surface-600 uppercase tracking-wider font-medium mb-1 px-1">{t('messages')}</div>
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
            <FilesToolbar onRefresh={onRequestFileTree} projects={projectsSortedByActivity} />
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

              {localStorage.getItem('userRole') === 'admin' && (
              <ProjectFileSection
                key="__common__"
                project={{ id: '__common__', name: 'Common', rootPath: treeRoot, color: '#6b7280', sortOrder: 9999, collapsed: false, archived: false, createdAt: '' }}
                onFileClick={onFileClick}
                onPinFile={onPinFile}
                onNewSessionInFolder={onNewSessionInFolder}
              />
              )}

              {sharedWithMe.length > 0 && (
                <div className="mt-3 px-2">
                  <div className="text-[10px] text-gray-600 uppercase tracking-wide font-medium mb-1.5 px-1">
                    {t('sharedWithMe')}
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

            <SelectionToolbar onRefresh={() => { useFileStore.getState().bumpRefreshTrigger(); onRequestFileTree(); }} />
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
                {t('addPrompt')}
              </button>
            )}
            {prompts.length === 0 ? (
              <p className="text-[12px] text-surface-700 px-2 py-6 text-center">
                {t('noSavedPrompts')}
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
              placeholder={t('searchSessions')}
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
