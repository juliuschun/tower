import React, { useState } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';

interface SummaryCardProps {
  session: SessionMeta;
}

export function SummaryCard({ session }: SummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const updateSessionMeta = useSessionStore((s) => s.updateSessionMeta);

  const turnCount = session.turnCount ?? 0;
  const summaryAtTurn = session.summaryAtTurn ?? 0;
  const filesCount = session.filesEdited?.length ?? 0;
  const isStale = session.summary && turnCount - summaryAtTurn >= 5;

  const handleSummarize = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/sessions/${session.id}/summarize`, {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        updateSessionMeta(session.id, {
          summary: data.summary,
          summaryAtTurn: data.summaryAtTurn,
        });
        setExpanded(true);
      }
    } catch {}
    setLoading(false);
  };

  return (
    <div className="mx-6 mt-4 mb-2">
      <div className="bg-surface-900/60 border border-surface-800/50 rounded-xl overflow-hidden">
        {/* Header — always visible */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <button
            onClick={() => session.summary ? setExpanded(!expanded) : handleSummarize()}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <svg className={`w-3.5 h-3.5 text-surface-600 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[12px] font-medium text-gray-400">
              {session.summary ? '요약' : '요약 없음'}
            </span>
          </button>

          {/* Meta chips */}
          <div className="flex items-center gap-2 shrink-0">
            {turnCount > 0 && (
              <span className="text-[10px] text-surface-600 bg-surface-800/50 px-1.5 py-0.5 rounded" title="턴 수">
                {turnCount}턴
              </span>
            )}
            {filesCount > 0 && (
              <span className="text-[10px] text-surface-600 bg-surface-800/50 px-1.5 py-0.5 rounded" title="편집된 파일">
                {filesCount}파일
              </span>
            )}
            {session.totalCost > 0 && (
              <span className="text-[10px] text-primary-400/70 bg-primary-900/10 px-1.5 py-0.5 rounded">
                ${session.totalCost.toFixed(4)}
              </span>
            )}
            {session.modelUsed && (
              <span className="text-[10px] text-purple-400/70 bg-purple-900/10 px-1.5 py-0.5 rounded">
                {session.modelUsed.replace('claude-', '').replace(/-\d+$/, '')}
              </span>
            )}
          </div>

          {/* Refresh button */}
          <button
            onClick={handleSummarize}
            disabled={loading}
            className="p-1 text-surface-600 hover:text-primary-400 transition-colors disabled:opacity-50 shrink-0"
            title={session.summary ? '요약 갱신' : '요약 생성'}
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Expanded content */}
        {expanded && session.summary && (
          <div className="px-4 pb-3 border-t border-surface-800/30">
            {isStale && (
              <div className="flex items-center gap-1.5 mt-2 mb-1.5 text-[10px] text-amber-400/80">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span>요약이 오래되었습니다 (+{turnCount - summaryAtTurn}턴)</span>
              </div>
            )}
            <p className="text-[12px] text-gray-400 leading-relaxed mt-2 whitespace-pre-wrap">
              {session.summary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
