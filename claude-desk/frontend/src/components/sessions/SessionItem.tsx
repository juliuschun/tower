import React, { useState, useRef, useEffect } from 'react';
import type { SessionMeta } from '../../stores/session-store';

interface SessionItemProps {
  session: SessionMeta;
  isActive: boolean;
  onSelect: (session: SessionMeta) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
}

export function SessionItem({ session, isActive, onSelect, onDelete, onRename, onToggleFavorite }: SessionItemProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(session.name);
    setEditing(true);
  };

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(session.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer text-[13px] transition-all duration-200 ${
        isActive
          ? 'bg-surface-800 text-gray-100 shadow-sm ring-1 ring-surface-700/50'
          : 'text-gray-400 hover:bg-surface-850 hover:text-gray-200'
      }`}
      onClick={() => onSelect(session)}
      onDoubleClick={handleDoubleClick}
    >
      {/* Favorite star */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(session.id, !session.favorite); }}
        className={`shrink-0 transition-colors ${
          session.favorite ? 'text-yellow-400' : 'text-surface-700 opacity-0 group-hover:opacity-100'
        }`}
        title={session.favorite ? '즐겨찾기 해제' : '즐겨찾기'}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={session.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>

      {/* Chat icon */}
      <svg className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-primary-500' : 'text-surface-700 group-hover:text-surface-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>

      {/* Name (editable) */}
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
          className="flex-1 min-w-0 bg-surface-700 text-gray-100 text-[13px] px-1.5 py-0.5 rounded border border-surface-600 outline-none focus:border-primary-500"
        />
      ) : (
        <span className="truncate flex-1 font-medium">{session.name}</span>
      )}

      {/* Cost badge */}
      {session.totalCost > 0 && (
        <span className="text-[10px] tabular-nums font-semibold text-surface-700/80 group-hover:text-surface-600 transition-colors bg-surface-800/30 px-1.5 py-0.5 rounded">
          ${session.totalCost.toFixed(2)}
        </span>
      )}

      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 hover:bg-red-950/30 rounded transition-all text-surface-700"
        title="삭제"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
