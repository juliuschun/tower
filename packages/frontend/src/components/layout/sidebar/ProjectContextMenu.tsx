import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { type Project } from '../../../stores/project-store';
import { useTranslation } from 'react-i18next';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';
import { ManageDecksPanel } from './ManageDecksPanel';

export function ProjectContextMenu({ x, y, project, onRename, onDelete, onClose, onNewChat, sessionCount, previewCount, expanded, onToggleExpanded }: {
  x: number; y: number; project: Project;
  onRename: () => void; onDelete: () => void;
  onClose: () => void;
  onNewChat: () => void;
  sessionCount: number;
  previewCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { t } = useTranslation('layout');
  const ref = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showManageDecks, setShowManageDecks] = useState(false);
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

  if (showManageDecks) {
    return (
      <div ref={ref} className="fixed z-50" style={adjustedPos}>
        <ManageDecksPanel projectId={project.id} onClose={onClose} />
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
        {t('newChat')}
      </button>
      {/* Show all / Show less */}
      {sessionCount > previewCount && (
        <button className={itemClass} onClick={() => { onToggleExpanded(); onClose(); }}>
          <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {expanded ? t('showLess') : t('showAll', { count: sessionCount })}
        </button>
      )}
      <div className="border-t border-surface-700/50 my-1" />
      {/* Invite Members */}
      <button className={itemClass} onClick={() => setShowInvite(true)}>
        <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        {t('inviteMembersMenu')}
      </button>
      {/* Rename */}
      <button className={itemClass} onClick={() => { onRename(); onClose(); }}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        {t('common:rename')}
      </button>
      {/* Settings */}
      <button className={itemClass} onClick={() => setShowSettings(true)}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {t('settings')}
      </button>
      {/* Manage Decks */}
      <button className={itemClass} onClick={() => setShowManageDecks(true)}>
        <svg className="w-3.5 h-3.5 text-primary-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
        </svg>
        {t('manageDecks')}
      </button>
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
        {t('deleteProject')}
      </button>
    </div>
  );
}
