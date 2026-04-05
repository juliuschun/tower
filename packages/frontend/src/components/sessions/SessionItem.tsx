import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import type { SessionMeta } from '../../stores/session-store';
import { useSessionStore } from '../../stores/session-store';
import { useChatStore } from '../../stores/chat-store';
import type { Project } from '../../stores/project-store';

function relativeTime(dateStr: string): string {
  // SQLite CURRENT_TIMESTAMP returns UTC without 'Z' suffix — normalize to avoid local-time misparse
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '~now';
  if (mins < 60) return `~${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `~${days}d`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Context Menu (fixed positioning, outside-click close) ── */

function SessionContextMenu({ x, y, session, onRename, onToggleFavorite, onDelete, onClose, onMoveToProject, projects }: {
  x: number; y: number; session: SessionMeta;
  onRename: () => void; onToggleFavorite: () => void; onDelete: () => void; onClose: () => void;
  onMoveToProject?: (sessionId: string, projectId: string | null) => void;
  projects?: Project[];
}) {
  const ref = useRef<HTMLDivElement>(null);
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

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={adjustedPos}>
      {/* Rename */}
      <button className={itemClass} onClick={() => { onRename(); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Rename
      </button>
      {/* Toggle favorite */}
      <button className={itemClass} onClick={() => { onToggleFavorite(); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-yellow-400" viewBox="0 0 24 24" fill={session.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
        {session.favorite ? 'Remove favorite' : 'Favorite'}
      </button>
      {/* Visibility toggle */}
      {session.projectId && (
        <button className={itemClass} onClick={() => {
          const newVis = session.visibility === 'project' ? 'private' : 'project';
          const tk = localStorage.getItem('token');
          const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
          if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
          fetch(`/api/sessions/${session.id}`, {
            method: 'PATCH', headers: hdrs, body: JSON.stringify({ visibility: newVis }),
          }).then(res => {
            if (res.ok) {
              useSessionStore.getState().updateSessionMeta(session.id, { visibility: newVis });
            }
          }).catch(() => {});
          onClose();
        }}>
          {session.visibility === 'project' ? (
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
          {session.visibility === 'project' ? 'Make private' : 'Share with project'}
        </button>
      )}
      {/* Label */}
      <SessionLabelMenu session={session} onClose={onClose} />
      {/* Move to Project */}
      {onMoveToProject && projects && projects.length > 0 && (
        <>
          <div className="border-t border-surface-700/50 my-1" />
          <div className="px-3 py-1 text-[10px] text-surface-600 uppercase tracking-wider">Move to</div>
          {projects.filter(p => p.id !== session.projectId).map((p) => (
            <button key={p.id} className={itemClass} onClick={() => { onMoveToProject(session.id, p.id); onClose(); }}>
              <svg className="w-3.5 h-3.5 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {session.projectId && (
            <button className={itemClass} onClick={() => { onMoveToProject(session.id, null); onClose(); }}>
              <svg className="w-3.5 h-3.5 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-surface-500">Remove from project</span>
            </button>
          )}
        </>
      )}
      {/* Divider */}
      <div className="border-t border-surface-700/50 my-1" />
      {/* Delete */}
      <button className={`${itemClass} !text-red-400 hover:!bg-red-950/30`} onClick={() => { onDelete(); onClose(); }}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete
      </button>
    </div>
  );
}

/* ── Session Item ── */

interface SessionItemProps {
  session: SessionMeta;
  isActive: boolean;
  currentUsername?: string;
  onSelect: (session: SessionMeta) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onMoveToProject?: (sessionId: string, projectId: string | null) => void;
  projects?: Project[];
}

export function SessionItem({ session, isActive, currentUsername, onSelect, onDelete, onRename, onToggleFavorite, onMoveToProject, projects }: SessionItemProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isStreaming = useSessionStore((s) => s.streamingSessions.has(session.id));
  const isUnread = useSessionStore((s) => s.unreadSessions.has(session.id));
  const isOwnUnread = isUnread && session.ownerUsername === currentUsername;
  const queueCount = useChatStore((s) => (s.messageQueue[session.id] ?? []).length);
  const isKanbanTask = session.name.startsWith('\u{1F7E2}'); // 🟢
  const markSessionRead = useSessionStore((s) => s.markSessionRead);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setEditName(session.name);
    setEditing(true);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startEditing();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(session.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <>
      <div
        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] transition-all duration-200 ${
          isActive
            ? 'bg-surface-800 text-gray-100 shadow-sm ring-1 ring-surface-700/50'
            : 'text-gray-400 hover:bg-surface-850 hover:text-gray-200'
        }`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', session.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => { markSessionRead(session.id); onSelect(session); }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Status badge: only when streaming or queued */}
        {isStreaming ? (
          <span className="shrink-0 text-[9px] font-semibold text-green-400 bg-green-400/10 border border-green-400/20 rounded px-1 py-0.5 leading-none animate-pulse">
            running{queueCount > 0 ? ` +${queueCount}` : ''}
          </span>
        ) : queueCount > 0 ? (
          <span className="shrink-0 text-[9px] font-semibold text-primary-300 bg-primary-500/10 border border-primary-500/20 rounded px-1 py-0.5 leading-none">
            queued {queueCount}
          </span>
        ) : isOwnUnread ? (
          <span className="shrink-0 text-[9px] font-semibold text-green-400 bg-green-400/10 border border-green-400/20 rounded px-1 py-0.5 leading-none">
            done
          </span>
        ) : session.favorite ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(session.id, false); }}
            className="shrink-0 text-yellow-400"
            title="Remove favorite"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
        ) : null}

        {/* Name */}
        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 h-[20px] bg-surface-700 text-gray-100 text-[13px] px-1.5 py-0 rounded border border-surface-600 outline-none focus:border-primary-500"
          />
        ) : (
          <span className={`flex-1 min-w-0 truncate leading-[20px] ${isOwnUnread ? 'font-bold text-gray-100' : 'font-medium'}`}>
            {/* Private lock icon (prefix) — only shown for private sessions in a project */}
            {session.projectId && session.visibility === 'private' && (
              <svg className="inline-block w-3 h-3 mr-1 text-surface-600 align-middle" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
            {session.name}
            {(session as any).engine === 'pi' && (
              <span className="ml-1 text-[8px] font-bold text-violet-300 bg-violet-500/20 px-1 rounded align-middle">PI</span>
            )}
            {session.roomId && (
              <span className="ml-1 text-[9px] text-surface-600 align-middle">#thread</span>
            )}
          </span>
        )}

        {/* Time (default) → action buttons (on hover) */}
        {!editing && (
          <>
            <span className="text-[10px] text-surface-700 shrink-0 group-hover:hidden">
              {session.projectId && session.ownerUsername && currentUsername && session.ownerUsername !== currentUsername
                ? <>{session.ownerUsername} · {relativeTime(session.updatedAt)}</>
                : <>{relativeTime(session.updatedAt)}{session.turnCount ? ` · ${session.turnCount}t` : ''}</>
              }
            </span>
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); startEditing(); }}
                className="p-0.5 hover:text-primary-400 hover:bg-primary-950/30 rounded transition-all text-surface-700"
                title="Rename"
                aria-label="Rename session"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                className="p-0.5 hover:text-red-400 hover:bg-red-950/30 rounded transition-all text-surface-700"
                title="Delete"
                aria-label="Delete session"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Context menu (portal-like: rendered outside the row via fragment) */}
      {ctxMenu && (
        <SessionContextMenu
          x={ctxMenu.x} y={ctxMenu.y} session={session}
          onRename={startEditing}
          onToggleFavorite={() => onToggleFavorite(session.id, !session.favorite)}
          onDelete={() => onDelete(session.id)}
          onClose={() => setCtxMenu(null)}
          onMoveToProject={onMoveToProject}
          projects={projects}
        />
      )}
    </>
  );
}

/* ── Session Label Menu (inline in context menu) ── */

function SessionLabelMenu({ session, onClose }: { session: SessionMeta; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const sessions = useSessionStore((s) => s.sessions);

  // Collect existing labels from the same project
  const existingLabels = useMemo(() => {
    if (!session.projectId) return [];
    const labelSet = new Set<string>();
    for (const s of sessions) {
      if (s.projectId === session.projectId && s.label) labelSet.add(s.label);
    }
    return [...labelSet].sort();
  }, [sessions, session.projectId]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const applyLabel = (label: string | null) => {
    // Optimistic: update UI immediately
    useSessionStore.getState().updateSessionMeta(session.id, { label });
    onClose();
    // Then persist in background
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ label }),
    }).catch(() => {});
  };

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  return (
    <>
      <button className={itemClass} onClick={() => setOpen(!open)}>
        <svg className="w-3.5 h-3.5 text-primary-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
        </svg>
        {session.label ? `Label: ${session.label}` : 'Set label'}
        <svg className={`w-3 h-3 ml-auto text-surface-600 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="py-1 border-t border-surface-700/30">
          {/* New label input */}
          <div className="px-3 py-1 flex items-center gap-1.5">
            <input
              ref={inputRef}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLabel.trim()) {
                  applyLabel(newLabel.trim());
                }
                if (e.key === 'Escape') setOpen(false);
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="New label..."
              className="flex-1 bg-surface-700 text-[11px] text-gray-200 px-2 py-1 rounded border border-surface-600 outline-none focus:border-primary-500/50 placeholder-surface-600"
            />
            {newLabel.trim() && (
              <button
                onClick={() => applyLabel(newLabel.trim())}
                className="text-[10px] text-primary-400 hover:text-primary-300 font-medium px-1"
              >
                Add
              </button>
            )}
          </div>
          {/* Existing labels */}
          {existingLabels.map((label) => (
            <button
              key={label}
              onClick={() => applyLabel(label)}
              className={`${itemClass} pl-6 ${session.label === label ? '!text-primary-400' : ''}`}
            >
              <svg className="w-3 h-3 text-primary-500/60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {label}
              {session.label === label && (
                <svg className="w-3 h-3 ml-auto text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
          {/* Remove label */}
          {session.label && (
            <>
              <div className="border-t border-surface-700/30 my-0.5" />
              <button className={`${itemClass} pl-6 !text-surface-500`} onClick={() => applyLabel(null)}>
                <svg className="w-3 h-3 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Remove label
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
