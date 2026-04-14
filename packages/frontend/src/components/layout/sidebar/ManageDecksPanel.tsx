import React, { useState, useRef } from 'react';
import { useSessionStore } from '../../../stores/session-store';
import { useProjectStore } from '../../../stores/project-store';
import { useTranslation } from 'react-i18next';

export function ManageDecksPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation('layout');
  const sessions = useSessionStore((s) => s.sessions);
  const hiddenLabels = useProjectStore((s) => s.hiddenLabels);
  const [newDeckName, setNewDeckName] = useState('');
  const newDeckRef = useRef<HTMLInputElement>(null);

  // Collect all labels for this project
  const projectSessions = sessions.filter(s => s.projectId === projectId);
  const labelMap = new Map<string, number>();
  for (const s of projectSessions) {
    if (s.label) {
      labelMap.set(s.label, (labelMap.get(s.label) || 0) + 1);
    }
  }
  const allLabels = [...labelMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const visibleLabels = allLabels.filter(([label]) => !hiddenLabels.has(`${projectId}::${label}`));
  const hiddenLabelsList = allLabels.filter(([label]) => hiddenLabels.has(`${projectId}::${label}`));

  const handleCreateDeck = async () => {
    const label = newDeckName.trim();
    if (!label) return;
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST', headers,
        body: JSON.stringify({ projectId, name: label }),
      });
      if (!res.ok) { onClose(); return; }
      const session = await res.json();
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ label }),
      });
      session.label = label;
      useSessionStore.getState().addSession(session);
      setNewDeckName('');
    } catch {}
  };

  const handleDeleteDeck = (label: string) => {
    const deckSessions = projectSessions.filter(s => s.label === label);
    const msg = t('archiveWarning', { count: deckSessions.length });
    if (!window.confirm(msg)) return;
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const store = useSessionStore.getState();
    for (const s of deckSessions) {
      fetch(`/api/sessions/${s.id}`, { method: 'DELETE', headers }).catch(() => {});
      store.removeSession(s.id);
    }
    // Also clean up hidden state
    useProjectStore.getState().setLabelHidden(projectId, label, false);
  };

  const toggleHidden = (label: string) => {
    useProjectStore.getState().toggleLabelHidden(projectId, label);
  };

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg shadow-xl min-w-[240px] max-w-[300px]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-surface-700/50 flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-primary-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <span className="text-[12px] font-medium text-gray-200">{t('manageDecks')}</span>
      </div>

      {/* Visible decks */}
      <div className="max-h-[240px] overflow-y-auto py-1">
        {visibleLabels.length === 0 && hiddenLabelsList.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-surface-500 text-center">{t('noDecksYet')}</div>
        )}
        {visibleLabels.map(([label, count]) => (
          <div key={label} className="flex items-center gap-1 px-2 py-1 group/deck hover:bg-surface-750 rounded mx-1">
            <svg className="w-3 h-3 text-primary-500/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span className="flex-1 text-[12px] text-gray-300 truncate">{label}</span>
            <span className="text-[10px] text-surface-600 tabular-nums shrink-0">{count}</span>
            {/* Hide button */}
            <button
              onClick={() => toggleHidden(label)}
              className="p-0.5 rounded text-surface-600 hover:text-yellow-400 transition-colors opacity-0 group-hover/deck:opacity-100"
              title={t('hideDeck')}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" />
              </svg>
            </button>
            {/* Delete button */}
            <button
              onClick={() => handleDeleteDeck(label)}
              className="p-0.5 rounded text-surface-600 hover:text-red-400 transition-colors opacity-0 group-hover/deck:opacity-100"
              title={t('deleteDeck')}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}

        {/* Hidden decks section */}
        {hiddenLabelsList.length > 0 && (
          <>
            <div className="px-3 py-1 mt-1 border-t border-surface-700/50">
              <span className="text-[10px] text-surface-500 uppercase tracking-wider">{t('hiddenDecks')} ({hiddenLabelsList.length})</span>
            </div>
            {hiddenLabelsList.map(([label, count]) => (
              <div key={label} className="flex items-center gap-1 px-2 py-1 group/deck hover:bg-surface-750 rounded mx-1 opacity-60">
                <svg className="w-3 h-3 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span className="flex-1 text-[12px] text-surface-500 truncate line-through">{label}</span>
                <span className="text-[10px] text-surface-600 tabular-nums shrink-0">{count}</span>
                {/* Show (unhide) button */}
                <button
                  onClick={() => toggleHidden(label)}
                  className="p-0.5 rounded text-surface-600 hover:text-green-400 transition-colors opacity-0 group-hover/deck:opacity-100"
                  title={t('showDeck')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                {/* Delete button */}
                <button
                  onClick={() => handleDeleteDeck(label)}
                  className="p-0.5 rounded text-surface-600 hover:text-red-400 transition-colors opacity-0 group-hover/deck:opacity-100"
                  title={t('deleteDeck')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Create new deck */}
      <div className="px-2 py-1.5 border-t border-surface-700/50 flex items-center gap-1.5">
        <input
          ref={newDeckRef}
          value={newDeckName}
          onChange={(e) => setNewDeckName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreateDeck();
            if (e.key === 'Escape') onClose();
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder={t('deckNamePlaceholder')}
          className="flex-1 bg-surface-700 text-[11px] text-gray-200 px-2 py-1 rounded border border-surface-600 outline-none focus:border-primary-500/50 placeholder-surface-600"
        />
        {newDeckName.trim() && (
          <button onClick={handleCreateDeck} className="text-[10px] text-primary-400 hover:text-primary-300 font-medium px-1 shrink-0">
            +
          </button>
        )}
      </div>
    </div>
  );
}
