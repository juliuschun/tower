import React, { useState, useEffect, useRef } from 'react';
import { useSessionStore, type SessionMeta } from '../../../stores/session-store';
import { useProjectStore, type Project } from '../../../stores/project-store';
import { SessionItem } from '../../sessions/SessionItem';
import { useTranslation } from 'react-i18next';
import { getPreviewCount } from './utils';
import { LabelGroup } from './LabelGroup';
import { UnlabeledDropZone } from './UnlabeledDropZone';
import { ProjectContextMenu } from './ProjectContextMenu';

export function ProjectGroup({
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
  const { t } = useTranslation('layout');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  // Label collapse/hidden state — subscribed via hook so toggle triggers re-render immediately
  const collapsedLabels = useProjectStore((s) => s.collapsedLabels);
  const toggleLabelCollapsed = useProjectStore((s) => s.toggleLabelCollapsed);
  const hiddenLabels = useProjectStore((s) => s.hiddenLabels);

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
        const { useRoomStore } = await import('../../../stores/room-store');
        const rooms = useRoomStore.getState().rooms.filter(r => r.projectId === project.id);
        for (const r of rooms) {
          useRoomStore.getState().removeRoom(r.id);
        }
        const { toastSuccess } = await import('../../../utils/toast');
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
                  {expanded ? t('showLess') : t('showAll', { count: groupSessions.length })}
                </button>
              )}
            </div>
          );
        }

        // Render label sub-groups + unlabeled
        return (
          <div className="ml-2.5 pl-3 border-l border-surface-800 space-y-0.5">
            {sortedLabels
              .filter(([label]) => !hiddenLabels.has(`${project.id}::${label}`))
              .map(([label, sessions]) => {
              const labelKey = `${project.id}::${label}`;
              const isLabelCollapsed = collapsedLabels.has(labelKey);
              return (
                <LabelGroup
                  key={label}
                  label={label}
                  sessions={sessions}
                  projectId={project.id}
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
