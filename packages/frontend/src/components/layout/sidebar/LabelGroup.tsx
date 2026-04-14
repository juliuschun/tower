import React, { useState } from 'react';
import { type SessionMeta } from '../../../stores/session-store';
import { type Project } from '../../../stores/project-store';
import { SessionItem } from '../../sessions/SessionItem';
import { LABEL_PREVIEW_COUNT, labelDisplay } from './utils';
import { DeckContextMenu } from './DeckContextMenu';

export function LabelGroup({ label, sessions, projectId, isCollapsed, onToggle, onDropSession, activeSessionId, currentUsername, onSelectSession, onDeleteSession, onRenameSession, onToggleFavorite, onMoveSession, projects }: {
  label: string;
  sessions: SessionMeta[];
  projectId: string;
  isCollapsed: boolean;
  onToggle: () => void;
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
  const [showAll, setShowAll] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const hasMore = sessions.length > LABEL_PREVIEW_COUNT;
  const visibleSessions = (!isCollapsed && hasMore && !showAll) ? sessions.slice(0, LABEL_PREVIEW_COUNT) : sessions;
  const display = labelDisplay(label);

  return (
    <div className="group/label">
      {/* Label header — clean section style */}
      <div
        onClick={onToggle}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const sessionId = e.dataTransfer.getData('text/plain');
          if (sessionId) onDropSession(sessionId);
        }}
        className={`flex items-center gap-1.5 py-1 px-0.5 -ml-0.5 rounded-md cursor-pointer transition-colors select-none ${
          dragOver ? 'bg-primary-600/15' : 'hover:bg-surface-850'
        }`}
      >
        {/* Chevron */}
        <svg className={`w-3 h-3 text-surface-600 transition-transform shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {/* Label name */}
        <span className="text-[13px] font-semibold text-surface-400 truncate">{display.name}</span>
        {/* Count */}
        {hasMore ? (
          <span
            onClick={(e) => { e.stopPropagation(); setShowAll(!showAll); }}
            className="text-[10px] tabular-nums shrink-0 cursor-pointer transition-colors text-surface-600 hover:text-primary-400 ml-auto"
            title={showAll ? `${LABEL_PREVIEW_COUNT}개만 보기` : `전체 ${sessions.length}개 보기`}
          >
            {showAll ? sessions.length : `${LABEL_PREVIEW_COUNT}/${sessions.length}`}
          </span>
        ) : (
          <span className="text-[10px] tabular-nums text-surface-600 shrink-0 ml-auto">{sessions.length}</span>
        )}
      </div>
      {/* Sessions — indented under label like tree children */}
      {!isCollapsed && (
        <div className="ml-2 pl-2.5 border-l border-surface-800/60 space-y-0.5">
          {visibleSessions.map((session) => (
            <SessionItem key={session.id} session={session} isActive={session.id === activeSessionId} currentUsername={currentUsername} onSelect={onSelectSession} onDelete={onDeleteSession} onRename={onRenameSession} onToggleFavorite={onToggleFavorite} onMoveToProject={onMoveSession} projects={projects} />
          ))}
        </div>
      )}
      {/* Deck context menu */}
      {ctxMenu && (
        <DeckContextMenu x={ctxMenu.x} y={ctxMenu.y} label={label} sessions={sessions} projectId={projectId} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}
