import React, { useState, useEffect, useRef } from 'react';
import { useProjectStore, type Project } from '../../../stores/project-store';
import { toastError, toastSuccess } from '../../../utils/toast';
import { useTranslation } from 'react-i18next';

export function ProjectSettingsPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation('layout');
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
        <div className={labelClass}>{t('projectMembers')}</div>
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
        <div className={labelClass}>{t('projectDescription')}</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('projectDescPlaceholder')}
          rows={2}
          className={`${inputClass} resize-none`}
        />
        <p className="text-[9px] text-surface-600 mt-0.5">Also saved to AGENTS.md in the project folder</p>
      </div>

      {/* Root Path */}
      <div className="mb-3">
        <div className={labelClass}>{t('projectFolder')}</div>
        <input
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
          placeholder={t('autoCreatedIn')}
          className={inputClass}
        />
        <p className="text-[9px] text-surface-600 mt-0.5">New chats will work in this folder. Leave empty for default.</p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1 text-[11px] text-surface-500 hover:text-gray-300 transition-colors">
          {t('common:cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 rounded text-[11px] font-medium text-white transition-colors disabled:opacity-50"
        >
          {saving ? t('common:saving') : t('common:save')}
        </button>
      </div>
    </div>
  );
}
