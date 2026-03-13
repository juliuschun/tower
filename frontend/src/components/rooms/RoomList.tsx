import { useEffect, useState } from 'react';
import { useRoomStore } from '../../stores/room-store';
import { CreateRoomModal } from './CreateRoomModal';

interface RoomListProps {
  onSelectRoom: (roomId: string) => void;
}

export function RoomList({ onSelectRoom }: RoomListProps) {
  const rooms = useRoomStore((s) => s.rooms);
  const activeRoomId = useRoomStore((s) => s.activeRoomId);
  const unreadCounts = useRoomStore((s) => s.unreadCounts);
  const messagesByRoom = useRoomStore((s) => s.messagesByRoom);
  const [createOpen, setCreateOpen] = useState(false);

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

  return (
    <div className="flex flex-col h-full">
      {/* Create Room button */}
      <div className="p-3">
        <button
          onClick={() => setCreateOpen(true)}
          className="w-full py-2 px-4 bg-primary-600 hover:bg-primary-500 rounded-lg text-[13px] font-semibold text-white shadow-sm shadow-primary-900/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 ring-1 ring-white/10"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Room
        </button>
      </div>

      {/* Room list */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5">
        {rooms.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[12px] text-gray-500">No rooms yet</p>
            <p className="text-[11px] text-gray-600 mt-1">Create one to get started</p>
          </div>
        ) : (
          rooms.map((room) => {
            const unread = unreadCounts[room.id] || 0;
            const lastMessages = messagesByRoom[room.id];
            const lastMsg = lastMessages?.[lastMessages.length - 1];
            const isActive = room.id === activeRoomId;

            return (
              <button
                key={room.id}
                onClick={() => onSelectRoom(room.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-surface-800 border border-surface-700'
                    : 'hover:bg-surface-800/50 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-surface-700 border border-surface-600 flex items-center justify-center shrink-0">
                    <span className="text-[12px] font-bold text-gray-300">
                      {room.name[0]?.toUpperCase() || '#'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-[13px] font-medium truncate ${isActive ? 'text-gray-100' : 'text-gray-300'}`}>
                        {room.name}
                      </span>
                      {unread > 0 && (
                        <span className="ml-2 px-1.5 py-0.5 bg-primary-600 text-[10px] font-bold text-white rounded-full min-w-[18px] text-center">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                    {lastMsg && (
                      <p className="text-[11px] text-gray-500 truncate mt-0.5">
                        {lastMsg.senderName ? `${lastMsg.senderName}: ` : ''}
                        {lastMsg.content.slice(0, 60)}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <CreateRoomModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
