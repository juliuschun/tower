import React, { useState } from 'react';
import { type SessionMeta } from '../../../stores/session-store';
import { type Project } from '../../../stores/project-store';
import { SessionItem } from '../../sessions/SessionItem';
import { getPreviewCount } from './utils';

/* ── Unlabeled Sessions (drop here to remove label) ── */

export function UnlabeledDropZone({ sessions, expanded, onDropSession, activeSessionId, currentUsername, onSelectSession, onDeleteSession, onRenameSession, onToggleFavorite, onMoveSession, projects }: {
  sessions: SessionMeta[];
  expanded: boolean;
  onDropSession: (sessionId: string) => void;
  activeSessionId: string | null;
  currentUsername?: string;
  onSelectSession: (s: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleFavorite: (id: string, fav: boolean) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  projects: Project[];
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`rounded transition-colors ${dragOver ? 'bg-surface-800/60 ring-1 ring-surface-600/30' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const sessionId = e.dataTransfer.getData('text/plain');
        if (sessionId) onDropSession(sessionId);
      }}
    >
      <div className="space-y-0.5">
        {(expanded ? sessions : sessions.slice(0, getPreviewCount(sessions))).map((session) => (
          <SessionItem key={session.id} session={session} isActive={session.id === activeSessionId} currentUsername={currentUsername} onSelect={onSelectSession} onDelete={onDeleteSession} onRename={onRenameSession} onToggleFavorite={onToggleFavorite} onMoveToProject={onMoveSession} projects={projects} />
        ))}
      </div>
    </div>
  );
}
