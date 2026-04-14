import React from 'react';
import { useSessionStore, type SessionMeta } from '../../../stores/session-store';
import { useTranslation } from 'react-i18next';

/* ── Stats Bar — running / done / 7-day pace ── */
export function StatsBar({ sessions }: { sessions: SessionMeta[] }) {
  const { t } = useTranslation('layout');
  const streamingSessions = useSessionStore((s) => s.streamingSessions);
  const unreadSessions = useSessionStore((s) => s.unreadSessions);

  const runningCount = streamingSessions.size;
  // Done = recently completed (unread) but NOT currently running
  const doneCount = React.useMemo(() => {
    let count = 0;
    unreadSessions.forEach(id => { if (!streamingSessions.has(id)) count++; });
    return count;
  }, [unreadSessions, streamingSessions]);

  // 7-day session count
  const weekCount = React.useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return sessions.filter(s => {
      const t = new Date(s.updatedAt.includes('T') ? s.updatedAt : s.updatedAt.replace(' ', 'T') + 'Z').getTime();
      return t > cutoff;
    }).length;
  }, [sessions]);

  // Nothing to show? Hide entirely
  if (runningCount === 0 && doneCount === 0 && weekCount === 0) return null;

  return (
    <div className="flex items-center gap-2.5 pb-1.5 px-0.5">
      {runningCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {t('running_count', { count: runningCount })}
        </span>
      )}
      {doneCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {t('done_count', { count: doneCount })}
        </span>
      )}
      {weekCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-surface-600">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          {t('week_count', { count: weekCount })}
        </span>
      )}
    </div>
  );
}
