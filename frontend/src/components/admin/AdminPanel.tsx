import React, { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { useChatStore } from '../../stores/chat-store';

const API_BASE = '/api';

interface User {
  id: number;
  username: string;
  role: string;
  allowed_path: string;
  created_at: string;
}

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
  token?: string | null;
}

export function AdminPanel({ open, onClose, token }: AdminPanelProps) {
  const [tab, setTab] = useState<'users' | 'system'>('users');

  if (!open) return null;

  const tabClass = (t: string) =>
    `px-4 py-2 text-[13px] font-medium transition-colors border-b-2 ${
      tab === t
        ? 'text-primary-400 border-primary-500'
        : 'text-gray-500 hover:text-gray-300 border-transparent'
    }`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h2 className="text-[16px] font-bold text-gray-100">Admin</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-surface-800 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-800 px-6 shrink-0">
          <button className={tabClass('users')} onClick={() => setTab('users')}>User Management</button>
          <button className={tabClass('system')} onClick={() => setTab('system')}>System</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'users' && <UserManagement token={token} />}
          {tab === 'system' && <SystemInfo />}
        </div>
      </div>
    </div>
  );
}

// ───── Users Tab ─────

function UserManagement({ token }: { token?: string | null }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'member', allowed_path: '' });
  const [resetPwUserId, setResetPwUserId] = useState<number | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [error, setError] = useState('');

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/users`, { headers: headers() });
      if (res.ok) setUsers(await res.json());
    } catch {} finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const currentUsername = (() => {
    try {
      const t = token?.split('.')[1];
      if (t) return JSON.parse(atob(t)).username;
    } catch {}
    return '';
  })();

  const handleCreate = async () => {
    setError('');
    if (!newUser.username || !newUser.password) { setError('Username and password are required'); return; }
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify(newUser),
      });
      if (res.ok) {
        setShowForm(false);
        setNewUser({ username: '', password: '', role: 'member', allowed_path: '' });
        fetchUsers();
      } else {
        const data = await res.json();
        setError(data.error || 'Creation failed');
      }
    } catch { setError('Server error'); }
  };

  const handleRoleChange = async (userId: number, role: string) => {
    await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ role }),
    });
    fetchUsers();
  };

  const handlePathChange = async (userId: number, allowed_path: string) => {
    await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ allowed_path }),
    });
    fetchUsers();
  };

  const handleResetPassword = async (userId: number) => {
    if (!resetPwValue) return;
    await fetch(`${API_BASE}/admin/users/${userId}/password`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ password: resetPwValue }),
    });
    setResetPwUserId(null);
    setResetPwValue('');
  };

  const handleDelete = async (userId: number, username: string) => {
    if (!window.confirm(`Disable user "${username}"?`)) return;
    await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'DELETE', headers: headers(),
    });
    fetchUsers();
  };

  if (loading) {
    return <div className="text-sm text-gray-500 py-8 text-center">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-gray-400">
          <span className="text-gray-200 font-semibold">{users.length}</span> registered users
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[12px] px-3 py-1.5 rounded-lg bg-primary-600/20 border border-primary-500/30 text-primary-300 hover:bg-primary-600/30 transition-colors font-medium"
        >
          {showForm ? 'Cancel' : '+ Add User'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="p-4 bg-surface-800/40 rounded-lg border border-surface-700 space-y-3">
          {error && <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Username</label>
              <input
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className="w-full bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-primary-500/50"
                placeholder="username"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Password</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-primary-500/50"
                placeholder="password"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Role</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full bg-surface-900 border border-surface-700 text-gray-300 rounded-md px-3 py-2 text-[13px]"
              >
                <option value="viewer">viewer</option>
                <option value="member">member</option>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Work Directory</label>
              <input
                type="text"
                value={newUser.allowed_path}
                onChange={(e) => setNewUser({ ...newUser, allowed_path: e.target.value })}
                className="w-full bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-[13px] text-gray-200 font-mono focus:outline-none focus:border-primary-500/50"
                placeholder="Empty = full access"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setShowForm(false); setError(''); }}
              className="px-4 py-2 text-[12px] text-gray-400 hover:text-gray-200 transition-colors rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="px-4 py-2 text-[12px] bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors font-medium"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* User table */}
      <div className="rounded-lg border border-surface-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-800/60 text-[11px] text-gray-500 uppercase tracking-wider">
              <th className="text-left px-4 py-2.5 font-semibold">Name</th>
              <th className="text-left px-4 py-2.5 font-semibold">Role</th>
              <th className="text-left px-4 py-2.5 font-semibold">Work Directory</th>
              <th className="text-right px-4 py-2.5 font-semibold w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800/50">
            {users.map((u) => {
              const isSelf = u.username === currentUsername;
              return (
                <tr key={u.id} className="hover:bg-surface-800/30 transition-colors">
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                        u.role === 'admin'
                          ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                          : u.role === 'operator'
                          ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-500/30'
                          : u.role === 'viewer'
                          ? 'bg-gray-700/40 text-gray-500 border border-gray-600/40'
                          : 'bg-surface-700 text-gray-400 border border-surface-600'
                      }`}>
                        {u.username[0].toUpperCase()}
                      </div>
                      <span className="text-[13px] font-medium text-gray-200">{u.username}</span>
                      {isSelf && <span className="text-[10px] text-gray-600 bg-surface-800 px-1.5 py-0.5 rounded">you</span>}
                    </div>
                  </td>

                  {/* Role */}
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={isSelf}
                      className="bg-surface-900 border border-surface-700 text-gray-300 rounded-md px-2 py-1 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <option value="viewer">viewer</option>
                      <option value="member">member</option>
                      <option value="operator">operator</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>

                  {/* Path */}
                  <td className="px-4 py-3">
                    <PathEditor value={u.allowed_path} onSave={(v) => handlePathChange(u.id, v)} />
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {resetPwUserId === u.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="password"
                            value={resetPwValue}
                            onChange={(e) => setResetPwValue(e.target.value)}
                            placeholder="New password"
                            className="w-28 bg-surface-900 border border-surface-700 rounded-md px-2 py-1 text-[12px] text-gray-200 focus:outline-none focus:border-primary-500/50"
                            onKeyDown={(e) => e.key === 'Enter' && handleResetPassword(u.id)}
                            autoFocus
                          />
                          <button onClick={() => handleResetPassword(u.id)} className="p-1 text-primary-400 hover:text-primary-300 rounded" title="Confirm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button onClick={() => { setResetPwUserId(null); setResetPwValue(''); }} className="p-1 text-gray-500 hover:text-gray-300 rounded" title="Cancel">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => setResetPwUserId(u.id)}
                            className="p-1.5 text-gray-500 hover:text-yellow-400 hover:bg-surface-800 rounded-md transition-colors"
                            title="Reset password"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                          </button>
                          <button
                            onClick={() => handleDelete(u.id, u.username)}
                            disabled={isSelf}
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-surface-800 rounded-md transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                            title={isSelf ? 'Cannot delete yourself' : 'Disable user'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PathEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onSave(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onSave(draft); setEditing(false); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        className="w-full bg-surface-900 border border-primary-500/50 rounded-md px-2 py-1 text-[12px] text-gray-200 font-mono focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className="text-[12px] text-gray-500 font-mono hover:text-gray-300 transition-colors truncate max-w-[200px] block text-left"
      title={value || '(full access)'}
    >
      {value ? value.replace(/^\/home\/[^/]+/, '~') : '(all)'}
    </button>
  );
}

// ───── System Tab ─────

function SystemInfo() {
  const serverConfig = useSettingsStore((s) => s.serverConfig);
  const model = useChatStore((s) => s.model);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Server Info</h3>
        <div className="rounded-lg border border-surface-700 divide-y divide-surface-800/50">
          <InfoRow label="Workspace" value={serverConfig?.workspaceRoot || '-'} mono />
          <InfoRow label="Model" value={model || 'Not connected'} />
          <InfoRow label="Permission Mode" value={serverConfig?.permissionMode || '-'} />
          <InfoRow label="Version" value={serverConfig?.version || '-'} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-gray-400">{label}</span>
      <span className={`text-[13px] text-gray-200 ${mono ? 'font-mono' : ''} max-w-[400px] truncate`} title={value}>
        {value}
      </span>
    </div>
  );
}
