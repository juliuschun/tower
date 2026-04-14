import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/* ── Ungrouped Drop Zone ── */

export function UngroupedDropZone({ children, onMoveSession, hasGroups, hasUngrouped }: {
  children: React.ReactNode;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  hasGroups: boolean;
  hasUngrouped: boolean;
}) {
  const { t } = useTranslation('layout');
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`mt-2 rounded-md transition-colors ${dragOver ? 'bg-surface-800/50 ring-1 ring-surface-700/50' : ''} ${!hasUngrouped && hasGroups ? 'min-h-[40px] flex items-center justify-center' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const sessionId = e.dataTransfer.getData('text/plain');
        if (sessionId) onMoveSession(sessionId, null);
      }}
    >
      {!hasUngrouped && dragOver && (
        <span className="text-[10px] text-surface-500">{t('dropToRemoveFromProject')}</span>
      )}
      {children}
    </div>
  );
}
