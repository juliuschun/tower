import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoomStore, type RoomMember } from '../../stores/room-store';
import { getTokenUserId } from '../../utils/session-restore';

interface InvitableUser {
  id: number;
  username: string;
  role: string;
}

interface RoomMembersPanelProps {
  roomId: string;
  onClose: () => void;
}

function authHeaders(): Record<string, string> {
  const tk = localStorage.getItem('token');
  const hdrs: Record<string, string> = {};
  if (tk) hdrs['Authorization'] = `Bearer ${tk}`;
  return hdrs;
}

export function RoomMembersPanel({ roomId, onClose }: RoomMembersPanelProps) {
  const { t } = useTranslation('rooms');
  const members = useRoomStore((s) => s.membersByRoom[roomId] ?? []);
  const currentUserId = parseInt(localStorage.getItem('userId') || '0', 10) || getTokenUserId(localStorage.getItem('token'));

  const [invitableUsers, setInvitableUsers] = useState<InvitableUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Current user's role in this room
  const myRole = members.find((m) => m.userId === currentUserId)?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const canInvite = !!myRole; // Any room member can invite others

  // Fetch invitable users when invite panel opens
  useEffect(() => {
    if (!showInvite) return;
    setLoading(true);
    fetch(`/api/rooms/${roomId}/invitable-users`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((data) => setInvitableUsers(data.users || []))
      .catch(() => setInvitableUsers([]))
      .finally(() => setLoading(false));
  }, [showInvite, roomId, members.length]);

  const handleInvite = async (userId: number) => {
    setInviting(userId);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/members`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: 'member' }),
      });
      if (res.ok) {
        const member: RoomMember = await res.json();
        useRoomStore.getState().addMember(roomId, member);
        setInvitableUsers((prev) => prev.filter((u) => u.id !== userId));
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to invite user');
      }
    } catch {
      setError('Network error');
    } finally {
      setInviting(null);
    }
  };

  const handleRemove = async (userId: number) => {
    if (userId === currentUserId) return; // Can't remove yourself
    setRemoving(userId);
    try {
      const res = await fetch(`/api/rooms/${roomId}/members/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        useRoomStore.getState().removeMember(roomId, userId);
      }
    } catch {
      // silently fail
    } finally {
      setRemoving(null);
    }
  };

  const filteredInvitable = searchQuery.trim()
    ? invitableUsers.filter((u) =>
        u.username.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : invitableUsers;

  const roleLabel = (role: string) => {
    switch (role) {
      case 'owner': return t('owner');
      case 'admin': return t('admin');
      case 'member': return t('member');
      case 'readonly': return t('readOnly');
      default: return role;
    }
  };

  const roleColor = (role: string) => {
    switch (role) {
      case 'owner': return 'text-amber-400 bg-amber-400/10';
      case 'admin': return 'text-blue-400 bg-blue-400/10';
      case 'member': return 'text-gray-400 bg-gray-400/10';
      case 'readonly': return 'text-gray-500 bg-gray-500/10';
      default: return 'text-gray-400 bg-gray-400/10';
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-surface-800 flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-200">
            {showInvite ? t('inviteMembers') : t('roomMembers')}
          </h2>
          <div className="flex items-center gap-2">
            {canInvite && (
              <button
                onClick={() => setShowInvite(!showInvite)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  showInvite
                    ? 'bg-surface-800 text-gray-300 hover:bg-surface-700'
                    : 'bg-primary-600 text-white hover:bg-primary-500'
                }`}
              >
                {showInvite ? t('backToMembers') : `+ ${t('invite')}`}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showInvite ? (
            /* ── Invite Panel ── */
            <div className="p-4 space-y-3">
              {/* Search */}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchUsers')}
                className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-primary-500/50 transition-colors"
                autoFocus
              />

              {error && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <span className="text-[12px] text-red-400">{error}</span>
                </div>
              )}

              {loading ? (
                <div className="py-8 text-center">
                  <span className="text-[12px] text-gray-500">{t('loadingUsers')}</span>
                </div>
              ) : filteredInvitable.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-[13px] text-gray-400">
                    {searchQuery ? t('noMatchingUsers') : t('allUsersMembers')}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredInvitable.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-surface-700 border border-surface-600 flex items-center justify-center shrink-0">
                          <span className="text-[12px] font-bold text-gray-300">
                            {user.username[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <span className="text-[13px] text-gray-200 truncate block">{user.username}</span>
                          <span className="text-[11px] text-gray-500">{user.role}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleInvite(user.id)}
                        disabled={inviting === user.id}
                        className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 rounded-lg text-[12px] font-medium text-white transition-colors shrink-0"
                      >
                        {inviting === user.id ? t('inviting') : t('invite')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Members List ── */
            <div className="p-4 space-y-1">
              {members.length === 0 ? (
                <div className="py-8 text-center">
                  <span className="text-[12px] text-gray-500">{t('noMembers')}</span>
                </div>
              ) : (
                members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-surface-700 border border-surface-600 flex items-center justify-center shrink-0">
                        <span className="text-[12px] font-bold text-gray-300">
                          {member.username[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[13px] text-gray-200 truncate block">
                          {member.username}
                          {member.userId === currentUserId && (
                            <span className="text-[11px] text-gray-500 ml-1">{t('common:you')}</span>
                          )}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${roleColor(member.role)}`}>
                          {roleLabel(member.role)}
                        </span>
                      </div>
                    </div>
                    {canManage && member.userId !== currentUserId && member.role !== 'owner' && (
                      <button
                        onClick={() => handleRemove(member.userId)}
                        disabled={removing === member.userId}
                        className="px-2.5 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors shrink-0"
                      >
                        {removing === member.userId ? '...' : t('common:remove')}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
