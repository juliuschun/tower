import { useState, useEffect, useCallback } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { type TaskMeta } from '../../stores/kanban-store';
import { toastSuccess, toastError } from '../../utils/toast';

type HistoryTab = 'sessions' | 'tasks';

interface ArchivedSession extends SessionMeta {}
interface ArchivedTask extends TaskMeta {}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: 'bg-green-500/15 text-green-400 border-green-500/30',
    failed: 'bg-red-500/15 text-red-400 border-red-500/30',
    todo: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
    in_progress: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${colors[status] || colors.todo}`}>
      {status === 'in_progress' ? 'in progress' : status}
    </span>
  );
}

export function HistoryPanel() {
  const [tab, setTab] = useState<HistoryTab>('sessions');
  const [sessions, setSessions] = useState<ArchivedSession[]>([]);
  const [tasks, setTasks] = useState<ArchivedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/history', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleRestoreSession = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/restore`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        // Also add back to the live sessions list
        const restored = sessions.find((s) => s.id === id);
        if (restored) {
          useSessionStore.getState().addSession(restored);
        }
        toastSuccess('Session restored');
      }
    } catch {
      toastError('Failed to restore session');
    }
  };

  const handleDeleteSessionPermanent = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/permanent`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        toastSuccess('Session permanently deleted');
      }
    } catch {
      toastError('Failed to delete session');
    }
  };

  const handleRestoreTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/restore`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        toastSuccess('Task restored to board');
      }
    } catch {
      toastError('Failed to restore task');
    }
  };

  const handleDeleteTaskPermanent = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/permanent`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        toastSuccess('Task permanently deleted');
      }
    } catch {
      toastError('Failed to delete task');
    }
  };

  const handleSessionClick = (session: ArchivedSession) => {
    // Restore and switch to chat view
    handleRestoreSession(session.id).then(() => {
      useSessionStore.getState().setActiveView('chat');
      useSessionStore.getState().setActiveSessionId(session.id);
      window.dispatchEvent(new CustomEvent('kanban-select-session', { detail: { sessionId: session.id } }));
    });
  };

  const filteredSessions = searchQuery
    ? sessions.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  const filteredTasks = searchQuery
    ? tasks.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase()))
    : tasks;

  const tabClass = (t: HistoryTab) =>
    `flex-1 py-2 text-[12px] font-semibold tracking-wide transition-colors cursor-pointer ${
      tab === t
        ? 'text-primary-400 border-b-2 border-primary-500'
        : 'text-gray-500 hover:text-gray-300'
    }`;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-surface-800 border border-surface-700/50 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-200">History</h2>
            <p className="text-[11px] text-gray-500">
              {sessions.length} archived session{sessions.length !== 1 ? 's' : ''} · {tasks.length} archived task{tasks.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-800/50 border border-surface-700/50 rounded-lg text-[13px] text-gray-300 pl-10 pr-4 py-2 placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors"
          />
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-surface-800/50">
          <button onClick={() => setTab('sessions')} className={tabClass('sessions')}>
            Sessions ({sessions.length})
          </button>
          <button onClick={() => setTab('tasks')} className={tabClass('tasks')}>
            Tasks ({tasks.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 border-surface-700 border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : tab === 'sessions' ? (
          filteredSessions.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-12 h-12 mx-auto text-surface-700 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <p className="text-[13px] text-gray-500">
                {searchQuery ? 'No matching sessions' : 'No archived sessions'}
              </p>
              <p className="text-[11px] text-surface-600 mt-1">
                Deleted sessions will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-1 mt-2">
              {filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-800/50 transition-colors cursor-pointer"
                  onClick={() => handleSessionClick(session)}
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-800 border border-surface-700/30 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-gray-300 truncate">{session.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-surface-600">{relativeTime(session.updatedAt)}</span>
                      {session.turnCount ? (
                        <span className="text-[10px] text-surface-600">{session.turnCount} turns</span>
                      ) : null}
                      {session.totalCost > 0 && (
                        <span className="text-[10px] text-surface-600">${session.totalCost.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRestoreSession(session.id); }}
                      className="p-1.5 rounded-md hover:bg-surface-700 text-gray-500 hover:text-green-400 transition-colors"
                      title="Restore to sidebar"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteSessionPermanent(session.id); }}
                      className="p-1.5 rounded-md hover:bg-surface-700 text-gray-500 hover:text-red-400 transition-colors"
                      title="Delete permanently"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          filteredTasks.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-12 h-12 mx-auto text-surface-700 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <p className="text-[13px] text-gray-500">
                {searchQuery ? 'No matching tasks' : 'No archived tasks'}
              </p>
              <p className="text-[11px] text-surface-600 mt-1">
                Deleted board tasks will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-1 mt-2">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className="group flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-800/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-800 border border-surface-700/30 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-gray-300 truncate">{task.title}</span>
                      <StatusBadge status={task.status} />
                    </div>
                    {task.description && (
                      <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-surface-600">{relativeTime(task.updatedAt)}</span>
                      <span className="text-[10px] text-surface-600 font-mono">{task.cwd.replace(/^\/home\/[^/]+/, '~')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => handleRestoreTask(task.id)}
                      className="p-1.5 rounded-md hover:bg-surface-700 text-gray-500 hover:text-green-400 transition-colors"
                      title="Restore to board"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteTaskPermanent(task.id)}
                      className="p-1.5 rounded-md hover:bg-surface-700 text-gray-500 hover:text-red-400 transition-colors"
                      title="Delete permanently"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
