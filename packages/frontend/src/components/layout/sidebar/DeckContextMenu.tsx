import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useSessionStore, type SessionMeta } from '../../../stores/session-store';
import { useProjectStore } from '../../../stores/project-store';
import { useTranslation } from 'react-i18next';

export function DeckContextMenu({ x, y, label, sessions, projectId, onClose }: {
  x: number; y: number; label: string; sessions: SessionMeta[]; projectId: string; onClose: () => void;
}) {
  const { t } = useTranslation('layout');
  const ref = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ left: x, top: y });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState(label);
  const renameRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (renaming) setTimeout(() => renameRef.current?.focus(), 50);
  }, [renaming]);

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-primary-600/30 hover:text-white transition-colors";

  const patchSessions = (patch: Record<string, any>) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    for (const s of sessions) {
      useSessionStore.getState().updateSessionMeta(s.id, patch);
      fetch(`/api/sessions/${s.id}`, {
        method: 'PATCH', headers, body: JSON.stringify(patch),
      }).catch(() => {});
    }
  };
  const handleRename = () => {
    const newName = renameName.trim();
    if (!newName || newName === label) { setRenaming(false); return; }
    // Update all sessions with the new label
    patchSessions({ label: newName });
    // Update hidden/collapsed label keys
    useProjectStore.getState().renameLabelInHidden(projectId, label, newName);
    onClose();
  };

  const handleHide = () => {
    useProjectStore.getState().setLabelHidden(projectId, label, true);
    onClose();
  };

  const allProject = sessions.every(s => s.visibility === 'project');
  const hasProjectId = sessions.some(s => s.projectId);

  if (renaming) {
    return (
      <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[180px]"
        style={adjustedPos}>
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          <input
            ref={renameRef}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder={t('deckNewName')}
            className="flex-1 bg-surface-700 text-[11px] text-gray-200 px-2 py-1 rounded border border-surface-600 outline-none focus:border-primary-500/50 placeholder-surface-600"
          />
          {renameName.trim() && renameName.trim() !== label && (
            <button onClick={handleRename} className="text-[10px] text-primary-400 hover:text-primary-300 font-medium px-1 shrink-0">
              OK
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="fixed z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[180px]"
      style={adjustedPos}>
      {/* Rename deck */}
      <button className={itemClass} onClick={() => setRenaming(true)}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        {t('renameDeck')}
      </button>
      {/* Hide deck */}
      <button className={itemClass} onClick={handleHide}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" />
        </svg>
        {t('hideDeck')}
      </button>
      <div className="border-t border-surface-700/50 my-1" />
      {/* Visibility toggle — only if sessions are in a project */}
      {hasProjectId && (
        <button className={itemClass} onClick={() => {
          const newVis = allProject ? 'private' : 'project';
          patchSessions({ visibility: newVis });
          onClose();
        }}>
          {allProject ? (
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
          {allProject ? t('makeAllPrivate') : t('shareAllWithProject')}
        </button>
      )}
      {/* Ungroup all sessions in this deck */}
      <button className={itemClass} onClick={() => {
        const token = localStorage.getItem('token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        for (const s of sessions) {
          useSessionStore.getState().updateSessionMeta(s.id, { label: null });
          fetch(`/api/sessions/${s.id}`, {
            method: 'PATCH', headers, body: JSON.stringify({ label: null }),
          }).catch(() => {});
        }
        onClose();
      }}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6" />
        </svg>
        {t('ungroupAll')} ({sessions.length})
      </button>
      <div className="border-t border-surface-700/50 my-1" />
      {/* Delete deck — with confirmation */}
      {!confirmDelete ? (
        <button className={`${itemClass} !text-red-400 hover:!bg-red-950/30`} onClick={() => setConfirmDelete(true)}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          {t('deleteDeck')} ({sessions.length})
        </button>
      ) : (
        <div className="px-2 py-1.5">
          <p className="text-[11px] text-red-400 mb-2 px-1">
            {t('archiveWarning', { count: sessions.length })}
          </p>
          <div className="flex gap-1.5">
            <button
              className="flex-1 px-2 py-1 text-[11px] bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 transition-colors border border-red-600/30"
              onClick={() => {
                const token = localStorage.getItem('token');
                const headers: Record<string, string> = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;
                for (const s of sessions) {
                  fetch(`/api/sessions/${s.id}`, { method: 'DELETE', headers }).catch(() => {});
                }
                // Remove from UI
                const store = useSessionStore.getState();
                for (const s of sessions) {
                  store.removeSession(s.id);
                }
                onClose();
              }}
            >
              {t('deleteAll')}
            </button>
            <button
              className="flex-1 px-2 py-1 text-[11px] bg-surface-700 text-gray-400 rounded hover:bg-surface-600 transition-colors"
              onClick={() => setConfirmDelete(false)}
            >
              {t('common:cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
