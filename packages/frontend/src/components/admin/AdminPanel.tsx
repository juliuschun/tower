import React, { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { useChatStore } from '../../stores/chat-store';

const API_BASE = '/api';

interface User {
  id: number;
  username: string;
  role: string;
  allowed_path: string;
  password_plain: string;
  created_at: string;
}

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
  token?: string | null;
}

export function AdminPanel({ open, onClose, token }: AdminPanelProps) {
  const [tab, setTab] = useState<'users' | 'groups' | 'models' | 'accounts' | 'prompts' | 'skills' | 'heartbeat' | 'system'>('users');

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
          <button className={tabClass('users')} onClick={() => setTab('users')}>Users</button>
          <button className={tabClass('groups')} onClick={() => setTab('groups')}>Groups</button>
          <button className={tabClass('models')} onClick={() => setTab('models')}>Models</button>
          <button className={tabClass('accounts')} onClick={() => setTab('accounts')}>Accounts</button>
          <button className={tabClass('prompts')} onClick={() => setTab('prompts')}>System Prompt</button>
          <button className={tabClass('skills')} onClick={() => setTab('skills')}>Skills</button>
          <button className={tabClass('heartbeat')} onClick={() => setTab('heartbeat')}>Heartbeat</button>
          <button className={tabClass('system')} onClick={() => setTab('system')}>System</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'users' && <UserManagement token={token} />}
          {tab === 'groups' && <GroupManagement token={token} />}
          {tab === 'models' && <ModelManagement token={token} />}
          {tab === 'accounts' && <ClaudeAccountManagement token={token} />}
          {tab === 'prompts' && <SystemPromptEditor token={token} />}
          {tab === 'skills' && <SkillsManagement token={token} />}
          {tab === 'heartbeat' && <HeartbeatManagement token={token} />}
          {tab === 'system' && <SystemInfo />}
        </div>
      </div>
    </div>
  );
}

// ───── Users Tab ─────

interface SimpleGroup {
  id: number;
  name: string;
  isGlobal: boolean;
  members: { id: number }[];
}

function UserManagement({ token }: { token?: string | null }) {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<SimpleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', passwordConfirm: '', role: 'member', allowed_path: '' });
  const [resetPwUserId, setResetPwUserId] = useState<number | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [resetPwConfirm, setResetPwConfirm] = useState('');
  const [resetPwError, setResetPwError] = useState('');
  const [error, setError] = useState('');

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchUsers = useCallback(async () => {
    try {
      const [usersRes, groupsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/users`, { headers: headers() }),
        fetch(`${API_BASE}/admin/groups`, { headers: headers() }),
      ]);
      if (usersRes.ok) setUsers(await usersRes.json());
      if (groupsRes.ok) setGroups(await groupsRes.json());
    } catch {} finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const getUserGroups = (userId: number) =>
    groups.filter(g => g.members.some(m => m.id === userId));

  const getAvailableGroups = (userId: number) =>
    groups.filter(g => !g.members.some(m => m.id === userId));

  const handleAddToGroup = async (userId: number, groupId: number) => {
    await fetch(`${API_BASE}/admin/groups/${groupId}/users`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ userId }),
    });
    fetchUsers();
  };

  const handleRemoveFromGroup = async (userId: number, groupId: number) => {
    await fetch(`${API_BASE}/admin/groups/${groupId}/users/${userId}`, {
      method: 'DELETE', headers: headers(),
    });
    fetchUsers();
  };

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
    if (newUser.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newUser.password !== newUser.passwordConfirm) { setError('Passwords do not match'); return; }
    try {
      const { passwordConfirm: _, ...payload } = newUser;
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowForm(false);
        setNewUser({ username: '', password: '', passwordConfirm: '', role: 'member', allowed_path: '' });
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
    setResetPwError('');
    if (!resetPwValue) return;
    if (resetPwValue.length < 8) { setResetPwError('Min 8 characters'); return; }
    if (resetPwValue !== resetPwConfirm) { setResetPwError('Passwords do not match'); return; }
    const res = await fetch(`${API_BASE}/admin/users/${userId}/password`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ password: resetPwValue }),
    });
    if (res.ok) {
      setResetPwUserId(null);
      setResetPwValue('');
      setResetPwConfirm('');
      setResetPwError('');
    } else {
      const data = await res.json();
      setResetPwError(data.error || 'Reset failed');
    }
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
                type="text"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-[13px] text-gray-200 font-mono focus:outline-none focus:border-primary-500/50"
                placeholder="password (min 8 chars)"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Confirm Password</label>
              <input
                type="text"
                value={newUser.passwordConfirm}
                onChange={(e) => setNewUser({ ...newUser, passwordConfirm: e.target.value })}
                className={`w-full bg-surface-900 border rounded-md px-3 py-2 text-[13px] text-gray-200 font-mono focus:outline-none focus:border-primary-500/50 ${
                  newUser.passwordConfirm && newUser.password !== newUser.passwordConfirm ? 'border-red-500/50' : 'border-surface-700'
                }`}
                placeholder="confirm password"
                autoComplete="off"
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
              <th className="text-left px-4 py-2.5 font-semibold">Password</th>
              <th className="text-left px-4 py-2.5 font-semibold">Role</th>
              <th className="text-left px-4 py-2.5 font-semibold">Groups</th>
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

                  {/* Password */}
                  <td className="px-4 py-3">
                    <PasswordCell password={u.password_plain} userId={u.id} token={token} onUpdate={fetchUsers} />
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

                  {/* Groups */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {getUserGroups(u.id).map(g => (
                        <span key={g.id} className="inline-flex items-center gap-0.5 text-[10px] bg-primary-600/15 text-primary-300 px-1.5 py-0.5 rounded border border-primary-500/20">
                          {g.name}{g.isGlobal ? ' *' : ''}
                          <button onClick={() => handleRemoveFromGroup(u.id, g.id)} className="text-primary-500/50 hover:text-red-400 ml-0.5">
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </span>
                      ))}
                      {getAvailableGroups(u.id).length > 0 && (
                        <select
                          className="bg-transparent border border-surface-700 text-gray-500 rounded px-1 py-0.5 text-[10px] cursor-pointer hover:border-primary-500/40"
                          value=""
                          onChange={(e) => { if (e.target.value) handleAddToGroup(u.id, parseInt(e.target.value)); }}
                        >
                          <option value="">+</option>
                          {getAvailableGroups(u.id).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      )}
                      {groups.length === 0 && <span className="text-[10px] text-gray-600">—</span>}
                    </div>
                  </td>

                  {/* Path */}
                  <td className="px-4 py-3">
                    <PathEditor value={u.allowed_path} onSave={(v) => handlePathChange(u.id, v)} />
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {resetPwUserId === u.id ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <input
                              type="password"
                              value={resetPwValue}
                              onChange={(e) => { setResetPwValue(e.target.value); setResetPwError(''); }}
                              placeholder="New password"
                              className="w-28 bg-surface-900 border border-surface-700 rounded-md px-2 py-1 text-[12px] text-gray-200 focus:outline-none focus:border-primary-500/50"
                              autoFocus
                            />
                            <input
                              type="password"
                              value={resetPwConfirm}
                              onChange={(e) => { setResetPwConfirm(e.target.value); setResetPwError(''); }}
                              placeholder="Confirm"
                              className={`w-28 bg-surface-900 border rounded-md px-2 py-1 text-[12px] text-gray-200 focus:outline-none focus:border-primary-500/50 ${
                                resetPwConfirm && resetPwValue !== resetPwConfirm ? 'border-red-500/50' : 'border-surface-700'
                              }`}
                              onKeyDown={(e) => e.key === 'Enter' && handleResetPassword(u.id)}
                            />
                            <button onClick={() => handleResetPassword(u.id)} className="p-1 text-primary-400 hover:text-primary-300 rounded" title="Confirm">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            </button>
                            <button onClick={() => { setResetPwUserId(null); setResetPwValue(''); setResetPwConfirm(''); setResetPwError(''); }} className="p-1 text-gray-500 hover:text-gray-300 rounded" title="Cancel">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                          {resetPwError && <span className="text-[10px] text-red-400 pl-1">{resetPwError}</span>}
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

function PasswordCell({ password, userId, token, onUpdate }: { password: string; userId: number; token?: string | null; onUpdate: () => void }) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!draft) return;
    if (draft.length < 8) { setError('Min 8 chars'); return; }
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/admin/users/${userId}/password`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ password: draft }),
    });
    if (res.ok) {
      setEditing(false); setDraft(''); setError('');
      onUpdate();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed');
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(''); }}
            placeholder="New password"
            className="w-28 bg-surface-900 border border-surface-700 rounded-md px-2 py-1 text-[12px] text-gray-200 font-mono focus:outline-none focus:border-primary-500/50"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button onClick={handleSave} className="p-0.5 text-primary-400 hover:text-primary-300" title="Save">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </button>
          <button onClick={() => { setEditing(false); setDraft(''); setError(''); }} className="p-0.5 text-gray-500 hover:text-gray-300" title="Cancel">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>
    );
  }

  if (!password) {
    return (
      <button onClick={() => setEditing(true)} className="text-[11px] text-gray-600 hover:text-primary-400 italic transition-colors" title="Set password">
        set password
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[12px] font-mono text-gray-400">{visible ? password : '••••••••'}</span>
      <button
        onClick={() => setVisible(!visible)}
        className="p-0.5 text-gray-600 hover:text-gray-400 transition-colors"
        title={visible ? 'Hide' : 'Show'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {visible
            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
            : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
          }
        </svg>
      </button>
      <button
        onClick={() => { setDraft(password); setEditing(true); }}
        className="p-0.5 text-gray-600 hover:text-yellow-400 transition-colors"
        title="Change password"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
      </button>
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

// ───── Groups Tab ─────

interface GroupData {
  id: number;
  name: string;
  description: string | null;
  isGlobal: boolean;
  members: { id: number; username: string }[];
  projects: { id: string; name: string }[];
}

function GroupManagement({ token }: { token?: string | null }) {
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', description: '', isGlobal: false });
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/groups`, { headers: headers() });
      if (res.ok) setGroups(await res.json());
    } catch {} finally { setLoading(false); }
  }, [headers]);

  const fetchMeta = useCallback(async () => {
    try {
      const [usersRes, projectsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/users`, { headers: headers() }),
        fetch(`${API_BASE}/projects`, { headers: headers() }),
      ]);
      if (usersRes.ok) setAllUsers((await usersRes.json()).map((u: any) => ({ id: u.id, username: u.username })));
      if (projectsRes.ok) setAllProjects((await projectsRes.json()).map((p: any) => ({ id: p.id, name: p.name })));
    } catch {}
  }, [headers]);

  useEffect(() => { fetchGroups(); fetchMeta(); }, [fetchGroups, fetchMeta]);

  const handleCreate = async () => {
    setError('');
    if (!newGroup.name.trim()) { setError('Group name is required'); return; }
    try {
      const res = await fetch(`${API_BASE}/admin/groups`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify(newGroup),
      });
      if (res.ok) {
        setShowForm(false);
        setNewGroup({ name: '', description: '', isGlobal: false });
        fetchGroups();
      } else {
        const data = await res.json();
        setError(data.error || 'Creation failed');
      }
    } catch { setError('Server error'); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete group "${name}"? Members will be unlinked.`)) return;
    await fetch(`${API_BASE}/admin/groups/${id}`, { method: 'DELETE', headers: headers() });
    fetchGroups();
  };

  const handleAddUser = async (groupId: number, userId: number) => {
    await fetch(`${API_BASE}/admin/groups/${groupId}/users`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ userId }),
    });
    fetchGroups();
  };

  const handleRemoveUser = async (groupId: number, userId: number) => {
    await fetch(`${API_BASE}/admin/groups/${groupId}/users/${userId}`, {
      method: 'DELETE', headers: headers(),
    });
    fetchGroups();
  };

  const handleInviteGroupToProject = async (groupId: number, projectId: string) => {
    await fetch(`${API_BASE}/projects/${projectId}/members`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ groupId }),
    });
    fetchGroups();
  };

  if (loading) return <div className="text-sm text-gray-500 py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-gray-400">
          <span className="text-gray-200 font-semibold">{groups.length}</span> groups
          {groups.length === 0 && <span className="text-gray-600 ml-2">— no groups means all projects are visible to everyone</span>}
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[12px] px-3 py-1.5 rounded-lg bg-primary-600/20 border border-primary-500/30 text-primary-300 hover:bg-primary-600/30 transition-colors font-medium"
        >
          {showForm ? 'Cancel' : '+ New Group'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="p-4 bg-surface-800/40 rounded-lg border border-surface-700 space-y-3">
          {error && <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Name</label>
              <input
                type="text"
                value={newGroup.name}
                onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                className="w-full bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-primary-500/50"
                placeholder="e.g. Marketing"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Description</label>
              <input
                type="text"
                value={newGroup.description}
                onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                className="w-full bg-surface-900 border border-surface-700 rounded-md px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-primary-500/50"
                placeholder="optional"
              />
            </div>
          </div>
          {/* Groups are now a bulk-invite tool, not access control */}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setShowForm(false); setError(''); }} className="px-4 py-2 text-[12px] text-gray-400 hover:text-gray-200 transition-colors rounded-md">Cancel</button>
            <button onClick={handleCreate} className="px-4 py-2 text-[12px] bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors font-medium">Create</button>
          </div>
        </div>
      )}

      {/* Groups list */}
      <div className="space-y-2">
        {groups.map((g) => {
          const isExpanded = expandedId === g.id;
          const availableUsers = allUsers.filter(u => !g.members.some(m => m.id === u.id));

          return (
            <div key={g.id} className="rounded-lg border border-surface-700 overflow-hidden">
              {/* Group header */}
              <div
                className="flex items-center justify-between px-4 py-3 bg-surface-800/40 cursor-pointer hover:bg-surface-800/60 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : g.id)}
              >
                <div className="flex items-center gap-2">
                  <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-[13px] font-semibold text-gray-200">{g.name}</span>
                  {g.description && <span className="text-[11px] text-gray-600 ml-1">{g.description}</span>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-500">
                  <span>{g.members.length} members</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(g.id, g.name); }}
                    className="p-1 text-gray-600 hover:text-red-400 transition-colors rounded"
                    title="Delete group"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-4 py-3 space-y-4 border-t border-surface-700/50">
                  {/* Members */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Members</span>
                      {availableUsers.length > 0 && (
                        <select
                          className="bg-surface-900 border border-surface-700 text-gray-400 rounded-md px-2 py-1 text-[11px]"
                          value=""
                          onChange={(e) => { if (e.target.value) handleAddUser(g.id, parseInt(e.target.value)); }}
                        >
                          <option value="">+ Add member</option>
                          {availableUsers.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.members.length === 0 && <span className="text-[11px] text-gray-600">No members</span>}
                      {g.members.map(m => (
                        <span key={m.id} className="inline-flex items-center gap-1 text-[11px] bg-surface-800 text-gray-300 px-2 py-1 rounded-md border border-surface-700">
                          {m.username}
                          <button onClick={() => handleRemoveUser(g.id, m.id)} className="text-gray-600 hover:text-red-400 ml-0.5">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Invite group to project */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Invite to Project</span>
                    </div>
                    {allProjects.length > 0 ? (
                      <select
                        className="bg-surface-900 border border-surface-700 text-gray-400 rounded-md px-2 py-1 text-[11px]"
                        value=""
                        onChange={(e) => { if (e.target.value) handleInviteGroupToProject(g.id, e.target.value); }}
                      >
                        <option value="">Select project to invite all members...</option>
                        {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-[11px] text-gray-600">No projects available</span>
                    )}
                    <p className="text-[10px] text-gray-600 mt-1">Adds all group members to the selected project (snapshot copy)</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* How it works */}
      <div className="p-3 bg-surface-800/30 rounded-lg border border-surface-700/50">
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">How it works</h4>
        <div className="text-[12px] text-gray-500 space-y-1">
          <p><strong className="text-gray-400">Groups</strong> = bulk-invite tool for adding many users to a project at once.</p>
          <p><strong className="text-gray-400">Project access</strong> is now controlled by project members, not groups.</p>
          <p><strong className="text-gray-400">Project owners</strong> can invite/remove members directly.</p>
          <p><strong className="text-gray-400">Admin</strong> users always see all projects.</p>
        </div>
      </div>
    </div>
  );
}

// ───── System Prompt Tab ─────

interface SystemPromptData {
  id: number;
  name: string;
  prompt: string;
  updated_at: string;
}

function SystemPromptEditor({ token }: { token?: string | null }) {
  const [prompts, setPrompts] = useState<SystemPromptData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/system-prompts`, { headers: headers() });
      if (res.ok) setPrompts(await res.json());
    } catch {} finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  const handleEdit = (p: SystemPromptData) => {
    setEditingName(p.name);
    setEditDraft(p.prompt);
    setSavedAt(null);
  };

  const handleSave = async () => {
    if (!editingName) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/system-prompts/${editingName}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ prompt: editDraft }),
      });
      if (res.ok) {
        setSavedAt(new Date().toLocaleTimeString());
        fetchPrompts();
      }
    } catch {} finally { setSaving(false); }
  };

  const handleCancel = () => {
    setEditingName(null);
    setEditDraft('');
    setSavedAt(null);
  };

  if (loading) {
    return <div className="text-sm text-gray-500 py-8 text-center">Loading...</div>;
  }

  // If editing, show full-screen editor
  if (editingName) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-200">{editingName}</span>
            <span className="text-[11px] text-gray-600">system prompt</span>
          </div>
          <div className="flex items-center gap-2">
            {savedAt && (
              <span className="text-[11px] text-green-400">Saved at {savedAt}</span>
            )}
            <button
              onClick={handleCancel}
              className="text-[12px] px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition-colors font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <textarea
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault();
              handleSave();
            }
          }}
          className="w-full h-[400px] bg-surface-900 border border-surface-700 rounded-lg px-4 py-3 text-[13px] text-gray-200 font-mono leading-relaxed resize-none focus:outline-none focus:border-primary-500/50"
          placeholder="Enter system prompt..."
          autoFocus
        />
        <div className="text-[11px] text-gray-600">
          This prompt is injected at the start of every conversation. It sets team-wide rules and behavior.
          <br />
          Tip: Use Cmd/Ctrl+S to save quickly. Role-specific context (user name, role, workspace path) is appended automatically.
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-gray-400">
          Manage system prompts injected into all conversations. The <span className="text-gray-200 font-semibold">default</span> prompt applies to everyone.
        </p>
      </div>

      <div className="rounded-lg border border-surface-700 divide-y divide-surface-800/50">
        {prompts.map((p) => (
          <div key={p.id} className="px-4 py-3 hover:bg-surface-800/30 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-gray-200">{p.name}</span>
                {p.name === 'default' && (
                  <span className="text-[10px] bg-primary-600/20 text-primary-400 border border-primary-500/30 px-1.5 py-0.5 rounded-full">active</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600">
                  Updated {new Date(p.updated_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleEdit(p)}
                  className="text-[12px] px-2.5 py-1 rounded-md text-gray-400 hover:text-primary-400 hover:bg-surface-800 transition-colors"
                >
                  Edit
                </button>
              </div>
            </div>
            <pre className="text-[12px] text-gray-500 font-mono whitespace-pre-wrap line-clamp-3 leading-relaxed">
              {p.prompt}
            </pre>
          </div>
        ))}
      </div>

      <div className="p-3 bg-surface-800/30 rounded-lg border border-surface-700/50">
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">How it works</h4>
        <div className="text-[12px] text-gray-500 space-y-1">
          <p>Every conversation gets this system prompt + auto-appended user context:</p>
          <div className="font-mono text-[11px] bg-surface-900/50 rounded px-3 py-2 text-gray-400 mt-1">
            [your prompt here]<br/>
            <br/>
            User: john (role: member)<br/>
            System package management requires IT team assistance.<br/>
            Your workspace is restricted to: ~/workspace
          </div>
        </div>
      </div>
    </div>
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

// ───── Model Management ─────

interface ClaudeModelEntry { id: string; name: string; badge: string; enabled: boolean }
interface PiModelEntry { provider: string; modelId: string; name: string; badge: string; enabled: boolean }
interface ModelDefaults { session: string; ai_reply: string; ai_task: string }
interface ModelsData { claude: ClaudeModelEntry[]; pi: PiModelEntry[]; defaults?: ModelDefaults }

function ModelManagement({ token }: { token?: string | null }) {
  const [models, setModels] = useState<ModelsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingPi, setAddingPi] = useState(false);
  const [newPi, setNewPi] = useState({ provider: 'openrouter', modelId: '', name: '', badge: 'OR' });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const fetchModels = useCallback(() => {
    fetch(`${API_BASE}/admin/models`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setModels(d))
      .catch(() => {});
  }, [token]);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const save = async (updated: ModelsData) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/models`, { method: 'PUT', headers, body: JSON.stringify(updated) });
      if (res.ok) {
        setModels(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleClaude = (idx: number) => {
    if (!models) return;
    const updated = { ...models, claude: models.claude.map((m, i) => i === idx ? { ...m, enabled: !m.enabled } : m) };
    save(updated);
  };

  const togglePi = (idx: number) => {
    if (!models) return;
    const updated = { ...models, pi: models.pi.map((m, i) => i === idx ? { ...m, enabled: !m.enabled } : m) };
    save(updated);
  };

  const deletePi = (idx: number) => {
    if (!models) return;
    const updated = { ...models, pi: models.pi.filter((_, i) => i !== idx) };
    save(updated);
  };

  const addPi = () => {
    if (!models || !newPi.modelId || !newPi.name) return;
    const entry: PiModelEntry = { ...newPi, enabled: true };
    const updated = { ...models, pi: [...models.pi, entry] };
    save(updated);
    setNewPi({ provider: 'openrouter', modelId: '', name: '', badge: 'OR' });
    setAddingPi(false);
  };

  if (!models) return <div className="text-gray-500 text-sm py-8 text-center">Loading...</div>;

  const rowClass = 'flex items-center gap-3 px-4 py-2.5 border-b border-surface-800 last:border-0';
  const toggleClass = (on: boolean) =>
    `w-9 h-5 rounded-full relative cursor-pointer transition-colors ${on ? 'bg-primary-500' : 'bg-surface-600'}`;
  const dotClass = (on: boolean) =>
    `absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'left-4' : 'left-0.5'}`;

  const enabledClaude = models.claude.filter(m => m.enabled);
  const enabledPi = models.pi.filter(m => m.enabled);
  const currentDefaults: ModelDefaults = models.defaults ?? { session: 'claude-opus-4-6', ai_reply: 'claude-haiku-4-5-20251001', ai_task: 'claude-sonnet-4-6' };

  const saveDefaults = (key: keyof ModelDefaults, value: string) => {
    const updated = { ...models, defaults: { ...currentDefaults, [key]: value } };
    save(updated);
  };

  // session: Claude only (SDK sessions), @ai/@task: Claude + Pi
  const defaultModelOptions = (key: keyof ModelDefaults) => {
    const claudeOpts = enabledClaude.map(m => ({ id: m.id, name: m.name, group: 'Claude' }));
    if (key === 'session') return claudeOpts;
    const piOpts = enabledPi.map(m => ({ id: `${m.provider}/${m.modelId}`, name: m.name, group: 'Pi' }));
    return [...claudeOpts, ...piOpts];
  };

  return (
    <div className="space-y-6">
      {/* Default Models */}
      <div>
        <h3 className="text-[13px] font-semibold text-gray-300 uppercase tracking-wider mb-2">Default Models</h3>
        <div className="bg-surface-800/50 rounded-lg border border-surface-700 divide-y divide-surface-700/50">
          {([
            { key: 'session' as const, label: 'Session', desc: 'Default model for new chat sessions' },
            { key: 'ai_reply' as const, label: '@ai Reply', desc: 'Model for quick AI replies in channels' },
            { key: 'ai_task' as const, label: '@task Execution', desc: 'Model for full task execution in channels' },
          ]).map(({ key, label, desc }) => {
            const options = defaultModelOptions(key);
            const groups = [...new Set(options.map(o => o.group))];
            return (
              <div key={key} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-gray-200 font-medium">{label}</div>
                  <div className="text-[11px] text-gray-500">{desc}</div>
                </div>
                <select
                  value={currentDefaults[key]}
                  onChange={(e) => saveDefaults(key, e.target.value)}
                  className="bg-surface-700 border border-surface-600 rounded-md px-3 py-1.5 text-[13px] text-gray-200 min-w-[180px]"
                >
                  {groups.length > 1 ? (
                    groups.map(g => (
                      <optgroup key={g} label={g}>
                        {options.filter(o => o.group === g).map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </optgroup>
                    ))
                  ) : (
                    options.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))
                  )}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Claude Models */}
      <div>
        <h3 className="text-[13px] font-semibold text-gray-300 uppercase tracking-wider mb-2">Claude (MAX)</h3>
        <div className="bg-surface-800/50 rounded-lg border border-surface-700">
          {models.claude.map((m, i) => (
            <div key={m.id} className={rowClass}>
              <div className={toggleClass(m.enabled)} onClick={() => toggleClaude(i)}>
                <div className={dotClass(m.enabled)} />
              </div>
              <span className="text-[13px] text-gray-200 flex-1">{m.name}</span>
              <span className="text-[11px] text-gray-500 font-mono">{m.id}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-700 text-gray-400">{m.badge}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pi Models */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-gray-300 uppercase tracking-wider">Pi (OpenRouter)</h3>
          <button
            onClick={() => setAddingPi(!addingPi)}
            className="text-[12px] text-primary-400 hover:text-primary-300 transition-colors"
          >
            {addingPi ? 'Cancel' : '+ Add Model'}
          </button>
        </div>

        {addingPi && (
          <div className="bg-surface-800/50 rounded-lg border border-surface-700 p-4 mb-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Model ID (e.g. x-ai/grok-4.1)"
                value={newPi.modelId}
                onChange={e => setNewPi({ ...newPi, modelId: e.target.value })}
                className="bg-surface-700 border border-surface-600 rounded px-3 py-1.5 text-[13px] text-gray-200 placeholder:text-gray-600"
              />
              <input
                placeholder="Display Name"
                value={newPi.name}
                onChange={e => setNewPi({ ...newPi, name: e.target.value })}
                className="bg-surface-700 border border-surface-600 rounded px-3 py-1.5 text-[13px] text-gray-200 placeholder:text-gray-600"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <input
                placeholder="Provider"
                value={newPi.provider}
                onChange={e => setNewPi({ ...newPi, provider: e.target.value })}
                className="bg-surface-700 border border-surface-600 rounded px-3 py-1.5 text-[13px] text-gray-200 placeholder:text-gray-600"
              />
              <input
                placeholder="Badge (e.g. OR)"
                value={newPi.badge}
                onChange={e => setNewPi({ ...newPi, badge: e.target.value })}
                className="bg-surface-700 border border-surface-600 rounded px-3 py-1.5 text-[13px] text-gray-200 placeholder:text-gray-600"
              />
              <button
                onClick={addPi}
                disabled={!newPi.modelId || !newPi.name}
                className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-[13px] rounded px-3 py-1.5 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}

        <div className="bg-surface-800/50 rounded-lg border border-surface-700">
          {models.pi.length === 0 && (
            <div className="text-gray-500 text-[13px] py-4 text-center">No Pi models configured</div>
          )}
          {models.pi.map((m, i) => (
            <div key={`${m.provider}/${m.modelId}`} className={rowClass}>
              <div className={toggleClass(m.enabled)} onClick={() => togglePi(i)}>
                <div className={dotClass(m.enabled)} />
              </div>
              <span className="text-[13px] text-gray-200 flex-1">{m.name}</span>
              <span className="text-[11px] text-gray-500 font-mono">{m.provider}/{m.modelId}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-700 text-gray-400">{m.badge}</span>
              <button
                onClick={() => deletePi(i)}
                className="text-gray-600 hover:text-red-400 transition-colors p-1"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {saving && <div className="text-[12px] text-primary-400 text-center">Saving...</div>}
    </div>
  );
}

// ───── Skills Tab ─────
function SkillsManagement({ token }: { token?: string | null }) {
  const [skills, setSkills] = useState<any[]>([]);
  const [scope, setScope] = useState<'company' | 'project' | 'personal'>('company');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', content: '', category: 'general' });

  const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) hdrs['Authorization'] = `Bearer ${token}`;

  const loadSkills = useCallback(() => {
    fetch(`${API_BASE}/skills?scope=${scope}`, { headers: hdrs })
      .then(r => r.ok ? r.json() : [])
      .then(setSkills)
      .catch(() => {});
  }, [scope, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const handleCreate = async () => {
    if (!form.name || !form.content) return;
    await fetch(`${API_BASE}/skills`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ ...form, scope }),
    });
    setCreating(false);
    setForm({ name: '', description: '', content: '', category: 'general' });
    loadSkills();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this skill?')) return;
    await fetch(`${API_BASE}/skills/${id}`, { method: 'DELETE', headers: hdrs });
    loadSkills();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await fetch(`${API_BASE}/skills/${id}`, {
      method: 'PUT', headers: hdrs,
      body: JSON.stringify({ enabled: !enabled }),
    });
    loadSkills();
  };

  const handleUpdate = async () => {
    if (!editing) return;
    await fetch(`${API_BASE}/skills/${editing.id}`, {
      method: 'PUT', headers: hdrs,
      body: JSON.stringify({ name: form.name, description: form.description, content: form.content, category: form.category }),
    });
    setEditing(null);
    loadSkills();
  };

  const scopeColors = {
    company: 'bg-amber-900/30 text-amber-400 border-amber-500/30',
    project: 'bg-green-900/30 text-green-400 border-green-500/30',
    personal: 'bg-blue-900/30 text-blue-400 border-blue-500/30',
  };

  return (
    <div className="space-y-4">
      {/* Scope tabs */}
      <div className="flex gap-2">
        {(['company', 'project', 'personal'] as const).map(s => (
          <button key={s} onClick={() => setScope(s)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-colors ${
              scope === s ? scopeColors[s] : 'text-gray-500 border-surface-700 hover:text-gray-300'
            }`}>
            {s === 'company' ? 'Company' : s === 'project' ? 'Project' : 'Personal'}
            <span className="ml-1.5 text-[10px] opacity-60">{skills.length}</span>
          </button>
        ))}
        <button onClick={() => { setCreating(true); setEditing(null); setForm({ name: '', description: '', content: '', category: 'general' }); }}
          className="ml-auto px-3 py-1.5 text-[12px] font-medium rounded-lg bg-primary-600/20 text-primary-400 border border-primary-500/30 hover:bg-primary-600/30 transition-colors">
          + New Skill
        </button>
      </div>

      {/* Create / Edit form */}
      {(creating || editing) && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-lg p-4 space-y-3">
          <div className="flex gap-3">
            <input placeholder="Skill name (no /)" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="flex-1 bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
            <input placeholder="Category" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-32 bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
          </div>
          <input placeholder="Description" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="w-full bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
          <textarea placeholder="SKILL.md content (with frontmatter)" value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            rows={8}
            className="w-full bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 font-mono focus:border-primary-500/50 focus:outline-none resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setCreating(false); setEditing(null); }}
              className="px-3 py-1.5 text-[12px] text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
            <button onClick={editing ? handleUpdate : handleCreate}
              className="px-4 py-1.5 text-[12px] font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-500 transition-colors">
              {editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Skill list */}
      <div className="border border-surface-700 rounded-lg divide-y divide-surface-800 overflow-hidden">
        {skills.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-gray-500">
            No {scope} skills yet
          </div>
        )}
        {skills.map((skill: any) => (
          <div key={skill.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-800/30 transition-colors group">
            <span className="text-primary-500/70 font-mono text-[13px]">/</span>
            <span className="text-[13px] font-medium text-gray-200">{skill.name}</span>
            <span className="text-[11px] text-gray-500 truncate flex-1">{skill.description}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${scopeColors[skill.scope as keyof typeof scopeColors] || 'text-gray-500 border-surface-600'}`}>
              {skill.category}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${skill.source === 'bundled' ? 'bg-surface-700/50 text-gray-500' : 'bg-violet-900/30 text-violet-400'}`}>
              {skill.source}
            </span>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => handleToggle(skill.id, skill.enabled)}
                className={`px-2 py-1 text-[10px] rounded ${skill.enabled ? 'text-green-400 hover:text-red-400' : 'text-red-400 hover:text-green-400'}`}>
                {skill.enabled ? 'ON' : 'OFF'}
              </button>
              <button onClick={() => { setEditing(skill); setCreating(false); setForm({ name: skill.name, description: skill.description, content: '', category: skill.category }); fetch(`${API_BASE}/skills/${skill.id}`, { headers: hdrs }).then(r => r.json()).then(d => setForm(f => ({ ...f, content: d.content || '' }))); }}
                className="px-2 py-1 text-[10px] text-gray-500 hover:text-primary-400 transition-colors">Edit</button>
              {skill.source !== 'bundled' && (
                <button onClick={() => handleDelete(skill.id)}
                  className="px-2 py-1 text-[10px] text-gray-500 hover:text-red-400 transition-colors">Del</button>
              )}
            </div>
          </div>
        ))}
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

// ───── Claude Accounts Tab ─────

interface ClaudeAccount {
  id: string;
  label: string;
  configDir: string;
  tier: 'max' | 'pro' | 'api';
  isDefault: boolean;
  enabled: boolean;
  createdAt?: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  claude_account_id: string | null;
}

function ClaudeAccountManagement({ token }: { token?: string | null }) {
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newAccount, setNewAccount] = useState({ id: '', label: '', configDir: '', tier: 'max' as string, isDefault: false });
  const [error, setError] = useState('');
  const [assigningProject, setAssigningProject] = useState<string | null>(null);

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  const fetchData = useCallback(async () => {
    try {
      const [accRes, projRes] = await Promise.all([
        fetch(`${API_BASE}/admin/claude-accounts`, { headers: headers() }),
        fetch(`${API_BASE}/projects`, { headers: headers() }),
      ]);
      if (accRes.ok) setAccounts(await accRes.json());
      if (projRes.ok) setProjects(await projRes.json());
    } catch {} finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    setError('');
    if (!newAccount.id || !newAccount.label || !newAccount.configDir) {
      setError('ID, Label, ConfigDir are required'); return;
    }
    try {
      const res = await fetch(`${API_BASE}/admin/claude-accounts`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify(newAccount),
      });
      if (res.ok) {
        setShowForm(false);
        setNewAccount({ id: '', label: '', configDir: '', tier: 'max', isDefault: false });
        fetchData();
      } else {
        const data = await res.json();
        setError(data.error || 'Creation failed');
      }
    } catch { setError('Server error'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete account "${id}"? Projects using it will fall back to default.`)) return;
    await fetch(`${API_BASE}/admin/claude-accounts/${id}`, { method: 'DELETE', headers: headers() });
    fetchData();
  };

  const handleToggle = async (acc: ClaudeAccount, field: 'enabled' | 'isDefault') => {
    await fetch(`${API_BASE}/admin/claude-accounts/${acc.id}`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ [field]: field === 'isDefault' ? true : !acc.enabled }),
    });
    fetchData();
  };

  const handleAssign = async (projectId: string, accountId: string | null) => {
    await fetch(`${API_BASE}/admin/projects/${projectId}/claude-account`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ accountId }),
    });
    setAssigningProject(null);
    fetchData();
  };

  const getAccountForProject = (p: ProjectSummary) =>
    accounts.find(a => a.id === p.claude_account_id);

  const defaultAccount = accounts.find(a => a.isDefault && a.enabled);

  if (loading) return <div className="text-gray-500 text-sm p-4">Loading...</div>;

  return (
    <div className="space-y-5">
      {/* ── Accounts Section ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] text-gray-400">
            <span className="text-gray-200 font-medium">{accounts.length}</span> account(s) registered
            {defaultAccount && (
              <span className="ml-2 text-primary-400/70">Default: {defaultAccount.label}</span>
            )}
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-3 py-1.5 text-[12px] font-medium bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
          >
            {showForm ? 'Cancel' : '+ Add Account'}
          </button>
        </div>

        {/* Add form */}
        {showForm && (
          <div className="bg-surface-800 border border-surface-700 rounded-lg p-4 mb-3 space-y-3">
            {error && <div className="text-red-400 text-[12px]">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">ID (slug)</label>
                <input
                  value={newAccount.id} onChange={e => setNewAccount({ ...newAccount, id: e.target.value })}
                  placeholder="e.g. gmail"
                  className="w-full bg-surface-900 border border-surface-700 text-gray-200 text-[13px] rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">Label</label>
                <input
                  value={newAccount.label} onChange={e => setNewAccount({ ...newAccount, label: e.target.value })}
                  placeholder="e.g. Gmail Max Account"
                  className="w-full bg-surface-900 border border-surface-700 text-gray-200 text-[13px] rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">Config Dir</label>
                <input
                  value={newAccount.configDir} onChange={e => setNewAccount({ ...newAccount, configDir: e.target.value })}
                  placeholder="e.g. /home/user/.claude-gmail"
                  className="w-full bg-surface-900 border border-surface-700 text-gray-200 text-[13px] rounded-lg px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">Tier</label>
                <select
                  value={newAccount.tier} onChange={e => setNewAccount({ ...newAccount, tier: e.target.value })}
                  className="w-full bg-surface-900 border border-surface-700 text-gray-200 text-[13px] rounded-lg px-3 py-2"
                >
                  <option value="max">Max</option>
                  <option value="pro">Pro</option>
                  <option value="api">API</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[12px] text-gray-400 cursor-pointer">
                <input
                  type="checkbox" checked={newAccount.isDefault}
                  onChange={e => setNewAccount({ ...newAccount, isDefault: e.target.checked })}
                  className="rounded border-surface-600"
                />
                Set as default
              </label>
              <button onClick={handleCreate}
                className="ml-auto px-4 py-1.5 text-[12px] font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
              >Create</button>
            </div>
          </div>
        )}

        {/* Account list */}
        <div className="bg-surface-800 border border-surface-700 rounded-lg divide-y divide-surface-700">
          {accounts.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-[13px]">
              No accounts registered. All sessions use default <code className="text-gray-400">~/.claude/</code>
            </div>
          ) : accounts.map(acc => {
            const assignedProjects = projects.filter(p => p.claude_account_id === acc.id);
            const tierColors: Record<string, string> = { max: 'text-purple-400', pro: 'text-blue-400', api: 'text-gray-400' };

            return (
              <div key={acc.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${acc.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-gray-200 font-medium">{acc.label}</span>
                        <span className={`text-[11px] font-mono ${tierColors[acc.tier] || 'text-gray-400'}`}>{acc.tier.toUpperCase()}</span>
                        {acc.isDefault && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary-600/20 text-primary-400 border border-primary-500/30">DEFAULT</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-600 font-mono truncate">{acc.configDir}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {!acc.isDefault && (
                      <button
                        onClick={() => handleToggle(acc, 'isDefault')}
                        className="px-2 py-1 text-[11px] text-gray-500 hover:text-primary-400 hover:bg-surface-700 rounded transition-colors"
                        title="Set as default"
                      >⭐</button>
                    )}
                    <button
                      onClick={() => handleToggle(acc, 'enabled')}
                      className={`px-2 py-1 text-[11px] rounded transition-colors ${
                        acc.enabled ? 'text-green-400 hover:text-red-400 hover:bg-surface-700' : 'text-gray-600 hover:text-green-400 hover:bg-surface-700'
                      }`}
                    >{acc.enabled ? 'ON' : 'OFF'}</button>
                    <button
                      onClick={() => handleDelete(acc.id)}
                      className="px-2 py-1 text-[11px] text-gray-600 hover:text-red-400 hover:bg-surface-700 rounded transition-colors"
                      title="Delete"
                    >✕</button>
                  </div>
                </div>
                {assignedProjects.length > 0 && (
                  <div className="mt-1.5 ml-5 flex flex-wrap gap-1">
                    {assignedProjects.map(p => (
                      <span key={p.id} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-gray-400">{p.name}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Project Assignment Section ── */}
      <div>
        <h3 className="text-[13px] font-medium text-gray-300 mb-3">Project → Account Assignment</h3>
        <div className="bg-surface-800 border border-surface-700 rounded-lg divide-y divide-surface-700 max-h-[300px] overflow-y-auto">
          {projects.map(proj => {
            const assigned = getAccountForProject(proj);
            const isAssigning = assigningProject === proj.id;

            return (
              <div key={proj.id} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[13px] text-gray-300 truncate">{proj.name}</span>
                </div>
                <div className="shrink-0 ml-3">
                  {isAssigning ? (
                    <select
                      autoFocus
                      value={proj.claude_account_id || ''}
                      onChange={e => handleAssign(proj.id, e.target.value || null)}
                      onBlur={() => setAssigningProject(null)}
                      className="bg-surface-900 border border-primary-500/50 text-gray-200 text-[12px] rounded px-2 py-1 w-44"
                    >
                      <option value="">— Use default —</option>
                      {accounts.filter(a => a.enabled).map(a => (
                        <option key={a.id} value={a.id}>{a.label}{a.isDefault ? ' ⭐' : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setAssigningProject(proj.id)}
                      className={`text-[12px] px-2 py-1 rounded transition-colors ${
                        assigned
                          ? 'text-primary-400 hover:bg-surface-700'
                          : 'text-gray-600 hover:text-gray-400 hover:bg-surface-700'
                      }`}
                    >
                      {assigned ? assigned.label : defaultAccount ? `(${defaultAccount.label})` : '— none —'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {defaultAccount && (
          <div className="mt-2 text-[11px] text-gray-600">
            Unassigned projects use the default account: <span className="text-gray-400">{defaultAccount.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ───── Heartbeat Tab ─────

interface HeartbeatConfig {
  projectId: string;
  projectName: string;
  projectPath: string;
  roomId?: string;
  intervalMinutes: number;
  autonomyLevel: 0 | 1 | 2;
  enabled: boolean;
  runHour?: number;
  deltaThreshold?: number;
  action?: string;
}

const AUTONOMY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'L0 Silent', color: 'text-gray-500' },
  1: { label: 'L1 Notify', color: 'text-blue-400' },
  2: { label: 'L2 Auto', color: 'text-amber-400' },
};

function HeartbeatManagement({ token }: { token?: string | null }) {
  const [heartbeats, setHeartbeats] = useState<HeartbeatConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<{ ran: number; results: string[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // projectId being edited

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  const fetchHeartbeats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/heartbeats`, { headers: headers() });
      const data = await res.json();
      setHeartbeats(data.heartbeats || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [headers]);

  useEffect(() => { fetchHeartbeats(); }, [fetchHeartbeats]);

  const patchProject = async (projectId: string, updates: Partial<HeartbeatConfig>) => {
    await fetch(`${API_BASE}/heartbeats/${projectId}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify(updates),
    });
    fetchHeartbeats();
  };

  const runNow = async (projectId?: string) => {
    const key = projectId || 'all';
    setRunning(key);
    setRunResults(null);
    try {
      const res = await fetch(`${API_BASE}/heartbeats/run`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify(projectId ? { projectId } : {}),
      });
      const data = await res.json();
      setRunResults(data);
    } catch (err: any) {
      setRunResults({ ran: 0, results: [`❌ ${err.message}`] });
    }
    setRunning(null);
  };

  const enabledCount = heartbeats.filter(h => h.enabled).length;
  const l2Count = heartbeats.filter(h => h.autonomyLevel === 2).length;

  if (loading) return <div className="text-gray-500 text-sm p-4">Loading...</div>;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-gray-400 flex items-center gap-4">
          <span><span className="text-gray-200 font-medium">{enabledCount}</span>/{heartbeats.length} enabled</span>
          {l2Count > 0 && <span className="text-amber-400/70">{l2Count} auto-execute</span>}
        </div>
        <button
          onClick={() => runNow()}
          disabled={running !== null}
          className="px-3 py-1.5 text-[12px] font-medium bg-primary-600 hover:bg-primary-500 disabled:bg-gray-700 text-white rounded-lg transition-colors"
        >
          {running === 'all' ? '⏳ Running...' : '▶ Run All Now'}
        </button>
      </div>

      {/* Run Results */}
      {runResults && (
        <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 text-[12px]">
          <div className="text-gray-400 mb-1">Ran {runResults.ran} project(s):</div>
          <div className="max-h-32 overflow-y-auto">
            {runResults.results.map((r, i) => (
              <div key={i} className="text-gray-300 py-0.5">{r}</div>
            ))}
          </div>
        </div>
      )}

      {/* Project List */}
      <div className="bg-surface-800 border border-surface-700 rounded-lg divide-y divide-surface-700">
        {heartbeats.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500 text-[13px]">
            No heartbeats registered. Projects with <code className="text-gray-400">.project/state.json</code> auto-register on server start.
          </div>
        ) : heartbeats.map(hb => {
          const isEditing = editing === hb.projectId;
          const al = AUTONOMY_LABELS[hb.autonomyLevel] || AUTONOMY_LABELS[1];

          return (
            <div key={hb.projectId} className="px-4 py-3">
              {/* Row: name + controls */}
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${hb.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
                    <span className="text-[13px] text-gray-200 font-medium truncate">{hb.projectName}</span>
                    <span className={`text-[11px] font-mono ${al.color}`}>{al.label}</span>
                    <span className="text-[11px] text-gray-600">{(hb.runHour ?? 3).toString().padStart(2, '0')}:00</span>
                    <span className="text-[11px] text-gray-600">Δ≥{hb.deltaThreshold ?? 5}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  <button
                    onClick={() => runNow(hb.projectId)}
                    disabled={running !== null}
                    className="px-2 py-1 text-[11px] text-gray-400 hover:text-primary-400 hover:bg-surface-700 rounded transition-colors disabled:opacity-30"
                    title="Run now"
                  >
                    {running === hb.projectId ? '⏳' : '▶'}
                  </button>
                  <button
                    onClick={() => setEditing(isEditing ? null : hb.projectId)}
                    className={`px-2 py-1 text-[11px] rounded transition-colors ${isEditing ? 'text-primary-400 bg-surface-700' : 'text-gray-500 hover:text-gray-300 hover:bg-surface-700'}`}
                    title="Settings"
                  >⚙</button>
                  <button
                    onClick={() => patchProject(hb.projectId, { enabled: !hb.enabled })}
                    className={`px-2 py-1 text-[11px] rounded transition-colors ${
                      hb.enabled ? 'text-green-400 hover:text-red-400 hover:bg-surface-700' : 'text-gray-600 hover:text-green-400 hover:bg-surface-700'
                    }`}
                  >
                    {hb.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* Expanded settings panel */}
              {isEditing && (
                <div className="mt-3 ml-4 p-3 bg-surface-900 border border-surface-700 rounded-lg space-y-3">
                  {/* Autonomy Level */}
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] text-gray-500 w-20 shrink-0">Autonomy</label>
                    <div className="flex gap-1">
                      {([0, 1, 2] as const).map(level => {
                        const info = AUTONOMY_LABELS[level];
                        return (
                          <button
                            key={level}
                            onClick={() => patchProject(hb.projectId, { autonomyLevel: level })}
                            className={`px-2 py-1 text-[11px] rounded transition-colors ${
                              hb.autonomyLevel === level
                                ? `${info.color} bg-surface-700 font-medium`
                                : 'text-gray-600 hover:text-gray-400 hover:bg-surface-800'
                            }`}
                          >{info.label}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Run Hour */}
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] text-gray-500 w-20 shrink-0">Run hour</label>
                    <select
                      value={hb.runHour ?? 3}
                      onChange={e => patchProject(hb.projectId, { runHour: Number(e.target.value) })}
                      className="bg-surface-800 border border-surface-700 text-gray-300 text-[12px] rounded px-2 py-1 w-24"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>

                  {/* Delta Threshold */}
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] text-gray-500 w-20 shrink-0">Delta ≥</label>
                    <input
                      type="number" min={1} max={100}
                      value={hb.deltaThreshold ?? 5}
                      onChange={e => patchProject(hb.projectId, { deltaThreshold: Number(e.target.value) })}
                      className="bg-surface-800 border border-surface-700 text-gray-300 text-[12px] rounded px-2 py-1 w-20"
                    />
                    <span className="text-[11px] text-gray-600">lines in progress.md</span>
                  </div>

                  {/* Action (L2 only) */}
                  {hb.autonomyLevel === 2 && (
                    <div className="flex items-center gap-3">
                      <label className="text-[11px] text-gray-500 w-20 shrink-0">Action</label>
                      <input
                        type="text"
                        value={hb.action ?? '/agents-md --evolve'}
                        onChange={e => patchProject(hb.projectId, { action: e.target.value })}
                        placeholder="/agents-md --evolve"
                        className="bg-surface-800 border border-surface-700 text-gray-300 text-[12px] rounded px-2 py-1 flex-1 font-mono"
                      />
                    </div>
                  )}

                  {/* Path (read-only) */}
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] text-gray-500 w-20 shrink-0">Path</label>
                    <span className="text-[11px] text-gray-600 font-mono truncate">{hb.projectPath}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
