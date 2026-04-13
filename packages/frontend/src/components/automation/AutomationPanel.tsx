/**
 * AutomationPanel — Tasks + Schedules 통합 UI.
 *
 * 리스트 뷰, 칸반 뷰, 템플릿 갤러리를 하나의 패널에서 관리한다.
 * activeView = 'automations' 일 때 표시.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Automation, AutomationRun, WorkflowTemplate } from '@tower/shared';

const API = '/api/automations';

// ── Helpers ──

function modeIcon(mode: string) {
  switch (mode) {
    case 'spawn': return '\u{1F680}';   // rocket
    case 'inject': return '\u{1F4AC}';  // speech bubble
    case 'channel': return '\u{1F4E2}'; // loudspeaker
    default: return '\u{2699}';         // gear
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'running': return { bg: 'bg-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' };
    case 'idle': return { bg: 'bg-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-400' };
    case 'done': return { bg: 'bg-green-500/20', text: 'text-green-400', dot: 'bg-green-400' };
    case 'failed': return { bg: 'bg-red-500/20', text: 'text-red-400', dot: 'bg-red-400' };
    default: return { bg: 'bg-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-400' };
  }
}

function triggerLabel(a: Automation, t: (k: string) => string): string {
  if (a.triggerType === 'manual') return t('manual');
  if (a.triggerType === 'once') {
    return a.onceAt ? new Date(a.onceAt).toLocaleString() : t('once');
  }
  if (!a.cronConfig) return t('cron');
  const c = a.cronConfig;
  const time = `${String(c.hour ?? 9).padStart(2, '0')}:${String(c.minute ?? 0).padStart(2, '0')}`;
  switch (c.type) {
    case 'daily': return `${t('daily')} ${time}`;
    case 'weekdays': return `${t('weekdays')} ${time}`;
    case 'weekly': {
      const days = [t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')];
      return `${t('every')} ${days[c.day ?? 1]} ${time}`;
    }
    case 'interval': return `${t('every')} ${c.hours ?? 1}${t('hours')}`;
    default: return t('cron');
  }
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) {
    const mins = Math.floor(-diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    return `in ${hours}h`;
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Fetch helper ──

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ── Tab / View types ──

type ViewMode = 'list' | 'kanban';
type StatusFilter = 'all' | 'running' | 'idle' | 'scheduled' | 'done';

// ── Component ──

export function AutomationPanel() {
  const { t } = useTranslation('automation');

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);

  // ── Data loading ──

  const loadAutomations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchJson<Automation[]>(API);
      setAutomations(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await fetchJson<WorkflowTemplate[]>(`${API}/templates`);
      setTemplates(data);
    } catch {}
  }, []);

  useEffect(() => { loadAutomations(); loadTemplates(); }, [loadAutomations, loadTemplates]);

  // ── Filtering ──

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return automations;
    if (statusFilter === 'scheduled') return automations.filter(a => a.triggerType !== 'manual');
    return automations.filter(a => a.status === statusFilter);
  }, [automations, statusFilter]);

  // Counts for tabs
  const counts = useMemo(() => ({
    all: automations.length,
    running: automations.filter(a => a.status === 'running').length,
    idle: automations.filter(a => a.status === 'idle').length,
    scheduled: automations.filter(a => a.triggerType !== 'manual').length,
    done: automations.filter(a => a.status === 'done' || a.status === 'failed').length,
  }), [automations]);

  // Kanban columns
  const kanbanColumns = useMemo(() => ({
    idle: filtered.filter(a => a.status === 'idle'),
    running: filtered.filter(a => a.status === 'running'),
    done: filtered.filter(a => a.status === 'done' || a.status === 'failed'),
  }), [filtered]);

  // ── Actions ──

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetchJson(`${API}/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
      loadAutomations();
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await fetchJson(`${API}/${id}`, { method: 'DELETE' });
      loadAutomations();
    } catch (err: any) { setError(err.message); }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    try {
      const data = await fetchJson<AutomationRun[]>(`${API}/${id}/runs?limit=10`);
      setRuns(data);
    } catch { setRuns([]); }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    try {
      await fetchJson(`${API}/from-template`, {
        method: 'POST',
        body: JSON.stringify({ templateId }),
      });
      setShowTemplates(false);
      loadAutomations();
    } catch (err: any) { setError(err.message); }
  };

  // ── Render ──

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('title')}</h1>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[var(--border-primary)]">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {t('listView')}
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {t('kanbanView')}
            </button>
          </div>

          <button
            onClick={() => setShowTemplates(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)] transition-colors"
          >
            {t('templates')}
          </button>

          <button
            onClick={() => { setEditingId(null); setShowCreate(true); }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-90 transition-opacity"
          >
            + {t('create')}
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 px-5 py-2 border-b border-[var(--border-primary)] overflow-x-auto">
        {(['all', 'running', 'idle', 'scheduled', 'done'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
              statusFilter === f
                ? 'bg-[var(--accent-primary)] text-white'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            {t(`filter_${f}`)} {counts[f] > 0 && <span className="ml-1 opacity-70">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-[var(--text-tertiary)]">{t('loading')}</div>
        ) : automations.length === 0 ? (
          <EmptyState t={t} onShowTemplates={() => setShowTemplates(true)} />
        ) : viewMode === 'list' ? (
          <ListView
            automations={filtered}
            expandedId={expandedId}
            runs={runs}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onExpand={handleExpand}
            onEdit={(id) => { setEditingId(id); setShowCreate(true); }}
            t={t}
          />
        ) : (
          <KanbanView columns={kanbanColumns} t={t} />
        )}
      </div>

      {/* Modals */}
      {showTemplates && (
        <TemplateGallery
          templates={templates}
          onSelect={handleCreateFromTemplate}
          onClose={() => setShowTemplates(false)}
          t={t}
        />
      )}

      {showCreate && (
        <AutomationFormModal
          editingId={editingId}
          onClose={() => { setShowCreate(false); setEditingId(null); }}
          onSaved={() => { setShowCreate(false); setEditingId(null); loadAutomations(); }}
          t={t}
        />
      )}
    </div>
  );
}

// ── Empty State ──

function EmptyState({ t, onShowTemplates }: { t: (k: string) => string; onShowTemplates: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-60 gap-4 text-[var(--text-tertiary)]">
      <div className="text-4xl opacity-40">{'\u{2699}\uFE0F'}</div>
      <p className="text-sm">{t('empty')}</p>
      <button
        onClick={onShowTemplates}
        className="px-4 py-2 text-sm rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-90"
      >
        {t('browseTemplates')}
      </button>
    </div>
  );
}

// ── List View ──

function ListView({
  automations, expandedId, runs,
  onToggle, onDelete, onExpand, onEdit, t,
}: {
  automations: Automation[];
  expandedId: string | null;
  runs: AutomationRun[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onExpand: (id: string) => void;
  onEdit: (id: string) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="space-y-2">
      {automations.map((a) => {
        const badge = statusBadge(a.status);
        const isExpanded = expandedId === a.id;

        return (
          <div key={a.id} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Mode icon */}
              <span className="text-lg" title={a.mode}>{modeIcon(a.mode)}</span>

              {/* Name + trigger */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-[var(--text-primary)] truncate">{a.name}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.bg} ${badge.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                    {t(`status_${a.status}`)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--text-tertiary)]">
                  <span>{triggerLabel(a, t)}</span>
                  {a.nextRunAt && <span>next: {relativeTime(a.nextRunAt)}</span>}
                  {a.runCount > 0 && <span>{a.runCount} {t('runs')}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onToggle(a.id, a.enabled)}
                  className={`w-8 h-5 rounded-full relative transition-colors ${
                    a.enabled ? 'bg-[var(--accent-primary)]' : 'bg-gray-600'
                  }`}
                  title={a.enabled ? t('disable') : t('enable')}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    a.enabled ? 'left-3.5' : 'left-0.5'
                  }`} />
                </button>

                <button
                  onClick={() => onExpand(a.id)}
                  className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs"
                  title={t('viewRuns')}
                >
                  {isExpanded ? '\u25B2' : '\u25BC'}
                </button>

                <button
                  onClick={() => onEdit(a.id)}
                  className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs"
                  title={t('edit')}
                >
                  \u270E
                </button>

                <button
                  onClick={() => onDelete(a.id)}
                  className="p-1.5 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 text-xs"
                  title={t('delete')}
                >
                  \u2715
                </button>
              </div>
            </div>

            {/* Expanded runs */}
            {isExpanded && (
              <div className="border-t border-[var(--border-primary)] px-4 py-2 bg-[var(--bg-primary)]">
                {runs.length === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)] py-2">{t('noRuns')}</p>
                ) : (
                  <div className="space-y-1">
                    {runs.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 text-xs py-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${r.status === 'success' ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span className="text-[var(--text-tertiary)]">{new Date(r.ranAt).toLocaleString()}</span>
                        <span className="text-[var(--text-secondary)]">{r.mode}</span>
                        {r.durationMs != null && <span className="text-[var(--text-tertiary)]">{(r.durationMs / 1000).toFixed(1)}s</span>}
                        {r.error && <span className="text-red-400 truncate max-w-[200px]">{r.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Kanban View ──

function KanbanView({ columns, t }: {
  columns: { idle: Automation[]; running: Automation[]; done: Automation[] };
  t: (k: string) => string;
}) {
  const colDefs = [
    { key: 'idle' as const, label: t('status_idle'), color: 'border-gray-500/30', items: columns.idle },
    { key: 'running' as const, label: t('status_running'), color: 'border-blue-500/30', items: columns.running },
    { key: 'done' as const, label: t('status_done'), color: 'border-green-500/30', items: columns.done },
  ];

  return (
    <div className="grid grid-cols-3 gap-4 h-full">
      {colDefs.map((col) => (
        <div key={col.key} className={`flex flex-col rounded-xl border ${col.color} bg-[var(--bg-secondary)] overflow-hidden`}>
          <div className="px-4 py-3 border-b border-[var(--border-primary)]">
            <span className="text-sm font-medium text-[var(--text-primary)]">{col.label}</span>
            <span className="ml-2 text-xs text-[var(--text-tertiary)]">{col.items.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {col.items.map((a) => (
              <KanbanCard key={a.id} automation={a} t={t} />
            ))}
            {col.items.length === 0 && (
              <div className="text-center text-xs text-[var(--text-tertiary)] py-8 opacity-50">{t('empty')}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function KanbanCard({ automation: a, t }: { automation: Automation; t: (k: string) => string }) {
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 hover:border-[var(--accent-primary)]/50 transition-colors cursor-default">
      <div className="flex items-center gap-2">
        <span className="text-sm">{modeIcon(a.mode)}</span>
        <span className="text-sm font-medium text-[var(--text-primary)] truncate flex-1">{a.name}</span>
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-tertiary)]">
        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)]">{triggerLabel(a, t)}</span>
        {a.runCount > 0 && <span>{a.runCount} {t('runs')}</span>}
      </div>
      {a.progressSummary && a.progressSummary.length > 0 && (
        <p className="mt-2 text-xs text-[var(--text-secondary)] truncate">
          {a.progressSummary[a.progressSummary.length - 1]}
        </p>
      )}
    </div>
  );
}

// ── Template Gallery ──

function TemplateGallery({
  templates, onSelect, onClose, t,
}: {
  templates: WorkflowTemplate[];
  onSelect: (id: string) => void;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const categories = useMemo(() => {
    const cats = new Map<string, WorkflowTemplate[]>();
    for (const tpl of templates) {
      const list = cats.get(tpl.category) || [];
      list.push(tpl);
      cats.set(tpl.category, list);
    }
    return cats;
  }, [templates]);

  const catLabels: Record<string, string> = {
    research: t('catResearch'),
    development: t('catDevelopment'),
    operations: t('catOperations'),
    communication: t('catCommunication'),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-primary)] rounded-2xl border border-[var(--border-primary)] w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('templateGallery')}</h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">&times;</button>
        </div>

        <div className="p-6 space-y-6">
          {[...categories.entries()].map(([cat, tpls]) => (
            <div key={cat}>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">{catLabels[cat] || cat}</h3>
              <div className="grid grid-cols-2 gap-3">
                {tpls.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="group rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 hover:border-[var(--accent-primary)]/50 transition-colors cursor-pointer"
                    onClick={() => onSelect(tpl.id)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">{tpl.icon}</span>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{tpl.nameKo}</span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] line-clamp-2">{tpl.descriptionKo}</p>
                    <div className="flex items-center gap-2 mt-3 text-[10px] text-[var(--text-tertiary)]">
                      <span className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)]">{tpl.defaultTrigger}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)]">{tpl.defaultMode}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Create/Edit Form Modal ──

function AutomationFormModal({
  editingId, onClose, onSaved, t,
}: {
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
  t: (k: string) => string;
}) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [mode, setMode] = useState<'spawn' | 'inject' | 'channel'>('spawn');
  const [triggerType, setTriggerType] = useState<'manual' | 'cron' | 'once'>('manual');
  const [cronType, setCronType] = useState<'daily' | 'weekdays' | 'weekly' | 'interval'>('daily');
  const [cronHour, setCronHour] = useState(9);
  const [cronMinute, setCronMinute] = useState(0);
  const [cronDay, setCronDay] = useState(1);
  const [cronIntervalHours, setCronIntervalHours] = useState(1);
  const [saving, setSaving] = useState(false);

  // Load existing data for edit
  useEffect(() => {
    if (!editingId) return;
    fetchJson<Automation>(`${API}/${editingId}`).then((a) => {
      setName(a.name);
      setPrompt(a.prompt);
      setModel(a.model);
      setMode(a.mode);
      setTriggerType(a.triggerType === 'event' ? 'manual' : a.triggerType);
      if (a.cronConfig) {
        setCronType(a.cronConfig.type);
        setCronHour(a.cronConfig.hour ?? 9);
        setCronMinute(a.cronConfig.minute ?? 0);
        setCronDay(a.cronConfig.day ?? 1);
        setCronIntervalHours(a.cronConfig.hours ?? 1);
      }
    }).catch(() => {});
  }, [editingId]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const cronConfig = triggerType === 'cron' ? {
        type: cronType,
        hour: cronType !== 'interval' ? cronHour : undefined,
        minute: cronType !== 'interval' ? cronMinute : undefined,
        day: cronType === 'weekly' ? cronDay : undefined,
        hours: cronType === 'interval' ? cronIntervalHours : undefined,
      } : undefined;

      const body = { name, prompt, model, mode, triggerType, cronConfig };

      if (editingId) {
        await fetchJson(`${API}/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await fetchJson(API, { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-primary)]';
  const labelCls = 'block text-xs font-medium text-[var(--text-secondary)] mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-primary)] rounded-2xl border border-[var(--border-primary)] w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {editingId ? t('editAutomation') : t('createAutomation')}
          </h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">&times;</button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className={labelCls}>{t('name')}</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
          </div>

          {/* Prompt */}
          <div>
            <label className={labelCls}>{t('prompt')}</label>
            <textarea
              className={`${inputCls} h-24 resize-none`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('promptPlaceholder')}
            />
          </div>

          {/* Mode */}
          <div>
            <label className={labelCls}>{t('mode')}</label>
            <div className="flex gap-2">
              {(['spawn', 'inject', 'channel'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                    mode === m
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                      : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {modeIcon(m)} {t(`mode_${m}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Trigger */}
          <div>
            <label className={labelCls}>{t('trigger')}</label>
            <div className="flex gap-2">
              {(['manual', 'cron', 'once'] as const).map((tr) => (
                <button
                  key={tr}
                  onClick={() => setTriggerType(tr)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                    triggerType === tr
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                      : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {t(`trigger_${tr}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Cron config */}
          {triggerType === 'cron' && (
            <div className="space-y-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <div>
                <label className={labelCls}>{t('cronType')}</label>
                <select className={inputCls} value={cronType} onChange={(e) => setCronType(e.target.value as any)}>
                  <option value="daily">{t('daily')}</option>
                  <option value="weekdays">{t('weekdays')}</option>
                  <option value="weekly">{t('weekly')}</option>
                  <option value="interval">{t('interval')}</option>
                </select>
              </div>
              {cronType !== 'interval' && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className={labelCls}>{t('hour')}</label>
                    <input type="number" min={0} max={23} className={inputCls} value={cronHour} onChange={(e) => setCronHour(+e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className={labelCls}>{t('minute')}</label>
                    <input type="number" min={0} max={59} className={inputCls} value={cronMinute} onChange={(e) => setCronMinute(+e.target.value)} />
                  </div>
                </div>
              )}
              {cronType === 'weekly' && (
                <div>
                  <label className={labelCls}>{t('dayOfWeek')}</label>
                  <select className={inputCls} value={cronDay} onChange={(e) => setCronDay(+e.target.value)}>
                    {[t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')].map((d, i) => (
                      <option key={i} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              {cronType === 'interval' && (
                <div>
                  <label className={labelCls}>{t('intervalHours')}</label>
                  <input type="number" min={1} max={72} className={inputCls} value={cronIntervalHours} onChange={(e) => setCronIntervalHours(+e.target.value)} />
                </div>
              )}
            </div>
          )}

          {/* Model */}
          <div>
            <label className={labelCls}>{t('model')}</label>
            <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="claude-sonnet-4-6">Sonnet</option>
              <option value="claude-opus-4-6">Opus</option>
              <option value="claude-haiku-4-6">Haiku</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-primary)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t('saving') : editingId ? t('save') : t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}
