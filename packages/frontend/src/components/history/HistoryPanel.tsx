import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSessionStore, type SessionMeta } from '../../stores/session-store';
import { useProjectStore } from '../../stores/project-store';
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
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: 'bg-green-500/15 text-green-400',
    failed: 'bg-red-500/15 text-red-400',
    todo: 'bg-gray-500/15 text-gray-400',
    in_progress: 'bg-blue-500/15 text-blue-400',
  };
  return (
    <span className={`text-[9px] font-medium px-1 py-px rounded ${colors[status] || colors.todo}`}>
      {status === 'in_progress' ? 'wip' : status}
    </span>
  );
}

export function HistoryPanel() {
  const [tab, setTab] = useState<HistoryTab>('sessions');
  const [sessions, setSessions] = useState<ArchivedSession[]>([]);
  const [tasks, setTasks] = useState<ArchivedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const activeView = useSessionStore((s) => s.activeView);
  const sidebarTab = useSessionStore((s) => s.sidebarTab);
  const projects = useProjectStore((s) => s.projects);

  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

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
    if (activeView === 'history' || sidebarTab === 'history') loadHistory();
  }, [activeView, sidebarTab, loadHistory]);

  const handleRestoreSession = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/restore`, { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        const restored = sessions.find((s) => s.id === id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (restored) useSessionStore.getState().addSession(restored);
        toastSuccess('Session restored');
      }
    } catch { toastError('Failed to restore session'); }
  };

  const handleDeleteSessionPermanent = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/permanent`, { method: 'DELETE', headers: getAuthHeaders() });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        toastSuccess('Permanently deleted');
      }
    } catch { toastError('Failed to delete'); }
  };

  const handleRestoreTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/restore`, { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        toastSuccess('Task restored');
      }
    } catch { toastError('Failed to restore task'); }
  };

  const handleDeleteTaskPermanent = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/permanent`, { method: 'DELETE', headers: getAuthHeaders() });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        toastSuccess('Permanently deleted');
      }
    } catch { toastError('Failed to delete'); }
  };

  const handleSessionClick = (session: ArchivedSession) => {
    if (!useSessionStore.getState().sessions.find((s) => s.id === session.id)) {
      useSessionStore.getState().addSession(session);
    }
    window.dispatchEvent(new CustomEvent('kanban-select-session', { detail: { sessionId: session.id } }));
  };

  const filteredSessions = searchQuery
    ? sessions.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  const filteredTasks = searchQuery
    ? tasks.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase()))
    : tasks;

  // Group sessions by project
  const groupedSessions = useMemo(() => {
    const groups = new Map<string | null, ArchivedSession[]>();
    for (const s of filteredSessions) {
      const key = s.projectId || null;
      const list = groups.get(key) || [];
      list.push(s);
      groups.set(key, list);
    }
    // Sort: projects with names first, then ungrouped
    const sorted: { projectId: string | null; name: string; sessions: ArchivedSession[] }[] = [];
    for (const [pid, list] of groups) {
      sorted.push({ projectId: pid, name: pid ? (projectMap.get(pid) || 'Unknown') : 'temp', sessions: list });
    }
    sorted.sort((a, b) => {
      if (a.projectId && !b.projectId) return -1;
      if (!a.projectId && b.projectId) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [filteredSessions, projectMap]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Compact header */}
      <div className="px-3 pt-2 pb-1">
        {/* Search */}
        <div className="relative mb-1.5">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-800 border border-surface-700 rounded-md text-[12px] text-gray-300 pl-8 pr-3 py-1.5 placeholder-surface-700 outline-none focus:border-primary-500/50 transition-colors"
          />
        </div>

        {/* Tab switcher — compact */}
        <div className="flex gap-1">
          <button
            onClick={() => setTab('sessions')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              tab === 'sessions'
                ? 'bg-primary-600/20 text-primary-400'
                : 'text-surface-600 hover:text-gray-400 hover:bg-surface-800'
            }`}
          >
            Sessions ({sessions.length})
          </button>
          <button
            onClick={() => setTab('tasks')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              tab === 'tasks'
                ? 'bg-primary-600/20 text-primary-400'
                : 'text-surface-600 hover:text-gray-400 hover:bg-surface-800'
            }`}
          >
            Tasks ({tasks.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 border-surface-700 border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : tab === 'sessions' ? (
          filteredSessions.length === 0 ? (
            <p className="text-[11px] text-surface-600 text-center py-8">
              {searchQuery ? 'No matching sessions' : 'No archived sessions'}
            </p>
          ) : (
            <div className="mt-1">
              {groupedSessions.map(({ projectId, name, sessions: groupSessions }) => {
                const key = projectId || '__temp__';
                const collapsed = collapsedGroups.has(key);
                return (
                  <div key={key} className="mb-1">
                    {/* Project group header */}
                    <button
                      onClick={() => toggleGroup(key)}
                      className="w-full flex items-center gap-1.5 px-1 py-1 group"
                    >
                      <svg className={`w-3 h-3 text-surface-600 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="text-[10px] text-surface-600 font-medium truncate">{name}</span>
                      <span className="text-[9px] text-surface-700">({groupSessions.length})</span>
                    </button>
                    {/* Session items */}
                    {!collapsed && (
                      <div className="space-y-0.5">
                        {groupSessions.map((session) => (
                          <div
                            key={session.id}
                            onClick={() => handleSessionClick(session)}
                            className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-800/60 transition-colors cursor-pointer"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] text-gray-400 truncate">{session.name}</div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[9px] text-surface-600">{relativeTime(session.updatedAt)}</span>
                                {session.turnCount ? <span className="text-[9px] text-surface-700">{session.turnCount}t</span> : null}
                                {session.totalCost > 0 && <span className="text-[9px] text-surface-700">${session.totalCost.toFixed(2)}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRestoreSession(session.id); }}
                                className="p-1 rounded hover:bg-surface-700 text-surface-600 hover:text-green-400 transition-colors"
                                title="Restore"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteSessionPermanent(session.id); }}
                                className="p-1 rounded hover:bg-surface-700 text-surface-600 hover:text-red-400 transition-colors"
                                title="Delete permanently"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Tasks tab */
          filteredTasks.length === 0 ? (
            <p className="text-[11px] text-surface-600 text-center py-8">
              {searchQuery ? 'No matching tasks' : 'No archived tasks'}
            </p>
          ) : (
            <div className="space-y-0.5 mt-1">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-800/60 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] text-gray-400 truncate">{task.title}</span>
                      <StatusBadge status={task.status} />
                    </div>
                    {task.description && (
                      <p className="text-[10px] text-surface-600 truncate mt-0.5">{task.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-surface-700">{relativeTime(task.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => handleRestoreTask(task.id)}
                      className="p-1 rounded hover:bg-surface-700 text-surface-600 hover:text-green-400 transition-colors"
                      title="Restore"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteTaskPermanent(task.id)}
                      className="p-1 rounded hover:bg-surface-700 text-surface-600 hover:text-red-400 transition-colors"
                      title="Delete permanently"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
