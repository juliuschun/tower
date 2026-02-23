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

interface SettingsPanelProps {
  onLogout: () => void;
  token?: string | null;
}

export function SettingsPanel({ onLogout, token }: SettingsPanelProps) {
  const isOpen = useSettingsStore((s) => s.isOpen);
  const setOpen = useSettingsStore((s) => s.setOpen);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const serverConfig = useSettingsStore((s) => s.serverConfig);
  const model = useChatStore((s) => s.model);

  const userRole = localStorage.getItem('userRole');
  const isAdmin = userRole === 'admin';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className={`relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl ${isAdmin ? 'w-[520px]' : 'w-[420px]'} max-h-[80vh] overflow-auto`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800">
          <h2 className="text-[15px] font-bold text-gray-100">Settings</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Server Info */}
          <section>
            <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">Server</h3>
            <div className="space-y-2.5">
              <SettingRow label="Workspace" value={serverConfig?.workspaceRoot || '-'} />
              <SettingRow label="Model" value={model || 'Not connected'} />
              <SettingRow label="Permission Mode" value={serverConfig?.permissionMode || '-'} />
              <SettingRow label="Version" value={serverConfig?.version || '-'} />
            </div>
          </section>

          {/* Theme */}
          <section>
            <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">Appearance</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme('dark')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                  theme === 'dark'
                    ? 'bg-surface-800 border-primary-500 text-primary-400'
                    : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                }`}
              >
                Dark
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                  theme === 'light'
                    ? 'bg-surface-800 border-primary-500 text-primary-400'
                    : 'bg-surface-900 border-surface-700 text-surface-500 hover:border-surface-600'
                }`}
              >
                Light
              </button>
            </div>
          </section>

          {/* Admin: User Management */}
          {isAdmin && <UserManagement token={token} />}

          {/* Actions */}
          <section>
            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="w-full py-2.5 text-xs font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-all"
            >
              Logout
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function UserManagement({ token }: { token?: string | null }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user', allowed_path: '' });
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
    if (!newUser.username || !newUser.password) { setError('사용자명과 비밀번호를 입력하세요'); return; }
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify(newUser),
      });
      if (res.ok) {
        setShowForm(false);
        setNewUser({ username: '', password: '', role: 'user', allowed_path: '' });
        fetchUsers();
      } else {
        const data = await res.json();
        setError(data.error || '생성 실패');
      }
    } catch { setError('서버 오류'); }
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
    if (!window.confirm(`"${username}" 사용자를 비활성화하시겠습니까?`)) return;
    await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'DELETE', headers: headers(),
    });
    fetchUsers();
  };

  if (loading) return <section><h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider mb-3">Users</h3><div className="text-xs text-gray-500">로딩 중...</div></section>;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[12px] font-semibold text-surface-500 uppercase tracking-wider">Users</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[11px] px-2.5 py-1 rounded-md bg-primary-600/20 border border-primary-500/30 text-primary-300 hover:bg-primary-600/30 transition-colors"
        >
          {showForm ? '취소' : '+ 추가'}
        </button>
      </div>

      {/* User list */}
      <div className="space-y-1.5">
        {users.map((u) => {
          const isSelf = u.username === currentUsername;
          return (
            <div key={u.id} className="flex items-center gap-2 px-3 py-2 bg-surface-800/50 rounded-lg text-xs">
              <span className="font-medium text-gray-200 w-20 truncate" title={u.username}>{u.username}</span>

              {/* Role select */}
              <select
                value={u.role}
                onChange={(e) => handleRoleChange(u.id, e.target.value)}
                disabled={isSelf}
                className="bg-surface-900 border border-surface-700 text-gray-300 rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <option value="admin">admin</option>
                <option value="user">user</option>
              </select>

              {/* Allowed path */}
              <PathEditor
                value={u.allowed_path}
                onSave={(v) => handlePathChange(u.id, v)}
              />

              {/* Reset password */}
              {resetPwUserId === u.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="password"
                    value={resetPwValue}
                    onChange={(e) => setResetPwValue(e.target.value)}
                    placeholder="새 비밀번호"
                    className="w-24 bg-surface-900 border border-surface-700 rounded px-1.5 py-0.5 text-[11px] text-gray-200 focus:outline-none focus:border-primary-500/50"
                    onKeyDown={(e) => e.key === 'Enter' && handleResetPassword(u.id)}
                    autoFocus
                  />
                  <button onClick={() => handleResetPassword(u.id)} className="text-primary-400 hover:text-primary-300" title="확인">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </button>
                  <button onClick={() => { setResetPwUserId(null); setResetPwValue(''); }} className="text-gray-500 hover:text-gray-300" title="취소">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setResetPwUserId(u.id)}
                  className="text-gray-500 hover:text-yellow-400 transition-colors"
                  title="비밀번호 초기화"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                </button>
              )}

              {/* Delete */}
              <button
                onClick={() => handleDelete(u.id, u.username)}
                disabled={isSelf}
                className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed ml-auto"
                title={isSelf ? '자기 자신은 삭제 불가' : '사용자 비활성화'}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mt-3 p-3 bg-surface-800/50 rounded-lg border border-surface-700 space-y-2.5">
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="사용자명"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              className="flex-1 bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-[12px] text-gray-200 focus:outline-none focus:border-primary-500/50"
            />
            <input
              type="password"
              placeholder="비밀번호"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              className="flex-1 bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-[12px] text-gray-200 focus:outline-none focus:border-primary-500/50"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              className="bg-surface-900 border border-surface-700 text-gray-300 rounded px-2 py-1.5 text-[12px]"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <input
              type="text"
              placeholder="작업 폴더 (빈칸=전체)"
              value={newUser.allowed_path}
              onChange={(e) => setNewUser({ ...newUser, allowed_path: e.target.value })}
              className="flex-1 bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-[12px] text-gray-200 font-mono focus:outline-none focus:border-primary-500/50"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setError(''); }}
              className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 text-[11px] bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors"
            >
              생성
            </button>
          </div>
        </div>
      )}
    </section>
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
        className="flex-1 min-w-0 bg-surface-900 border border-primary-500/50 rounded px-1.5 py-0.5 text-[11px] text-gray-200 font-mono focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className="flex-1 min-w-0 text-left truncate text-[11px] text-gray-500 font-mono hover:text-gray-300 transition-colors px-1.5 py-0.5"
      title={value || '(전체 접근)'}
    >
      {value ? value.replace(/^\/home\/[^/]+/, '~') : '(전체)'}
    </button>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-gray-400">{label}</span>
      <span className="text-[12px] text-gray-300 font-mono bg-surface-800 px-2 py-0.5 rounded max-w-[220px] truncate" title={value}>
        {value}
      </span>
    </div>
  );
}
