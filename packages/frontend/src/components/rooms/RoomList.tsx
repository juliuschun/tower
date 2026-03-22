import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRoomStore } from '../../stores/room-store';
import { useProjectStore } from '../../stores/project-store';
import { CreateRoomModal } from './CreateRoomModal';
import type { Room } from '../../stores/room-store';
import type { Project } from '@tower/shared';

function authHeaders(): Record<string, string> {
  const tk = localStorage.getItem('token');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tk) h['Authorization'] = `Bearer ${tk}`;
  return h;
}

interface RoomListProps {
  onSelectRoom: (roomId: string) => void;
}

export function RoomList({ onSelectRoom }: RoomListProps) {
  const rooms = useRoomStore((s) => s.rooms);
  const activeRoomId = useRoomStore((s) => s.activeRoomId);
  const unreadCounts = useRoomStore((s) => s.unreadCounts);
  const messagesByRoom = useRoomStore((s) => s.messagesByRoom);
  const collapsedGroups = useRoomStore((s) => s.collapsedRoomGroups);
  const toggleCollapsed = useRoomStore((s) => s.toggleRoomGroupCollapsed);
  const projects = useProjectStore((s) => s.projects);
  const [createOpen, setCreateOpen] = useState(false);
  const [createProjectId, setCreateProjectId] = useState<string | undefined>();

  // Fetch rooms on mount
  useEffect(() => {
    const tk = localStorage.getItem('token');
    const hdrs: Record<string, string> = {};
    if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
    fetch('/api/rooms', { headers: hdrs })
      .then((r) => r.ok ? r.json() : { rooms: [] })
      .then((data) => {
        useRoomStore.getState().setRooms(data.rooms || []);
        useRoomStore.getState().setPgEnabled(data.pgEnabled ?? false);
        if (data.unreadCounts) {
          useRoomStore.getState().setUnreadCounts(data.unreadCounts);
        }
      })
      .catch(() => {});
  }, []);

  // Group rooms by project (only show projects that have rooms)
  const grouped = useMemo(() => {
    const projectGroups = new Map<string, { project: Project; rooms: Room[] }>();
    const general: Room[] = [];

    for (const proj of projects) {
      projectGroups.set(proj.id, { project: proj, rooms: [] });
    }

    for (const room of rooms) {
      if (room.projectId && projectGroups.has(room.projectId)) {
        projectGroups.get(room.projectId)!.rooms.push(room);
      } else {
        general.push(room);
      }
    }

    // Show all projects (matching Sessions tab) — even without channels
    const sorted = [...projectGroups.values()]
      .sort((a, b) => {
        const unreadA = a.rooms.reduce((sum, r) => sum + (unreadCounts[r.id] || 0), 0);
        const unreadB = b.rooms.reduce((sum, r) => sum + (unreadCounts[r.id] || 0), 0);
        if (unreadA && !unreadB) return -1;
        if (!unreadA && unreadB) return 1;
        return a.project.sortOrder - b.project.sortOrder;
      });

    return { groups: sorted, general };
  }, [rooms, projects, unreadCounts]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Channels</span>
        <button
          onClick={() => { setCreateProjectId(undefined); setCreateOpen(true); }}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-surface-700 text-gray-500 hover:text-gray-300 transition-colors"
          title="Create Channel"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Channel list grouped by project */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {rooms.length === 0 && grouped.groups.length === 0 ? (
          <div className="text-center py-8 px-2">
            <p className="text-[12px] text-gray-500">No channels yet</p>
            <p className="text-[11px] text-gray-600 mt-1">Create one to get started</p>
          </div>
        ) : (
          <>
            {/* Project groups */}
            {grouped.groups.map(({ project, rooms: groupRooms }) => (
              <RoomProjectGroup
                key={project.id}
                project={project}
                rooms={groupRooms}
                collapsed={collapsedGroups.has(project.id)}
                activeRoomId={activeRoomId}
                unreadCounts={unreadCounts}
                messagesByRoom={messagesByRoom}
                projects={projects}
                onToggleCollapsed={() => toggleCollapsed(project.id)}
                onSelectRoom={onSelectRoom}
                onNewChannel={() => { setCreateProjectId(project.id); setCreateOpen(true); }}
              />
            ))}

            {/* General (no project) */}
            {grouped.general.length > 0 && (
              <div className="mb-1">
                {grouped.groups.length > 0 && (
                  <div
                    className="flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer transition-colors hover:bg-surface-850"
                    onClick={() => toggleCollapsed('__general__')}
                  >
                    <svg className={`w-3.5 h-3.5 text-surface-600 transition-transform shrink-0 ${collapsedGroups.has('__general__') ? '-rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    <svg className="w-4 h-4 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-gray-300 truncate">General</span>
                      <span className="text-[10px] tabular-nums shrink-0 text-surface-600">{grouped.general.length}</span>
                      {(() => {
                        const unread = grouped.general.reduce((sum, r) => sum + (unreadCounts[r.id] || 0), 0);
                        return unread > 0 ? (
                          <span className="text-[9px] font-semibold text-green-400 bg-green-400/10 border border-green-400/20 rounded px-1 py-0.5 leading-none shrink-0">
                            {unread} new
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                )}

                {(!collapsedGroups.has('__general__') || grouped.groups.length === 0) && (
                  <div className={grouped.groups.length > 0 ? 'pl-5 space-y-0.5' : 'space-y-0.5'}>
                    {grouped.general.map((room) => (
                      <RoomItem
                        key={room.id}
                        room={room}
                        isActive={room.id === activeRoomId}
                        unread={unreadCounts[room.id] || 0}
                        lastMsg={messagesByRoom[room.id]?.[messagesByRoom[room.id]?.length - 1]}
                        onSelect={onSelectRoom}
                        projects={projects}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <CreateRoomModal open={createOpen} onClose={() => setCreateOpen(false)} defaultProjectId={createProjectId} />
    </div>
  );
}

// ── Room Project Group (mirrors SessionItem's ProjectGroup UI) ────

interface RoomProjectGroupProps {
  project: Project;
  rooms: Room[];
  collapsed: boolean;
  activeRoomId: string | null;
  unreadCounts: Record<string, number>;
  messagesByRoom: Record<string, { senderName: string | null; content: string }[]>;
  projects: Project[];
  onToggleCollapsed: () => void;
  onSelectRoom: (roomId: string) => void;
  onNewChannel: () => void;
}

function RoomProjectGroup({
  project, rooms: groupRooms, collapsed, activeRoomId,
  unreadCounts, messagesByRoom, projects,
  onToggleCollapsed, onSelectRoom, onNewChannel,
}: RoomProjectGroupProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [dragOver, setDragOver] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  const totalUnread = groupRooms.reduce((sum, r) => sum + (unreadCounts[r.id] || 0), 0);
  const isEmpty = groupRooms.length === 0;

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const commitRename = async () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.name) {
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ name: trimmed }),
        });
        if (res.ok) {
          const updated = await res.json();
          useProjectStore.getState().updateProject(project.id, updated);
        }
      } catch {}
    }
    setEditing(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const roomId = e.dataTransfer.getData('text/room-id');
    if (roomId) {
      fetch(`/api/rooms/${roomId}`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ projectId: project.id }),
      }).then(res => res.ok ? res.json() : null).then(updated => {
        if (updated) useRoomStore.getState().updateRoom(roomId, { projectId: updated.projectId ?? null });
      }).catch(() => {});
    }
  };

  return (
    <div className="mb-1">
      {/* Group header — matches Sessions tab ProjectGroup */}
      <div
        className={`flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer transition-colors group/proj ${
          dragOver ? 'bg-primary-600/20 ring-1 ring-primary-500/40' : 'hover:bg-surface-850'
        }`}
        onClick={() => {
          if (collapsed && groupRooms.length > 0) {
            onToggleCollapsed();
            onSelectRoom(groupRooms[0].id);
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
        {isEmpty ? (
          <div className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <svg className={`w-3.5 h-3.5 text-surface-600 transition-transform shrink-0 ${collapsed ? '-rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
        {totalUnread > 0 ? (
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shrink-0" />
        ) : (
          <svg className={`w-4 h-4 shrink-0 ${isEmpty ? 'text-surface-700' : 'text-surface-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
              <span className={`text-[13px] font-bold truncate ${isEmpty ? 'text-surface-600' : totalUnread > 0 ? 'text-gray-100' : 'text-gray-300'}`}>
                {project.name}
              </span>
              {!isEmpty && (
                <span className="text-[10px] tabular-nums shrink-0 text-surface-600">
                  {groupRooms.length}
                </span>
              )}
              {totalUnread > 0 && (
                <span className="text-[9px] font-semibold text-green-400 bg-green-400/10 border border-green-400/20 rounded px-1 py-0.5 leading-none shrink-0">
                  {totalUnread} new
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setCtxMenu({ x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().bottom + 4 }); }}
                className="p-0.5 rounded text-surface-600 hover:text-gray-300 hover:bg-surface-700/50 transition-all shrink-0 ml-auto"
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

      {/* Rooms inside group */}
      {!collapsed && (
        <div className="pl-5 space-y-0.5">
          {groupRooms.map((room) => (
            <RoomItem
              key={room.id}
              room={room}
              isActive={room.id === activeRoomId}
              unread={unreadCounts[room.id] || 0}
              lastMsg={messagesByRoom[room.id]?.[messagesByRoom[room.id]?.length - 1]}
              onSelect={onSelectRoom}
              projects={projects}
            />
          ))}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ProjectGroupContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          project={project}
          onClose={() => setCtxMenu(null)}
          onNewChannel={onNewChannel}
        />
      )}
    </div>
  );
}

// ── Room Item ──────────────────────────────────────────────────────

interface RoomItemProps {
  room: Room;
  isActive: boolean;
  unread: number;
  lastMsg?: { senderName: string | null; content: string } | undefined;
  onSelect: (roomId: string) => void;
  projects: Project[];
}

function RoomItem({ room, isActive, unread, lastMsg, onSelect, projects }: RoomItemProps) {
  const hasUnread = unread > 0;
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => {
    setCtxMenu(null);
  }, []);

  const moveToProject = useCallback(async (projectId: string | null) => {
    try {
      const res = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        const updated = await res.json();
        useRoomStore.getState().updateRoom(room.id, { projectId: updated.projectId ?? null });
      }
    } catch {}
    closeMenu();
  }, [room.id, closeMenu]);

  const archiveRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) {
        useRoomStore.getState().removeRoom(room.id);
      }
    } catch {}
    closeMenu();
  }, [room.id, closeMenu]);

  return (
    <>
      <button
        onClick={() => onSelect(room.id)}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/room-id', room.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        className={`w-full text-left px-2 py-1 rounded transition-colors group ${
          isActive
            ? 'bg-primary-600/20 text-gray-100'
            : 'hover:bg-surface-800/60 text-gray-400'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-[14px] shrink-0 ${isActive ? 'text-gray-300' : 'text-gray-600'}`}>#</span>
            <span className={`text-[13px] truncate ${
              isActive ? 'text-gray-100' : hasUnread ? 'text-gray-200 font-semibold' : 'text-gray-400'
            }`}>
              {room.name}
            </span>
          </div>
          {hasUnread && (
            <span className="ml-1 px-1.5 py-0.5 bg-primary-600 text-[10px] font-bold text-white rounded-full min-w-[18px] text-center shrink-0">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        {lastMsg && (
          <p className={`text-[11px] truncate mt-0.5 pl-5 ${isActive ? 'text-gray-400' : 'text-gray-600'}`}>
            {lastMsg.senderName ? `${lastMsg.senderName}: ` : ''}
            {lastMsg.content.slice(0, 60)}
          </p>
        )}
      </button>

      {/* Context menu — matches SessionItem context menu style */}
      {ctxMenu && (
        <RoomContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          room={room}
          projects={projects}
          onClose={closeMenu}
          onSelect={onSelect}
          onMoveToProject={moveToProject}
          onArchive={archiveRoom}
        />
      )}
    </>
  );
}

// ── Project Group Context Menu (with Invite — mirrors Sessions tab) ──

function ProjectGroupContextMenu({ x, y, project, onClose, onNewChannel }: {
  x: number; y: number; project: Project;
  onClose: () => void;
  onNewChannel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([]);
  const [currentMembers, setCurrentMembers] = useState<{ userId: number; username: string; role: string }[]>([]);
  const inviteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Fetch users + members when invite panel opens
  useEffect(() => {
    if (!showInvite) return;
    const headers: Record<string, string> = {};
    const tk = localStorage.getItem('token');
    if (tk) headers['Authorization'] = `Bearer ${tk}`;
    fetch('/api/users/search?q=', { headers })
      .then(r => r.ok ? r.json() : [])
      .then(setAllUsers)
      .catch(() => {});
    fetch(`/api/projects/${project.id}/members`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(setCurrentMembers)
      .catch(() => {});
    setTimeout(() => inviteInputRef.current?.focus(), 50);
  }, [showInvite, project.id]);

  const handleInvite = async (userId: number) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/members`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        const user = allUsers.find(u => u.id === userId);
        setCurrentMembers(prev => [...prev, { userId, username: user?.username || '', role: 'member' }]);
      }
    } catch {}
  };

  const handleRemove = async (userId: number) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/members/${userId}`, {
        method: 'DELETE', headers: authHeaders(),
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

  // Invite / Members view
  if (showInvite) {
    return (
      <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl min-w-[220px]"
        style={{ left: x, top: y }}>
        {/* Search input */}
        <div className="px-3 py-2 border-b border-surface-700/50 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          <input
            ref={inviteInputRef}
            value={inviteQuery}
            onChange={(e) => setInviteQuery(e.target.value)}
            placeholder="Search members..."
            className="flex-1 bg-transparent text-[12px] text-gray-200 placeholder-surface-600 outline-none"
          />
        </div>

        {/* Users to invite */}
        {filteredUsers.length > 0 && (
          <div className="max-h-[150px] overflow-y-auto py-1">
            {filteredUsers.map(u => (
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
            ))}
          </div>
        )}

        {/* Current members */}
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
                      onClick={() => handleRemove(m.userId)}
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

  // Default menu
  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: x, top: y }}>
      {/* New Channel */}
      <button className={itemClass} onClick={() => { onNewChannel(); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        New Channel
      </button>

      <div className="border-t border-surface-700/50 my-1" />

      {/* Invite to Project */}
      <button className={itemClass} onClick={() => setShowInvite(true)}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        Invite to Project
      </button>

      {/* Members */}
      <button className={itemClass} onClick={() => setShowInvite(true)}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Members ({currentMembers.length || '...'})
      </button>
    </div>
  );
}

// ── Room Context Menu (matches SessionContextMenu style) ─────────

function RoomContextMenu({ x, y, room, projects, onClose, onSelect, onMoveToProject, onArchive }: {
  x: number; y: number; room: Room; projects: Project[];
  onClose: () => void;
  onSelect: (roomId: string) => void;
  onMoveToProject: (projectId: string | null) => void;
  onArchive: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
      style={{ left: x, top: y }}>
      {/* Open & Invite */}
      <button className={itemClass} onClick={() => { onSelect(room.id); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        Open & Invite
      </button>

      {/* Move to Project — inline list like SessionContextMenu */}
      {projects.length > 0 && (
        <>
          <div className="border-t border-surface-700/50 my-1" />
          <div className="px-3 py-1 text-[10px] text-surface-600 uppercase tracking-wider">Move to</div>
          {projects.filter(p => p.id !== room.projectId).map((p) => (
            <button key={p.id} className={itemClass} onClick={() => { onMoveToProject(p.id); onClose(); }}>
              <svg className="w-3.5 h-3.5 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {room.projectId && (
            <button className={itemClass} onClick={() => { onMoveToProject(null); onClose(); }}>
              <svg className="w-3.5 h-3.5 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-surface-500">Remove from project</span>
            </button>
          )}
        </>
      )}

      <div className="border-t border-surface-700/50 my-1" />

      {/* Archive */}
      <button className={`${itemClass} !text-red-400`} onClick={() => { onArchive(); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        Archive Channel
      </button>
    </div>
  );
}
