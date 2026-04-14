import React, { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { toastError, toastSuccess } from '../../../utils/toast';
import { useTranslation } from 'react-i18next';

export function NewProjectButton() {
  const { t } = useTranslation('layout');
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) { setCreating(false); return; }
    setSubmitting(true);
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
    setSubmitting(false);
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
            placeholder={t('projectNamePlaceholder')}
            className="w-full bg-surface-700 border border-surface-600 rounded text-[12px] text-gray-200 px-2.5 py-1.5 placeholder-surface-600 outline-none focus:border-primary-500/50"
          />

          {/* Member invite */}
          <div className="relative">
            <input
              value={memberSearch}
              onChange={(e) => searchUsers(e.target.value)}
              placeholder={t('inviteMembersHint')}
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
              <option value="">{t('inviteGroupHint')}</option>
              {myGroups.map(g => <option key={g.id} value={g.id}>{g.name} (all members)</option>)}
            </select>
          )}

          <p className="text-[10px] text-surface-600 px-0.5">
            {selectedMembers.length > 0 || inviteGroupId
              ? t('invitedMembersCanSee')
              : t('onlyYouAndAdmin')
            }
          </p>
        </div>
      )}
    </div>
  );
}
